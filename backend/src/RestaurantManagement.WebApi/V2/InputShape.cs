using System.Text.Json;
using RestaurantManagement.Application.Contracts;

namespace RestaurantManagement.WebApi.V2;

public static class InputShape
{
    public static void Check(JsonElement body, string resource, string method, bool external)
    {
        if (body.ValueKind != JsonValueKind.Object) throw ApiFailure.Invalid("body");
        if (resource == "deliveries/confirm") {
            var fields = body.EnumerateObject().ToArray();
            if (fields.Length != 1) throw ApiFailure.Invalid("receivedAt", "Укажите время либо серверный режим");
            if (fields[0].Name == "receivedAtMode") {
                if (fields[0].Value.ValueKind != JsonValueKind.String || fields[0].Value.GetString() != "server") throw ApiFailure.Invalid("receivedAtMode");
            } else if (fields[0].Name != "receivedAt" || fields[0].Value.ValueKind != JsonValueKind.String) throw ApiFailure.Invalid("receivedAt");
            return;
        }
        string[] required = resource switch {
            "ingredients" when method == "PATCH" => [],
            "ingredients" => ["name", "unit", "defaultShelfLifeHours", "reorderPoint", "targetStock"],
            "dishes" => ["name", "active", "recipe"],
            "deliveries" => ["number", "expectedAt", "note", "lines"],
            "deliveries/confirm" => ["receivedAt"], "deliveries/reject" => ["reason"],
            "manual-offers" => method == "PUT" ? ["dishId", "title", "publicText", "startsAt", "endsAt", "expectedVersion"] : ["dishId", "title", "publicText", "startsAt", "endsAt"],
            "manual-offers/publish" or "manual-offers/unpublish" or "manual-offers/archive" => ["expectedVersion"],
            "orders" or "orders/preview" => ["lines"], "write-offs" => ["batchId", "quantity", "reason", "note"],
            "quarantines" => ["batchId", "expectedBatchVersion", "quantity", "reason", "note"],
            "quarantines/release" => ["expectedVersion", "quantity", "reason"], "quarantines/write-off" => ["expectedVersion", "quantity", "reason", "note"],
            "combos" => ["title", "components"], "combos/versions" => ["title", "components", "expectedVersion"],
            "combos/publish" or "combos/archive" => ["expectedVersion"], "combo-plans/preview" => ["candidateDishIds"],
            "purchase-requests" => method == "PUT" ? ["supplierClientId", "expectedAt", "note", "lines", "version"] : ["supplierClientId", "expectedAt", "note", "lines"],
            "purchase-requests/reject" => ["version", "reason"], "purchase-requests/submit" or "purchase-requests/cancel" or "purchase-requests/approve" => ["version"],
            "customer-publication" => ["enabled"], "integration-clients" => ["name", "kind"], "integration-clients/keys" => ["label", "expiresAt"],
            _ => []
        };
        var allowed = new List<string>(required);
        if (resource == "ingredients" && method == "PATCH") allowed.AddRange(["name", "defaultShelfLifeHours", "reorderPoint", "targetStock"]);
        if (resource is "orders" or "orders/preview") allowed.Add("combos");
        if (external && resource is "orders" or "deliveries") { required = [.. required, "externalId"]; allowed.Add("externalId"); if (resource == "deliveries") allowed.Add("purchaseRequestId"); }
        foreach (var key in required) if (!body.TryGetProperty(key, out _)) throw ApiFailure.Invalid(key, "Поле обязательно");
        foreach (var p in body.EnumerateObject()) {
            if (!allowed.Contains(p.Name)) throw ApiFailure.Invalid(p.Name, "Неизвестное поле");
            if (p.Value.ValueKind == JsonValueKind.Null && p.Name is not ("expectedAt" or "note" or "expiresAt" or "purchaseRequestId" or "publicText" or "startsAt")) throw ApiFailure.Invalid(p.Name);
        }
        // Nested request DTOs forbid extra fields through ContractJson; union format has explicit omission rules.
        if (resource == "deliveries" && body.TryGetProperty("lines", out var lines) && lines.ValueKind == JsonValueKind.Array)
            foreach (var (line, index) in lines.EnumerateArray().Select((line, index) => (line, index))) {
                if (line.ValueKind != JsonValueKind.Object || !line.TryGetProperty("ingredientId", out _) || !line.TryGetProperty("quantity", out _)) throw ApiFailure.Invalid($"lines.{index}");
                if (line.EnumerateObject().Any(p => p.Value.ValueKind == JsonValueKind.Null)) throw ApiFailure.Invalid($"lines.{index}");
            }
    }
}
