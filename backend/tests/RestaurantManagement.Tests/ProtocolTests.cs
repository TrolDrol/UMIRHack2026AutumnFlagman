using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Infrastructure.Persistence;
using Xunit;

namespace RestaurantManagement.Tests;
[Collection("postgres")]
public sealed class ProtocolTests(PostgresFixture f)
{
    [Fact] public async Task RateLimitUsesErrorEnvelopeAndRetryAfter()
    {
        await using var host=new TestHost(f.Connection,f.Clock,1);var client=new ApiClient(host.CreateClient());await client.Csrf();
        var input=new{username="admin",password=PostgresFixture.AdminPassword};Assert.Equal(200,(await client.Send("POST","/api/v2/auth/login",input)).Status);
        var second=await client.Send("POST","/api/v2/auth/login",input);Assert.Equal(429,second.Status);Assert.Equal("RATE_LIMITED",second.Code);Assert.NotNull(second.Body!["meta"]);
    }
    [Fact] public async Task LowerCaseIntegrationSchemeAndUpperCasePathCannotUseStaffCookie()
    {
        var(_,owner,w,_)=await f.Warehouse();var unauthorized=await owner.Send("GET",("/integrations/v1/warehouses/"+w+"/identity").ToUpperInvariant());Assert.Equal(401,unauthorized.Status);
        var anonymous=new ApiClient(f.Host.CreateClient());Assert.Equal(401,(await anonymous.Send("GET","/api/v2/warehouses/"+Guid.NewGuid()+"/inventory")).Status);
        anonymous.Http.DefaultRequestHeaders.Add("Cookie","rims_staff_session=invalid-base64-cookie");Assert.Equal(401,(await anonymous.Send("GET","/api/v2/auth/me")).Status);
    }
    [Fact] public async Task PersistentOwnerCannotBeRemovedAndManagerCannotPublishOutlet()
    {
        var(_,owner,w,e)=await f.Warehouse();var member=new ApiClient(f.Host.CreateClient());await member.Csrf();var name="manager"+Guid.NewGuid().ToString("N");var register=await member.Send("POST","/api/v2/auth/register",new{username=name,password=PostgresFixture.AdminPassword,displayName="Manager"});member.UserId=Guid.Parse(register.Data!["id"]!.GetValue<string>());await member.Csrf();
        Assert.Equal(201,(await owner.Send("POST","/api/v2/enterprises/"+e+"/members",new{username=name,role="manager"})).Status);
        Assert.Equal("OWNER_IMMUTABLE",(await owner.Send("DELETE","/api/v2/enterprises/"+e+"/members/"+owner.UserId)).Code);
        Assert.Equal(403,(await member.Send("PATCH","/api/v2/warehouses/"+w+"/customer-publication",new{enabled=true})).Status);
        Assert.Equal(200,(await member.Send("GET","/api/v2/warehouses/"+w+"/purchase-suppliers")).Status);
    }
    [Fact] public async Task CancelShipmentRaceHasOneWinnerAndCancelledUnsubmittedDraftStaysHidden()
    {
        var(_,c,w,_)=await f.Warehouse();var root="/api/v2/warehouses/"+w;var i=await c.Send("POST",root+"/ingredients",new{name="Race ingredient",unit="g",defaultShelfLifeHours=72,reorderPoint="0.000",targetStock="10.000"});
        var supplier=await c.Send("POST",root+"/integration-clients",new{name="Race supplier",kind="supplier"});var sid=supplier.Data!["id"]!.GetValue<string>();var key=await c.Send("POST",root+"/integration-clients/"+sid+"/keys",new{label="Test",expiresAt=(string?)null});var token=key.Data!["token"]!.GetValue<string>();var external="/integrations/v1/warehouses/"+w;
        var input=new{supplierClientId=sid,expectedAt=(string?)null,note=(string?)null,lines=new[]{new{ingredientId=i.Data!["id"]!.GetValue<string>(),quantity="2.000"}}};
        Assert.Equal(403,(await c.Send("POST",external+"/purchase-requests",input,Guid.NewGuid(),token)).Status);
        var draft=await c.Send("POST",root+"/purchase-requests",input,Guid.NewGuid());var rid=draft.Data!["id"]!.GetValue<string>();
        await c.Send("POST",root+"/purchase-requests/"+rid+"/submit",new{version=1},Guid.NewGuid());await c.Send("POST",external+"/purchase-requests/"+rid+"/approve",new{version=2},Guid.NewGuid(),token);
        var race=await Task.WhenAll(c.Send("POST",root+"/purchase-requests/"+rid+"/cancel",new{version=3},Guid.NewGuid()),c.Send("POST",external+"/deliveries",new{number="SHIP",externalId="ship-race",purchaseRequestId=rid,expectedAt=(string?)null,note=(string?)null,lines=new[]{new{ingredientId=i.Data!["id"]!.GetValue<string>(),quantity="2.000",expiresAt="2026-10-15T12:00:00Z"}}},Guid.NewGuid(),token));
        Assert.Single(race,r=>r.Status is 200 or 201);Assert.Single(race,r=>r.Status==409);Assert.Equal(0,(await c.Send("GET",root+"/batches")).Data!["total"]!.GetValue<int>());
        var secret=await c.Send("POST",root+"/purchase-requests",input,Guid.NewGuid());var secretId=secret.Data!["id"]!.GetValue<string>();await c.Send("POST",root+"/purchase-requests/"+secretId+"/cancel",new{version=1},Guid.NewGuid());
        Assert.Equal(404,(await c.Send("GET",external+"/purchase-requests/"+secretId,bearer:token)).Status);
        var list=await c.Send("GET",external+"/purchase-requests",bearer:token);Assert.DoesNotContain(list.Data!["items"]!.AsArray(),j=>j!["id"]!.GetValue<string>()==secretId);
    }
}
