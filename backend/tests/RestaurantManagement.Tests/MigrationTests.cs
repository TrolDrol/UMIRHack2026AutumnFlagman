using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using RestaurantManagement.Infrastructure.Persistence;
using Xunit;

namespace RestaurantManagement.Tests;
[Collection("postgres")]
public sealed class MigrationTests(PostgresFixture fixture)
{
    [Fact] public async Task ExistingV1UpgradePreservesDocumentsAndMarksUnknownReceiptHistory()
    {
        var options=new NpgsqlConnectionStringBuilder(fixture.Connection);var name="rims_upgrade_"+Guid.NewGuid().ToString("N")+"_test";
        await using(var c=new NpgsqlConnection(fixture.Connection)){await c.OpenAsync();await new NpgsqlCommand($"CREATE DATABASE {name}",c).ExecuteNonQueryAsync();}
        options.Database=name;await using var db=new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(options.ConnectionString).Options);
        await db.GetService<IMigrator>().MigrateAsync("20261013173403_InitialCreate");
        var w=Guid.NewGuid();var i=Guid.NewGuid();var d=Guid.NewGuid();var item=Guid.NewGuid();var b=Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
          INSERT INTO ingredients(id,warehouse_id,name,unit,default_shelf_life_hours,reorder_point,target_stock) VALUES({i},{w},'Legacy product','g',72,1,10);
          INSERT INTO deliveries(id,warehouse_id,number,status,created_at,received_at,source) VALUES({d},{w},'LEGACY',2,'2026-10-13T12:00:00Z','2026-10-13T12:00:00Z','manual');
          INSERT INTO delivery_items(id,delivery_id,ingredient_id,ingredient_name,quantity,unit,shelf_life_hours,expiration_date) VALUES({item},{d},{i},'Legacy product',10,'g',72,'2026-10-16T12:00:00Z');
          INSERT INTO batches(id,warehouse_id,delivery_id,source_item_id,ingredient_id,ingredient_name,expires_at,unit,received_at,shelf_life_hours,initial_quantity,remaining_quantity) VALUES({b},{w},{d},{item},{i},'Legacy product','2026-10-16T12:00:00Z','g','2026-10-13T12:00:00Z',72,10,5);
          """);
        await db.Database.MigrateAsync();Assert.False(db.Database.HasPendingModelChanges());
        var batch=await db.Batches.SingleAsync();Assert.Equal(b,batch.Id.Value);Assert.Equal(5,batch.RemainingQuantity.Value);Assert.Null(batch.ReceiptCommittedAt);Assert.Equal(1,batch.Version);
        Assert.Equal(d,(await db.Deliveries.SingleAsync()).Id.Value);
        var opening=await db.Documents.SingleAsync(o=>o.Kind=="opening_balance");Assert.Equal(b,opening.BatchId);Assert.Contains("5.000",opening.Json);
        Assert.False((await db.Warehouses.SingleAsync()).CustomerPublished);Assert.Empty(await db.Memberships.ToArrayAsync());
        Assert.NotEqual(Guid.Empty,(await db.Runtime.SingleAsync()).BackendInstanceId);
    }
}
