using System.Text.Json.Nodes;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Application.Stock;
using RestaurantManagement.Domain.Supplies.Entities;

namespace RestaurantManagement.WebApi.V2;

public sealed partial class WarehouseService
{
    public static int Integer(IQueryCollection q, string key, int fallback, int min, int max)
    {
        if (!q.ContainsKey(key)) return fallback;
        if (q[key].Count != 1 || !int.TryParse(q[key], out var value) || value < min || value > max) throw ApiFailure.Invalid(key);
        return value;
    }
    public static bool? Bool(IQueryCollection q, string key)
    {
        if (!q.ContainsKey(key)) return null;
        if (q[key].Count != 1 || q[key].ToString() is not ("true" or "false")) throw ApiFailure.Invalid(key);
        return q[key] == "true";
    }
    public static Guid? QueryId(IQueryCollection q, string key)
    {
        if (!q.ContainsKey(key)) return null;
        if (q[key].Count != 1 || !Guid.TryParse(q[key], out var value)) throw ApiFailure.Invalid(key);
        return value;
    }
    public static string? EnumQuery(IQueryCollection q, string key, params string[] allowed)
    {
        if (!q.ContainsKey(key)) return null;
        if (q[key].Count != 1 || !allowed.Contains(q[key].ToString())) throw ApiFailure.Invalid(key);
        return q[key].ToString();
    }
    public static void QueryKeys(IQueryCollection q, params string[] allowed)
    {
        foreach (var key in q.Keys) if (!allowed.Contains(key) || q[key].Count != 1) throw ApiFailure.Invalid(key);
    }
    public static object Paginate(IEnumerable<object> data, IQueryCollection query)
    {
        var page = Integer(query, "page", 1, 1, int.MaxValue);
        var size = Integer(query, "pageSize", 50, 1, 100);
        var items = data.ToArray();
        return new { items = items.Skip((int)Math.Min(int.MaxValue, (long)(page - 1) * size)).Take(size).ToArray(), page, pageSize = size, total = items.Length };
    }
    static bool Search(string name, IQueryCollection query) => name.Contains(query["q"].ToString().Trim(), StringComparison.OrdinalIgnoreCase);
    static IEnumerable<JsonObject> NameSort(IEnumerable<JsonObject> data, string name, string id) => data.OrderBy(j => j[name]!.GetValue<string>(), StringComparer.Ordinal).ThenBy(j => j[id]!.GetValue<string>(), StringComparer.Ordinal);
    static IEnumerable<JsonObject> HistorySort(IEnumerable<JsonObject> data) => data.OrderByDescending(j => Time(j, "createdAt")).ThenByDescending(j => j["id"]!.GetValue<string>(), StringComparer.Ordinal);

    public static JsonObject[] Inventory(WarehouseSnapshot s) => s.Ingredients.Select(i => {
        var bs = s.Batches.Where(b => b.IngredientId == i.Id).ToArray();
        var available = ContractJson.Limit(bs.Sum(b => StockKernel.Available(b, s.Now)));
        return Json(new { ingredientId = i.Id.Value, ingredientName = i.Name, unit = i.Unit.Value,
            physicalQuantity = new Amount(ContractJson.Limit(bs.Sum(b => b.RemainingQuantity.Value))), heldQuantity = new Amount(bs.Sum(b => b.HeldQuantity)),
            heldExpiredQuantity = new Amount(bs.Where(b => b.IsExpired(s.Now)).Sum(b => b.HeldQuantity)), availableQuantity = new Amount(available),
            expiringQuantity = new Amount(bs.Where(b => b.IsExpiringSoon(s.Now)).Sum(b => StockKernel.Available(b, s.Now))),
            expiredQuantity = new Amount(bs.Where(b => b.IsExpired(s.Now)).Sum(b => b.RemainingQuantity.Value)),
            nearestExpiresAt = bs.Where(b => StockKernel.Available(b, s.Now) > 0).Select(b => (DateTime?)b.ExpirationDate.Value).Min(),
            reorderPoint = new Amount(i.ReorderPoint.Value), targetStock = new Amount(i.TargetStock.Value), isLowStock = available < i.ReorderPoint.Value });
    }).OrderBy(j => j["ingredientName"]!.GetValue<string>(), StringComparer.Ordinal).ThenBy(j => j["ingredientId"]!.GetValue<string>(), StringComparer.Ordinal).ToArray();

