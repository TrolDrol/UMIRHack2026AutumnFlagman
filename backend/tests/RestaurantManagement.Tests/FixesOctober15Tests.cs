using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using RestaurantManagement.Infrastructure.Persistence;
using Xunit;

namespace RestaurantManagement.Tests;

[Collection("postgres")]
public sealed class FixesOctober15Tests(PostgresFixture f)
{
    static Guid Id(ApiResponse r) => Guid.Parse(r.Data!["id"]!.GetValue<string>());
    async Task<(ApiClient C,string W,Guid Dish,Guid Delivery)> Setup(bool expiring=false)
    {
        var (_,c,w,_) = await f.Warehouse(); var root=$"/api/v2/warehouses/{w}";
        var i=await c.Send("POST",root+"/ingredients",new{name="Fresh",unit="g",defaultShelfLifeHours=72,reorderPoint="0.000",targetStock="10.000"});Assert.Equal(201,i.Status);
        var d=await c.Send("POST",root+"/dishes",new{name="Fresh dish",active=true,recipe=new[]{new{ingredientId=Id(i),quantity="1.000"}}});Assert.Equal(201,d.Status);
        var delivery=await c.Send("POST",root+"/deliveries",new{number="F3",expectedAt=(string?)null,note=(string?)null,lines=new[]{new{ingredientId=Id(i),quantity="10.000",expiresAt=expiring?"2026-10-14T12:10:00Z":"2026-10-17T12:00:00Z"}}},Guid.NewGuid());Assert.Equal(201,delivery.Status);
        return(c,root,Id(d),Id(delivery));
    }
    static object Input(Guid dish,string? start=null,string end="2026-10-14T13:00:00Z",long? version=null) => version is null
        ? new {dishId=dish,title="Manual fresh",publicText=(string?)null,startsAt=start,endsAt=end}
        : (object)new {dishId=dish,title="Edited",publicText=(string?)null,startsAt=start,endsAt=end,expectedVersion=version.Value};
    [Fact] public async Task ServerReceiptUsesLockedTimeAndReplayRetainsOneReceiptAndLegacyHash()
    {
        var(c,w,_,delivery)=await Setup();var path=$"{w}/deliveries/{delivery}/confirm";var key=Guid.NewGuid();
        try {
            await using var connection=new NpgsqlConnection(f.Connection);await connection.OpenAsync();await using var tx=await connection.BeginTransactionAsync();
            await using(var cmd=new NpgsqlCommand("SELECT 1 FROM warehouses WHERE \"Id\"=@id FOR UPDATE",connection,tx)){cmd.Parameters.AddWithValue("id",Guid.Parse(w.Split('/').Last()));await cmd.ExecuteScalarAsync();}
            var waiting=c.Send("POST",path,new{receivedAtMode="server"},key);await Task.Delay(150);f.Clock.Set(new(2026,10,14,12,5,0,TimeSpan.Zero));await tx.CommitAsync();
            var first=await waiting;Assert.True(first.Status==200,first.Raw);var at=first.Data!["receivedAt"]!.GetValue<string>();Assert.StartsWith("2026-10-14T12:05:00",at);
            Assert.All(first.Data["batches"]!.AsArray(),b=>Assert.Equal(at,b!["receivedAt"]!.GetValue<string>()));
            f.Clock.Set(new(2026,10,14,12,10,0,TimeSpan.Zero));Assert.Equal(first.Raw,(await c.Send("POST",path,new{receivedAtMode="server"},key)).Raw);
            var concurrent=await Task.WhenAll(c.Send("POST",path,new{receivedAtMode="server"},Guid.NewGuid()),c.Send("POST",path,new{receivedAtMode="server"},Guid.NewGuid()));Assert.All(concurrent,r=>{Assert.Equal(200,r.Status);Assert.Equal(at,r.Data!["receivedAt"]!.GetValue<string>());});
            Assert.Equal(200,(await c.Send("POST",path,new{receivedAt=at},Guid.NewGuid())).Status);
            Assert.Equal(409,(await c.Send("POST",path,new{receivedAt="2026-10-14T12:00:00Z"},Guid.NewGuid())).Status);
            Assert.Equal(1,(await c.Send("GET",w+"/batches")).Data!["total"]!.GetValue<int>());
            Assert.Equal(1,(await c.Send("GET",w+"/movements")).Data!["total"]!.GetValue<int>());
        } finally {f.Clock.Set(new(2026,10,14,12,0,0,TimeSpan.Zero));}
    }
    [Fact] public async Task ConfirmUnionRejectsInvalidFormsAndFutureFieldWithoutStock()
    {
        var(c,w,_,delivery)=await Setup();var path=$"{w}/deliveries/{delivery}/confirm";
        foreach(var json in new[]{"{}","{\"receivedAtMode\":null}","{\"receivedAtMode\":\"device\"}","{\"receivedAtMode\":\"server\",\"receivedAt\":\"2026-10-14T12:00:00Z\"}","{\"receivedAt\":\"2026-10-14T12:00:00\"}","{\"receivedAtMode\":\"server\",\"extra\":1}"})
            Assert.Equal(422,(await c.Send("POST",path,JsonNode.Parse(json),Guid.NewGuid())).Status);
        var future=await c.Send("POST",path,new{receivedAt="2026-10-14T12:00:00.000001Z"},Guid.NewGuid());Assert.Equal(422,future.Status);Assert.Equal("receivedAt",future.Body!["error"]!["details"]!["fields"]![0]!["path"]!.GetValue<string>());
        Assert.Equal(0,(await c.Send("GET",w+"/batches")).Data!["total"]!.GetValue<int>());
        var key=Guid.NewGuid();var legacy=new{receivedAt="2026-10-14T15:00:00+03:00"};var r=await c.Send("POST",path,legacy,key);Assert.Equal(200,r.Status);Assert.Equal(r.Raw,(await c.Send("POST",path,new{receivedAt="2026-10-14T12:00:00Z"},key)).Raw);
    }
    [Fact] public async Task ManualLifecycleFreshStockPublicProjectionReplayAndArchiveUniqueness()
    {
        var(c,w,d,delivery)=await Setup();Assert.Equal(200,(await c.Send("POST",$"{w}/deliveries/{delivery}/confirm",new{receivedAtMode="server"},Guid.NewGuid())).Status);
        Assert.Equal(0,(await c.Send("GET",w+"/recommendations")).Data!["total"]!.GetValue<int>());
        var key=Guid.NewGuid();var create=await c.Send("POST",w+"/manual-offers",Input(d),key);Assert.True(create.Status==201,create.Raw);var id=Id(create);var path=$"{w}/manual-offers/{id}";
        Assert.Equal(create.Raw,(await c.Send("POST",w+"/manual-offers",Input(d),key)).Raw);
        Assert.Equal("IDEMPOTENCY_KEY_REUSED",(await c.Send("POST",w+"/manual-offers",Input(d,end:"2026-10-14T14:00:00Z"),key)).Code);
        Assert.Equal("MANUAL_OFFER_EXISTS",(await c.Send("POST",w+"/manual-offers",Input(d),Guid.NewGuid())).Code);
        var pubkey=Guid.NewGuid();var published=await c.Send("POST",path+"/publish",new{expectedVersion=1},pubkey);Assert.True(published.Status==200,published.Raw);Assert.Equal(2,published.Data!["version"]!.GetValue<int>());
        var offers=await c.Send("GET",w+"/offers?kind=manual");Assert.Equal(1,offers.Data!["total"]!.GetValue<int>());Assert.Null(offers.Data["items"]![0]!["automatic"]);Assert.NotNull(offers.Data["items"]![0]!["manual"]);
        Assert.Equal(0,(await c.Send("GET",w+"/recommendations")).Data!["total"]!.GetValue<int>());
        var safe=await c.Send("GET",w+"/service/offers");Assert.Equal(200,safe.Status);foreach(var forbidden in new[]{"score","batchIds","createdByUserId","effectiveState","automatic","version"})Assert.DoesNotContain("\""+forbidden+"\"",safe.Raw);
        Assert.Equal("MANUAL_OFFER_STATE_CONFLICT",(await c.Send("PUT",path,Input(d,version:2),Guid.NewGuid())).Code);
        Assert.Equal("MANUAL_OFFER_VERSION_CONFLICT",(await c.Send("POST",path+"/unpublish",new{expectedVersion=1},Guid.NewGuid())).Code);
        try {f.Clock.Set(new(2026,10,14,13,0,0,TimeSpan.Zero));Assert.Equal(0,(await c.Send("GET",w+"/offers")).Data!["total"]!.GetValue<int>());Assert.Equal("ended",(await c.Send("GET",path)).Data!["effectiveState"]!.GetValue<string>());Assert.Equal(published.Raw,(await c.Send("POST",path+"/publish",new{expectedVersion=1},pubkey)).Raw);}finally{f.Clock.Set(new(2026,10,14,12,0,0,TimeSpan.Zero));}
        Assert.Equal(200,(await c.Send("POST",path+"/unpublish",new{expectedVersion=2},Guid.NewGuid())).Status);
        Assert.Equal(200,(await c.Send("PUT",path,Input(d,version:3),Guid.NewGuid())).Status);
        Assert.Equal(200,(await c.Send("POST",path+"/archive",new{expectedVersion=4},Guid.NewGuid())).Status);
        Assert.Equal(201,(await c.Send("POST",w+"/manual-offers",Input(d),Guid.NewGuid())).Status);
        using var scope=f.Host.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();var stored=await db.Documents.AsNoTracking().SingleAsync(o=>o.Id==id);Assert.Equal(5,stored.Version);Assert.Equal(5,JsonNode.Parse(stored.Json)!["version"]!.GetValue<int>());
    }
    [Fact] public async Task AutomaticMergeConcurrentCreateAndQuarantineUseRealStock()
    {
        var(c,w,d,delivery)=await Setup(true);var receipt=await c.Send("POST",$"{w}/deliveries/{delivery}/confirm",new{receivedAtMode="server"},Guid.NewGuid());Assert.Equal(200,receipt.Status);
        var auto=await c.Send("GET",w+"/recommendations");Assert.Equal(1,auto.Data!["total"]!.GetValue<int>());
        var races=await Task.WhenAll(c.Send("POST",w+"/manual-offers",Input(d),Guid.NewGuid()),c.Send("POST",w+"/manual-offers",Input(d),Guid.NewGuid()));Assert.Single(races,r=>r.Status==201);Assert.Single(races,r=>r.Code=="MANUAL_OFFER_EXISTS");
        var id=Id(races.Single(r=>r.Status==201));Assert.Equal(200,(await c.Send("POST",$"{w}/manual-offers/{id}/publish",new{expectedVersion=1},Guid.NewGuid())).Status);
        foreach(var kind in new[]{"all","automatic","manual"}) {var merged=await c.Send("GET",w+"/offers?kind="+kind);Assert.Equal(1,merged.Data!["total"]!.GetValue<int>());Assert.Equal(auto.Data["items"]![0]!.ToJsonString(),merged.Data["items"]![0]!["automatic"]!.ToJsonString());}
        var b=receipt.Data!["batches"]![0]!;Assert.Equal(201,(await c.Send("POST",w+"/quarantines",new{batchId=b["id"]!.GetValue<string>(),expectedBatchVersion=1,quantity="10.000",reason="Inspect",note=(string?)null},Guid.NewGuid())).Status);
        Assert.Equal(0,(await c.Send("GET",w+"/offers")).Data!["total"]!.GetValue<int>());Assert.Equal("unavailable",(await c.Send("GET",$"{w}/manual-offers/{id}")).Data!["effectiveState"]!.GetValue<string>());
        var other=await f.Warehouse();Assert.Equal(404,(await other.Owner.Send("GET",$"/api/v2/warehouses/{other.Warehouse}/manual-offers/{id}")).Status);
    }
    [Fact] public async Task PublicOutletPaginationAndOfferRolesDoNotExposeHiddenOrManagementData()
    {
        var(c,w,d,delivery)=await Setup();var wid=Guid.Parse(w.Split('/').Last());
        await c.Send("POST",$"{w}/deliveries/{delivery}/confirm",new{receivedAtMode="server"},Guid.NewGuid());
        var offer=await c.Send("POST",w+"/manual-offers",Input(d,start:"2026-10-14T12:30:00Z"),Guid.NewGuid());var id=Id(offer);
        Assert.Equal(200,(await c.Send("POST",$"{w}/manual-offers/{id}/publish",new{expectedVersion=1},Guid.NewGuid())).Status);
        Assert.Equal("scheduled",(await c.Send("GET",$"{w}/manual-offers/{id}")).Data!["effectiveState"]!.GetValue<string>());
        var customer=new ApiClient(f.Host.CreateClient(),true);await customer.Csrf();var registered=await customer.Send("POST","/api/v2/customer/auth/register",new{username="customer-"+Guid.NewGuid().ToString("N"),password=PostgresFixture.AdminPassword,displayName="Customer"});customer.UserId=Id(registered);await customer.Csrf();
        Assert.Equal(404,(await customer.Send("GET",$"/api/v2/customer/warehouses/{wid}/offers")).Status);
        Assert.Equal(200,(await c.Send("PATCH",w+"/customer-publication",new{enabled=true})).Status);
        try {f.Clock.Set(new(2026,10,14,12,30,0,TimeSpan.Zero));var publicOffers=await customer.Send("GET",$"/api/v2/customer/warehouses/{wid}/offers");Assert.Equal(1,publicOffers.Data!["total"]!.GetValue<int>());foreach(var field in new[]{"score","batchIds","createdByUserId","automatic","version"})Assert.DoesNotContain("\""+field+"\"",publicOffers.Raw);}finally{f.Clock.Set(new(2026,10,14,12,0,0,TimeSpan.Zero));}
        foreach(var kind in new[]{"pos","supplier"}) {
            var client=await c.Send("POST",w+"/integration-clients",new{name=kind,kind});var key=await c.Send("POST",$"{w}/integration-clients/{Id(client)}/keys",new{label="test",expiresAt=(string?)null});var token=key.Data!["token"]!.GetValue<string>();
            var root=$"/integrations/v1/warehouses/{wid}";Assert.Equal(kind=="pos"?200:403,(await c.Send("GET",root+"/offers",bearer:token)).Status);
            Assert.Equal(404,(await c.Send("POST",root+"/manual-offers",Input(d),Guid.NewGuid(),token)).Status);
        }
        var enterprise=(await c.Send("GET","/api/v2/me/memberships")).Data!.AsArray().Single(m=>m!["warehouseId"]!.GetValue<string>()==wid.ToString())!["enterpriseId"]!.GetValue<string>();
        foreach(var role in new[]{"manager","waiter","warehouse"}) {
            var username="offer-role-"+Guid.NewGuid().ToString("N");await c.Send("POST",$"/api/v2/enterprises/{enterprise}/members/register",new{username,password=PostgresFixture.AdminPassword,displayName=role,role});var actor=await f.Login(username);
            Assert.Equal(role=="manager"?200:403,(await actor.Send("GET",w+"/manual-offers")).Status);
            Assert.Equal(role=="warehouse"?403:200,(await actor.Send("GET",w+"/service/offers")).Status);
            Assert.Equal(role=="manager"?409:403,(await actor.Send("POST",w+"/manual-offers",Input(d),Guid.NewGuid())).Status);
            Assert.Equal(403,(await actor.Send("PATCH",w+"/customer-publication",new{enabled=false})).Status);
        }
        var prefix="outlets-"+Guid.NewGuid().ToString("N");
        using var scope=f.Host.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();var now=new DateTime(2026,10,14,12,0,0,DateTimeKind.Utc);
        for(var n=0;n<103;n++){var e=Guid.NewGuid();db.Enterprises.Add(new(){Id=e,Name=prefix+n.ToString("D3"),CreatedAt=now});db.Warehouses.Add(new(){Id=Guid.NewGuid(),EnterpriseId=e,TrackingStartedAt=now,CustomerPublished=n<102});}await db.SaveChangesAsync();
        var first=await customer.Send("GET","/api/v2/customer/outlets?q="+prefix+"&pageSize=100");var second=await customer.Send("GET","/api/v2/customer/outlets?q="+prefix+"&pageSize=100&page=2");Assert.Equal(102,first.Data!["total"]!.GetValue<int>());Assert.Equal(100,first.Data["items"]!.AsArray().Count);Assert.Equal(2,second.Data!["items"]!.AsArray().Count);Assert.DoesNotContain(prefix+"102",first.Raw+second.Raw);
        await using var sql=new NpgsqlConnection(f.Connection);await sql.OpenAsync();
        await using var duplicate=new NpgsqlCommand("INSERT INTO operational_documents (\"Id\",\"WarehouseId\",\"Kind\",\"Version\",\"CreatedAt\",\"Json\") SELECT @newid,\"WarehouseId\",\"Kind\",\"Version\",\"CreatedAt\",jsonb_set(\"Json\",'{id}',to_jsonb(@newid::text)) FROM operational_documents WHERE \"Id\"=@id",sql);duplicate.Parameters.AddWithValue("newid",Guid.NewGuid());duplicate.Parameters.AddWithValue("id",id);var conflict=await Assert.ThrowsAsync<PostgresException>(()=>duplicate.ExecuteNonQueryAsync());Assert.Equal("ux_manual_offer_dish",conflict.ConstraintName);
        await using var invalid=new NpgsqlCommand("UPDATE operational_documents SET \"Version\"=99 WHERE \"Id\"=@id",sql);invalid.Parameters.AddWithValue("id",id);Assert.Equal("23514",(await Assert.ThrowsAsync<PostgresException>(()=>invalid.ExecuteNonQueryAsync())).SqlState);
    }
}
