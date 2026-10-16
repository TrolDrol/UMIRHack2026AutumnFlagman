using System.Text.Json;
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

namespace RestaurantManagement.WebApi.V2;

public sealed partial class WarehouseService
{
    public static void Validate(IngredientInput b)
    {
        Name(b.Name); if (b.Unit is not ("g" or "ml" or "pcs")) throw ApiFailure.Invalid("unit");
        if (b.DefaultShelfLifeHours is < 1 or > 87600) throw ApiFailure.Invalid("defaultShelfLifeHours");
        if (b.TargetStock.Value < b.ReorderPoint.Value) throw ApiFailure.Invalid("targetStock");
    }
    public static void Validate(DishInput b)
    {
        Name(b.Name); if (b.Recipe is null || b.Recipe.Length is < 1 or > 50) throw ApiFailure.Invalid("recipe");
        if (b.Recipe.Any(r => r.IngredientId == Guid.Empty || r.Quantity.Value <= 0) || b.Recipe.Select(r => r.IngredientId).Distinct().Count() != b.Recipe.Length) throw ApiFailure.Invalid("recipe");
    }
    public static void Validate(DeliveryInput b, bool external)
    {
        Name(b.Number, "number", 64); Note(b.Note);
        if (external) Name(b.ExternalId, "externalId", 128);
        if (b.Lines is null || b.Lines.Length is < 1 or > 100) throw ApiFailure.Invalid("lines");
        for (var n = 0; n < b.Lines.Length; n++) {
            var l = b.Lines[n]; Positive(l.Quantity, $"lines.{n}.quantity");
            if (l.IngredientId == Guid.Empty || (l.ExpiresAt == null) == (l.ManufacturedAt == null) || l.ExpiresAt != null && l.ShelfLifeHours != null || l.ShelfLifeHours is < 1 or > 87600) throw ApiFailure.Invalid($"lines.{n}");
        }
    }
    public static void Validate(OrderInput b, bool external)
    {
        if (b.Lines == null || b.Lines.Length > 100 || (b.Lines.Length + (b.Combos?.Length ?? 0)) is < 1 or > 100) throw ApiFailure.Invalid("lines");
        if (b.Lines.Any(l => l.DishId == Guid.Empty || l.Portions is < 1 or > 1000) || b.Lines.Select(l => l.DishId).Distinct().Count() != b.Lines.Length) throw ApiFailure.Invalid("lines");
        if (b.Combos != null && (b.Combos.Any(c => c.ComboId == Guid.Empty || c.Quantity is < 1 or > 1000 || c.Version < 1 || c.Version > 9007199254740991) || b.Combos.Select(c => c.ComboId).Distinct().Count() != b.Combos.Length)) throw ApiFailure.Invalid("combos");
        if (external) Name(b.ExternalId, "externalId", 128);
    }
    public CommandResult SaveIngredient(WarehouseSnapshot s, IngredientInput input, Guid? id)
    {
        if (s.Ingredients.Any(i => i.Id.Value != id && string.Equals(i.Name, input.Name.Trim(), StringComparison.OrdinalIgnoreCase))) throw ApiFailure.Conflict("NAME_CONFLICT");
        var i = id == null ? new Ingredient(IngredientId.New(), WarehouseId.From(s.Warehouse.Id), input.Name, Unit.From(input.Unit), input.DefaultShelfLifeHours, Quantity.From(input.ReorderPoint.Value), Quantity.From(input.TargetStock.Value)) :
            s.Ingredients.FirstOrDefault(i => i.Id.Value == id) ?? throw ApiFailure.Missing();
        if (id == null) { db.Ingredients.Add(i); s.Ingredients.Add(i); }
        else i.UpdateProperties(input.Name, input.DefaultShelfLifeHours, Quantity.From(input.ReorderPoint.Value), Quantity.From(input.TargetStock.Value));
        return Ok(IngredientDto(i), id == null ? 201 : 200);
    }
    public CommandResult PatchIngredient(WarehouseSnapshot s, Guid id, JsonElement input)
    {
        var i = s.Ingredients.FirstOrDefault(i => i.Id.Value == id) ?? throw ApiFailure.Missing();
        var j = Json(IngredientDto(i)); j.Remove("id");
        foreach (var p in input.EnumerateObject()) {
            if (p.Name == "unit" || !j.ContainsKey(p.Name) || p.Value.ValueKind == JsonValueKind.Null) throw ApiFailure.Invalid(p.Name);
            j[p.Name] = System.Text.Json.Nodes.JsonNode.Parse(p.Value.GetRawText());
        }
        if (!input.EnumerateObject().Any()) throw ApiFailure.Invalid("body");
        var b = ContractJson.Parse<IngredientInput>(j.ToJsonString()); Validate(b); return SaveIngredient(s, b, id);
    }
    public CommandResult SaveDish(WarehouseSnapshot s, DishInput input, Guid? id)
    {
        if (s.Dishes.Any(d => d.Id.Value != id && string.Equals(d.Name, input.Name.Trim(), StringComparison.OrdinalIgnoreCase))) throw ApiFailure.Conflict("NAME_CONFLICT");
        var recipe = input.Recipe.Select(r => {
            var i = s.Ingredient(r.IngredientId);
            return new RecipeIngredient(RecipeIngredientId.New(), i.Name, new IngredientRequirement(i.Id, Quantity.From(r.Quantity.Value), i.Unit));
        }).ToArray();
        var dish = id == null ? new Dish(DishId.New(), WarehouseId.From(s.Warehouse.Id), input.Name, recipe) : s.Dishes.FirstOrDefault(d => d.Id.Value == id) ?? throw ApiFailure.Missing();
        if(id!=null)db.Set<RecipeIngredient>().RemoveRange(dish.RecipeIngredients.ToArray());
        dish.Replace(input.Name, input.Active, recipe, s.Now);
        if (id == null) { db.Dishes.Add(dish); s.Dishes.Add(dish); }
        return Ok(DishDto(s, dish), id == null ? 201 : 200);
    }
    public CommandResult CreateDelivery(WarehouseSnapshot s, DeliveryInput input, bool supplier)
    {
        if (supplier && External(s, "delivery", input.ExternalId!) is { } saved) return Ok(DeliveryDto(s, s.Deliveries.First(d => d.Id.Value == saved.DocumentId), true));
        if (s.Deliveries.Any(d => d.Number == input.Number.Trim())) throw ApiFailure.Conflict("DELIVERY_NUMBER_EXISTS");
        var delivery = new Delivery(DeliveryId.New(), WarehouseId.From(s.Warehouse.Id), input.Number, s.Now, input.ExpectedAt, input.Note, supplier ? "integration" : "manual", input.ExternalId);
        foreach (var l in input.Lines) {
            var i = s.Ingredient(l.IngredientId);
            delivery.AddItem(i.Id, i.Name, Quantity.From(l.Quantity.Value), i.Unit, l.ManufacturedAt, l.ShelfLifeHours, l.ExpiresAt, i.DefaultShelfLifeHours);
        }
        if (supplier) {
            delivery.SetIntegration(s.Actor.ClientId!.Value, input.PurchaseRequestId);
            if (input.PurchaseRequestId != null) LinkShipment(s, delivery, input.PurchaseRequestId.Value);
        } else if (input.ExternalId != null || input.PurchaseRequestId != null) throw ApiFailure.Invalid("externalId");
        db.Deliveries.Add(delivery); s.Deliveries.Add(delivery);
        AddDocument(s,"delivery_created",new { deliveryId=delivery.Id.Value,actorUserId=s.Actor.ClientId==null?(Guid?)s.Actor.Id:null,integrationClientId=s.Actor.ClientId,at=s.Now },client:s.Actor.ClientId);
        if (supplier) MapExternal(s, "delivery", input.ExternalId!, delivery.Id.Value);
        return Ok(DeliveryDto(s, delivery, supplier), 201);
    }
    public CommandResult ConfirmDelivery(WarehouseSnapshot s, Guid id, ConfirmInput input)
    {
        var d = s.Deliveries.FirstOrDefault(d => d.Id.Value == id) ?? throw ApiFailure.Missing();
        if (d.Status == DeliveryStatus.Confirmed) {
            if (input.ReceivedAtMode != "server" && d.ReceivedAt != input.ReceivedAt) throw ApiFailure.Conflict("DELIVERY_STATE_CONFLICT");
            return Ok(DeliveryDto(s, d));
        }
        if (d.Status != DeliveryStatus.Pending) throw ApiFailure.Conflict("DELIVERY_STATE_CONFLICT");
        var receivedAt = input.ReceivedAtMode == "server" ? s.Now : input.ReceivedAt!.Value;
        if (receivedAt > s.Now) throw ApiFailure.Invalid("receivedAt", "Приёмка не может быть в будущем");
        // Validate the complete receipt and stock limits before changing the tracked document.
        foreach (var group in d.Items.GroupBy(i => i.IngredientId))
            ContractJson.Limit(group.Sum(i => i.Quantity.Value) + s.Batches.Where(b => b.IngredientId == group.Key).Sum(b => b.RemainingQuantity.Value));
        d.Confirm(receivedAt, s.Now, s.Actor.Id.ToString());
        foreach (var i in d.Items) {
            var b = new Batch(BatchId.New(), d.WarehouseId, d.Id, i.Id, i.IngredientId, i.IngredientName, i.Quantity, receivedAt, i.ManufacturedAt, i.ShelfLifeHours, ExpirationDate.From(i.ExpiresAt), i.Unit);
            b.MarkReceipt(s.Now); db.Batches.Add(b); s.Batches.Add(b);
            Movement(s, b, "receipt", i.Quantity.Value, 0, d.Id.Value, d.Number);
        }
        FinishPurchase(s, d, "received");
        return Ok(DeliveryDto(s, d));
    }
    public CommandResult RejectDelivery(WarehouseSnapshot s, Guid id, ReasonInput input)
    {
        var d = s.Deliveries.FirstOrDefault(d => d.Id.Value == id) ?? throw ApiFailure.Missing();
        if (d.Status == DeliveryStatus.Rejected && d.RejectionReason == input.Reason.Trim()) return Ok(DeliveryDto(s, d));
        if (d.Status != DeliveryStatus.Pending) throw ApiFailure.Conflict("DELIVERY_STATE_CONFLICT");
        d.Reject(input.Reason); d.MarkRejected(s.Now); FinishPurchase(s, d, "delivery_rejected");
        return Ok(DeliveryDto(s, d));
    }
    public CommandResult PlaceOrder(WarehouseSnapshot s, OrderInput input, string source, bool preview)
    {
        if (!preview && source == "integration" && External(s, "order", input.ExternalId!) is { } saved) return Ok(Receipt(s.Orders.First(o => o.Id.Value == saved.DocumentId)));
        var (lines, composition) = Expand(s, input);
        var plan = StockKernel.Plan(s.Ingredients, s.Dishes, s.Batches, lines, s.Now, includeRisk: !preview);
        var safe = source is "waiter" or "customer" or "integration";
        var shortages = plan.Requirements.Where(r => r.MissingQuantity.Value > 0).ToArray();
        object SafeShortages() => shortages.Select(r => new { r.IngredientName, r.Unit, r.MissingQuantity }).ToArray();
        if (preview) return Ok(safe ? new { plan.CanCreate, shortages = SafeShortages() } : (object)plan);
        if (!plan.CanCreate) throw new ApiFailure(409, "INSUFFICIENT_STOCK", "Недостаточно ингредиентов", new { shortages = safe ? SafeShortages() : (object)shortages });
        var o = new Order(OrderId.New(), WarehouseId.From(s.Warehouse.Id), s.Now);
        foreach (var l in lines) o.AddItem(s.Dish(l.DishId), l.Portions);
        foreach (var a in plan.Allocations) o.RecordAllocation(BatchId.From(a.BatchId), IngredientId.From(a.IngredientId), Quantity.From(a.Quantity.Value), ExpirationDate.From(a.ExpiresAt));
        o.ConfirmPayment();
        var number = "ORD-" + (++s.Warehouse.OrderSequence).ToString("D6");
        var data = new { id = o.Id.Value, number, createdAt = s.Now, status = "completed", source, customerId = source == "customer" ? (Guid?)s.Actor.Id : null,
            externalId = input.ExternalId?.Trim(), lines = lines.Select(l => new { l.DishId, dishName = s.Dish(l.DishId).Name, l.Portions }),
            allocations = plan.Allocations, composition, recipeSnapshot = lines.Select(l => new { l.DishId, recipe = DishDto(s, s.Dish(l.DishId)).Recipe }) };
        o.SetSnapshot(number, source, source == "customer" ? s.Actor.Id : null, s.Actor.ClientId, input.ExternalId, ContractJson.Serialize(data));
        AddDocument(s,"order_recipe_snapshot",new { orderId=o.Id.Value,at=s.Now,recipes=lines.Select(l=>new{l.DishId,dishName=s.Dish(l.DishId).Name,ingredients=s.Dish(l.DishId).RecipeIngredients.Select(r=>{
            var i=s.Ingredient(r.Requirement.IngredientId.Value);return new{ingredientId=i.Id.Value,ingredientName=i.Name,unit=i.Unit.Value,quantityPerPortion=new Amount(r.Requirement.Quantity.Value)};
        }).ToArray()}).ToArray() },client:s.Actor.ClientId);
        foreach (var a in plan.Allocations) {
            var b = s.Batch(a.BatchId); b.Deduct(Quantity.From(a.Quantity.Value));
            Movement(s, b, "order", -a.Quantity.Value, 0, o.Id.Value, number, risk: a.RiskSnapshot);
        }
        db.Orders.Add(o); s.Orders.Add(o);
        if (source == "integration") MapExternal(s, "order", input.ExternalId!, o.Id.Value);
        return Ok(safe ? Receipt(o) : OrderDto(o), 201);
    }
    public CommandResult WriteOff(WarehouseSnapshot s, WriteOffInput input)
    {
        var b = s.Batch(input.BatchId);
        if (input.Reason == "expired" && !b.IsExpired(s.Now)) throw ApiFailure.Conflict("BATCH_NOT_EXPIRED");
        if (input.Quantity.Value > b.FreeQuantity) throw ApiFailure.Conflict("INSUFFICIENT_FREE_BATCH_STOCK");
        var id = Guid.NewGuid(); b.Deduct(Quantity.From(input.Quantity.Value));
        var result = new { id, createdAt = s.Now, input.BatchId, input.Quantity, input.Reason, input.Note };
        AddDocument(s, "write_off", result, id, b.Id.Value);
        Movement(s, b, "write_off", -input.Quantity.Value, 0, id, null, risk: StockKernel.Risk(b, s.Now));
        return Ok(result, 201);
    }
    public void Movement(WarehouseSnapshot s, Batch b, string type, decimal physical, decimal held, Guid referenceId, string? number, Guid? quarantineId = null, RiskSnapshot? risk = null)
    {
        var id = Guid.NewGuid(); var sequence = ++s.Warehouse.EventSequence;
        var result = new { id, createdAt = s.Now, ingredientId = b.IngredientId.Value, ingredientName = s.Ingredient(b.IngredientId.Value).Name,
            unit = b.Unit.Value, batchId = b.Id.Value, type, quantityDelta = physical.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture),
            heldQuantityDelta = held.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture), heldAfter = new Amount(b.HeldQuantity), quarantineId,
            actorUserId = s.Actor.ClientId == null ? (Guid?)s.Actor.Id : null, integrationClientId = s.Actor.ClientId, eventSequence = sequence, riskSnapshot = risk,
            remainingAfter = new Amount(b.RemainingQuantity.Value), referenceId, referenceNumber = number };
        AddDocument(s, "movement", result, id, b.Id.Value, s.Actor.ClientId, sequence);
    }
    RestaurantManagement.Infrastructure.Persistence.ExternalDocumentRecord? External(WarehouseSnapshot s, string kind, string externalId)
    {
        var record = s.ExternalDocuments.FirstOrDefault(d => d.ClientId == s.Actor.ClientId && d.Kind == kind && d.ExternalId == externalId.Trim());
        if (record != null && record.RequestHash != s.RequestHash) throw ApiFailure.Conflict("EXTERNAL_ID_CONFLICT");
        return record;
    }
    void MapExternal(WarehouseSnapshot s, string kind, string externalId, Guid documentId)
    {
        var record = new RestaurantManagement.Infrastructure.Persistence.ExternalDocumentRecord { WarehouseId = s.Warehouse.Id, ClientId = s.Actor.ClientId!.Value, Kind = kind, ExternalId = externalId.Trim(), RequestHash = s.RequestHash, DocumentId = documentId };
        db.ExternalDocuments.Add(record); s.ExternalDocuments.Add(record);
    }
}
