using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RestaurantManagement.Application.Contracts;

namespace RestaurantManagement.WebApi.V2;

[ApiController]
[Route("api/v2/warehouses/{warehouseId:guid}")]
[Route("api/v2/customer/warehouses/{warehouseId:guid}")]
[Route("integrations/v1/warehouses/{warehouseId:guid}")]
public sealed class WarehouseController(WarehouseService service) : ControllerBase
{
    (string Channel, string Resource) Route(Guid warehouseId, Guid? id = null)
    {
        var path = Request.Path.Value!;
        var tail = path[(path.IndexOf(warehouseId.ToString(), StringComparison.OrdinalIgnoreCase) + 37)..];
        if (id != null) tail = tail.Replace("/" + id, "", StringComparison.OrdinalIgnoreCase);
        var channel = path.StartsWith("/integrations/", StringComparison.OrdinalIgnoreCase) ? "integration" : path.StartsWith("/api/v2/customer/", StringComparison.OrdinalIgnoreCase) ? "customer" : tail.StartsWith("service/", StringComparison.OrdinalIgnoreCase) ? "service" : "staff";
        return (channel, (channel == "service" ? tail[8..] : tail).ToLowerInvariant());
    }
    static string[] Roles(string channel, string resource, bool write)
    {
        if (channel == "customer") {
            if (resource is not ("menu" or "offers" or "recommendations" or "combos" or "orders" or "orders/preview")) throw ApiFailure.Missing();
            if (write && resource is not ("orders" or "orders/preview")) throw ApiFailure.Missing();
            return ["customer"];
        }
        if (channel == "integration") return resource switch {
            "identity" or "catalog/ingredients" when !write => ["supplier", "pos"],
            "purchase-requests" when !write => ["supplier"],
            "deliveries" or "purchase-requests/approve" or "purchase-requests/reject" => ["supplier"],
            "menu" or "stop-list" or "offers" or "recommendations" or "combos" when !write => ["pos"],
            "orders" => ["pos"],
            "purchase-requests" or "combos" => throw new ApiFailure(403,"INSUFFICIENT_SCOPE","Недостаточно прав интеграции"),
            _ => throw ApiFailure.Missing()
        };
        if (channel == "service") {
            if (resource is not ("menu" or "stop-list" or "offers" or "recommendations" or "combos" or "orders" or "orders/preview")) throw ApiFailure.Missing();
            return WarehouseService.ServiceRoles;
        }
        if (!write && resource == "config") return ["super_admin", "owner", "manager", "warehouse", "waiter"];
        if (resource.StartsWith("integration-clients", StringComparison.Ordinal) || resource == "customer-publication") return WarehouseService.OwnerRoles;
        if (resource.StartsWith("purchase-", StringComparison.Ordinal) && resource != "purchase-suggestions" || resource.StartsWith("combo", StringComparison.Ordinal) || resource == "quarantines/orders") return WarehouseService.Management;
        if (write && resource is not ("deliveries" or "quarantines")) return WarehouseService.Management;
        return resource is "ingredients" or "inventory" or "batches" or "movements" or "deliveries" or "purchase-suggestions" or "quarantines" or "stop-list/forecast" or "analytics/risk-inventory"
            ? WarehouseService.StockRoles : WarehouseService.Management;
    }
    string AuthChannel(string channel) => channel == "service" ? "staff" : channel;

