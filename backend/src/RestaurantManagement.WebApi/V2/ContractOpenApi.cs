using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc.ApiExplorer;

namespace RestaurantManagement.WebApi.V2;

public static class ContractOpenApi
{
    static JsonObject Ref(string name) => new() { ["$ref"] = "#/components/schemas/" + name };
    static JsonObject Obj(params (string Key, JsonNode? Value)[] values) => new(values.Select(p => KeyValuePair.Create(p.Key, p.Value)).ToArray());
    static JsonObject Shape(params (string Key, JsonObject Type)[] fields) => Obj(("type",JsonValue.Create("object")),("properties",new JsonObject(fields.Select(f=>KeyValuePair.Create(f.Key,(JsonNode?)f.Type)).ToArray())),("required",new JsonArray(fields.Select(f=>(JsonNode?)JsonValue.Create(f.Key)).ToArray())),("additionalProperties",JsonValue.Create(false)));
    static JsonObject Text(string? format = null) { var j = new JsonObject { ["type"] = "string" }; if (format != null) j["format"] = format; return j; }
    static JsonObject Envelope(JsonObject value) => Shape(("data",value),("meta",Ref("Meta")));
    static JsonObject Page(JsonObject value) => Shape(("items",new() { ["type"]="array",["items"]=value }),("page",new(){["type"]="integer",["minimum"]=1}),("pageSize",new(){["type"]="integer",["minimum"]=1,["maximum"]=100}),("total",new(){["type"]="integer",["minimum"]=0}));
    public static JsonObject Generate(IServiceProvider services, string contentRoot)
    {
        var schemas = JsonNode.Parse(File.ReadAllText(Path.Combine(contentRoot,"Contracts","schemas.json")))!.AsObject();
        schemas["StaffAccount"] = Shape(("userId", Text("uuid")), ("username", Text()), ("displayName", Text()),
            ("isSuperAdmin", new() { ["type"] = "boolean" }), ("canDeleteAccount", new() { ["type"] = "boolean" }),
            ("memberships", new() { ["type"] = "array", ["items"] = Shape(("enterpriseId", Text("uuid")), ("enterpriseName", Text()), ("role", Ref("Role"))) }));
        JsonObject Extend(string name, string field) {
            var j=schemas[name]!.DeepClone().AsObject();j["properties"]![field]=new JsonObject{["type"]="integer",["minimum"]=1,["maximum"]=9007199254740991L};j["required"]!.AsArray().Add(field);return j;
        }
        var paths = new JsonObject();
        foreach (var d in services.GetRequiredService<IApiDescriptionGroupCollectionProvider>().ApiDescriptionGroups.Items.SelectMany(g=>g.Items))
        {
            var path="/"+d.RelativePath!.Split('?')[0]; var method=d.HttpMethod!.ToLowerInvariant();
            if (!path.StartsWith("/api/v2",StringComparison.Ordinal) && !path.StartsWith("/integrations/v1",StringComparison.Ordinal)) continue;
            var customer=path.StartsWith("/api/v2/customer/",StringComparison.Ordinal); var integration=path.StartsWith("/integrations/",StringComparison.Ordinal); var service=!customer&&!integration&&path.Contains("/service/",StringComparison.Ordinal);
            var root=path.Contains("/warehouses/{warehouseId}",StringComparison.Ordinal);
            var resource=root?path.Split("/warehouses/{warehouseId}/")[1]:path[(customer?17:8)..];
            if(service)resource=resource[8..];
            if (customer && root && !new[]{"menu","offers","recommendations","combos","orders","orders/{id}","orders/preview"}.Contains(resource))continue;
            if(integration && !new[]{"identity","catalog/ingredients","deliveries","deliveries/{id}","purchase-requests","purchase-requests/{id}","purchase-requests/{id}/approve","purchase-requests/{id}/reject","menu","stop-list","offers","recommendations","combos","orders","orders/{id}"}.Contains(resource))continue;
            if(integration && method=="get" && resource is "orders" or "deliveries")continue;
            if(integration && method!="get" && resource is "purchase-requests" or "combos")continue;
            if(customer&&method!="get"&&resource is "menu" or "offers" or "recommendations" or "combos")continue;
            if(!integration&&(resource.EndsWith("/approve",StringComparison.Ordinal)||resource=="purchase-requests/{id}/reject"))continue;
            var normalized=resource.Replace("/{id}",""); var safe=customer||integration||service;
            JsonObject? input=null; JsonObject? output=null;
            var creation=method=="post" && normalized is "auth/register" or "enterprises" or "ingredients" or "dishes" or "deliveries" or "orders" or "write-offs" or "quarantines" or "combos" or "combos/versions" or "purchase-requests" or "integration-clients" or "integration-clients/keys" or "enterprises/members" or "manual-offers";
            var noContent=method=="delete"||normalized=="auth/logout";
            var name=normalized switch {
                "auth/me" or "auth/register" or "auth/login" => customer?"CustomerUser":"User",
                "ingredients" => "Ingredient", "catalog/ingredients" => "CatalogIngredient", "dishes"=>"Dish", "deliveries"=>integration?"SupplierDelivery":"Delivery",
                "orders"=>safe?"OrderReceipt":"Order", "orders/preview"=>safe?"ServicePreview":"OrderPreview", "write-offs"=>"WriteOff", "movements"=>"Movement", "inventory"=>"InventoryRow", "batches"=>"Batch",
                "menu" or "menu/availability" or "stop-list" => safe?"ServiceMenuItem":"DishAvailability", "recommendations"=>safe?"ServiceOffer":"HotOffer", "offers"=>safe?"PublicOfferCard":"OfferCard", "manual-offers" or "manual-offers/publish" or "manual-offers/unpublish" or "manual-offers/archive"=>"ManualOffer", "purchase-suggestions"=>"PurchaseSuggestion", "dashboard"=>"Dashboard", "config"=>"Config",
                "quarantines"=>"Quarantine", "quarantines/orders"=>"QuarantineOrderUsage", "quarantines/release"=>"Quarantine", "combo-plans/preview"=>"ComboPlan", "combos"=>safe?"PublicCombo":"Combo", "combos/versions" or "combos/publish" or "combos/archive"=>"Combo",
                "stop-list/forecast"=>"StopForecast", "analytics/risk-inventory"=>"RiskReport", "purchase-requests" or "purchase-requests/submit" or "purchase-requests/cancel" or "purchase-requests/approve" or "purchase-requests/reject"=>"PurchaseRequest", "identity"=>"IntegrationIdentity", "integration-clients"=>"IntegrationClient", "integration-clients/keys"=>"IntegrationKey", "outlets"=>"CustomerOutlet", "enterprises"=>"Enterprise", _=>null
            };
            if (name!=null)output=Ref(name);
            if (normalized == "staff") output = Ref("StaffAccount");
            if(normalized=="auth/csrf")output=Shape(("requestToken",Text()));
            if(normalized=="runtime")output=Shape(("backendInstanceId",Text("uuid")),("sourceKind",new(){["const"]="server"}),("contractVersion",new(){["const"]="2.1.0"}));
            if(normalized=="customer-publication")output=Shape(("enabled",new(){["type"]="boolean"}));
            if(normalized=="purchase-suppliers")output=Shape(("id",Text("uuid")),("name",Text()));
            if(normalized=="quarantines/write-off")output=Shape(("quarantine",Ref("Quarantine")),("writeOff",Ref("WriteOff")));
            if(resource.StartsWith("enterprises/",StringComparison.Ordinal))output=Ref("Member");
            if(normalized=="me/memberships")output=new(){["type"]="array",["items"]=Ref("Membership")};
            if(method is "post" or "put" or "patch") {
                var type=normalized switch {
                    "auth/login"=>"AuthLogin", "auth/register"=>"AuthRegister", "ingredients"=>method=="patch"?"IngredientPatch":"IngredientInput", "dishes"=>"DishInput", "deliveries"=>integration?"ExternalDeliveryInput":"DeliveryInput", "orders" or "orders/preview"=>integration?"ExternalOrderInput21":"OrderInput21", "write-offs"=>"WriteOffInput", "quarantines"=>"QuarantineInput", "quarantines/release"=>"QuarantineReleaseInput", "quarantines/write-off"=>"QuarantineWriteOffInput", "combos" or "combos/versions"=>"ComboInput", "purchase-requests"=>"PurchaseRequestInput", _=>null };
                if(type!=null)input=Ref(type);
                if(normalized=="combos/versions"||normalized is "combos/publish" or "combos/archive") {
                    var version=Shape(("expectedVersion",new(){["type"]="integer",["minimum"]=1,["maximum"]=9007199254740991L}));
                    input=normalized=="combos/versions"?Extend("ComboInput","expectedVersion"):version;
                }
                if(normalized=="manual-offers")input=method=="put"?Extend("ManualOfferInput","expectedVersion"):Ref("ManualOfferInput");
                if(normalized.StartsWith("manual-offers/",StringComparison.Ordinal))input=Shape(("expectedVersion",new(){["type"]="integer",["minimum"]=1,["maximum"]=9007199254740991L}));
                if(normalized=="purchase-requests"&&method=="put")input=Extend("PurchaseRequestInput","version");
                if(normalized.StartsWith("purchase-requests/",StringComparison.Ordinal))input=normalized.EndsWith("reject",StringComparison.Ordinal)?Shape(("version",new(){["type"]="integer",["minimum"]=1}),("reason",Text())):Shape(("version",new(){["type"]="integer",["minimum"]=1}));
                if(normalized=="deliveries/confirm") { input=Ref("ConfirmDeliveryInput"); output=Ref("Delivery"); }
                if(normalized=="deliveries/reject") { input=Shape(("reason",Text())); output=Ref("Delivery"); }
                if(normalized=="customer-publication")input=output!.DeepClone().AsObject();
                if(normalized=="combo-plans/preview")input=Shape(("candidateDishIds",new(){["type"]="array",["items"]=Text("uuid"),["minItems"]=2,["maxItems"]=12,["uniqueItems"]=true}));
                if(normalized=="integration-clients")input=Shape(("name",Text()),("kind",new(){["enum"]=new JsonArray("supplier","pos")}));
                if(normalized=="integration-clients/keys") { input=Shape(("label",Text()),("expiresAt",new(){["anyOf"]=new JsonArray(Text("date-time"),new JsonObject{["type"]="null"})}));output=Shape(("key",Ref("IntegrationKey")),("token",Text())); }
                if(normalized=="enterprises")input=Shape(("name",Text()),("ownerUsername",Text()));
                if(resource.EndsWith("/owner",StringComparison.Ordinal))input=Shape(("ownerUsername",Text()));
                if(resource.Contains("/members",StringComparison.Ordinal))input=method=="post"?Shape(("username",Text()),("role",new(){["enum"]=new JsonArray("manager","warehouse","waiter")})):Shape(("role",new(){["enum"]=new JsonArray("manager","warehouse","waiter")}));
            }
            if (method == "post" && normalized is "enterprises/staff" or "enterprises/members/register") {
                creation = true;
                input = schemas["AuthRegister"]!.DeepClone().AsObject();
                if (normalized == "enterprises/members/register") {
                    input["properties"]!["role"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("manager", "warehouse", "waiter") };
                    input["required"]!.AsArray().Add("role");
                }
                output = Shape(("userId", Text("uuid")), ("username", Text()), ("displayName", Text()),
                    ("enterpriseId", normalized == "enterprises/staff" ? new() { ["type"] = "null" } : Text("uuid")),
                    ("role", normalized == "enterprises/staff" ? new() { ["type"] = "null" } : new() { ["type"] = "string", ["enum"] = new JsonArray("manager", "warehouse", "waiter") }));
            }
            var collection=method=="get"&&!resource.Contains("{id}",StringComparison.Ordinal)&&normalized is not ("config" or "dashboard" or "identity" or "runtime" or "auth/me" or "auth/csrf" or "me/memberships" or "customer-publication" or "stop-list/forecast" or "analytics/risk-inventory");
            if(resource=="quarantines/{id}/orders"||resource=="integration-clients/{id}/keys"||resource.EndsWith("/members",StringComparison.Ordinal)&&method=="get")collection=true;
            var parameters=new JsonArray();
            foreach(Match p in Regex.Matches(path,@"\{([^}]+)\}"))parameters.Add(new JsonObject{["name"]=p.Groups[1].Value,["in"]="path",["required"]=true,["schema"]=Text("uuid")});
            if(collection) { parameters.Add(new JsonObject{["name"]="page",["in"]="query",["schema"]=new JsonObject{["type"]="integer",["minimum"]=1,["default"]=1}});parameters.Add(new JsonObject{["name"]="pageSize",["in"]="query",["schema"]=new JsonObject{["type"]="integer",["minimum"]=1,["maximum"]=100,["default"]=50}}); }
            if(method=="get") {
                void Query(string name,JsonObject schema,bool required=false)=>parameters.Add(new JsonObject{["name"]=name,["in"]="query",["required"]=required,["schema"]=schema});
                JsonObject Values(params string[] choices)=>new(){["type"]="string",["enum"]=new JsonArray(choices.Select(c=>(JsonNode?)JsonValue.Create(c)).ToArray())};
                if (normalized == "staff") { Query("q", Text()); Query("enterpriseId", Text("uuid")); }
                if(normalized is "ingredients" or "catalog/ingredients" or "dishes" or "inventory" or "menu" or "menu/availability" or "stop-list" or "recommendations" or "offers" or "manual-offers" or "purchase-suggestions" or "combos" or "purchase-suppliers" or "outlets")Query("q",Text());
                if(normalized=="offers")Query("kind",Values("all","automatic","manual"));
                if(normalized=="manual-offers")Query("status",Values("draft","published","archived"));
                if(normalized=="dishes")Query("active",new(){["type"]="boolean"});
                if(normalized=="inventory")Query("lowStock",new(){["type"]="boolean"});
                if(normalized is "batches" or "movements" or "write-offs" or "quarantines" or "analytics/risk-inventory")Query("ingredientId",Text("uuid"));
                if(normalized is "movements" or "write-offs" or "quarantines" or "analytics/risk-inventory")Query("batchId",Text("uuid"));
                if(normalized=="batches"){Query("deliveryId",Text("uuid"));Query("includeEmpty",new(){["type"]="boolean",["default"]=false});Query("status",Values("fresh","expiring","expired","empty"));}
                if(normalized=="dishes"){}else if(normalized=="deliveries"){Query("status",Values("pending","confirmed","rejected"));Query("source",Values("manual","integration"));}
                if(normalized=="orders")Query("source",Values("staff","waiter","customer","integration"));
                if(normalized=="movements")Query("type",Values("receipt","order","write_off","quarantine_open","quarantine_release"));
                if(normalized=="quarantines")Query("status",Values("open","closed"));
                if(normalized=="combos")Query("status",Values("draft","published","archived"));
                if(normalized=="purchase-requests"){Query("supplierClientId",Text("uuid"));Query("status",Values("draft","submitted","approved","delivery_pending","received","rejected","cancelled","delivery_rejected"));}
                if(normalized=="stop-list/forecast"){Query("historyDays",new(){["type"]="integer",["enum"]=new JsonArray(7,14,28),["default"]=14});Query("horizonHours",new(){["type"]="integer",["enum"]=new JsonArray(6,12,24,48),["default"]=24});}
                if(normalized=="analytics/risk-inventory"){
                    Query("view",Values("period","cohort"));Query("cohortEntry",Values("dated","unknown"));Query("from",Text("date-time"),true);Query("to",Text("date-time"),true);
                    Query("page",new(){["type"]="integer",["minimum"]=1,["default"]=1});Query("pageSize",new(){["type"]="integer",["minimum"]=1,["maximum"]=100,["default"]=50});
                }
            }
            if (method is "post" or "put" or "patch" or "delete") {
                if(!integration) { parameters.Add(new JsonObject{["name"]="X-CSRF-TOKEN",["in"]="header",["required"]=true,["schema"]=Text()}); if(!normalized.StartsWith("auth/",StringComparison.Ordinal))parameters.Add(new JsonObject{["name"]="X-Rims-Expected-User-Id",["in"]="header",["required"]=true,["schema"]=Text("uuid")}); }
                if(root&&!normalized.EndsWith("/preview",StringComparison.Ordinal)&&normalized is not ("ingredients" or "dishes" or "customer-publication" or "integration-clients" or "integration-clients/keys")&&!resource.StartsWith("integration-clients",StringComparison.Ordinal))parameters.Add(new JsonObject{["name"]="Idempotency-Key",["in"]="header",["required"]=true,["schema"]=Text("uuid")});
            }
            var responses=new JsonObject(); var status=noContent?"204":creation?"201":"200";
            responses[status]=noContent?new JsonObject{["description"]="No content"}:new JsonObject{["description"]="Success",["content"]=new JsonObject{["application/json"]=new JsonObject{["schema"]=Envelope(collection?Page(output??new()):output??new())}}};
            foreach(var error in new[]{400,401,403,404,409,413,415,422,429,500,503})responses[error.ToString()]=new JsonObject{["description"]="ApiError",["content"]=new JsonObject{["application/json"]=new JsonObject{["schema"]=Ref("ApiError")}}};
            var operation=new JsonObject{["operationId"]=method+Regex.Replace(path,"[^a-zA-Z0-9]","_"),["parameters"]=parameters,["responses"]=responses};
            if(input!=null)operation["requestBody"]=new JsonObject{["required"]=true,["content"]=new JsonObject{["application/json"]=new JsonObject{["schema"]=input}}};
            if(!(normalized is "runtime" or "auth/csrf" or "auth/register" or "auth/login" or "auth/logout"))operation["security"]=new JsonArray(new JsonObject{[integration?"integrationBearer":customer?"customerCookie":"staffCookie"]=new JsonArray()});
            var item=paths[path] as JsonObject??new JsonObject(); item[method]=operation; if(paths[path]==null)paths[path]=item;
        }
        return new JsonObject{["openapi"]="3.1.0",["info"]=new JsonObject{["title"]="RIMS live backend",["version"]="2.1.0"},["paths"]=paths,["components"]=new JsonObject{["schemas"]=schemas,["securitySchemes"]=new JsonObject{
            ["staffCookie"]=new JsonObject{["type"]="apiKey",["in"]="cookie",["name"]="rims_staff_session"},["customerCookie"]=new JsonObject{["type"]="apiKey",["in"]="cookie",["name"]="rims_customer_session"},["integrationBearer"]=new JsonObject{["type"]="http",["scheme"]="bearer"}}}};
    }
}
