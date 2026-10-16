using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Application.Stock;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Infrastructure.Persistence;

namespace RestaurantManagement.WebApi.V2;

public sealed partial class WarehouseService
{
    public async Task<(string Name, Dictionary<string, double> Values)> MetricsSnapshot(WarehouseRecord warehouse, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
        await db.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", ct);
        var w = await db.Warehouses.SingleAsync(w => w.Id == warehouse.Id, ct);
        var now = ContractJson.Now(clock); var s = await Load(w, now, new(Guid.Empty, "internal"), ct);
        var inventory = Inventory(s); var menu = Availability(s); var values = new Dictionary<string, double>();
        foreach (var status in new[] { "fresh", "expiring", "expired", "empty" }) values[$"rims_inventory_batches|state={status}"] = s.Batches.Count(b => (b.IsEmpty ? "empty" : StockKernel.Risk(b, now).Phase) == status);
        values["rims_inventory_low_stock_ingredients"] = inventory.Count(j => j["isLowStock"]!.GetValue<bool>());
        values["rims_inventory_out_of_stock_ingredients"] = inventory.Count(j => Qty(j, "availableQuantity") == 0);
        foreach (var status in new[] { "available", "stopped", "inactive" }) values[$"rims_menu_dishes|state={status}"] = menu.Count(j => j["status"]!.GetValue<string>() == status);
        values["rims_hot_offers"] = Offers(s).Length;
        var pending = s.Deliveries.Where(d => d.Status == RestaurantManagement.Domain.Supplies.ValueObjects.DeliveryStatus.Pending).ToArray();
        values["rims_deliveries_pending"] = pending.Length;
        values["rims_oldest_pending_delivery_age_seconds"] = pending.Length == 0 ? 0 : Math.Max(0, (now - pending.Min(d => d.CreatedAt)).TotalSeconds);
        var replays = await db.Replays.AsNoTracking().Where(r => r.WarehouseId == w.Id && r.Status == 409 && r.Path.EndsWith("/orders")).ToArrayAsync(ct);
        foreach (var source in new[] { "staff", "waiter", "customer", "integration" }) {
            values[$"rims_orders_total|source={source}|result=accepted"] = s.Orders.Count(o => o.Source == source && o.CreatedAt >= w.TrackingStartedAt);
            string Source(ReplayRecord r) => r.Path.StartsWith("/integrations/", StringComparison.Ordinal) ? "integration" : r.Path.StartsWith("/api/v2/customer/", StringComparison.Ordinal) ? "customer" : r.Path.Contains("/service/", StringComparison.Ordinal) ? "waiter" : "staff";
            values[$"rims_orders_total|source={source}|result=rejected"] = replays.Count(r => Source(r) == source);
        }
        foreach (var reason in new[] { "expired", "damaged" }) values[$"rims_writeoffs_total|reason={reason}"] = s.Documents.Count(d => d.Kind == "write_off" && System.Text.Json.Nodes.JsonNode.Parse(d.Json)!["reason"]!.GetValue<string>() == reason);
        values["rims_deliveries_confirmed_total"] = s.Deliveries.Count(d => s.Batches.Any(b => b.DeliveryId == d.Id && b.ReceiptCommittedAt >= w.TrackingStartedAt));
        values["rims_snapshot_timestamp_seconds"] = new DateTimeOffset(now).ToUnixTimeMilliseconds() / 1000d;
        values["rims_snapshot_success"] = 1;
        await tx.CommitAsync(ct); return (s.RestaurantName, values);
    }
}

