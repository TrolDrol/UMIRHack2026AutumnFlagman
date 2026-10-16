using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
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

namespace RestaurantManagement.WebApi.V2;

public sealed record CommandResult(int Status, object? Data);
public sealed class WarehouseSnapshot
{
    public required WarehouseRecord Warehouse { get; init; }
    public required List<Ingredient> Ingredients { get; init; }
    public required List<Dish> Dishes { get; init; }
    public required List<Batch> Batches { get; init; }
    public required List<Delivery> Deliveries { get; init; }
    public required List<Order> Orders { get; init; }
    public required List<OperationalDocument> Documents { get; init; }
    public required List<IntegrationClientRecord> Clients { get; init; }
    public required DateTime Now { get; init; }
    public required Actor Actor { get; init; }
    public required string RestaurantName { get; init; }
    public CancellationToken Cancellation { get; init; }
    public string RequestHash { get; set; } = "";
    public required List<ExternalDocumentRecord> ExternalDocuments { get; init; }
    public Ingredient Ingredient(Guid id) => Ingredients.FirstOrDefault(i => i.Id.Value == id) ?? throw ApiFailure.Invalid("ingredientId", "Ингредиент не найден в складе");
    public Dish Dish(Guid id) => Dishes.FirstOrDefault(i => i.Id.Value == id) ?? throw ApiFailure.Invalid("dishId", "Блюдо не найдено в складе");
    public Batch Batch(Guid id) => Batches.FirstOrDefault(i => i.Id.Value == id) ?? throw ApiFailure.Invalid("batchId", "Партия не найдена в складе");
    public OperationalDocument Document(string kind, Guid id) => Documents.FirstOrDefault(d => d.Kind == kind && d.Id == id) ?? throw ApiFailure.Missing();
}

public sealed partial class WarehouseService(AppDbContext db, TimeProvider clock, AccessService access)
{
    public static readonly string[] Management = ["super_admin", "owner", "manager"];
    public static readonly string[] StockRoles = ["super_admin", "owner", "manager", "warehouse"];
    public static readonly string[] ServiceRoles = ["super_admin", "owner", "manager", "waiter"];
    public static readonly string[] OwnerRoles = ["super_admin", "owner"];

    public async Task<IResult> Execute(HttpContext http, Guid warehouseId, string channel, string[] roles,
        bool mutation, bool keyRequired, object? body, Func<WarehouseSnapshot, Task<CommandResult>> command, bool published = true, bool computeOutside = false)
    {
        await access.Warehouse(http, warehouseId, channel, roles, published);
        if (http.Request.Method != "GET" && channel != "integration") await access.CookieMutation(http);
        Guid key = Guid.Empty;
        if (keyRequired && !Guid.TryParse(http.Request.Headers["Idempotency-Key"], out key))
            throw new ApiFailure(400, "INVALID_IDEMPOTENCY_KEY", "Требуется UUID Idempotency-Key");
        var hash = AccessService.Hash(Canonical(body));
        await using var tx = await db.Database.BeginTransactionAsync(mutation ? IsolationLevel.ReadCommitted : IsolationLevel.RepeatableRead, http.RequestAborted);
        await db.Database.ExecuteSqlRawAsync("SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '5s'", http.RequestAborted);
        if (!mutation) await db.Database.ExecuteSqlRawAsync("SET TRANSACTION READ ONLY", http.RequestAborted);
        var warehouse = mutation
            ? await db.Warehouses.FromSqlInterpolated($"SELECT * FROM warehouses WHERE \"Id\" = {warehouseId} FOR UPDATE").SingleAsync(http.RequestAborted)
            : await db.Warehouses.SingleAsync(w => w.Id == warehouseId, http.RequestAborted);
        var actor = await access.Warehouse(http, warehouseId, channel, roles, published);
        var now = ContractJson.Now(clock);
        var path = http.Request.Path.Value!.ToLowerInvariant();
        var method = http.Request.Method;
        if (keyRequired)
        {
            var replay = await db.Replays.AsNoTracking().FirstOrDefaultAsync(r => r.WarehouseId == warehouseId && r.Principal == actor.ReplayScope && r.Method == method && r.Path == path && r.Key == key, http.RequestAborted);
            if (replay != null)
            {
                if (replay.Hash != hash) throw ApiFailure.Conflict("IDEMPOTENCY_KEY_REUSED");
                await tx.CommitAsync(http.RequestAborted);
                return Results.Content(replay.ResponseJson, "application/json", statusCode: replay.Status);
            }
        }
        var snapshot = await Load(warehouse, now, actor, http.RequestAborted);
        snapshot.RequestHash = hash;
        if (!mutation && computeOutside) {
            await tx.CommitAsync(http.RequestAborted);
            var computed = await command(snapshot);
            return Results.Content(ContractJson.Serialize(new Envelope<object?>(computed.Data, ApiMiddleware.Meta(http, now))), "application/json", statusCode: computed.Status);
        }
        CommandResult result;
        string response;
        try
        {
            result = await command(snapshot);
            if (mutation && db.ChangeTracker.HasChanges()) warehouse.StateRevision++;
            response = result.Status == 204 ? "{}" : ContractJson.Serialize(new Envelope<object?>(result.Data, ApiMiddleware.Meta(http, now)));
        }
        catch (ApiFailure failure) when (keyRequired && failure.Status == 409)
        {
            // No mutation has been saved yet. Discard all tracked domain changes, retain only the final rejection.
            db.ChangeTracker.Clear();
            result = new(failure.Status, null);
            response = ContractJson.Serialize(ApiMiddleware.Error(http, now, failure));
        }
        if (keyRequired) db.Replays.Add(new() { Id = Guid.NewGuid(), WarehouseId = warehouseId, Principal = actor.ReplayScope,
            Method = method, Path = path, Key = key, Hash = hash, Status = result.Status, ResponseJson = response, CreatedAt = now });
        if (mutation) await db.SaveChangesAsync(http.RequestAborted);
        await tx.CommitAsync(http.RequestAborted);
        return result.Status == 204 ? Results.NoContent() : Results.Content(response, "application/json", statusCode: result.Status);
    }

