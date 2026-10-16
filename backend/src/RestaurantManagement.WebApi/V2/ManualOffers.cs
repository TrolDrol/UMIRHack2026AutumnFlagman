using System.Text.Json.Nodes;
using RestaurantManagement.Application.Stock;
using RestaurantManagement.Application.Contracts;

namespace RestaurantManagement.WebApi.V2;

public record ManualOfferInput(Guid DishId, string Title, string? PublicText, DateTime? StartsAt, DateTime EndsAt, long? ExpectedVersion = null);

public sealed partial class WarehouseService
{
    static string ManualState(WarehouseSnapshot s, JsonObject j)
    {
        var status = j["status"]!.GetValue<string>();
        if (status != "published") return status;
        if (Time(j, "endsAt") <= s.Now) return "ended";
        if (Time(j, "effectiveStartsAt") > s.Now) return "scheduled";
        var dish = s.Dishes.FirstOrDefault(d => d.Id.Value == Id(j, "dishId"));
        return dish is null || !dish.Active || StockKernel.MaxPortions(dish, s.Batches, s.Now) == 0 ? "unavailable" : "visible";
    }
    static JsonObject ManualDto(WarehouseSnapshot s, JsonObject stored)
    {
        var j = stored.DeepClone().AsObject();
        j["dishName"] = s.Dishes.FirstOrDefault(d => d.Id.Value == Id(j, "dishId"))?.Name ?? "Блюдо удалено";
        j["effectiveState"] = ManualState(s, j);
        j["unavailableReason"] = j["effectiveState"]!.GetValue<string>() == "unavailable" ? "Блюдо неактивно или нет ингредиентов на порцию" : null;
        return j;
    }
    public CommandResult SaveManualOffer(WarehouseSnapshot s, ManualOfferInput input, Guid? id)
    {
        Name(input.Title, "title");
        if (input.PublicText?.Length > 500) throw ApiFailure.Invalid("publicText");
        if (input.EndsAt == default || input.StartsAt is { } start && input.EndsAt <= start) throw ApiFailure.Invalid("endsAt");
        var dish = s.Dish(input.DishId);
        var document = id is null ? null : s.Document("manual_offer", id.Value);
        var j = document is null ? new JsonObject() : JsonNode.Parse(document.Json)!.AsObject();
        if (document is not null) {
            if (input.ExpectedVersion is null) throw ApiFailure.Invalid("expectedVersion");
            Version(input.ExpectedVersion.Value, "expectedVersion");
            if (document.Version != input.ExpectedVersion) throw ApiFailure.Conflict("MANUAL_OFFER_VERSION_CONFLICT");
            if (j["status"]!.GetValue<string>() != "draft") throw ApiFailure.Conflict("MANUAL_OFFER_STATE_CONFLICT");
            if (Id(j, "dishId") != input.DishId) throw ApiFailure.Invalid("dishId", "Блюдо неизменяемо");
        } else {
            if (!dish.Active) throw ApiFailure.Conflict("DISH_INACTIVE");
            if (s.Documents.Where(d => d.Kind == "manual_offer").Select(d => JsonNode.Parse(d.Json)!.AsObject()).Any(o => Id(o, "dishId") == input.DishId && o["status"]!.GetValue<string>() != "archived")) throw ApiFailure.Conflict("MANUAL_OFFER_EXISTS");
            j = Json(new { id = Guid.NewGuid(), dishId = input.DishId, status = "draft", version = 1L, createdAt = s.Now, createdByUserId = s.Actor.Id, publishedAt = (DateTime?)null, effectiveStartsAt = (DateTime?)null });
        }
        j["title"] = input.Title.Trim(); j["publicText"] = input.PublicText;
        j["startsAt"] = input.StartsAt is { } at ? System.Text.Json.JsonSerializer.SerializeToNode(at, RestaurantManagement.Application.Contracts.ContractJson.Options) : null;
        j["endsAt"] = System.Text.Json.JsonSerializer.SerializeToNode(input.EndsAt, RestaurantManagement.Application.Contracts.ContractJson.Options);
        j["updatedAt"] = System.Text.Json.JsonSerializer.SerializeToNode(s.Now, RestaurantManagement.Application.Contracts.ContractJson.Options); j["updatedByUserId"] = s.Actor.Id;
        if (document is null) AddDocument(s, "manual_offer", j, Id(j, "id"));
        else { j["version"] = document.Version + 1; Update(document, j); }
        return Ok(ManualDto(s, j), document is null ? 201 : 200);
    }
    // Kept as a separate command so transitions have independent immutable replay intentions.
    public CommandResult TransitionManualOffer(WarehouseSnapshot s, Guid id, long version, string transition)
    {
        Version(version, "expectedVersion");
        var document = s.Document("manual_offer", id); var j = JsonNode.Parse(document.Json)!.AsObject();
        if (document.Version != version) throw ApiFailure.Conflict("MANUAL_OFFER_VERSION_CONFLICT");
        var status = j["status"]!.GetValue<string>();
        if (status == "archived" || transition == "publish" && status != "draft" || transition == "unpublish" && status != "published") throw ApiFailure.Conflict("MANUAL_OFFER_STATE_CONFLICT");
        if (transition == "publish") {
            var dish = s.Dish(Id(j, "dishId"));
            if (!dish.Active) throw ApiFailure.Conflict("DISH_INACTIVE");
            if (Time(j, "endsAt") <= s.Now) throw ApiFailure.Invalid("endsAt", "Окончание должно быть после серверного времени");
            if (StockKernel.MaxPortions(dish, s.Batches, s.Now) < 1) throw ApiFailure.Conflict("MANUAL_OFFER_UNAVAILABLE");
            j["publishedAt"] = System.Text.Json.JsonSerializer.SerializeToNode(s.Now, RestaurantManagement.Application.Contracts.ContractJson.Options);
            j["effectiveStartsAt"] = j["startsAt"]?.DeepClone() ?? j["publishedAt"]!.DeepClone();
        }
        j["status"] = transition == "publish" ? "published" : transition == "unpublish" ? "draft" : "archived";
        j["version"] = document.Version + 1; j["updatedByUserId"] = s.Actor.Id;
        j["updatedAt"] = System.Text.Json.JsonSerializer.SerializeToNode(s.Now, RestaurantManagement.Application.Contracts.ContractJson.Options);
        Update(document, j); return Ok(ManualDto(s, j));
    }
    public static JsonObject[] CombinedOffers(WarehouseSnapshot s, bool safe)
    {
        var automatic = Offers(s); var remaining = automatic.ToDictionary(j => Id(j, "dishId"));
        var result = new List<JsonObject>();
        JsonObject Card(Guid dishId, JsonObject? auto, JsonObject? manual) {
            var dish = s.Dish(dishId);
            var promotion = manual is null ? null : Json(new { title = manual["title"]!.GetValue<string>(), publicText = manual["publicText"]?.GetValue<string>(), startsAt = Time(manual,"effectiveStartsAt"), endsAt = Time(manual,"endsAt") });
            if (promotion is not null && !safe) { promotion["id"] = Id(manual!,"id"); promotion["version"] = manual!["version"]!.GetValue<long>(); }
            var card = Json(new { dishId, dishName = dish.Name, maxPortions = StockKernel.MaxPortions(dish,s.Batches,s.Now), suggestedPortions = auto?["suggestedPortions"]?.GetValue<int>() ?? 1 });
            if (safe) { card["isAutomatic"] = auto is not null; card["promotion"] = promotion; }
            else { card["automatic"] = auto?.DeepClone(); card["manual"] = promotion; }
            return card;
        }
        foreach (var manual in s.Documents.Where(d => d.Kind == "manual_offer").Select(d => JsonNode.Parse(d.Json)!.AsObject()).Where(j => ManualState(s,j) == "visible").OrderByDescending(j => Time(j,"publishedAt")).ThenBy(j => j["id"]!.GetValue<string>(),StringComparer.Ordinal)) {
            var id = Id(manual,"dishId"); remaining.Remove(id, out var auto); result.Add(Card(id,auto,manual));
        }
        foreach (var auto in automatic.Where(a => remaining.ContainsKey(Id(a,"dishId")))) result.Add(Card(Id(auto,"dishId"),auto,null));
        return result.ToArray();
    }
}