public sealed class LiveMetrics(IServiceScopeFactory scopes, TimeProvider clock, ILogger<LiveMetrics> log) : BackgroundService
{
    readonly object gate = new(); readonly SemaphoreSlim refreshGate = new(1, 1);
    readonly Dictionary<Guid, (string Name, Dictionary<string, double> Values)> warehouses = [];
    readonly Dictionary<(string Operation, string Outcome), (long[] Buckets, double Sum, long Count)> histograms = [];
    static readonly double[] Buckets = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, double.PositiveInfinity];
    static readonly string[] Operations = ["order_create", "delivery_create", "delivery_confirm", "menu_read"];
    public void Observe(HttpContext http, double seconds)
    {
        var p = http.Request.Path.Value ?? ""; string? op = http.Request.Method == "POST" && p.EndsWith("/orders", StringComparison.Ordinal) ? "order_create" : http.Request.Method == "POST" && p.EndsWith("/deliveries", StringComparison.Ordinal) ? "delivery_create" : http.Request.Method == "POST" && p.Contains("/deliveries/", StringComparison.Ordinal) && p.EndsWith("/confirm", StringComparison.Ordinal) ? "delivery_confirm" : http.Request.Method == "GET" && (p.EndsWith("/menu", StringComparison.Ordinal) || p.EndsWith("/menu/availability", StringComparison.Ordinal)) ? "menu_read" : null;
        if (op == null) return;
        var key = (op, http.Response.StatusCode is >= 200 and < 300 ? "success" : "error");
        lock (gate) { var h = histograms.GetValueOrDefault(key, (Buckets: new long[Buckets.Length], Sum: 0d, Count: 0L)); for (var i = 0; i < Buckets.Length; i++) if (seconds <= Buckets[i]) h.Buckets[i]++; histograms[key] = (h.Buckets, h.Sum + seconds, h.Count + 1); }
    }
    double rosterTimestamp;
    bool rosterSuccess;
    public async Task Refresh(CancellationToken ct = default)
    {
        await refreshGate.WaitAsync(ct);
        try {
            using var scope = scopes.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var roster = await db.Warehouses.AsNoTracking().ToArrayAsync(ct); if (roster.Length > 100) throw new InvalidOperationException("Metrics warehouse roster exceeds configured bound 100.");
            lock (gate) { rosterSuccess = true; rosterTimestamp = clock.GetUtcNow().ToUnixTimeMilliseconds() / 1000d; }
            lock (gate) foreach (var removed in warehouses.Keys.Except(roster.Select(w => w.Id)).ToArray()) warehouses.Remove(removed);
            foreach (var w in roster) {
                try {
                    using var snapshotScope = scopes.CreateScope(); var service = snapshotScope.ServiceProvider.GetRequiredService<WarehouseService>();
                    var snapshot = await service.MetricsSnapshot(w, ct); lock (gate) warehouses[w.Id] = snapshot;
                } catch (Exception ex) { log.LogError(ex, "Metrics snapshot failed for warehouse {WarehouseId}", w.Id); lock (gate) {
                    if (!warehouses.TryGetValue(w.Id, out var existing)) existing = ("Unknown", new() { ["rims_snapshot_timestamp_seconds"] = 0 });
                    existing.Values["rims_snapshot_success"] = 0; warehouses[w.Id] = existing;
                } }
            }
        } catch (Exception ex) { log.LogError(ex, "Metrics roster refresh failed"); lock (gate) { rosterSuccess = false; foreach (var value in warehouses.Values) value.Values["rims_snapshot_success"] = 0; } }
        finally { refreshGate.Release(); }
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested) { await Refresh(stoppingToken); try { await Task.Delay(TimeSpan.FromSeconds(15), clock, stoppingToken); } catch (OperationCanceledException) { break; } }
    }
    static string Escape(string s) => s.Replace("\\", "\\\\").Replace("\n", "\\n").Replace("\"", "\\\"");
    public string Export()
    {
        var b = new StringBuilder("# HELP rims_source_info Authoritative backend metrics source\n# TYPE rims_source_info gauge\nrims_source_info{source_kind=\"live\",contract_version=\"1.0\"} 1\n");
        void Sample(string name, string labels, double value) => b.Append(name).Append('{').Append(labels).Append("} ").Append(value.ToString("R", CultureInfo.InvariantCulture)).Append('\n');
        lock (gate) {
            b.Append("# HELP rims_source_roster_success Last warehouse roster read succeeded, including an empty database\n# TYPE rims_source_roster_success gauge\n# HELP rims_source_roster_timestamp_seconds Last successful roster read Unix time\n# TYPE rims_source_roster_timestamp_seconds gauge\n");
            Sample("rims_source_roster_success", "", rosterSuccess ? 1 : 0);
            Sample("rims_source_roster_timestamp_seconds", "", rosterTimestamp);
            var types = warehouses.Values.SelectMany(w => w.Values.Keys).Select(k => k.Split('|')[0]).Distinct().ToArray();
            b.Append("# HELP rims_warehouse_info Warehouse roster\n# TYPE rims_warehouse_info gauge\n");
            foreach (var name in types) b.Append("# HELP ").Append(name).Append(" Live PostgreSQL projection\n# TYPE ").Append(name).Append(name.EndsWith("_total", StringComparison.Ordinal) ? " counter\n" : " gauge\n");
            foreach (var (id, warehouse) in warehouses) {
                var labels = $"warehouse_id=\"{id}\""; Sample("rims_warehouse_info", labels + $",warehouse_name=\"{Escape(warehouse.Name)}\"", 1);
                foreach (var (key, value) in warehouse.Values) { var parts = key.Split('|'); Sample(parts[0], labels + string.Concat(parts.Skip(1).Select(s => { var kv = s.Split('='); return $",{kv[0]}=\"{kv[1]}\""; })), value); }
            }
            b.Append("# HELP rims_api_request_duration_seconds Actual backend request duration\n# TYPE rims_api_request_duration_seconds histogram\n");
            foreach (var op in Operations) foreach (var outcome in new[] { "success", "error" }) {
                var h = histograms.GetValueOrDefault((op, outcome), (Buckets: new long[Buckets.Length], Sum: 0d, Count: 0L)); var labels = $"operation=\"{op}\",outcome=\"{outcome}\"";
                for (var i = 0; i < Buckets.Length; i++) Sample("rims_api_request_duration_seconds_bucket", labels + $",le=\"{(double.IsPositiveInfinity(Buckets[i]) ? "+Inf" : Buckets[i].ToString(CultureInfo.InvariantCulture))}\"", h.Buckets[i]);
                Sample("rims_api_request_duration_seconds_sum", labels, h.Sum); Sample("rims_api_request_duration_seconds_count", labels, h.Count);
            }
        }
        return b.ToString();
    }
}


