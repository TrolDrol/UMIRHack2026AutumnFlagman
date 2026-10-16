using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RestaurantManagement.Infrastructure.Persistence;
using Xunit;

namespace RestaurantManagement.Tests;

[Collection("postgres")]
public sealed class HttpPostgresTests(PostgresFixture fixture)
{
    static Guid Id(ApiResponse r) => Guid.Parse(r.Data!["id"]!.GetValue<string>());
    static string W(Guid id) => "/api/v2/warehouses/" + id;
    static object Ingredient(string name) => new { name, unit = "g", defaultShelfLifeHours = 72, reorderPoint = "1.000", targetStock = "10.000" };
    async Task<(ApiClient C, Guid W, Guid I, Guid D, Guid Batch)> Stock(string quantity = "2.000")
    {
        var (_, c, w, _) = await fixture.Warehouse(); var root = W(w);
        var i = await c.Send("POST", root + "/ingredients", Ingredient("Test ingredient")); Assert.Equal(201, i.Status);
        var dish = await c.Send("POST", root + "/dishes", new { name = "Test dish", active = true, recipe = new[] { new { ingredientId = Id(i), quantity = "1.000" } } }); Assert.Equal(201, dish.Status);
        var delivery = await c.Send("POST", root + "/deliveries", new { number = "TEST-01", expectedAt = (string?)null, note = (string?)null, lines = new[] { new { ingredientId = Id(i), quantity, expiresAt = "2026-10-15T12:00:00Z" } } }, Guid.NewGuid()); Assert.Equal(201, delivery.Status);
        var confirm = await c.Send("POST", root + "/deliveries/" + Id(delivery) + "/confirm", new { receivedAt = "2026-10-14T11:00:00Z" }, Guid.NewGuid()); Assert.Equal(200, confirm.Status);
        return (c, w, Id(i), Id(dish), Guid.Parse(confirm.Data!["batches"]![0]!["id"]!.GetValue<string>()));
    }
    [Fact] public async Task OrderRaceReplayAndLedgerAreAtomic()
    {
        var (c, w, _, dish, batch) = await Stock("1.000"); var path = W(w) + "/orders";
        var body = new { lines = new[] { new { dishId = dish, portions = 1 } } }; var keyA = Guid.NewGuid(); var keyB = Guid.NewGuid();
        var results = await Task.WhenAll(c.Send("POST", path, body, keyA), c.Send("POST", path, body, keyB));
        Assert.Equal(new[] { 201, 409 }, results.Select(r => r.Status).Order().ToArray());
        var winner = results[0].Status == 201 ? keyA : keyB; var loser = winner == keyA ? keyB : keyA;
        var repeated = await c.Send("POST", path, body, winner); Assert.Equal(results.First(r => r.Status == 201).Raw, repeated.Raw);
        var changed = await c.Send("POST", path, new { lines = new[] { new { dishId = dish, portions = 2 } } }, winner); Assert.Equal("IDEMPOTENCY_KEY_REUSED", changed.Code);
        var conflict = await c.Send("POST", path, body, loser); Assert.Equal("INSUFFICIENT_STOCK", conflict.Code);
        using var scope = fixture.Host.Services.CreateScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(0, (await db.Batches.SingleAsync(b => b.Id == RestaurantManagement.Domain.Supplies.ValueObjects.BatchId.From(batch))).RemainingQuantity.Value);
        var movements = await c.Send("GET", W(w) + "/movements"); Assert.Equal(2, movements.Data!["total"]!.GetValue<int>());
        Assert.NotNull(movements.Data!["items"]!.AsArray().Single(m => m!["type"]!.GetValue<string>() == "order")!["riskSnapshot"]);
        Assert.Equal(1, (await c.Send("GET", W(w) + "/orders")).Data!["total"]!.GetValue<int>());
    }
    [Fact] public async Task ConcurrentConfirmProducesOneReceipt()
    {
        var (_, c, w, _) = await fixture.Warehouse(); var i = await c.Send("POST", W(w) + "/ingredients", Ingredient("Tomato"));
        var d = await c.Send("POST", W(w) + "/deliveries", new { number = "RACE", expectedAt = (string?)null, note = (string?)null, lines = new[] { new { ingredientId = Id(i), quantity = "10", expiresAt = "2026-10-15T12:00:00Z" } } }, Guid.NewGuid());
        var body = new { receivedAt = "2026-10-14T11:00:00Z" };
        var outcomes = await Task.WhenAll(c.Send("POST", W(w) + "/deliveries/" + Id(d) + "/confirm", body, Guid.NewGuid()), c.Send("POST", W(w) + "/deliveries/" + Id(d) + "/confirm", body, Guid.NewGuid()));
        Assert.All(outcomes, r => Assert.Equal(200, r.Status));
        Assert.Equal(1, (await c.Send("GET", W(w) + "/batches")).Data!["total"]!.GetValue<int>());
        Assert.Equal(1, (await c.Send("GET", W(w) + "/movements")).Data!["total"]!.GetValue<int>());
    }
    [Fact] public async Task QuarantinePartialDecisionsBalanceAndComboSnapshots()
    {
        var (c, w, ingredient, dish, batch) = await Stock("10.000"); var root = W(w);
        var second = await c.Send("POST", root + "/dishes", new { name = "Second dish", active = true, recipe = new[] { new { ingredientId = ingredient, quantity = "1.000" } } });
        var combo = await c.Send("POST", root + "/combos", new { title = "Pair", components = new[] { new { dishId = dish, portions = 1 }, new { dishId = Id(second), portions = 1 } } }, Guid.NewGuid()); Assert.Equal(201, combo.Status);
        var published = await c.Send("POST", root + "/combos/" + Id(combo) + "/publish", new { expectedVersion = 1 }, Guid.NewGuid()); Assert.Equal(200, published.Status);
        var hold = await c.Send("POST", root + "/quarantines", new { batchId = batch, expectedBatchVersion = 1, quantity = "8.000", reason = "Test hold", note = (string?)null }, Guid.NewGuid()); Assert.Equal(201, hold.Status);
        var order = await c.Send("POST", root + "/orders", new { lines = Array.Empty<object>(), combos = new[] { new { comboId = Id(combo), version = 1, quantity = 1 } } }, Guid.NewGuid()); Assert.Equal(201, order.Status);
        Assert.Equal(2, order.Data!["lines"]!.AsArray().Count); Assert.Single(order.Data["composition"]!.AsArray());
        var release = await c.Send("POST", root + "/quarantines/" + Id(hold) + "/release", new { expectedVersion = 1, quantity = "3.000", reason = "Checked" }, Guid.NewGuid()); Assert.Equal(200, release.Status);
        var write = await c.Send("POST", root + "/quarantines/" + Id(hold) + "/write-off", new { expectedVersion = 2, quantity = "5.000", reason = "damaged", note = (string?)null }, Guid.NewGuid()); Assert.Equal(200, write.Status);
        var row = (await c.Send("GET", root + "/inventory")).Data!["items"]![0]!;
        Assert.Equal("3.000", row["physicalQuantity"]!.GetValue<string>()); Assert.Equal("0.000", row["heldQuantity"]!.GetValue<string>());
        var trace = await c.Send("GET", root + "/quarantines/" + Id(hold) + "/orders"); Assert.Equal(1, trace.Data!["total"]!.GetValue<int>());
        var report = await c.Send("GET", root + "/analytics/risk-inventory?view=period&from=2026-10-14T11:59:59Z&to=2026-10-14T12:00:00Z"); Assert.Equal(200, report.Status);
    }
    [Fact] public async Task SupplierWorkflowPersistsSubmittedOwnershipAndExactShipment()
    {
        var (_, c, w, _) = await fixture.Warehouse(); var root = W(w); var i = await c.Send("POST", root + "/ingredients", Ingredient("Milk"));
        var supplier = await c.Send("POST", root + "/integration-clients", new { name = "Supplier", kind = "supplier" });
        var key = await c.Send("POST", root + "/integration-clients/" + Id(supplier) + "/keys", new { label = "Test", expiresAt = (string?)null }); Assert.Equal(201, key.Status);
        var token = key.Data!["token"]!.GetValue<string>(); var integration = "/integrations/v1/warehouses/" + w;
        var purchase = await c.Send("POST", root + "/purchase-requests", new { supplierClientId = Id(supplier), expectedAt = (string?)null, note = (string?)null, lines = new[] { new { ingredientId = Id(i), quantity = "10.000" } } }, Guid.NewGuid()); Assert.Equal(201, purchase.Status);
        var hidden = await c.Send("GET", integration + "/purchase-requests/" + Id(purchase), bearer: token); Assert.Equal(404, hidden.Status);
        var submit = await c.Send("POST", root + "/purchase-requests/" + Id(purchase) + "/submit", new { version = 1 }, Guid.NewGuid()); Assert.Equal(200, submit.Status);
        var approve = await c.Send("POST", integration + "/purchase-requests/" + Id(purchase) + "/approve", new { version = 2 }, Guid.NewGuid(), token); Assert.Equal(200, approve.Status);
        var invalid = await c.Send("POST", integration + "/deliveries", new { number = "BAD", externalId = "bad", purchaseRequestId = Id(purchase), expectedAt = (string?)null, note = (string?)null, lines = new[] { new { ingredientId = Id(i), quantity = "9", expiresAt = "2026-10-15T12:00:00Z" } } }, Guid.NewGuid(), token); Assert.Equal(422, invalid.Status);
        var ship = await c.Send("POST", integration + "/deliveries", new { number = "SHIP", externalId = "external-1", purchaseRequestId = Id(purchase), expectedAt = (string?)null, note = (string?)null, lines = new[] { new { ingredientId = Id(i), quantity = "10", expiresAt = "2026-10-15T12:00:00Z" } } }, Guid.NewGuid(), token); Assert.Equal(201, ship.Status);
        Assert.Null(ship.Data!["batches"]);
        var confirm = await c.Send("POST", root + "/deliveries/" + Id(ship) + "/confirm", new { receivedAt = "2026-10-14T11:00:00Z" }, Guid.NewGuid()); Assert.Equal(200, confirm.Status);
        var request = await c.Send("GET", integration + "/purchase-requests/" + Id(purchase), bearer: token); Assert.Equal("received", request.Data!["status"]!.GetValue<string>());
        Assert.Equal("10.000", (await c.Send("GET", root + "/inventory")).Data!["items"]![0]!["physicalQuantity"]!.GetValue<string>());
    }
    [Fact] public async Task SecurityCookieSeparationForeignWarehouseAndValidation()
    {
        var (_, owner, warehouse, enterprise) = await fixture.Warehouse(); var root = W(warehouse);
        var anonymous = new ApiClient(fixture.Host.CreateClient()); Assert.Equal(401, (await anonymous.Send("GET", root + "/inventory")).Status);
        Assert.Equal(404, (await owner.Send("GET", W(Guid.NewGuid()) + "/inventory")).Status);
        Assert.Equal(404, (await anonymous.Send("GET", "/api/v1/warehouses/" + warehouse + "/ingredients")).Status);
        var csrf = await owner.Send("POST", root + "/ingredients", Ingredient("A"), protect: false); Assert.Equal(409, csrf.Status); // missing expected principal fails before mutation
        var previous = owner.UserId; owner.UserId = Guid.NewGuid(); var stale = await owner.Send("POST", root + "/ingredients", Ingredient("A")); Assert.Equal("SESSION_CONTEXT_CHANGED", stale.Code); owner.UserId = previous;
        var customer = new ApiClient(fixture.Host.CreateClient(), true); await customer.Csrf();
        var registered = await customer.Send("POST", customer.Prefix + "/auth/register", new { username = "customer" + Guid.NewGuid().ToString("N"), password = PostgresFixture.AdminPassword, displayName = "Buyer" }); Assert.Equal(201, registered.Status);
        customer.UserId = Id(registered); await customer.Csrf(); Assert.Equal("customer", registered.Data!["role"]!.GetValue<string>());
        Assert.Equal(404, (await customer.Send("GET", customer.Prefix + "/warehouses/" + warehouse + "/menu")).Status);
        Assert.Equal(200, (await owner.Send("PATCH", root + "/customer-publication", new { enabled = true })).Status);
        var menu = await customer.Send("GET", customer.Prefix + "/warehouses/" + warehouse + "/menu"); Assert.Equal(200, menu.Status);
        Assert.Equal(422, (await owner.Send("POST", root + "/ingredients", new { name = "A", unit = "g", defaultShelfLifeHours = 72, reorderPoint = 1, targetStock = "10.000" })).Status);
        var runtime = await anonymous.Send("GET", "/api/v2/runtime"); Assert.Equal("server", runtime.Data!["sourceKind"]!.GetValue<string>());
        Assert.Equal(200, (await anonymous.Send("GET", "/health/ready")).Status);
    }
}
