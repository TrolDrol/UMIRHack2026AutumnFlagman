using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Infrastructure.Persistence;
using Testcontainers.PostgreSql;
using Xunit;

[assembly: CollectionBehavior(DisableTestParallelization = true)]
namespace RestaurantManagement.Tests;

public sealed class ControlledClock : TimeProvider
{
    DateTimeOffset now = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => now;
    public void Set(DateTimeOffset value) => now = value;
}
public sealed class TestHost(string connection, ControlledClock clock, int authLimit=1000) : WebApplicationFactory<Program>
{
    public FailureInjector Failure { get; } = new();
    // CookieContainer uses wall time, while application/session expiry uses the
    // deterministic test clock. Preserve the cookie's remaining lifetime at the
    // transport boundary so these real PostgreSQL tests also run after 14 Oct.
    public new HttpClient CreateClient() => CreateDefaultClient(new CookieContainerHandler(), new TestCookieClock(clock));
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");
        builder.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?> {
            ["ConnectionStrings:Default"] = connection, ["App:AllowedOrigins:0"] = "http://localhost",
            ["Logging:LogLevel:Default"] = "Error", ["Logging:LogLevel:Microsoft.EntityFrameworkCore.Database.Command"] = "None",
            ["App:AuthRateLimit"] = authLimit.ToString(),
            ["App:DataProtectionPath"] = Path.Combine(Path.GetTempPath(), "rims-test-keys")
        }));
        builder.ConfigureServices(services => { services.RemoveAll<TimeProvider>(); services.AddSingleton<TimeProvider>(clock); services.AddDbContext<AppDbContext>((_,o)=>o.AddInterceptors(Failure)); });
    }
}
public sealed class TestCookieClock(TimeProvider clock) : DelegatingHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var response = await base.SendAsync(request, cancellationToken);
        if (response.Headers.TryGetValues("Set-Cookie", out var values)) {
            var cookies = Microsoft.Net.Http.Headers.SetCookieHeaderValue.ParseList(values.ToList());
            foreach (var cookie in cookies) {
                if (cookie.Expires.HasValue) cookie.Expires = DateTimeOffset.UtcNow + (cookie.Expires.Value - clock.GetUtcNow());
            }
            response.Headers.Remove("Set-Cookie");
            response.Headers.TryAddWithoutValidation("Set-Cookie", cookies.Select(c => c.ToString()));
        }
        return response;
    }
}
public sealed class FailureInjector : SaveChangesInterceptor
{
    int armed;
    public void FailNextCommit() => Interlocked.Exchange(ref armed,1);
    public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData data,int result,CancellationToken ct=default)
    {
        if(Interlocked.Exchange(ref armed,0)==1)throw new InvalidOperationException("Test failure after SQL flush, before transaction commit");
        return ValueTask.FromResult(result);
    }
}
[CollectionDefinition("postgres")]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>;