    public static JsonObject[] Availability(WarehouseSnapshot s) => s.Dishes.Select(d => {
        var max = StockKernel.MaxPortions(d, s.Batches, s.Now);
        return Json(new { dishId = d.Id.Value, dishName = d.Name, d.Active, maxPortions = max, status = !d.Active ? "inactive" : max == 0 ? "stopped" : "available",
            shortages = d.Active && max == 0 ? StockKernel.Plan(s.Ingredients, s.Dishes, s.Batches, [new(d.Id.Value, 1)], s.Now).Requirements.Where(r => r.MissingQuantity.Value > 0).ToArray() : [] });
    }).OrderBy(j => j["dishName"]!.GetValue<string>(), StringComparer.Ordinal).ThenBy(j => j["dishId"]!.GetValue<string>(), StringComparer.Ordinal).ToArray();

    public static JsonObject[] Offers(WarehouseSnapshot s)
    {
        var result = new List<JsonObject>();
        foreach (var d in s.Dishes.Where(d => d.Active))
        {
            var max = StockKernel.MaxPortions(d, s.Batches, s.Now); if (max == 0) continue;
            var risk = d.RecipeIngredients.ToDictionary(r => r.Requirement.IngredientId.Value, r => s.Batches.Where(b => b.IngredientId == r.Requirement.IngredientId && b.IsExpiringSoon(s.Now)).Sum(b => StockKernel.Available(b, s.Now)));
            if (!risk.Values.Any(n => n > 0)) continue;
            var needed = d.RecipeIngredients.Max(r => (long)Math.Ceiling(risk[r.Requirement.IngredientId.Value] / r.Requirement.Quantity.Value));
            var suggested = (int)Math.Min(max, Math.Min(20, needed));
            var plan = StockKernel.Plan(s.Ingredients, s.Dishes, s.Batches, [new(d.Id.Value, suggested)], s.Now, includeRisk: true);
            var used = plan.Allocations.Where(a => a.RiskSnapshot!.Phase == "expiring").ToArray(); if (used.Length == 0) continue;
            var reasons = used.GroupBy(a => a.IngredientId).Select(g => {
                var i = s.Ingredient(g.Key);
                return new { ingredientId = g.Key, ingredientName = i.Name, unit = i.Unit.Value, batchIds = g.Select(a => a.BatchId).ToArray(),
                    usableExpiringQuantity = new Amount(risk[g.Key]), plannedUsage = new Amount(g.Sum(a => a.Quantity.Value)), earliestExpiresAt = g.Min(a => a.ExpiresAt) };
            }).OrderBy(r => r.ingredientName, StringComparer.Ordinal).ThenBy(r => r.ingredientId.ToString(), StringComparer.Ordinal).ToArray();
            var urgency = used.Max(a => 1 - (a.ExpiresAt - s.Now).TotalSeconds / (a.RiskSnapshot!.ShelfLifeHours * 360));
            var coverage = risk.Where(r => r.Value > 0).Average(r => (double)(used.Where(a => a.IngredientId == r.Key).Sum(a => a.Quantity.Value) / r.Value));
            result.Add(Json(new { dishId = d.Id.Value, dishName = d.Name, score = Math.Round(100 * urgency * coverage, 2, MidpointRounding.AwayFromZero), maxPortions = max,
                suggestedPortions = suggested, earliestExpiresAt = used.Min(a => a.ExpiresAt), reasons, explanation = $"Продайте {suggested} порций: используете истекающие партии. Предложения используют общий склад." }));
        }
        return result.OrderByDescending(j => j["score"]!.GetValue<double>()).ThenBy(j => Time(j, "earliestExpiresAt")).ThenBy(j => j["dishId"]!.GetValue<string>(), StringComparer.Ordinal).ToArray();
    }
    public static JsonObject[] Purchases(WarehouseSnapshot s)
    {
        var result = new List<JsonObject>();
        foreach (var row in Inventory(s)) {
            var i = s.Ingredient(Id(row, "ingredientId")); var available = Qty(row, "availableQuantity"); var expiring = Qty(row, "expiringQuantity"); var planning = available - expiring;
            var recipes = s.Dishes.Where(d => d.Active).SelectMany(d => d.RecipeIngredients.Where(r => r.Requirement.IngredientId == i.Id).Select(r => (dish: d, quantity: r.Requirement.Quantity.Value))).ToArray();
            var affected = recipes.Where(r => r.quantity > available).Select(r => r.dish.Id.Value).OrderBy(x => x.ToString(), StringComparer.Ordinal).ToArray();
            var reasons = new List<string>(); if (available < i.ReorderPoint.Value) reasons.Add("below_minimum"); if (expiring > 0 && planning < i.ReorderPoint.Value) reasons.Add("expiring_stock"); if (affected.Length > 0) reasons.Add("stopped_dish");
            var target = Math.Max(i.TargetStock.Value, recipes.Select(r => r.quantity).DefaultIfEmpty(0).Max()); var suggested = Math.Max(0, target - planning);
            if (reasons.Count == 0 || suggested == 0) continue;
            result.Add(Json(new { ingredientId = i.Id.Value, ingredientName = i.Name, unit = i.Unit.Value, availableQuantity = new Amount(available), expiringQuantity = new Amount(expiring), planningQuantity = new Amount(planning),
                reorderPoint = new Amount(i.ReorderPoint.Value), targetStock = new Amount(i.TargetStock.Value), targetQuantity = new Amount(target), suggestedQuantity = new Amount(suggested), reasons, affectedDishIds = affected }));
        }
        return result.ToArray();
    }
    public CommandResult Read(WarehouseSnapshot s, string resource, Guid? id, IQueryCollection q, string channel)
    {
        var safe = channel is "service" or "customer" or "integration";
        if (resource == "config") { QueryKeys(q); return Ok(new { restaurantName = s.RestaurantName, timeZone = "Europe/Moscow", expiryWarningPercent = 10, hotOfferMaxPortions = 20, contractVersion = "2.1.0" }); }
        if (resource == "customer-publication") { QueryKeys(q); return Ok(new { enabled = s.Warehouse.CustomerPublished }); }
        if (resource == "identity") { QueryKeys(q); var c = s.Clients.First(c => c.Id == s.Actor.ClientId); return Ok(new { clientId = c.Id, warehouseId = s.Warehouse.Id, c.Name, c.Kind }); }
        if (resource == "dashboard") {
            QueryKeys(q);
            var rows = Inventory(s); var av = Availability(s); var start = s.Now.AddHours(3).Date.AddHours(-3);
            return Ok(new { ingredientCount = s.Ingredients.Count, activeDishCount = s.Dishes.Count(d => d.Active), stoppedDishCount = av.Count(j => j["status"]!.GetValue<string>() == "stopped"),
                lowStockIngredientCount = rows.Count(j => j["isLowStock"]!.GetValue<bool>()), expiringBatchCount = s.Batches.Count(b => !b.IsEmpty && b.IsExpiringSoon(s.Now)), expiredBatchCount = s.Batches.Count(b => !b.IsEmpty && b.IsExpired(s.Now)),
                todayOrderCount = s.Orders.Count(o => o.CreatedAt >= start && o.CreatedAt < start.AddDays(1)), hotOfferCount = Offers(s).Length, pendingDeliveryCount = s.Deliveries.Count(d => d.Status == RestaurantManagement.Domain.Supplies.ValueObjects.DeliveryStatus.Pending) });
        }
        IEnumerable<JsonObject> data;
        switch (resource)
        {
            case "ingredients": case "catalog/ingredients":
                QueryKeys(q, "q", "page", "pageSize");
                data = s.Ingredients.Where(i => Search(i.Name, q)).Select(i => resource == "catalog/ingredients" ? Json(new { id = i.Id.Value, i.Name, unit = i.Unit.Value }) : Json(IngredientDto(i)));
                data = NameSort(data, "name", "id"); break;
            case "dishes":
                QueryKeys(q, "q", "active", "page", "pageSize"); var active = Bool(q, "active");
                data = s.Dishes.Where(d => (id == null || d.Id.Value == id) && Search(d.Name, q) && (active == null || d.Active == active)).Select(d => Json(DishDto(s, d)));
                data = NameSort(data, "name", "id"); break;
            case "inventory":
                QueryKeys(q, "q", "lowStock", "page", "pageSize"); var low = Bool(q, "lowStock");
                data = Inventory(s).Where(j => Search(j["ingredientName"]!.GetValue<string>(), q) && (low == null || j["isLowStock"]!.GetValue<bool>() == low)); break;
            case "batches":
                QueryKeys(q, "ingredientId", "deliveryId", "status", "includeEmpty", "page", "pageSize");
                var ing = QueryId(q, "ingredientId"); var delivery = QueryId(q, "deliveryId"); var status = EnumQuery(q, "status", "fresh", "expiring", "expired", "empty"); var empty = Bool(q, "includeEmpty") ?? false;
                data = StockKernel.Fefo(s.Batches.Where(b => (ing == null || b.IngredientId.Value == ing) && (delivery == null || b.DeliveryId.Value == delivery) && (empty || status == "empty" || !b.IsEmpty))).Select(b => Json(BatchDto(s, b))).Where(j => status == null || j["status"]!.GetValue<string>() == status); break;
            case "deliveries":
                QueryKeys(q, "status", "source", "page", "pageSize"); var ds = EnumQuery(q, "status", "pending", "confirmed", "rejected"); var source = EnumQuery(q, "source", "manual", "integration");
                data = HistorySort(s.Deliveries.Where(d => (id == null || d.Id.Value == id) && (channel != "integration" || d.IntegrationClientId == s.Actor.ClientId) && (ds == null || d.Status.ToString().ToLowerInvariant() == ds) && (source == null || d.Source == source)).Select(d => (JsonObject)DeliveryDto(s, d, channel == "integration"))); break;
            case "orders":
                QueryKeys(q, "source", "page", "pageSize"); var os = EnumQuery(q, "source", "staff", "waiter", "customer", "integration");
                data = HistorySort(s.Orders.Where(o => (id == null || o.Id.Value == id) && (channel != "customer" || o.CustomerId == s.Actor.Id) && (channel != "integration" || o.IntegrationClientId == s.Actor.ClientId) && (os == null || o.Source == os)).Select(o => safe ? (JsonObject)Receipt(o) : OrderDto(o))); break;
            case "movements": case "write-offs":
                QueryKeys(q, "ingredientId", "batchId", "type", "page", "pageSize"); var bi = QueryId(q, "batchId"); var ii = QueryId(q, "ingredientId"); var mt = EnumQuery(q, "type", "receipt", "order", "write_off", "quarantine_open", "quarantine_release");
                data = HistorySort(s.Documents.Where(d => d.Kind == (resource == "movements" ? "movement" : "write_off") && (bi == null || d.BatchId == bi)).Select(d => JsonNode.Parse(d.Json)!.AsObject()).Where(j => (ii == null || (resource == "movements" ? Id(j, "ingredientId") : s.Batch(Id(j, "batchId")).IngredientId.Value) == ii) && (mt == null || resource != "movements" || j["type"]!.GetValue<string>() == mt))); break;
            case "menu": case "menu/availability": case "stop-list":
                QueryKeys(q, "q", "page", "pageSize");
                data = Availability(s).Where(j => Search(j["dishName"]!.GetValue<string>(), q) && (resource != "stop-list" || j["status"]!.GetValue<string>() == "stopped") && (!safe || j["active"]!.GetValue<bool>()));
                if (safe) data = data.Select(j => Json(new { dishId = Id(j, "dishId"), dishName = j["dishName"]!.GetValue<string>(), maxPortions = j["maxPortions"]!.GetValue<long>(), status = j["status"]!.GetValue<string>(), unavailableReason = j["status"]!.GetValue<string>() == "stopped" ? "Блюдо временно недоступно" : null })); break;
            case "manual-offers":
                QueryKeys(q, "status", "q", "page", "pageSize"); var ms = EnumQuery(q,"status","draft","published","archived");
                data = s.Documents.Where(d => d.Kind == "manual_offer" && (id == null || d.Id == id)).Select(d => ManualDto(s,JsonNode.Parse(d.Json)!.AsObject())).Where(j => (ms == null || j["status"]!.GetValue<string>() == ms) && Search(j["title"]!.GetValue<string>() + " " + j["dishName"]!.GetValue<string>(),q)).OrderByDescending(j => Time(j,"createdAt")).ThenBy(j => j["id"]!.GetValue<string>(),StringComparer.Ordinal); break;
            case "offers":
                QueryKeys(q,"q","kind","page","pageSize"); var kind = EnumQuery(q,"kind","all","automatic","manual") ?? "all";
                data = CombinedOffers(s,safe).Where(j => Search(j["dishName"]!.GetValue<string>() + " " + (j[safe ? "promotion" : "manual"]?["title"]?.GetValue<string>() ?? ""),q) && (kind == "all" || kind == "automatic" && (safe ? j["isAutomatic"]!.GetValue<bool>() : j["automatic"] != null) || kind == "manual" && j[safe ? "promotion" : "manual"] != null)); break;
            case "recommendations":
                QueryKeys(q, "q", "page", "pageSize"); data = Offers(s).Where(j => Search(j["dishName"]!.GetValue<string>(), q));
                if (safe) data = data.Select(j => Json(new { dishId = Id(j, "dishId"), dishName = j["dishName"]!.GetValue<string>(), maxPortions = j["maxPortions"]!.GetValue<long>(), suggestedPortions = j["suggestedPortions"]!.GetValue<int>() })); break;
            case "purchase-suggestions":
                QueryKeys(q, "q", "page", "pageSize"); data = Purchases(s).Where(j => Search(j["ingredientName"]!.GetValue<string>(), q)); break;
            case "purchase-suppliers":
                QueryKeys(q, "q", "page", "pageSize"); data = NameSort(s.Clients.Where(c => c.Kind == "supplier" && Search(c.Name, q)).Select(c => Json(new { c.Id, c.Name })), "name", "id"); break;
            case "quarantines": case "combos": case "purchase-requests":
                return ReadExtension(s, resource, id, q, channel);
            case "stop-list/forecast": return Ok(Forecast(s, q));
            case "analytics/risk-inventory": return Ok(RiskReport(s, q));
            default: throw ApiFailure.Missing();
        }
        if (id != null) return Ok(data.FirstOrDefault() ?? throw ApiFailure.Missing());
        return Ok(Paginate(data, q));
    }
}
