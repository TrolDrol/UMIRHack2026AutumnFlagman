using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RestaurantManagement.Infrastructure.Persistence;
using Xunit;

namespace RestaurantManagement.Tests;

[Collection("postgres")]
public sealed class StaffDirectoryTests(PostgresFixture f)
{
    static string Name() => "directory-" + Guid.NewGuid().ToString("N");
    static Guid Id(ApiResponse response) => Guid.Parse(response.Data!["userId"]!.GetValue<string>());
    async Task<(Guid Id, string Name)> Staff(ApiClient actor, Guid? enterprise, string name, string role = "waiter", string? displayName = null)
    {
        var path = enterprise.HasValue ? $"/api/v2/enterprises/{enterprise}/members/register" : "/api/v2/enterprises/staff";
        var result = await actor.Send("POST", path, new { username = name, password = PostgresFixture.AdminPassword, displayName = displayName ?? name, role = enterprise.HasValue ? role : null });
        Assert.Equal(201, result.Status); return (Id(result), name);
    }
    [Fact]
    public async Task DirectoryScopesUsersAndMembershipDetailsAndPaginatesWithoutCustomerAccounts()
    {
        var first = await f.Warehouse(); var second = await f.Warehouse(); var prefix = Name();
        var shared = await Staff(first.Owner, first.Enterprise, prefix + "-shared");
        await Staff(second.Owner, second.Enterprise, prefix + "-private", displayName: "Тестовый Сотрудник");
        await Staff(first.Admin, null, prefix + "-unassigned");
        Assert.Equal(201, (await second.Owner.Send("POST", $"/api/v2/enterprises/{second.Enterprise}/members", new { username = shared.Name, role = "manager" })).Status);
        var customer = new ApiClient(f.Host.CreateClient(), true); await customer.Csrf();
        Assert.Equal(201, (await customer.Send("POST", "/api/v2/customer/auth/register", new { username = prefix + "-customer", password = PostgresFixture.AdminPassword, displayName = "Customer" })).Status);
        var owned = await first.Owner.Send("GET", "/api/v2/staff?q=" + prefix);
        Assert.Equal(200, owned.Status); Assert.Equal(1, owned.Data!["total"]!.GetValue<int>());
        var row = owned.Data["items"]![0]!;
        Assert.Equal(shared.Id.ToString(), row["userId"]!.GetValue<string>());
        Assert.False(row["canDeleteAccount"]!.GetValue<bool>());
        Assert.Single(row["memberships"]!.AsArray());
        Assert.Equal(first.Enterprise.ToString(), row["memberships"]![0]!["enterpriseId"]!.GetValue<string>());
        Assert.DoesNotContain(second.Enterprise.ToString(), owned.Raw);
        Assert.DoesNotContain("password", owned.Raw, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(404, (await first.Owner.Send("GET", $"/api/v2/staff?enterpriseId={second.Enterprise}")).Status);
        var all = await first.Admin.Send("GET", "/api/v2/staff?q=" + prefix);
        Assert.Equal(3, all.Data!["total"]!.GetValue<int>());
        Assert.Equal(2, all.Data["items"]!.AsArray().Single(j => j!["userId"]!.GetValue<string>() == shared.Id.ToString())!["memberships"]!.AsArray().Count);
        var page1 = await first.Admin.Send("GET", $"/api/v2/staff?q={prefix}&pageSize=1");
        var page2 = await first.Admin.Send("GET", $"/api/v2/staff?q={prefix}&pageSize=1&page=2");
        Assert.Equal(3, page1.Data!["total"]!.GetValue<int>()); Assert.Single(page1.Data["items"]!.AsArray());
        Assert.NotEqual(page1.Data["items"]![0]!["userId"]!.GetValue<string>(), page2.Data!["items"]![0]!["userId"]!.GetValue<string>());
        Assert.Equal(1, (await first.Admin.Send("GET", "/api/v2/staff?q=" + shared.Name.ToUpperInvariant())).Data!["total"]!.GetValue<int>());
        Assert.Equal(1, (await first.Admin.Send("GET", "/api/v2/staff?q=" + Uri.EscapeDataString("тЕсТоВыЙ сОтРуДнИк"))).Data!["total"]!.GetValue<int>());
        Assert.Equal(0, (await first.Owner.Send("GET", "/api/v2/staff?q=" + Uri.EscapeDataString("тЕсТоВыЙ сОтРуДнИк"))).Data!["total"]!.GetValue<int>());
        var worker = await f.Login(shared.Name);
        Assert.Equal(403, (await worker.Send("GET", "/api/v2/staff")).Status);
        Assert.Equal(401, (await customer.Send("GET", "/api/v2/staff")).Status);
        Assert.Equal(422, (await first.Admin.Send("GET", "/api/v2/staff?pageSize=101")).Status);
    }
    [Fact]
    public async Task OwnerRemovesOnlyOwnAccessAndSuperAdminDeletesAccountAndSessions()
    {
        var first = await f.Warehouse(); var second = await f.Warehouse();
        var staff = await Staff(first.Owner, first.Enterprise, Name(), "manager");
        Assert.Equal(201, (await second.Owner.Send("POST", $"/api/v2/enterprises/{second.Enterprise}/members", new { username = staff.Name, role = "waiter" })).Status);
        var worker = await f.Login(staff.Name);
        var ingredient = await worker.Send("POST", $"/api/v2/warehouses/{first.Warehouse}/ingredients", new { name = "Persisted history ingredient", unit = "g", defaultShelfLifeHours = 48, reorderPoint = "1.000", targetStock = "5.000" }, Guid.NewGuid());
        Assert.Equal(201, ingredient.Status);
        Assert.Equal(403, (await first.Owner.Send("DELETE", $"/api/v2/staff/{staff.Id}")).Status);
        Assert.Equal(404, (await first.Owner.Send("DELETE", $"/api/v2/enterprises/{second.Enterprise}/members/{staff.Id}")).Status);
        Assert.Equal(204, (await first.Owner.Send("DELETE", $"/api/v2/enterprises/{first.Enterprise}/members/{staff.Id}")).Status);
        var remaining = await worker.Send("GET", "/api/v2/me/memberships");
        Assert.Single(remaining.Data!.AsArray()); Assert.Equal(second.Enterprise.ToString(), remaining.Data[0]!["enterpriseId"]!.GetValue<string>());
        Assert.Equal(404, (await worker.Send("GET", $"/api/v2/warehouses/{first.Warehouse}/inventory")).Status);
        Assert.Equal(409, (await first.Admin.Send("DELETE", $"/api/v2/staff/{staff.Id}", protect: false)).Status);
        Assert.Equal(204, (await first.Admin.Send("DELETE", $"/api/v2/staff/{staff.Id}")).Status);
        Assert.Equal(401, (await worker.Send("GET", "/api/v2/auth/me")).Status);
        Assert.Equal(404, (await first.Admin.Send("DELETE", $"/api/v2/staff/{staff.Id}")).Status);
        using var scope = f.Host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Users.AnyAsync(u => u.Id == staff.Id));
        Assert.False(await db.Sessions.AnyAsync(s => s.UserId == staff.Id));
        Assert.False(await db.Memberships.AnyAsync(m => m.UserId == staff.Id));
        Assert.NotNull(await db.Ingredients.FindAsync(RestaurantManagement.Domain.Ingredients.ValueObjects.IngredientId.From(Guid.Parse(ingredient.Data!["id"]!.GetValue<string>()))));
        Assert.True(await db.Warehouses.AnyAsync(w => w.Id == first.Warehouse));
    }
    [Fact]
    public async Task OwnersAndAdministratorsAreProtectedAndFailedDeletionIsAtomic()
    {
        var (admin, owner, warehouse, enterprise) = await f.Warehouse();
        Assert.Equal("SELF_DELETE_FORBIDDEN", (await admin.Send("DELETE", $"/api/v2/staff/{admin.UserId}")).Code);
        Assert.Equal("OWNER_IMMUTABLE", (await admin.Send("DELETE", $"/api/v2/staff/{owner.UserId}")).Code);
        Assert.Equal("OWNER_IMMUTABLE", (await owner.Send("DELETE", $"/api/v2/enterprises/{enterprise}/members/{owner.UserId}")).Code);
        var user = await Staff(admin, null, Name()); var session = await f.Login(user.Name);
        f.Host.Failure.FailNextCommit();
        Assert.Equal(500, (await admin.Send("DELETE", $"/api/v2/staff/{user.Id}")).Status);
        Assert.Equal(200, (await session.Send("GET", "/api/v2/auth/me")).Status);
        using var scope = f.Host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.True(await db.Users.AnyAsync(u => u.Id == user.Id));
        Assert.True(await db.Sessions.AnyAsync(s => s.UserId == user.Id));
    }
}