public sealed class PostgresFixture : IAsyncLifetime
{
    PostgreSqlContainer? container;
    public string Connection = "";
    public ControlledClock Clock = new();
    public TestHost Host = null!;
    public const string AdminPassword = "test-admin-only-password";
    public async Task InitializeAsync()
    {
        var testConnection = Environment.GetEnvironmentVariable("RIMS_TEST_POSTGRES");
        if (testConnection == null) {
            container = new PostgreSqlBuilder().WithImage("postgres:17.6-alpine").WithDatabase("rims_test").WithUsername("rims_test").WithPassword("test-only-password").Build();
            await container.StartAsync(); testConnection = container.GetConnectionString();
        }
        var options = new NpgsqlConnectionStringBuilder(testConnection);
        if (!options.Database!.Contains("test", StringComparison.OrdinalIgnoreCase) || options.Host is not ("localhost" or "127.0.0.1" or "::1"))
            throw new InvalidOperationException("Tests require explicitly isolated loopback PostgreSQL with 'test' in the database name.");
        var database = "rims_" + Guid.NewGuid().ToString("N") + "_test";
        await using (var c = new NpgsqlConnection(testConnection)) { await c.OpenAsync(); await new NpgsqlCommand($"CREATE DATABASE {database}", c).ExecuteNonQueryAsync(); }
        options.Database = database; Connection = options.ConnectionString;
        Environment.SetEnvironmentVariable("ConnectionStrings__Default", Connection);
        Host = new TestHost(Connection, Clock);
        using var scope = Host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
        var admin = new UserAccount { Id = Guid.NewGuid(), Username = "admin", NormalizedUsername = "ADMIN", DisplayName = "Test admin", IsSuperAdmin = true };
        admin.PasswordHash = new PasswordHasher<UserAccount>().HashPassword(admin, AdminPassword); db.Users.Add(admin); await db.SaveChangesAsync();
    }
    public async Task DisposeAsync() { await Host.DisposeAsync(); if (container != null) await container.DisposeAsync(); }
    public async Task<ApiClient> Login(string username = "admin", string password = AdminPassword, bool customer = false)
    {
        var client = new ApiClient(Host.CreateClient(), customer); await client.Csrf();
        var response = await client.Send("POST", client.Prefix + "/auth/login", new { username, password });
        Assert.Equal(200, response.Status); client.UserId = Guid.Parse(response.Data!["id"]!.GetValue<string>()); await client.Csrf(); return client;
    }
    public async Task<(ApiClient Admin, ApiClient Owner, Guid Warehouse, Guid Enterprise)> Warehouse()
    {
        var admin = await Login(); var owner = new ApiClient(Host.CreateClient()); await owner.Csrf(); var name = "owner" + Guid.NewGuid().ToString("N");
        var reg = await owner.Send("POST", "/api/v2/auth/register", new { username = name, password = AdminPassword, displayName = "Owner" });
        Assert.Equal(201, reg.Status); owner.UserId = Guid.Parse(reg.Data!["id"]!.GetValue<string>()); await owner.Csrf();
        var enterprise = await admin.Send("POST", "/api/v2/enterprises", new { name = "Test restaurant", ownerUsername = name });
        Assert.Equal(201, enterprise.Status); return (admin, owner, Guid.Parse(enterprise.Data!["warehouseId"]!.GetValue<string>()), Guid.Parse(enterprise.Data!["id"]!.GetValue<string>()));
    }
}
public record ApiResponse(int Status, JsonNode? Body, string Raw)
{
    public JsonNode? Data => Body?["data"];
    public string? Code => Body?["error"]?["code"]?.GetValue<string>();
}
public sealed class ApiClient(HttpClient client, bool customer = false)
{
    public Guid UserId;
    public string Prefix = customer ? "/api/v2/customer" : "/api/v2";
    string? csrf;
    public HttpClient Http => client;
    public async Task Csrf() { var r = await Send("GET", Prefix + "/auth/csrf"); Assert.Equal(200, r.Status); csrf = r.Data!["requestToken"]!.GetValue<string>(); }
    public async Task<ApiResponse> Send(string method, string path, object? body = null, Guid? key = null, string? bearer = null, bool protect = true)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (body != null) request.Content = new StringContent(ContractJson.Serialize(body), Encoding.UTF8, "application/json");
        if (key != null) request.Headers.Add("Idempotency-Key", key.ToString());
        if (bearer != null) request.Headers.Authorization = new("Bearer", bearer);
        if (protect) { request.Headers.Add("Origin", "http://localhost"); if (csrf != null) request.Headers.Add("X-CSRF-TOKEN", csrf); if (UserId != Guid.Empty) request.Headers.Add("X-Rims-Expected-User-Id", UserId.ToString()); }
        using var response = await client.SendAsync(request);
        var raw = await response.Content.ReadAsStringAsync(); var json = raw.Length == 0 ? null : JsonNode.Parse(raw);
        return new((int)response.StatusCode, json, raw);
    }
}
