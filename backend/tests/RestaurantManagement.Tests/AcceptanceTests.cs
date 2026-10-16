using System.Data;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Infrastructure.Persistence;
using RestaurantManagement.WebApi.V2;
using Xunit;

namespace RestaurantManagement.Tests;

[Collection("postgres")]
public sealed class AcceptanceTests(PostgresFixture f)
{
    static Guid Id(ApiResponse r) => Guid.Parse(r.Data!["id"]!.GetValue<string>());
    static string Root(Guid w) => "/api/v2/warehouses/" + w;
    [Fact] public async Task SqlFlushFailureRollsBackDocumentStockLedgerAndKey()
    {
        var(c,w,_,_,dish,_)=await Stock("1.000");var key=Guid.NewGuid();var body=new{lines=new[]{new{dishId=dish,portions=1}}};
        f.Host.Failure.FailNextCommit();var failed=await c.Send("POST",Root(w)+"/orders",body,key);Assert.Equal(500,failed.Status);
        Assert.Equal(0,(await c.Send("GET",Root(w)+"/orders")).Data!["total"]!.GetValue<int>());
        Assert.Equal("1.000",(await c.Send("GET",Root(w)+"/inventory")).Data!["items"]![0]!["physicalQuantity"]!.GetValue<string>());
        Assert.Equal(1,(await c.Send("GET",Root(w)+"/movements")).Data!["total"]!.GetValue<int>());
        Assert.Equal(201,(await c.Send("POST",Root(w)+"/orders",body,key)).Status);
    }
    [Fact] public async Task ConfirmFailureKeepsPendingWithoutPartialReceipt()
    {
        var(_,c,w,_)=await f.Warehouse();var root=Root(w);var i=await c.Send("POST",root+"/ingredients",new{name="Product",unit="g",defaultShelfLifeHours=72,reorderPoint="0.000",targetStock="10.000"});
        var d=await c.Send("POST",root+"/deliveries",new{number="FAULT",expectedAt=(string?)null,note=(string?)null,lines=new[]{new{ingredientId=Id(i),quantity="10.000",expiresAt="2026-10-15T12:00:00Z"}}},Guid.NewGuid());var key=Guid.NewGuid();var input=new{receivedAt="2026-10-14T11:00:00Z"};
        f.Host.Failure.FailNextCommit();Assert.Equal(500,(await c.Send("POST",root+"/deliveries/"+Id(d)+"/confirm",input,key)).Status);
        Assert.Equal("pending",(await c.Send("GET",root+"/deliveries/"+Id(d))).Data!["status"]!.GetValue<string>());Assert.Equal(0,(await c.Send("GET",root+"/batches")).Data!["total"]!.GetValue<int>());
        Assert.Equal(200,(await c.Send("POST",root+"/deliveries/"+Id(d)+"/confirm",input,key)).Status);
    }
    async Task<(ApiClient Client,Guid Warehouse,Guid Enterprise,Guid Ingredient,Guid Dish,Guid Batch)> Stock(string amount="2.000",string expires="2026-10-14T18:00:00Z")
    {
        var (_,c,w,e)=await f.Warehouse();var root=Root(w);
        var i=await c.Send("POST",root+"/ingredients",new{name="Tomatoes",unit="g",defaultShelfLifeHours=72,reorderPoint="1.000",targetStock="10.000"});Assert.Equal(201,i.Status);
        var d=await c.Send("POST",root+"/dishes",new{name="Dish",active=true,recipe=new[]{new{ingredientId=Id(i),quantity="1.000"}}});Assert.Equal(201,d.Status);
        var delivery=await c.Send("POST",root+"/deliveries",new{number="RECEIPT",expectedAt=(string?)null,note=(string?)null,lines=new[]{new{ingredientId=Id(i),quantity=amount,expiresAt=expires}}},Guid.NewGuid());Assert.Equal(201,delivery.Status);
        var receipt=await c.Send("POST",root+"/deliveries/"+Id(delivery)+"/confirm",new{receivedAt="2026-10-14T11:00:00Z"},Guid.NewGuid());Assert.Equal(200,receipt.Status);
        return(c,w,e,Id(i),Id(d),Guid.Parse(receipt.Data!["batches"]![0]!["id"]!.GetValue<string>()));
    }
    [Fact] public async Task SameKeyConcurrentAndSemanticReplaySurviveCatalogChanges()
    {
        var(c,w,_,i,d,_)=await Stock();var root=Root(w);var key=Guid.NewGuid();var body=new{lines=new[]{new{dishId=d,portions=1}}};
        var replies=await Task.WhenAll(c.Send("POST",root+"/orders",body,key),c.Send("POST",root+"/orders",body,key));Assert.All(replies,r=>Assert.Equal(201,r.Status));Assert.Equal(replies[0].Raw,replies[1].Raw);
        var changed=await c.Send("PUT",root+"/dishes/"+d,new{name="Changed",active=false,recipe=new[]{new{ingredientId=i,quantity="2.000"}}});Assert.True(changed.Status==200,changed.Raw);
        var current=await c.Send("GET",root+"/dishes/"+d);Assert.False(current.Data!["active"]!.GetValue<bool>());Assert.Equal("2.000",current.Data["recipe"]![0]!["quantity"]!.GetValue<string>());
        var repeat=await c.Send("POST",root+"/orders",new{lines=new[]{new{dishId=d.ToString().ToUpperInvariant(),portions=1}}},key);Assert.Equal(replies[0].Raw,repeat.Raw);
        var old=await c.Send("GET",root+"/orders/"+Id(replies[0]));Assert.Equal("Dish",old.Data!["lines"]![0]!["dishName"]!.GetValue<string>());Assert.Equal("1.000",old.Data["recipeSnapshot"]![0]!["recipe"]![0]!["quantity"]!.GetValue<string>());
    }
    [Fact] public async Task RejectedIntentionStaysRejectedAfterRestock()
    {
        var(c,w,_,i,d,_)=await Stock("1.000");var path=Root(w)+"/orders";var body=new{lines=new[]{new{dishId=d,portions=2}}};var key=Guid.NewGuid();var fail=await c.Send("POST",path,body,key);Assert.Equal(409,fail.Status);
        var delivery=await c.Send("POST",Root(w)+"/deliveries",new{number="RESTOCK",expectedAt=(string?)null,note=(string?)null,lines=new[]{new{ingredientId=i,quantity="2.000",expiresAt="2026-10-15T12:00:00Z"}}},Guid.NewGuid());
        await c.Send("POST",Root(w)+"/deliveries/"+Id(delivery)+"/confirm",new{receivedAt="2026-10-14T11:00:00Z"},Guid.NewGuid());
        Assert.Equal(fail.Raw,(await c.Send("POST",path,body,key)).Raw);Assert.Equal(201,(await c.Send("POST",path,body,Guid.NewGuid())).Status);
    }
    [Fact] public async Task HoldAgainstOrderCannotSpendHeldLastPortion()
    {
        var(c,w,_,_,d,b)=await Stock("1.000");var root=Root(w);
        var replies=await Task.WhenAll(c.Send("POST",root+"/orders",new{lines=new[]{new{dishId=d,portions=1}}},Guid.NewGuid()),c.Send("POST",root+"/quarantines",new{batchId=b,expectedBatchVersion=1,quantity="1.000",reason="Inspect",note=(string?)null},Guid.NewGuid()));
        Assert.Single(replies,r=>r.Status==201);Assert.Single(replies,r=>r.Status==409);
        var inventory=(await c.Send("GET",root+"/inventory")).Data!["items"]![0]!;
        var p=decimal.Parse(inventory["physicalQuantity"]!.GetValue<string>(),System.Globalization.CultureInfo.InvariantCulture);var h=decimal.Parse(inventory["heldQuantity"]!.GetValue<string>(),System.Globalization.CultureInfo.InvariantCulture);Assert.True(h>=0&&h<=p);
    }
    [Fact] public async Task ExpiryDuringLockQueueUsesTimeAfterLock()
    {
        var(c,w,_,_,d,_)=await Stock("1.000","2026-10-14T12:00:01Z");
        await using var connection=new NpgsqlConnection(f.Connection);await connection.OpenAsync();await using var tx=await connection.BeginTransactionAsync();
        await using(var cmd=new NpgsqlCommand("SELECT 1 FROM warehouses WHERE \"Id\"=@id FOR UPDATE",connection,tx)){cmd.Parameters.AddWithValue("id",w);await cmd.ExecuteScalarAsync();}
        var task=c.Send("POST",Root(w)+"/orders",new{lines=new[]{new{dishId=d,portions=1}}},Guid.NewGuid());
        await Task.Delay(150);f.Clock.Set(new(2026,10,14,12,0,1,TimeSpan.Zero));await tx.CommitAsync();
        try{Assert.Equal("INSUFFICIENT_STOCK",(await task).Code);Assert.Equal("1.000",(await c.Send("GET",Root(w)+"/inventory")).Data!["items"]![0]!["physicalQuantity"]!.GetValue<string>());}
        finally{f.Clock.Set(new(2026,10,14,12,0,0,TimeSpan.Zero));}
    }
    [Fact] public async Task LockTimeoutDoesNotConsumeIdempotencyKey()
    {
        var(c,w,_,_,d,_)=await Stock();var key=Guid.NewGuid();var body=new{lines=new[]{new{dishId=d,portions=1}}};
        await using var connection=new NpgsqlConnection(f.Connection);await connection.OpenAsync();await using var tx=await connection.BeginTransactionAsync();
        await using(var cmd=new NpgsqlCommand("SELECT 1 FROM warehouses WHERE \"Id\"=@id FOR UPDATE",connection,tx)){cmd.Parameters.AddWithValue("id",w);await cmd.ExecuteScalarAsync();}
        var timed=await c.Send("POST",Root(w)+"/orders",body,key);Assert.Equal(503,timed.Status);Assert.Equal("RETRY_LATER",timed.Code);await tx.RollbackAsync();
        Assert.Equal(201,(await c.Send("POST",Root(w)+"/orders",body,key)).Status);
    }
    [Fact] public async Task RevokedMembershipImmediatelyBlocksOldSessionAndReplay()
    {
        var(c,w,e,_,_,_)=await Stock();var staff=new ApiClient(f.Host.CreateClient());await staff.Csrf();var name="member"+Guid.NewGuid().ToString("N");
        var user=await staff.Send("POST","/api/v2/auth/register",new{username=name,password=PostgresFixture.AdminPassword,displayName="Worker"});staff.UserId=Id(user);await staff.Csrf();
        await c.Send("POST","/api/v2/enterprises/"+e+"/members",new{username=name,role="warehouse"});
        Assert.Equal(200,(await staff.Send("GET",Root(w)+"/inventory")).Status);Assert.Equal(403,(await staff.Send("GET",Root(w)+"/dishes")).Status);
        Assert.Equal(204,(await c.Send("DELETE","/api/v2/enterprises/"+e+"/members/"+staff.UserId)).Status);
        Assert.Equal(404,(await staff.Send("GET",Root(w)+"/inventory")).Status);
    }
    [Fact] public async Task CustomerOwnReceiptAndReplayRemainAfterPublicationRemoved()
    {
        var(c,w,_,_,d,_)=await Stock("3.000");await c.Send("PATCH",Root(w)+"/customer-publication",new{enabled=true});
        var customer=new ApiClient(f.Host.CreateClient(),true);await customer.Csrf();var reg=await customer.Send("POST","/api/v2/customer/auth/register",new{username="buyer"+Guid.NewGuid().ToString("N"),password=PostgresFixture.AdminPassword,displayName="Buyer"});customer.UserId=Id(reg);await customer.Csrf();
        var path="/api/v2/customer/warehouses/"+w+"/orders";var body=new{lines=new[]{new{dishId=d,portions=1}}};var key=Guid.NewGuid();var order=await customer.Send("POST",path,body,key);Assert.Equal(201,order.Status);Assert.Null(order.Data!["allocations"]);
        await c.Send("PATCH",Root(w)+"/customer-publication",new{enabled=false});
        Assert.Equal(order.Raw,(await customer.Send("POST",path,body,key)).Raw);Assert.Equal(200,(await customer.Send("GET",path+"/"+Id(order))).Status);Assert.Equal(404,(await customer.Send("POST",path,body,Guid.NewGuid())).Status);
        var other=new ApiClient(f.Host.CreateClient(),true);await other.Csrf();var otherReg=await other.Send("POST","/api/v2/customer/auth/register",new{username="other"+Guid.NewGuid().ToString("N"),password=PostgresFixture.AdminPassword,displayName="Other"});other.UserId=Id(otherReg);await other.Csrf();Assert.Equal(404,(await other.Send("GET",path+"/"+Id(order))).Status);
    }
    [Fact] public async Task PosExternalIdentityPersistsAcrossKeyRotation()
    {
        var(c,w,_,_,d,_)=await Stock("3.000");var root=Root(w);var client=await c.Send("POST",root+"/integration-clients",new{name="POS",kind="pos"});
        var firstKey=await c.Send("POST",root+"/integration-clients/"+Id(client)+"/keys",new{label="one",expiresAt=(string?)null});
        var token=firstKey.Data!["token"]!.GetValue<string>();var path="/integrations/v1/warehouses/"+w+"/orders";var body=new{externalId="source-1",lines=new[]{new{dishId=d,portions=1}}};
        var order=await c.Send("POST",path,body,Guid.NewGuid(),token);Assert.Equal(201,order.Status);
        var duplicate=await c.Send("POST",path,body,Guid.NewGuid(),token);Assert.Equal(200,duplicate.Status);Assert.Equal(Id(order),Id(duplicate));
        Assert.Equal("EXTERNAL_ID_CONFLICT",(await c.Send("POST",path,new{externalId="source-1",lines=new[]{new{dishId=d,portions=2}}},Guid.NewGuid(),token)).Code);
        var secondKey=await c.Send("POST",root+"/integration-clients/"+Id(client)+"/keys",new{label="two",expiresAt=(string?)null});
        await c.Send("DELETE",root+"/integration-clients/"+Id(client)+"/keys/"+Guid.Parse(firstKey.Data!["key"]!["id"]!.GetValue<string>()));
        Assert.Equal(401,(await c.Send("GET","/integrations/v1/warehouses/"+w+"/identity",bearer:token)).Status);
        var rotated=await c.Send("POST",path,body,Guid.NewGuid(),secondKey.Data!["token"]!.GetValue<string>());Assert.Equal(200,rotated.Status);Assert.Equal(Id(order),Id(rotated));
    }
    [Fact] public async Task CsrfOriginMalformedJsonAndStrictFieldsHaveOneEnvelope()
    {
        var(c,w,_,_,dish,_)=await Stock();var root=Root(w);
        using var request=new HttpRequestMessage(HttpMethod.Post,root+"/orders");request.Headers.Add("Origin","http://localhost");request.Headers.Add("X-Rims-Expected-User-Id",c.UserId.ToString());request.Content=new StringContent(ContractJson.Serialize(new{lines=new[]{new{dishId=dish,portions=1}}}),System.Text.Encoding.UTF8,"application/json");
        var csrf=await c.Http.SendAsync(request);Assert.Equal(403,(int)csrf.StatusCode);Assert.Equal("CSRF_INVALID",JsonNode.Parse(await csrf.Content.ReadAsStringAsync())!["error"]!["code"]!.GetValue<string>());
        using var malformed=new HttpRequestMessage(HttpMethod.Post,root+"/orders"){Content=new StringContent("{broken",System.Text.Encoding.UTF8,"application/json")};var invalid=await c.Http.SendAsync(malformed);Assert.Equal(400,(int)invalid.StatusCode);
        var fields=await c.Send("POST",root+"/ingredients",new{name="Incomplete",unit="g",defaultShelfLifeHours=72});Assert.Equal(422,fields.Status);Assert.NotNull(fields.Body!["meta"]);Assert.Equal("reorderPoint",fields.Body["error"]!["details"]!["fields"]![0]!["path"]!.GetValue<string>());
        Assert.Equal(422,(await c.Send("GET",root+"/inventory?pageSize=101")).Status);Assert.Equal(422,(await c.Send("GET",root+"/inventory?lowStock=1")).Status);
    }
    [Fact] public async Task StaffAndCustomerCookiesLogoutIndependently()
    {
        var staff=await f.Login();await staff.Csrf();var customer=new ApiClient(staff.Http,true);await customer.Csrf();
        var reg=await customer.Send("POST","/api/v2/customer/auth/register",new{username="dual"+Guid.NewGuid().ToString("N"),password=PostgresFixture.AdminPassword,displayName="Dual"});Assert.Equal(201,reg.Status);customer.UserId=Id(reg);await customer.Csrf();
        Assert.Equal(200,(await staff.Send("GET","/api/v2/auth/me")).Status);Assert.Equal(200,(await customer.Send("GET","/api/v2/customer/auth/me")).Status);
        Assert.Equal(204,(await staff.Send("POST","/api/v2/auth/logout")).Status);Assert.Equal(401,(await staff.Send("GET","/api/v2/auth/me")).Status);Assert.Equal(200,(await customer.Send("GET","/api/v2/customer/auth/me")).Status);
    }
    [Fact] public async Task AllBaseReadRoutesAndGeneratedOpenApiAreAvailable()
    {
        var(_,c,w,_)=await f.Warehouse();foreach(var resource in new[]{"config","dashboard","ingredients","dishes","inventory","batches","deliveries","orders","write-offs","movements","menu/availability","stop-list","recommendations","purchase-suggestions","quarantines","combos","purchase-suppliers","purchase-requests","integration-clients","service/menu","service/stop-list","service/recommendations","service/combos","stop-list/forecast","customer-publication"}) {var r=await c.Send("GET",Root(w)+"/"+resource);Assert.True(r.Status==200,resource+": "+r.Raw);Assert.NotNull(r.Body!["meta"]);}
        var openapi=await c.Send("GET","/openapi/v2.json");Assert.Equal(200,openapi.Status);Assert.Equal("3.1.0",openapi.Body!["openapi"]!.GetValue<string>());
        var paths=openapi.Body["paths"]!.AsObject();Assert.True(paths.ContainsKey("/api/v2/customer/warehouses/{warehouseId}/orders"));Assert.True(paths.ContainsKey("/integrations/v1/warehouses/{warehouseId}/purchase-requests/{id}/approve"));Assert.False(paths.ContainsKey("/api/v2/customer/warehouses/{warehouseId}/inventory"));
        using var scope=f.Host.Services.CreateScope();Assert.False(scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.HasPendingModelChanges());
    }
}
