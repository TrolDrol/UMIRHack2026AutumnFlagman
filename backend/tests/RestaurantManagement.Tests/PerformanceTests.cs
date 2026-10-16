using System.Diagnostics;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Infrastructure.Persistence;
using Xunit;

namespace RestaurantManagement.Tests;
[Collection("postgres")]
public sealed class PerformanceTests(PostgresFixture f)
{
    [Fact] public async Task Measure100Ingredients100Dishes1000BatchesOnRealPostgres()
    {
        var(_,c,w,_)=await f.Warehouse();var root="/api/v2/warehouses/"+w;var now=ContractJson.Now(f.Clock);
        var ingredients=Enumerable.Range(0,100).Select(n=>new Ingredient(IngredientId.New(),WarehouseId.From(w),"Product "+n.ToString("D3"),Unit.Grams(),72,Quantity.Zero,Quantity.From(20))).ToArray();
        var dishes=ingredients.Select((i,n)=>{
            var recipe=new[]{new RecipeIngredient(RecipeIngredientId.New(),i.Name,new(i.Id,Quantity.From(1),i.Unit))};var d=new Dish(DishId.New(),WarehouseId.From(w),"Dish "+n.ToString("D3"),recipe);d.Replace(d.Name,true,recipe,now);return d;
        }).ToArray();
        using(var scope=f.Host.Services.CreateScope()){
            var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();await using var tx=await db.Database.BeginTransactionAsync();
            var warehouse=await db.Warehouses.FromSqlInterpolated($"SELECT * FROM warehouses WHERE \"Id\"={w} FOR UPDATE").SingleAsync();
            db.Ingredients.AddRange(ingredients);await db.SaveChangesAsync();db.Dishes.AddRange(dishes);warehouse.StateRevision++;warehouse.DatasetKind="demo_seeded";await db.SaveChangesAsync();await tx.CommitAsync();
        }
        for(var n=0;n<10;n++){
            var d=await c.Send("POST",root+"/deliveries",new{number="BENCH-"+n,expectedAt=(string?)null,note=(string?)null,lines=ingredients.Select(i=>new{ingredientId=i.Id.Value,quantity="1.000",expiresAt="2026-10-15T12:00:00Z"}).ToArray()},Guid.NewGuid());Assert.Equal(201,d.Status);
            Assert.Equal(200,(await c.Send("POST",root+"/deliveries/"+d.Data!["id"]!.GetValue<string>()+"/confirm",new{receivedAt="2026-10-14T11:00:00Z"},Guid.NewGuid())).Status);
        }
        Assert.Equal(1000,(await c.Send("GET",root+"/batches")).Data!["total"]!.GetValue<int>());
        var reads=new List<double>();var writes=new List<double>();
        foreach(var path in new[]{"inventory","menu/availability","recommendations","dashboard"}){
            await c.Send("GET",root+"/"+path);
            for(var n=0;n<8;n++){var sw=Stopwatch.StartNew();Assert.Equal(200,(await c.Send("GET",root+"/"+path)).Status);reads.Add(sw.Elapsed.TotalMilliseconds);}
        }
        for(var n=0;n<20;n++){var sw=Stopwatch.StartNew();Assert.Equal(201,(await c.Send("POST",root+"/orders",new{lines=new[]{new{dishId=dishes[n].Id.Value,portions=1}}},Guid.NewGuid())).Status);writes.Add(sw.Elapsed.TotalMilliseconds);}
        static double P95(List<double> data)=>data.Order().ElementAt((int)Math.Ceiling(data.Count*0.95)-1);
        var result=new{postgres="native-or-testcontainers",ingredients=100,dishes=100,batches=1000,readSamples=reads.Count,writeSamples=writes.Count,readP95Ms=P95(reads),writeP95Ms=P95(writes)};
        var folder=Environment.GetEnvironmentVariable("RIMS_TEST_ARTIFACTS")??Path.Combine(Path.GetTempPath(),"rims-test-artifacts");Directory.CreateDirectory(folder);await File.WriteAllTextAsync(Path.Combine(folder,"benchmark.json"),JsonSerializer.Serialize(result,new JsonSerializerOptions{WriteIndented=true}));
        Assert.True(result.readP95Ms<500,$"Read p95 = {result.readP95Ms:F1} ms");Assert.True(result.writeP95Ms<1000,$"Write p95 = {result.writeP95Ms:F1} ms");
    }
}
