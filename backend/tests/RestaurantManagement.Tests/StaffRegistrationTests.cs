using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RestaurantManagement.Infrastructure.Persistence;
using Xunit;

namespace RestaurantManagement.Tests;

[Collection("postgres")]
public sealed class StaffRegistrationTests(PostgresFixture f)
{
    static string Username() => "staff-" + Guid.NewGuid().ToString("N");
    [Fact]
    public async Task OwnerAndSuperAdminCreateStaffWithoutReplacingTheirSession()
    {
        var (admin, owner, warehouse, enterprise) = await f.Warehouse();
        var path = $"/api/v2/enterprises/{enterprise}/members/register";
        foreach (var actor in new[] { owner, admin }) {
            var username = Username();
            var created = await actor.Send("POST", path, new { username, password = PostgresFixture.AdminPassword, displayName = "New staff", role = "waiter" });
            Assert.Equal(201, created.Status);
            Assert.DoesNotContain("password", created.Raw, StringComparison.OrdinalIgnoreCase);
            var me = await actor.Send("GET", "/api/v2/auth/me");
            Assert.Equal(actor.UserId.ToString(), me.Data!["id"]!.GetValue<string>());
            var staff = await f.Login(username, PostgresFixture.AdminPassword);
            var memberships = await staff.Send("GET", "/api/v2/me/memberships");
            Assert.Equal(enterprise.ToString(), memberships.Data![0]!["enterpriseId"]!.GetValue<string>());
            Assert.Equal("waiter", memberships.Data[0]!["role"]!.GetValue<string>());
            Assert.False((await staff.Send("GET", "/api/v2/auth/me")).Data!["isSuperAdmin"]!.GetValue<bool>());
            Assert.Equal(403, (await staff.Send("POST", path, new { username = Username(), password = PostgresFixture.AdminPassword, displayName = "Forbidden", role = "waiter" })).Status);
            Assert.Equal(409, (await actor.Send("POST", path, new { username = username.ToUpperInvariant(), password = PostgresFixture.AdminPassword, displayName = "Duplicate", role = "waiter" })).Status);
        }
        var other = await f.Warehouse();
        Assert.Equal(404, (await owner.Send("POST", $"/api/v2/enterprises/{other.Enterprise}/members/register", new { username = Username(), password = PostgresFixture.AdminPassword, displayName = "Forbidden", role = "waiter" })).Status);
        Assert.Equal(422, (await owner.Send("POST", path, new { username = Username(), password = PostgresFixture.AdminPassword, displayName = "Forbidden", role = "owner" })).Status);
        Assert.Equal(403, (await owner.Send("POST", "/api/v2/enterprises/staff", new { username = Username(), password = PostgresFixture.AdminPassword, displayName = "Forbidden" })).Status);
    }
    [Fact]
    public async Task SuperAdminCanCreateFutureOwnerAndCreationRollsBackAtomically()
    {
        var (admin, owner, warehouse, enterprise) = await f.Warehouse();
        var username = Username();
        Assert.Equal(201, (await admin.Send("POST", "/api/v2/enterprises/staff", new { username, password = PostgresFixture.AdminPassword, displayName = "Future owner" })).Status);
        Assert.Equal(201, (await admin.Send("POST", "/api/v2/enterprises", new { name = "New enterprise", ownerUsername = username })).Status);
        var failedUsername = Username();
        f.Host.Failure.FailNextCommit();
        Assert.Equal(500, (await owner.Send("POST", $"/api/v2/enterprises/{enterprise}/members/register", new { username = failedUsername, password = PostgresFixture.AdminPassword, displayName = "Rollback", role = "manager" })).Status);
        using var scope = f.Host.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.NormalizedUsername == failedUsername.ToUpperInvariant()));
    }
    [Fact]
    public async Task ProtectedMutationsAndConcurrentDuplicatesNeverCreateExtraAccounts()
    {
        var admin = await f.Login();
        var username = Username();
        var body = new { username, password = PostgresFixture.AdminPassword, displayName = "Protected account" };
        Assert.Equal(409, (await admin.Send("POST", "/api/v2/enterprises/staff", body, protect: false)).Status);
        using (var unprotected = new HttpRequestMessage(HttpMethod.Post, "/api/v2/enterprises/staff")) {
            unprotected.Content = new StringContent(System.Text.Json.JsonSerializer.Serialize(body), System.Text.Encoding.UTF8, "application/json");
            unprotected.Headers.Add("Origin", "http://localhost");
            unprotected.Headers.Add("X-Rims-Expected-User-Id", admin.UserId.ToString());
            Assert.Equal(System.Net.HttpStatusCode.Forbidden, (await admin.Http.SendAsync(unprotected)).StatusCode);
        }
        var realId = admin.UserId;
        admin.UserId = Guid.NewGuid();
        Assert.Equal(409, (await admin.Send("POST", "/api/v2/enterprises/staff", body)).Status);
        admin.UserId = realId;
        Assert.Equal(422, (await admin.Send("POST", "/api/v2/enterprises/staff", new { username, password = "short", displayName = "Invalid" })).Status);
        using (var scope = f.Host.Services.CreateScope()) {
            Assert.False(await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync(u => u.NormalizedUsername == username.ToUpperInvariant()));
        }
        var secondAdmin = await f.Login();
        var responses = await Task.WhenAll(admin.Send("POST", "/api/v2/enterprises/staff", body), secondAdmin.Send("POST", "/api/v2/enterprises/staff", body));
        Assert.Equal(new[] { 201, 409 }, responses.Select(r => r.Status).Order().ToArray());
        using var finalScope = f.Host.Services.CreateScope();
        Assert.Equal(1, await finalScope.ServiceProvider.GetRequiredService<AppDbContext>().Users.CountAsync(u => u.NormalizedUsername == username.ToUpperInvariant()));
    }
}
