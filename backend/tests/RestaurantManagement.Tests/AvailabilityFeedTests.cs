using Microsoft.Extensions.DependencyInjection;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Infrastructure.Persistence;
using RestaurantManagement.WebApi.V2;
using Xunit;

namespace RestaurantManagement.Tests;

[Collection("postgres")]
public sealed class AvailabilityFeedTests(PostgresFixture f)
{
    [Fact]
    public async Task DurableRevisionRollbackAndExpiryAreObservedWithoutChangingHistoricalData()
    {
        var original=f.Clock.GetUtcNow();
        try {
            var (_,owner,warehouse,_)=await f.Warehouse();
            var path="/api/v2/warehouses/"+warehouse;
            var feed=f.Host.Services.GetRequiredService<AvailabilityFeed>();
            using var subscription=feed.Subscribe(warehouse);
            var empty=await feed.Read(warehouse,default);
            var ingredient=await owner.Send("POST",path+"/ingredients",new{name="Realtime stock",unit="g",defaultShelfLifeHours=1,reorderPoint="0.000",targetStock="10.000"});
            var delivery=await owner.Send("POST",path+"/deliveries",new{number="Realtime receipt",note=(string?)null,expectedAt=(string?)null,lines=new[]{new{ingredientId=ingredient.Data!["id"]!.GetValue<string>(),quantity="10.000",expiresAt=original.UtcDateTime.AddMinutes(20)}}},Guid.NewGuid());
            Assert.Equal(201,delivery.Status);
            Assert.Equal(200,(await owner.Send("POST",path+"/deliveries/"+delivery.Data!["id"]!.GetValue<string>()+"/confirm",new{receivedAtMode="server"},Guid.NewGuid())).Status);
            f.Clock.Set(original.AddSeconds(2));
            var stocked=await feed.Read(warehouse,default);
            Assert.NotEqual(empty.Revision,stocked.Revision);
            using(var scope=f.Host.Services.CreateScope()) {
                var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await using var transaction=await db.Database.BeginTransactionAsync();
                var w=await db.Warehouses.SingleAsync(w=>w.Id==warehouse);w.StateRevision++;
                await db.SaveChangesAsync();await transaction.RollbackAsync();
            }
            f.Clock.Set(original.AddSeconds(4));
            Assert.Equal(stocked.Revision,(await feed.Read(warehouse,default)).Revision);
            f.Clock.Set(original.AddMinutes(21));
            var expired=await feed.Read(warehouse,default);
            Assert.Equal(stocked.Revision,expired.Revision);
            Assert.NotEqual(stocked.ClockVersion,expired.ClockVersion);
            Assert.Equal(stocked.BackendInstanceId,expired.BackendInstanceId);
        } finally { f.Clock.Set(original); }
    }
}