    [HttpGet("offers")][HttpGet("service/offers")][HttpGet("manual-offers")][HttpGet("manual-offers/{id:guid}")]
    [HttpGet("config")][HttpGet("dashboard")][HttpGet("ingredients")][HttpGet("dishes")][HttpGet("dishes/{id:guid}")]
    [HttpGet("deliveries")][HttpGet("deliveries/{id:guid}")][HttpGet("inventory")][HttpGet("batches")][HttpGet("movements")]
    [HttpGet("orders")][HttpGet("orders/{id:guid}")][HttpGet("write-offs")][HttpGet("menu/availability")][HttpGet("stop-list")]
    [HttpGet("recommendations")][HttpGet("purchase-suggestions")][HttpGet("service/menu")][HttpGet("service/stop-list")][HttpGet("service/recommendations")]
    [HttpGet("combos")][HttpGet("combos/{id:guid}")][HttpGet("service/combos")][HttpGet("quarantines")][HttpGet("quarantines/{id:guid}")]
    [HttpGet("quarantines/{id:guid}/orders")][HttpGet("stop-list/forecast")][HttpGet("analytics/risk-inventory")]
    [HttpGet("purchase-suppliers")][HttpGet("purchase-requests")][HttpGet("purchase-requests/{id:guid}")]
    [HttpGet("customer-publication")][HttpGet("menu")][HttpGet("identity")][HttpGet("catalog/ingredients")]
    [HttpGet("integration-clients")][HttpGet("integration-clients/{id:guid}/keys")]
    public Task<IResult> Read(Guid warehouseId, Guid? id)
    {
        var (channel, resource) = Route(warehouseId, id);
        if (channel == "customer" && id != null && resource != "orders") throw ApiFailure.Missing();
        if (channel == "integration" && resource is "orders" or "deliveries" && id == null) throw ApiFailure.Missing();
        return service.Execute(HttpContext, warehouseId, AuthChannel(channel), Roles(channel, resource, false), false, false, null,
            s => Task.FromResult(resource == "quarantines/orders" ? service.QuarantineOrders(s, id!.Value, Request.Query) : resource.StartsWith("integration-clients", StringComparison.Ordinal) ? service.ReadClients(s, resource, id, Request.Query) : service.Read(s, resource, id, Request.Query, channel)),
            published: !(channel == "customer" && resource == "orders"), computeOutside: resource is "stop-list/forecast" or "analytics/risk-inventory");
    }

