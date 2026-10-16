using System.Text.Json;
using System.Text.Json.Nodes;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Application.Stock;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Infrastructure.Persistence;

namespace RestaurantManagement.WebApi.V2;

public sealed partial class WarehouseService
{
    public CommandResult OpenQuarantine(WarehouseSnapshot s, QuarantineInput input)
    {
        var b = s.Batch(input.BatchId);
        if (b.Version != input.ExpectedBatchVersion) throw ApiFailure.Conflict("BATCH_VERSION_CHANGED");
        if (input.Quantity.Value > b.FreeQuantity) throw ApiFailure.Conflict("INSUFFICIENT_FREE_BATCH_STOCK");
        var id = Guid.NewGuid(); b.Hold(input.Quantity.Value);
        var data = new { id, warehouseId = s.Warehouse.Id, input.BatchId, version = 1, openedQuantity = input.Quantity,
            remainingHeldQuantity = input.Quantity, releasedQuantity = new Amount(0), writtenOffQuantity = new Amount(0), input.Reason, input.Note,
            createdAt = s.Now, createdByUserId = s.Actor.Id, status = "open", closedAt = (DateTime?)null, decisions = Array.Empty<object>() };
        AddDocument(s, "quarantine", data, id, b.Id.Value);
        Movement(s, b, "quarantine_open", 0, input.Quantity.Value, id, null, id);
        return Ok(data, 201);
    }
    public CommandResult DecideQuarantine(WarehouseSnapshot s, Guid id, DecisionInput input, bool writeOff)
    {
        var doc = s.Document("quarantine", id); var j = JsonNode.Parse(doc.Json)!.AsObject(); var b = s.Batch(Id(j, "batchId"));
        if (j["version"]!.GetValue<long>() != input.ExpectedVersion) throw ApiFailure.Conflict("QUARANTINE_VERSION_CHANGED");
        if (j["status"]!.GetValue<string>() != "open") throw ApiFailure.Conflict("QUARANTINE_CLOSED");
        if (input.Quantity.Value > Qty(j, "remainingHeldQuantity")) throw ApiFailure.Conflict("INSUFFICIENT_HELD_STOCK");
        if (writeOff && input.Reason == "expired" && !b.IsExpired(s.Now)) throw ApiFailure.Conflict("BATCH_NOT_EXPIRED");
        Guid? writeOffId = null; object? wd = null;
        if (writeOff) {
            writeOffId = Guid.NewGuid(); b.WriteOffHeld(input.Quantity.Value);
            wd = new { id = writeOffId, createdAt = s.Now, batchId = b.Id.Value, input.Quantity, input.Reason, input.Note };
            AddDocument(s, "write_off", wd, writeOffId, b.Id.Value);
            Movement(s, b, "write_off", -input.Quantity.Value, -input.Quantity.Value, writeOffId.Value, null, id, StockKernel.Risk(b, s.Now));
        } else { b.Release(input.Quantity.Value); Movement(s, b, "quarantine_release", 0, -input.Quantity.Value, id, null, id); }
        var remainder = Qty(j, "remainingHeldQuantity") - input.Quantity.Value;
        j["remainingHeldQuantity"] = new Amount(remainder).ToString();
        var field = writeOff ? "writtenOffQuantity" : "releasedQuantity"; j[field] = new Amount(Qty(j, field) + input.Quantity.Value).ToString();
        j["version"] = input.ExpectedVersion + 1;
        if (remainder == 0) { j["status"] = "closed"; j["closedAt"] = JsonSerializer.SerializeToNode(s.Now, ContractJson.Options); }
        j["decisions"]!.AsArray().Add(Json(new { id = Guid.NewGuid(), action = writeOff ? "write_off" : "release", input.Quantity, input.Reason, at = s.Now, actorUserId = s.Actor.Id, writeOffId }));
        Update(doc, j); return Ok(writeOff ? new { quarantine = j, writeOff = wd } : (object)j);
    }
    public CommandResult QuarantineOrders(WarehouseSnapshot s, Guid id, IQueryCollection query)
    {
        QueryKeys(query, "page", "pageSize"); var b = s.Batch(s.Document("quarantine", id).BatchId!.Value);
        var rows = s.Orders.Where(o => o.Allocations.Any(a => a.BatchId == b.Id)).OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id.Value.ToString(), StringComparer.Ordinal)
            .Select(o => new { orderId = o.Id.Value, number = OrderDto(o)["number"]!.GetValue<string>(), o.CreatedAt, o.Source,
                usedFromBatchQuantity = new Amount(o.Allocations.Where(a => a.BatchId == b.Id).Sum(a => a.Quantity.Value)), unit = b.Unit.Value });
        return Ok(Paginate(rows, query));
    }
    public static void Validate(ComboInput input)
    {
        Name(input.Title, "title"); if (input.Components is null || input.Components.Length != 2 || input.Components.Select(c => c.DishId).Distinct().Count() != 2 || input.Components.Any(c => c.Portions != 1 || c.DishId == Guid.Empty)) throw ApiFailure.Invalid("components");
        if (input.ExpectedVersion != null) Version(input.ExpectedVersion.Value, "expectedVersion");
    }
    public static string Fingerprint(WarehouseSnapshot s, Component[] components) => ContractJson.Serialize(components.OrderBy(c => c.DishId.ToString(), StringComparer.Ordinal).Select(c => {
        var d = s.Dish(c.DishId); return new { c.DishId, c.Portions, active = d.Active, recipe = DishDto(s, d).Recipe.OrderBy(r => r.IngredientId.ToString(), StringComparer.Ordinal).ToArray() };
    }).ToArray());
    public CommandResult SaveCombo(WarehouseSnapshot s, ComboInput input, Guid? id)
    {
        foreach (var c in input.Components) if (!s.Dish(c.DishId).Active) throw ApiFailure.Conflict("DISH_INACTIVE");
        var existing = id == null ? null : s.Document("combo", id.Value); var old = existing == null ? null : JsonNode.Parse(existing.Json)!.AsObject();
        if (old != null && old["version"]!.GetValue<long>() != input.ExpectedVersion) throw ApiFailure.Conflict("COMBO_VERSION_CHANGED");
        var version = old == null ? 1 : old["version"]!.GetValue<long>() + 1;
        var comboId = id ?? Guid.NewGuid();
        var data = new { id = comboId, title = input.Title.Trim(), input.Components, version, status = "draft", createdAt = old == null ? s.Now : Time(old, "createdAt"), updatedAt = s.Now,
            recipeFingerprint = Fingerprint(s, input.Components), needsReview = false, pricingMode = "unpriced" };
        if (existing == null) AddDocument(s, "combo", data, comboId);
        else { AddDocument(s, "combo_version", old!); Update(existing, Json(data)); }
        return Ok(data, 201);
    }
    public CommandResult TransitionCombo(WarehouseSnapshot s, Guid id, ExpectedVersionInput input, bool publish)
    {
        var doc = s.Document("combo", id); var j = JsonNode.Parse(doc.Json)!.AsObject();
        if (j["version"]!.GetValue<long>() != input.ExpectedVersion) throw ApiFailure.Conflict("COMBO_VERSION_CHANGED");
        var status = j["status"]!.GetValue<string>();
        if (publish && status != "draft" || !publish && status is not ("draft" or "published")) throw ApiFailure.Conflict("COMBO_STATE_CONFLICT");
        var components = ContractJson.Parse<Component[]>(j["components"]!.ToJsonString());
        if (publish) {
            if (j["recipeFingerprint"]!.GetValue<string>() != Fingerprint(s, components)) throw ApiFailure.Conflict("COMBO_RECIPE_CHANGED");
            if (!StockKernel.Plan(s.Ingredients, s.Dishes, s.Batches, components.Select(c => new OrderLine(c.DishId, 1)).ToArray(), s.Now).CanCreate) throw ApiFailure.Conflict("COMBO_UNAVAILABLE");
        }
        j["status"] = publish ? "published" : "archived"; j["updatedAt"] = JsonSerializer.SerializeToNode(s.Now, ContractJson.Options); Update(doc, j);
        return Ok(j);
    }
    public static (OrderLine[] Lines, object[] Composition) Expand(WarehouseSnapshot s, OrderInput input)
    {
        var counts = new Dictionary<Guid, int>(); var composition = new List<object>();
        foreach (var l in input.Lines) { var d = s.Dish(l.DishId); counts[l.DishId] = l.Portions; composition.Add(new { kind = "dish", l.DishId, dishName = d.Name, l.Portions }); }
        foreach (var l in input.Combos ?? []) {
            var doc = s.Documents.FirstOrDefault(d => d.Kind == "combo" && d.Id == l.ComboId); if (doc == null) throw ApiFailure.Conflict("COMBO_VERSION_CHANGED");
            var c = JsonNode.Parse(doc.Json)!.AsObject();
            if (c["version"]!.GetValue<long>() != l.Version) throw ApiFailure.Conflict("COMBO_VERSION_CHANGED");
            if (c["status"]!.GetValue<string>() != "published") throw ApiFailure.Conflict("COMBO_UNAVAILABLE");
            var parts = ContractJson.Parse<Component[]>(c["components"]!.ToJsonString());
            if (c["recipeFingerprint"]!.GetValue<string>() != Fingerprint(s, parts)) throw ApiFailure.Conflict("COMBO_RECIPE_CHANGED");
            foreach (var p in parts) {
                if (!s.Dish(p.DishId).Active) throw ApiFailure.Conflict("COMBO_UNAVAILABLE");
                counts[p.DishId] = counts.GetValueOrDefault(p.DishId) + l.Quantity;
            }
            composition.Add(new { kind = "combo", l.ComboId, l.Version, title = c["title"]!.GetValue<string>(), l.Quantity, pricingMode = "unpriced", components = parts.Select(p => new { p.DishId, dishName = s.Dish(p.DishId).Name, p.Portions }).ToArray() });
        }
        if (counts.Count > 100 || counts.Values.Any(n => n > 1000)) throw new ApiFailure(422, "ORDER_LIMIT_EXCEEDED", "Превышен предел заказа после раскрытия комбо");
        return (counts.OrderBy(p => p.Key.ToString(), StringComparer.Ordinal).Select(p => new OrderLine(p.Key, p.Value)).ToArray(), composition.ToArray());
    }
    public static object PublicCombo(WarehouseSnapshot s, JsonObject c)
    {
        var components = ContractJson.Parse<Component[]>(c["components"]!.ToJsonString());
        var changed = c["recipeFingerprint"]!.GetValue<string>() != Fingerprint(s, components);
        var max = 0L;
        if (!changed && components.All(p => s.Dish(p.DishId).Active) && c["status"]!.GetValue<string>() == "published") {
            var req = StockKernel.Plan(s.Ingredients, s.Dishes, s.Batches, components.Select(p => new OrderLine(p.DishId, 1)).ToArray(), s.Now).Requirements;
            max = Math.Min(1000, req.Min(r => (long)(r.AvailableQuantity.Value / r.RequiredQuantity.Value)));
        }
        return new { id = Id(c, "id"), version = c["version"]!.GetValue<long>(), title = c["title"]!.GetValue<string>(), components = components.Select(p => new { p.DishId, dishName = s.Dish(p.DishId).Name, p.Portions }),
            status = max > 0 ? "available" : "stopped", maxUnits = max, unavailableReason = max > 0 ? null : "Комплект временно недоступен", pricingMode = "unpriced" };
    }
    public CommandResult ReadExtension(WarehouseSnapshot s, string resource, Guid? id, IQueryCollection q, string channel)
    {
        IEnumerable<JsonObject> rows = s.Documents.Where(d => d.Kind == (resource == "quarantines" ? "quarantine" : resource == "combos" ? "combo" : "purchase_request") && (id == null || d.Id == id))
            .Select(d => JsonNode.Parse(d.Json)!.AsObject());
        if (resource == "quarantines") {
            QueryKeys(q, "status", "batchId", "ingredientId", "page", "pageSize"); var status = EnumQuery(q, "status", "open", "closed"); var b = QueryId(q, "batchId"); var i = QueryId(q, "ingredientId");
            rows = rows.Where(j => (status == null || j["status"]!.GetValue<string>() == status) && (b == null || Id(j, "batchId") == b) && (i == null || s.Batch(Id(j, "batchId")).IngredientId.Value == i));
        } else if (resource == "combos") {
            QueryKeys(q, "q", "status", "page", "pageSize"); var status = EnumQuery(q, "status", "draft", "published", "archived");
            rows = rows.Where(j => Search(j["title"]!.GetValue<string>(), q) && (status == null || j["status"]!.GetValue<string>() == status));
            if (channel != "staff") rows = rows.Where(j => j["status"]!.GetValue<string>() == "published").Select(j => Json(PublicCombo(s, j)));
            else rows = rows.Select(j => { j["needsReview"] = j["recipeFingerprint"]!.GetValue<string>() != Fingerprint(s, ContractJson.Parse<Component[]>(j["components"]!.ToJsonString())); return j; });
        } else {
            QueryKeys(q, "status", "supplierClientId", "page", "pageSize"); var status = EnumQuery(q, "status", "draft", "submitted", "approved", "delivery_pending", "received", "rejected", "cancelled", "delivery_rejected"); var supplier = QueryId(q, "supplierClientId");
            rows = rows.Where(j => (channel != "integration" || Id(j, "supplierClientId") == s.Actor.ClientId && j["submittedAt"] != null) && (supplier == null || Id(j, "supplierClientId") == supplier) && (status == null || j["status"]!.GetValue<string>() == status));
        }
        rows = resource == "combos" ? NameSort(rows, "title", "id") : HistorySort(rows);
        if (id != null) return Ok(rows.FirstOrDefault() ?? throw ApiFailure.Missing());
        return Ok(Paginate(rows, q));
    }
    public static void Validate(PurchaseInput input)
    {
        Note(input.Note); if (input.SupplierClientId == Guid.Empty || input.Lines == null || input.Lines.Length is < 1 or > 100 || input.Lines.Select(l => l.IngredientId).Distinct().Count() != input.Lines.Length || input.Lines.Any(l => l.IngredientId == Guid.Empty || l.Quantity.Value <= 0)) throw ApiFailure.Invalid("lines");
        if (input.Version != null) Version(input.Version.Value);
    }
    public CommandResult SavePurchase(WarehouseSnapshot s, PurchaseInput input, Guid? id)
    {
        var supplier = s.Clients.FirstOrDefault(c => c.Id == input.SupplierClientId && c.Kind == "supplier") ?? throw ApiFailure.Invalid("supplierClientId");
        var doc = id == null ? null : s.Document("purchase_request", id.Value); var old = doc == null ? null : JsonNode.Parse(doc.Json)!.AsObject();
        if (old != null) { if (old["version"]!.GetValue<long>() != input.Version) throw ApiFailure.Conflict("VERSION_CONFLICT"); if (old["status"]!.GetValue<string>() != "draft") throw ApiFailure.Conflict("PURCHASE_REQUEST_STATE_CONFLICT"); }
        var requestId = id ?? Guid.NewGuid();
        var data = new { id = requestId, number = old == null ? "PUR-" + (++s.Warehouse.PurchaseSequence).ToString("D6") : old["number"]!.GetValue<string>(), warehouseId = s.Warehouse.Id,
            version = old == null ? 1 : old["version"]!.GetValue<long>() + 1, input.SupplierClientId, supplierName = supplier.Name, status = "draft", createdAt = old == null ? s.Now : Time(old, "createdAt"),
            submittedAt = (DateTime?)null, approvedAt = (DateTime?)null, closedAt = (DateTime?)null, input.ExpectedAt, input.Note, rejectionReason = (string?)null, deliveryId = (Guid?)null,
            lines = input.Lines.Select(l => { var i = s.Ingredient(l.IngredientId); return new { l.IngredientId, ingredientName = i.Name, unit = i.Unit.Value, l.Quantity }; }).ToArray() };
        if (doc == null) AddDocument(s, "purchase_request", data, requestId, client: supplier.Id);
        else { AddDocument(s, "purchase_version", old!, client: doc.ClientId); doc.ClientId = supplier.Id; Update(doc, Json(data)); }
        return Ok(data, id == null ? 201 : 200);
    }
    public CommandResult TransitionPurchase(WarehouseSnapshot s, Guid id, VersionInput input, string action, bool supplier)
    {
        var doc = s.Document("purchase_request", id); var j = JsonNode.Parse(doc.Json)!.AsObject();
        if (supplier && (doc.ClientId != s.Actor.ClientId || j["submittedAt"] == null)) throw ApiFailure.Missing();
        if (j["version"]!.GetValue<long>() != input.Version) throw ApiFailure.Conflict("VERSION_CONFLICT");
        var status = j["status"]!.GetValue<string>();
        var valid = action switch { "submit" => status == "draft", "cancel" => status is "draft" or "submitted" or "approved" && j["deliveryId"] == null, "approve" or "reject" => status == "submitted", _ => false };
        if (!valid) throw ApiFailure.Conflict("PURCHASE_REQUEST_STATE_CONFLICT");
        AddDocument(s, "purchase_transition", new { purchaseRequestId = id, action, previous = j.DeepClone(), actorUserId = s.Actor.ClientId == null ? (Guid?)s.Actor.Id : null, integrationClientId = s.Actor.ClientId, at = s.Now }, client: doc.ClientId);
        j["status"] = action switch { "submit" => "submitted", "cancel" => "cancelled", "approve" => "approved", _ => "rejected" };
        j["version"] = input.Version + 1;
        if (action == "submit") j["submittedAt"] = JsonSerializer.SerializeToNode(s.Now, ContractJson.Options);
        if (action == "approve") j["approvedAt"] = JsonSerializer.SerializeToNode(s.Now, ContractJson.Options);
        if (action is "cancel" or "reject") j["closedAt"] = JsonSerializer.SerializeToNode(s.Now, ContractJson.Options);
        if (action == "reject") j["rejectionReason"] = input.Reason!.Trim();
        Update(doc, j); return Ok(j);
    }
    void LinkShipment(WarehouseSnapshot s, Delivery d, Guid id)
    {
        var doc = s.Document("purchase_request", id); var j = JsonNode.Parse(doc.Json)!.AsObject();
        if (doc.ClientId != s.Actor.ClientId || j["submittedAt"] == null) throw ApiFailure.Missing();
        if (j["status"]!.GetValue<string>() != "approved" || j["deliveryId"] != null) throw ApiFailure.Conflict("PURCHASE_REQUEST_STATE_CONFLICT");
        var lines = j["lines"]!.AsArray().Select(n => n!.AsObject()).ToDictionary(l => Id(l, "ingredientId"), l => Qty(l, "quantity"));
        var shipped = d.Items.GroupBy(i => i.IngredientId.Value).ToDictionary(g => g.Key, g => g.Sum(i => i.Quantity.Value));
        if (lines.Count != shipped.Count || lines.Any(l => shipped.GetValueOrDefault(l.Key) != l.Value)) throw ApiFailure.Invalid("lines", "Отгрузка должна точно совпадать с одобренной заявкой");
        AddDocument(s, "purchase_transition", new { purchaseRequestId = id, action = "shipment", previous = j.DeepClone(), integrationClientId = s.Actor.ClientId, at = s.Now }, client: doc.ClientId);
        j["status"] = "delivery_pending"; j["deliveryId"] = d.Id.Value.ToString(); j["version"] = j["version"]!.GetValue<long>() + 1; Update(doc, j);
    }
    void FinishPurchase(WarehouseSnapshot s, Delivery d, string status)
    {
        if (d.PurchaseRequestId == null) return;
        var doc = s.Document("purchase_request", d.PurchaseRequestId.Value); var j = JsonNode.Parse(doc.Json)!.AsObject();
        if (j["status"]!.GetValue<string>() != "delivery_pending" || Id(j, "deliveryId") != d.Id.Value) throw ApiFailure.Conflict("PURCHASE_REQUEST_STATE_CONFLICT");
        AddDocument(s, "purchase_transition", new { purchaseRequestId = d.PurchaseRequestId, action = status, previous = j.DeepClone(), actorUserId = s.Actor.Id, at = s.Now }, client: doc.ClientId);
        j["status"] = status; j["closedAt"] = JsonSerializer.SerializeToNode(s.Now, ContractJson.Options); j["version"] = j["version"]!.GetValue<long>() + 1; Update(doc, j);
    }
}
