using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Infrastructure.Persistence;
using RestaurantManagement.Application.Contracts;

namespace RestaurantManagement.WebApi.V2;

// One database revision check per active warehouse, shared by all its connections.
// PostgreSQL revision is authoritative: commits from integrations/admin tools and
// other backend instances are also observed; rolled-back changes are never sent.
public sealed class AvailabilityFeed(IServiceScopeFactory scopes, TimeProvider clock)
{
    public sealed record Notice(string Type, Guid WarehouseId, Guid BackendInstanceId, string Revision, string ClockVersion);
    sealed class Entry {
        public readonly SemaphoreSlim Gate = new(1, 1);
        public int Users;
        public DateTime CheckedAt;
        public long Revision = -1;
        public Guid Instance;
        public DateTime[] Boundaries = [];
    }
    readonly ConcurrentDictionary<Guid, Entry> entries = new();
    readonly object rosterLock = new();
    public IDisposable Subscribe(Guid warehouse) {
        lock(rosterLock) entries.GetOrAdd(warehouse, _ => new()).Users++;
        return new Subscription(() => { lock(rosterLock) {
            if(entries.TryGetValue(warehouse,out var entry) && --entry.Users==0) entries.TryRemove(warehouse,out _);
        }});
    }
    sealed class Subscription(Action release) : IDisposable {
        int disposed;
        public void Dispose() { if(Interlocked.Exchange(ref disposed,1)==0) release(); }
    }
    public async Task<Notice> Read(Guid warehouse, CancellationToken ct) {
        if(!entries.TryGetValue(warehouse,out var entry)) throw new InvalidOperationException("No active subscription");
        await entry.Gate.WaitAsync(ct);
        try {
            var now=clock.GetUtcNow().UtcDateTime;
            if(entry.Revision<0 || now-entry.CheckedAt>=TimeSpan.FromSeconds(1.5)) {
                using var scope=scopes.CreateScope(); var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await using var tx=await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead,ct);
                await db.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout='3s'",ct);
                var revision=await db.Warehouses.AsNoTracking().Where(w=>w.Id==warehouse).Select(w=>w.StateRevision).SingleAsync(ct);
                var instance=await db.Runtime.AsNoTracking().Select(r=>r.BackendInstanceId).SingleAsync(ct);
                if(entry.Revision!=revision || entry.Instance!=instance) {
                    var wid=WarehouseId.From(warehouse);
                    var batches=await db.Batches.AsNoTracking().Where(b=>b.WarehouseId==wid).ToArrayAsync(ct);
                    entry.Boundaries=batches.Where(b=>b.FreeQuantity>0).SelectMany(b=>new[]{b.ExpirationDate.Value,b.ExpirationDate.Value.AddSeconds(-b.GetCriticalThresholdSeconds())}).Order().ToArray();
                }
                await tx.CommitAsync(ct);
                entry.Revision=revision; entry.Instance=instance; entry.CheckedAt=now;
            }
            return new("availability.changed",warehouse,entry.Instance,entry.Revision.ToString(System.Globalization.CultureInfo.InvariantCulture),entry.Boundaries.Count(t=>t<=now).ToString(System.Globalization.CultureInfo.InvariantCulture));
        } finally { entry.Gate.Release(); }
    }
}

public static class AvailabilitySocket
{
    public static async Task Handle(HttpContext http, Guid warehouseId, AccessService access, AvailabilityFeed feed, IConfiguration config, ILoggerFactory logs) {
        var origins=config.GetSection("App:AllowedOrigins").Get<string[]>() ?? [];
        if(!origins.Contains(http.Request.Headers.Origin.ToString(),StringComparer.Ordinal)) throw new ApiFailure(403,"ORIGIN_FORBIDDEN","Источник подключения не разрешён");
        if(!http.WebSockets.IsWebSocketRequest) { http.Response.StatusCode=426; return; }
        var channel=http.Request.Path.StartsWithSegments("/api/v2/customer")?"customer":"staff";
        var actor=await access.Warehouse(http,warehouseId,channel,channel=="customer"?["customer"]:["super_admin","owner","manager","warehouse","waiter"]);
        if(!Guid.TryParse(http.Request.Query["userId"],out var expected) || expected!=actor.Id) throw ApiFailure.Conflict("SESSION_CONTEXT_CHANGED");
        using var subscription=feed.Subscribe(warehouseId);
        // Fail before upgrade when the database cannot provide a valid snapshot.
        var initial=await feed.Read(warehouseId,http.RequestAborted);
        using var socket=await http.WebSockets.AcceptWebSocketAsync();
        using var cancelled=CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);
        var ct=cancelled.Token;
        async Task Receive() {
            var buffer=new byte[256];
            while(!ct.IsCancellationRequested) {
                var message=await socket.ReceiveAsync(buffer,ct);
                if(message.MessageType==WebSocketMessageType.Close) return;
                // This endpoint is notification-only; it accepts no commands/data.
                throw new WebSocketException("Unexpected client payload");
            }
        }
        async Task Send() {
            AvailabilityFeed.Notice? last=null;var nextAuth=DateTime.MinValue;var nextHeartbeat=DateTime.MinValue;
            while(!ct.IsCancellationRequested) {
                if(DateTime.UtcNow>=nextAuth) {
                    var fresh=await access.Warehouse(http,warehouseId,channel,channel=="customer"?["customer"]:["super_admin","owner","manager","warehouse","waiter"]);
                    if(fresh.Id!=expected)throw ApiFailure.Conflict("SESSION_CONTEXT_CHANGED");
                    nextAuth=DateTime.UtcNow.AddSeconds(10);
                }
                var notice=last is null?initial:await feed.Read(warehouseId,ct);
                if(notice!=last || DateTime.UtcNow>=nextHeartbeat) {
                    var payload=Encoding.UTF8.GetBytes(ContractJson.Serialize(notice));
                    await socket.SendAsync(payload,WebSocketMessageType.Text,true,ct);
                    nextHeartbeat=DateTime.UtcNow.AddSeconds(10);last=notice;
                }
                await Task.Delay(TimeSpan.FromSeconds(2),ct);
            }
        }
        var receiving=Receive();var sending=Send();
        try { await await Task.WhenAny(receiving,sending); }
        catch(Exception ex) when(ex is ApiFailure or WebSocketException or OperationCanceledException or InvalidOperationException or Npgsql.NpgsqlException) {
            if(ex is not OperationCanceledException) logs.CreateLogger("AvailabilitySocket").LogInformation("Availability stream ended ({Reason})",ex.GetType().Name);
        } finally {
            cancelled.Cancel();
            try { await Task.WhenAll(receiving,sending); } catch { /* Both tasks are observed during shutdown. */ }
            if(socket.State is WebSocketState.Open or WebSocketState.CloseReceived) {
                using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(2));
                try { await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure,"Reconnect and refresh",timeout.Token); } catch(Exception ex) when(ex is WebSocketException or OperationCanceledException) { }
            }
        }
    }
}