    [HttpPost("manual-offers")][HttpPut("manual-offers/{id:guid}")][HttpPost("manual-offers/{id:guid}/publish")][HttpPost("manual-offers/{id:guid}/unpublish")][HttpPost("manual-offers/{id:guid}/archive")]
    [HttpPost("ingredients")][HttpPost("dishes")][HttpPost("deliveries")][HttpPost("deliveries/{id:guid}/confirm")][HttpPost("deliveries/{id:guid}/reject")]
    [HttpPost("orders")][HttpPost("orders/preview")][HttpPost("service/orders")][HttpPost("service/orders/preview")][HttpPost("write-offs")]
    [HttpPost("quarantines")][HttpPost("quarantines/{id:guid}/release")][HttpPost("quarantines/{id:guid}/write-off")]
    [HttpPost("combo-plans/preview")][HttpPost("combos")][HttpPost("combos/{id:guid}/versions")][HttpPost("combos/{id:guid}/publish")][HttpPost("combos/{id:guid}/archive")]
    [HttpPost("purchase-requests")][HttpPost("purchase-requests/{id:guid}/submit")][HttpPost("purchase-requests/{id:guid}/cancel")]
    [HttpPost("purchase-requests/{id:guid}/approve")][HttpPost("purchase-requests/{id:guid}/reject")]
    [HttpPost("integration-clients")][HttpPost("integration-clients/{id:guid}/keys")]
    [HttpPut("dishes/{id:guid}")][HttpPut("purchase-requests/{id:guid}")]
    [HttpPatch("ingredients/{id:guid}")][HttpPatch("customer-publication")]
    public Task<IResult> Write(Guid warehouseId, Guid? id, [FromBody] JsonElement body)
    {
        var (channel, resource) = Route(warehouseId, id); var roles = Roles(channel, resource, true);
        InputShape.Check(body, resource, Request.Method, channel == "integration");
        var preview = resource.EndsWith("/preview", StringComparison.Ordinal);
        var keyed = !preview && resource is not ("ingredients" or "dishes" or "customer-publication" or "integration-clients" or "integration-clients/keys");
        object input;
        Func<WarehouseSnapshot, CommandResult> action;
        switch (resource)
        {
            case "manual-offers": var manual = WarehouseService.Body<ManualOfferInput>(body); input = manual; action = s => service.SaveManualOffer(s, manual, id); break;
            case "manual-offers/publish": case "manual-offers/unpublish": case "manual-offers/archive": var mv = WarehouseService.Body<ExpectedVersionInput>(body); input = mv; action = s => service.TransitionManualOffer(s, id!.Value, mv.ExpectedVersion, resource.Split('/')[1]); break;
            case "ingredients" when Request.Method == "PATCH":
                if (body.ValueKind != JsonValueKind.Object || !body.EnumerateObject().Any() || body.EnumerateObject().Any(p => !new[] { "name", "defaultShelfLifeHours", "reorderPoint", "targetStock" }.Contains(p.Name) || p.Value.ValueKind == JsonValueKind.Null)) throw ApiFailure.Invalid("body");
                input = body; action = s => service.PatchIngredient(s, id!.Value, body); break;
            case "ingredients": var ing = WarehouseService.Body<IngredientInput>(body); WarehouseService.Validate(ing); input = ing; action = s => service.SaveIngredient(s, ing, null); break;
            case "dishes": var dish = WarehouseService.Body<DishInput>(body); WarehouseService.Validate(dish); input = dish; action = s => service.SaveDish(s, dish, id); break;
            case "deliveries": var d = WarehouseService.Body<DeliveryInput>(body); WarehouseService.Validate(d, channel == "integration"); input = d; action = s => service.CreateDelivery(s, d, channel == "integration"); break;
            case "deliveries/confirm": var confirm = WarehouseService.Body<ConfirmInput>(body); input = confirm; if (confirm.ReceivedAtMode != "server" && (confirm.ReceivedAt == null || confirm.ReceivedAt == default(DateTime))) throw ApiFailure.Invalid("receivedAt"); action = s => service.ConfirmDelivery(s, id!.Value, confirm); break;
            case "deliveries/reject": var reason = WarehouseService.Body<ReasonInput>(body); WarehouseService.Name(reason.Reason, "reason", 500); input = reason; action = s => service.RejectDelivery(s, id!.Value, reason); break;
            case "orders": case "orders/preview": var order = WarehouseService.Body<OrderInput>(body); WarehouseService.Validate(order, channel == "integration");
                if (channel != "integration" && order.ExternalId != null) throw ApiFailure.Invalid("externalId"); input = order;
                action = s => service.PlaceOrder(s, order, channel == "service" ? "waiter" : channel == "staff" ? "staff" : channel, preview); break;
            case "write-offs": var wo = WarehouseService.Body<WriteOffInput>(body); WarehouseService.Positive(wo.Quantity); WarehouseService.Note(wo.Note); if (wo.Reason is not ("expired" or "damaged")) throw ApiFailure.Invalid("reason"); input = wo; action = s => service.WriteOff(s, wo); break;
            case "quarantines": var hold = WarehouseService.Body<QuarantineInput>(body); WarehouseService.Positive(hold.Quantity); WarehouseService.Version(hold.ExpectedBatchVersion); WarehouseService.Name(hold.Reason, "reason", 500); WarehouseService.Note(hold.Note); input = hold; action = s => service.OpenQuarantine(s, hold); break;
            case "quarantines/release": case "quarantines/write-off": var decision = WarehouseService.Body<DecisionInput>(body); WarehouseService.Positive(decision.Quantity); WarehouseService.Version(decision.ExpectedVersion); WarehouseService.Name(decision.Reason, "reason", 500); WarehouseService.Note(decision.Note); if (resource.EndsWith("write-off", StringComparison.Ordinal) && decision.Reason is not ("expired" or "damaged")) throw ApiFailure.Invalid("reason"); input = decision; action = s => service.DecideQuarantine(s, id!.Value, decision, resource.EndsWith("write-off", StringComparison.Ordinal)); break;
            case "combo-plans/preview": var plan = WarehouseService.Body<ComboPlanInput>(body); if (plan.CandidateDishIds == null || plan.CandidateDishIds.Length is < 2 or > 12 || plan.CandidateDishIds.Distinct().Count() != plan.CandidateDishIds.Length || plan.CandidateDishIds.Any(i => i == Guid.Empty)) throw ApiFailure.Invalid("candidateDishIds"); input = plan; action = s => WarehouseService.Ok(service.ComboPlan(s, plan)); break;
            case "combos": case "combos/versions": var combo = WarehouseService.Body<ComboInput>(body); WarehouseService.Validate(combo); if (id != null && combo.ExpectedVersion == null) throw ApiFailure.Invalid("expectedVersion"); input = combo; action = s => service.SaveCombo(s, combo, id); break;
            case "combos/publish": case "combos/archive": var cv = WarehouseService.Body<ExpectedVersionInput>(body); WarehouseService.Version(cv.ExpectedVersion); input = cv; action = s => service.TransitionCombo(s, id!.Value, cv, resource.EndsWith("publish", StringComparison.Ordinal)); break;
            case "purchase-requests": var pi = WarehouseService.Body<PurchaseInput>(body); WarehouseService.Validate(pi); if (id != null && pi.Version == null) throw ApiFailure.Invalid("version"); input = pi; action = s => service.SavePurchase(s, pi, id); break;
            case "purchase-requests/submit": case "purchase-requests/cancel": case "purchase-requests/approve": case "purchase-requests/reject":
                if (channel != "integration" && resource is "purchase-requests/approve" or "purchase-requests/reject" || channel == "integration" && resource is "purchase-requests/submit" or "purchase-requests/cancel") throw ApiFailure.Missing();
                var pv = WarehouseService.Body<VersionInput>(body); WarehouseService.Version(pv.Version); if (resource.EndsWith("reject", StringComparison.Ordinal)) WarehouseService.Name(pv.Reason, "reason", 500); input = pv; action = s => service.TransitionPurchase(s, id!.Value, pv, resource.Split('/')[1], channel == "integration"); break;
            case "customer-publication": var pub = WarehouseService.Body<PublicationInput>(body); input = pub; action = s => { s.Warehouse.CustomerPublished = pub.Enabled; return WarehouseService.Ok(pub); }; break;
            case "integration-clients": var client = WarehouseService.Body<ClientInput>(body); WarehouseService.Name(client.Name); if (client.Kind is not ("supplier" or "pos")) throw ApiFailure.Invalid("kind"); input = client; action = s => service.CreateClient(s, client); break;
            case "integration-clients/keys": var key = WarehouseService.Body<KeyInput>(body); WarehouseService.Name(key.Label, "label"); input = key; action = s => service.CreateKey(s, id!.Value, key); break;
            default: throw ApiFailure.Missing();
        }
        // Preserve omission markers and original array order in hashing; normalize only contract scalar types.
        return service.Execute(HttpContext, warehouseId, AuthChannel(channel), roles, !preview, keyed, body, s => {
            if (channel == "customer" && !s.Warehouse.CustomerPublished) throw ApiFailure.Missing();
            return Task.FromResult(action(s));
        }, published: !(channel == "customer" && resource == "orders"), computeOutside: preview);
    }
    [HttpDelete("integration-clients/{id:guid}/keys/{keyId:guid}")]
    public Task<IResult> Revoke(Guid warehouseId, Guid id, Guid keyId)
    {
        var (channel, _) = Route(warehouseId); if (channel != "staff") throw ApiFailure.Missing();
        return service.Execute(HttpContext, warehouseId, "staff", WarehouseService.OwnerRoles, true, false, null, s => Task.FromResult(service.RevokeKey(s, id, keyId)));
    }
}