    async Task<WarehouseSnapshot> Load(WarehouseRecord w, DateTime now, Actor actor, CancellationToken ct)
    {
        var id = WarehouseId.From(w.Id);
        return new() {
            Warehouse = w, Now = now, Actor = actor,
            Cancellation = ct,
            ExternalDocuments = await db.ExternalDocuments.Where(x => x.WarehouseId == w.Id).ToListAsync(ct),
            RestaurantName = await db.Enterprises.Where(e => e.Id == w.EnterpriseId).Select(e => e.Name).SingleAsync(ct),
            Ingredients = await db.Ingredients.Where(x => x.WarehouseId == id).ToListAsync(ct),
            Dishes = await db.Dishes.Include(x => x.RecipeIngredients).Where(x => x.WarehouseId == id).ToListAsync(ct),
            Batches = await db.Batches.Where(x => x.WarehouseId == id).ToListAsync(ct),
            Deliveries = await db.Deliveries.Include(x => x.Items).Where(x => x.WarehouseId == id).ToListAsync(ct),
            Orders = await db.Orders.Include(x => x.Items).Include(x => x.Allocations).AsSplitQuery().Where(x => x.WarehouseId == id && x.Status == OrderStatus.Paid).ToListAsync(ct),
            Documents = await db.Documents.Where(x => x.WarehouseId == w.Id).ToListAsync(ct),
            Clients = await db.IntegrationClients.Where(x => x.WarehouseId == w.Id).ToListAsync(ct)
        };
    }
    public static string Canonical(object? body)
    {
        var node = JsonSerializer.SerializeToNode(body, ContractJson.Options);
        JsonNode? Sort(JsonNode? n) => n switch {
            JsonObject o => new JsonObject(o.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => {
                var v = Sort(p.Value);
                if (v is JsonValue value && value.TryGetValue<string>(out var str)) {
                    if (p.Key is "quantity" or "reorderPoint" or "targetStock") {
                        if (decimal.TryParse(str, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var amount)) v = new Amount(amount).ToString();
                    } else if (p.Key.EndsWith("Id", StringComparison.Ordinal) && Guid.TryParse(str,out var uuid)) v = uuid.ToString();
                    else if (p.Key.EndsWith("At", StringComparison.Ordinal) && DateTimeOffset.TryParse(str, CultureInfo.InvariantCulture, DateTimeStyles.None, out var time))
                        v = time.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);
                    else if (p.Key is "name" or "title" or "number" or "externalId") v = str.Trim();
                }
                return KeyValuePair.Create(p.Key, v);
            }).ToArray()),
            JsonArray a => new JsonArray(a.Select(n => { var v = Sort(n); if (v is JsonValue value && value.TryGetValue<string>(out var text) && Guid.TryParse(text,out var uuid)) return JsonValue.Create(uuid.ToString()); return v; }).ToArray()),
            _ => n?.DeepClone()
        };
        return Sort(node)?.ToJsonString() ?? "null";
    }
    public static T Body<T>(JsonElement body) => ContractJson.Parse<T>(body.GetRawText());
    public static void Name(string? name, string path = "name", int max = 120)
    { if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > max) throw ApiFailure.Invalid(path); }
    public static void Note(string? note) { if (note?.Length > 500) throw ApiFailure.Invalid("note"); }
    public static void Positive(Amount value, string path = "quantity") { if (value.Value <= 0) throw ApiFailure.Invalid(path); }
    public static void Version(long value, string path = "version") { if (value < 1 || value > 9007199254740991) throw ApiFailure.Invalid(path); }
    public static CommandResult Ok(object data, int status = 200) => new(status, data);
    public static JsonObject Json(object data) => JsonSerializer.SerializeToNode(data, ContractJson.Options)!.AsObject();
    public static Guid Id(JsonObject j, string key) => Guid.Parse(j[key]!.GetValue<string>());
    public static decimal Qty(JsonObject j, string key) => decimal.Parse(j[key]!.GetValue<string>(), CultureInfo.InvariantCulture);
    public static DateTime Time(JsonObject j, string key) => DateTime.Parse(j[key]!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);
    public OperationalDocument AddDocument(WarehouseSnapshot s, string kind, object data, Guid? id = null, Guid? batch = null, Guid? client = null, long? sequence = null)
    {
        var d = new OperationalDocument { Id = id ?? Guid.NewGuid(), WarehouseId = s.Warehouse.Id, Kind = kind, Json = ContractJson.Serialize(data),
            CreatedAt = s.Now, BatchId = batch, ClientId = client, ActorUserId = s.Actor.ClientId == null ? s.Actor.Id : null, EventSequence = sequence };
        db.Documents.Add(d); s.Documents.Add(d); return d;
    }
    public static void Update(OperationalDocument d, JsonObject json) { d.Json = json.ToJsonString(); d.Version++; }
    public static IngredientDto IngredientDto(Ingredient i) => new(i.Id.Value, i.Name, i.Unit.Value, i.DefaultShelfLifeHours, i.ReorderPoint.Value, i.TargetStock.Value);
    public static DishDto DishDto(WarehouseSnapshot s, Dish d) => new(d.Id.Value, d.Name, d.Active,
        d.RecipeIngredients.Select(r => new RecipeLine(r.Requirement.IngredientId.Value, r.Requirement.Quantity.Value)).ToArray(),
        d.CreatedAt ?? s.Warehouse.TrackingStartedAt, d.UpdatedAt ?? s.Warehouse.TrackingStartedAt);
    public static object BatchDto(WarehouseSnapshot s, Batch b) => new {
        id = b.Id.Value, deliveryId = b.DeliveryId.Value, deliveryNumber = s.Deliveries.First(d => d.Id == b.DeliveryId).Number,
        deliveryItemId = b.SourceItemId.Value, ingredientId = b.IngredientId.Value, ingredientName = s.Ingredient(b.IngredientId.Value).Name,
        unit = b.Unit.Value, b.ReceivedAt, b.ManufacturedAt, b.ShelfLifeHours, expiresAt = b.ExpirationDate.Value,
        initialQuantity = new Amount(b.InitialQuantity.Value), remainingQuantity = new Amount(b.RemainingQuantity.Value), heldQuantity = new Amount(b.HeldQuantity),
        availableQuantity = new Amount(StockKernel.Available(b, s.Now)), heldExpiredQuantity = new Amount(b.IsExpired(s.Now) ? b.HeldQuantity : 0),
        b.Version, b.ReceiptCommittedAt, status = b.IsEmpty ? "empty" : StockKernel.Risk(b, s.Now).Phase,
        remainingSeconds = (long)Math.Floor((b.ExpirationDate.Value - s.Now).TotalSeconds)
    };
    public static object DeliveryDto(WarehouseSnapshot s, Delivery d, bool supplier = false)
    {
        var j = Json(new {
            id = d.Id.Value, d.Number, d.CreatedAt, d.ExpectedAt, d.ReceivedAt, status = d.Status.ToString().ToLowerInvariant(), d.Source, d.ExternalId,
            purchaseRequestId = d.PurchaseRequestId, d.Note, d.RejectedAt, d.RejectionReason,
            lines = d.Items.Select(i => new { id = i.Id.Value, ingredientId = i.IngredientId.Value, i.IngredientName, unit = i.Unit.Value, quantity = new Amount(i.Quantity.Value), i.ManufacturedAt, i.ShelfLifeHours, i.ExpiresAt }).ToArray()
        });
        if (!supplier) { j["batches"] = JsonSerializer.SerializeToNode(StockKernel.Fefo(s.Batches.Where(b => b.DeliveryId == d.Id)).Select(b => BatchDto(s, b)), ContractJson.Options); j["confirmedByUserId"] = d.ConfirmedByUserId; }
        if (!supplier) j.Remove("purchaseRequestId");
        return j;
    }
    public static JsonObject OrderDto(Order o)
    {
        if (o.SnapshotJson != null) return JsonNode.Parse(o.SnapshotJson)!.AsObject();
        return Json(new { id = o.Id.Value, number = o.Number ?? "LEGACY-" + o.Id.Value.ToString("N"), o.CreatedAt, status = "completed", o.Source, o.CustomerId,
            o.ExternalId, lines = o.Items.Select(l => new { dishId = l.DishId.Value, l.DishName, portions = l.Quantity }),
            allocations = o.Allocations.Select(a => new AllocationDto(a.BatchId.Value, a.IngredientId.Value, a.Quantity.Value, a.ExpiresAt.Value, null)),
            composition = o.Items.Select(l => new { kind = "dish", dishId = l.DishId.Value, l.DishName, portions = l.Quantity }) });
    }
    public static object Receipt(Order o)
    {
        var j = OrderDto(o); foreach (var k in j.Select(p => p.Key).Where(k => !new[] { "id", "number", "createdAt", "status", "lines", "composition" }.Contains(k)).ToArray()) j.Remove(k); return j;
    }
}

