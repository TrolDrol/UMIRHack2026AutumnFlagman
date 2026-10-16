using System.Globalization;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Application.Stock;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Orders.Entities;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Infrastructure.Persistence;
using RestaurantManagement.WebApi.V2;
using Xunit;

namespace RestaurantManagement.Tests;
public class ParityTests
{
    readonly JsonObject fixture = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures/ts-parity.json")))!.AsObject();
    static Guid Id(JsonNode j, string key = "id") => Guid.Parse(j[key]!.GetValue<string>());
    static DateTime At(JsonNode j, string key) => DateTime.Parse(j[key]!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
    static decimal Q(JsonNode j, string key) => decimal.Parse(j[key]!.GetValue<string>(), CultureInfo.InvariantCulture);
    WarehouseSnapshot Snapshot()
    {
        var f = fixture["snapshot"]!; var wid = WarehouseId.From(Guid.Parse("dddddddd-0000-4000-8000-000000000003"));
        var ingredients = f["ingredients"]!.AsArray().Select(j => new Ingredient(IngredientId.From(Id(j!)), wid, j!["name"]!.GetValue<string>(), Unit.From(j["unit"]!.GetValue<string>()), j["defaultShelfLifeHours"]!.GetValue<int>(), Quantity.From(Q(j, "reorderPoint")), Quantity.From(Q(j, "targetStock")))).ToList();
        var dishes = f["dishes"]!.AsArray().Select(j => {
            var recipes = j!["recipe"]!.AsArray().Select(r => { var i = ingredients.First(i => i.Id.Value == Id(r!, "ingredientId")); return new RecipeIngredient(RecipeIngredientId.New(), i.Name, new(i.Id, Quantity.From(Q(r!, "quantity")), i.Unit)); }).ToArray();
            var d = new Dish(DishId.From(Id(j)), wid, j["name"]!.GetValue<string>(), recipes); d.Replace(d.Name, j["active"]!.GetValue<bool>(), recipes, At(j, "createdAt")); return d;
        }).ToList();
        var deliveryNodes = f["deliveries"]!.AsArray();
        var deliveries = deliveryNodes.Select(j => new Delivery(DeliveryId.From(Id(j!)), wid, j!["number"]!.GetValue<string>(), At(j,"createdAt"), null, null, "manual")).ToList();
        var batches = deliveryNodes.SelectMany(j => j!["batches"]!.AsArray()).Select(j => {
            var b = new Batch(BatchId.From(Id(j!)), wid, DeliveryId.From(Id(j!,"deliveryId")), DeliveryItemId.From(Id(j!,"deliveryItemId")), IngredientId.From(Id(j!,"ingredientId")), j!["ingredientName"]!.GetValue<string>(), Quantity.From(Q(j,"initialQuantity")), At(j,"receivedAt"), j["manufacturedAt"] == null ? null : At(j,"manufacturedAt"), j["shelfLifeHours"]!.GetValue<int>(), ExpirationDate.From(At(j,"expiresAt")), Unit.From(j["unit"]!.GetValue<string>()));
            var used = b.InitialQuantity.Value - Q(j,"remainingQuantity"); if (used > 0) b.Deduct(Quantity.From(used)); var held = Q(j,"heldQuantity"); if (held > 0) b.Hold(held);
            if (j["receiptCommittedAt"] != null) b.MarkReceipt(At(j,"receiptCommittedAt")); return b;
        }).ToList();
        var orders = f["orders"]!.AsArray().Select(j => {
            var o = new Order(OrderId.From(Id(j!)),wid,At(j!,"createdAt")); foreach (var l in j!["lines"]!.AsArray()) o.AddItem(dishes.First(d => d.Id.Value == Id(l!,"dishId")),l!["portions"]!.GetValue<int>());
            foreach (var a in j["allocations"]!.AsArray()) o.RecordAllocation(BatchId.From(Id(a!,"batchId")),IngredientId.From(Id(a!,"ingredientId")),Quantity.From(Q(a!,"quantity")),ExpirationDate.From(At(a!,"expiresAt")));
            o.ConfirmPayment(); o.SetSnapshot(j["number"]!.GetValue<string>(),j["source"]!.GetValue<string>(),null,null,null,j.ToJsonString()); return o;
        }).ToList();
        var docs = new List<OperationalDocument>();
        foreach (var (field,kind) in new[] { ("movements","movement"),("writeOffs","write_off"),("quarantines","quarantine"),("combos","combo") })
            foreach (var j in f[field]!.AsArray()) docs.Add(new() { Id = Id(j!), WarehouseId = wid.Value, Kind = kind, BatchId = j!["batchId"] == null ? null : Id(j,"batchId"), CreatedAt = At(j,"createdAt"), Json = j.ToJsonString(), EventSequence = j["eventSequence"]?.GetValue<long>() });
        return new() { Warehouse = new() { Id = wid.Value, StateRevision = 1, TrackingStartedAt = At(f,"analyticsTrackingStartedAt") }, Now = At(fixture,"asOf"), Actor = new(Guid.NewGuid(),"staff","owner"), RestaurantName = "Parity", Ingredients = ingredients, Dishes = dishes, Batches = batches, Deliveries = deliveries, Orders = orders, Documents = docs, Clients = [], ExternalDocuments = [] };
    }
    static void Equivalent(JsonNode? expected, object actual)
    {
        var value = JsonNode.Parse(ContractJson.Serialize(actual));
        string? Difference(JsonNode? a, JsonNode? b, string path = "$") {
            if (JsonNode.DeepEquals(a,b)) return null;
            if (a is JsonObject ao && b is JsonObject bo) { foreach (var key in ao.Select(p => p.Key).Union(bo.Select(p => p.Key))) { var diff = Difference(ao[key],bo[key],path + "." + key); if (diff != null) return diff; } }
            if (a is JsonArray aa && b is JsonArray ba) { if (aa.Count != ba.Count) return path + ".length"; for (var n=0;n<aa.Count;n++) { var diff=Difference(aa[n],ba[n],path+"."+n); if(diff!=null)return diff; } }
            return $"{path}: expected {a}, actual {b}";
        }
        var mismatch = Difference(expected,value); Assert.True(mismatch == null,mismatch);
    }
    WarehouseService Service() => new(new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql("Host=127.0.0.1;Database=unused_parity_test").Options), new ControlledClock(), null!);
    [Fact] public void StockMatchesExistingTsKernel()
    {
        var s = Snapshot(); var input = ContractJson.Parse<OrderInput>(fixture["input"]!.ToJsonString());
        Equivalent(fixture["expected"]!["inventory"], WarehouseService.Inventory(s));
        Equivalent(fixture["expected"]!["preview"], StockKernel.Plan(s.Ingredients,s.Dishes,s.Batches,input.Lines,s.Now));
    }
    [Fact] public void ComboCompositionAndJointFefoMatchTs()
    {
        var s = Snapshot(); var combo = JsonNode.Parse(s.Documents.First(d => d.Kind == "combo").Json)!.AsObject();
        Equivalent(fixture["expected"]!["combo"], WarehouseService.PublicCombo(s, combo));
        var expanded = WarehouseService.Expand(s,ContractJson.Parse<OrderInput>(fixture["comboInput"]!.ToJsonString()));
        Equivalent(fixture["expected"]!["expanded"], new { input = new { lines = expanded.Lines }, composition = expanded.Composition });
        Equivalent(fixture["expected"]!["comboPlan"], Service().ComboPlan(s,new(s.Dishes.Take(3).Select(d => d.Id.Value).ToArray())));
    }
    [Fact] public void ForecastMatchesTsSharedStockAndIndependentExpiryEvents()
    {
        var query = new QueryCollection(new Dictionary<string,Microsoft.Extensions.Primitives.StringValues> { ["historyDays"] = "14", ["horizonHours"] = "48" });
        Equivalent(fixture["expected"]!["forecast"], Service().Forecast(Snapshot(),query));
    }
    [Theory][InlineData("period","reportInput")][InlineData("cohort","cohortInput")]
    public void ReportsMatchTsLedgerCohortAndUnknownHistory(string view, string inputName)
    {
        var j = fixture[inputName]!.AsObject(); var query = new QueryCollection(j.ToDictionary(p => p.Key,p => new Microsoft.Extensions.Primitives.StringValues(p.Value is JsonValue v && v.TryGetValue<string>(out var text) ? text : p.Value!.ToJsonString())));
        Equivalent(fixture["expected"]![view], Service().RiskReport(Snapshot(),query));
    }
}
