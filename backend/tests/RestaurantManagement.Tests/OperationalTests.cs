using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Infrastructure.Persistence;
using RestaurantManagement.WebApi.V2;
using Xunit;

namespace RestaurantManagement.Tests;
[Collection("postgres")]
public sealed class OperationalTests(PostgresFixture f)
{
    [Fact] public async Task InfrastructureEndpointsRemainAvailableWhenDatabaseCannotConnect()
    {
        var options = new NpgsqlConnectionStringBuilder(f.Connection) { Port = 1, Timeout = 1 };
        var previous = Environment.GetEnvironmentVariable("ConnectionStrings__Default");
        try {
            Environment.SetEnvironmentVariable("ConnectionStrings__Default", options.ConnectionString);
            await using var unavailable = new TestHost(options.ConnectionString, f.Clock);
            var client = unavailable.CreateClient();
            Assert.Equal(System.Net.HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/health/ready")).StatusCode);
            // Even a valid session cookie must not turn infrastructure probes into DB-auth requests.
            var login = await f.Login();
            var original = await login.Http.GetAsync("/api/v2/auth/me");
            if (original.RequestMessage!.Headers.TryGetValues("Cookie", out var cookies))
                client.DefaultRequestHeaders.Add("Cookie", cookies);
            Assert.Equal(System.Net.HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/health/ready")).StatusCode);
        } finally { Environment.SetEnvironmentVariable("ConnectionStrings__Default", previous); }
    }
    [Fact] public async Task ExplicitSeedIsRepeatableAndProducesC10RiskScore()
    {
        using(var scope=f.Host.Services.CreateScope())await scope.ServiceProvider.GetRequiredService<WarehouseService>().SeedDemo("seed-test-only-password");
        using(var scope=f.Host.Services.CreateScope())await scope.ServiceProvider.GetRequiredService<WarehouseService>().SeedDemo("seed-test-only-password");
        var c=await f.Login("demo-owner","seed-test-only-password");var root="/api/v2/warehouses/eeeeeeee-0000-4000-8000-000000000001";
        Assert.Equal(5,(await c.Send("GET",root+"/batches")).Data!["total"]!.GetValue<int>());
        var offer=(await c.Send("GET",root+"/recommendations")).Data!["items"]![0]!;Assert.Equal(16.67,offer["score"]!.GetValue<double>());Assert.Equal(3,offer["maxPortions"]!.GetValue<int>());
        var dish=(await c.Send("GET",root+"/dishes")).Data!["items"]![0]!["id"]!.GetValue<string>();
        var order=await c.Send("POST",root+"/orders",new{lines=new[]{new{dishId=dish,portions=2}}},Guid.NewGuid());Assert.Equal(201,order.Status);
        var fail=await c.Send("POST",root+"/orders",new{lines=new[]{new{dishId=dish,portions=2}}},Guid.NewGuid());Assert.Equal("INSUFFICIENT_STOCK",fail.Code);
        Assert.Equal("50.000",fail.Body!["error"]!["details"]!["shortages"]![0]!["missingQuantity"]!.GetValue<string>());
        Assert.Equal(1,(await c.Send("GET",root+"/menu/availability")).Data!["items"]![0]!["maxPortions"]!.GetValue<int>());
    }
    [Fact] public async Task MetricsUseLiveDatabaseAndReplayDoesNotIncrementAccepted()
    {
        var metrics=f.Host.Services.GetRequiredService<LiveMetrics>();var(_,c,w,_)=await f.Warehouse();var root="/api/v2/warehouses/"+w;
        var i=await c.Send("POST",root+"/ingredients",new{name="Metric product",unit="g",defaultShelfLifeHours=72,reorderPoint="0.000",targetStock="10.000"});
        var dish=await c.Send("POST",root+"/dishes",new{name="Metric dish",active=true,recipe=new[]{new{ingredientId=i.Data!["id"]!.GetValue<string>(),quantity="1.000"}}});
        var delivery=await c.Send("POST",root+"/deliveries",new{number="METRIC",expectedAt=(string?)null,note=(string?)null,lines=new[]{new{ingredientId=i.Data!["id"]!.GetValue<string>(),quantity="2.000",expiresAt="2026-10-14T12:00:01Z"}}},Guid.NewGuid());
        await c.Send("POST",root+"/deliveries/"+delivery.Data!["id"]!.GetValue<string>()+"/confirm",new{receivedAt="2026-10-14T11:00:00Z"},Guid.NewGuid());
        var input=new{lines=new[]{new{dishId=dish.Data!["id"]!.GetValue<string>(),portions=1}}};var key=Guid.NewGuid();Assert.Equal(201,(await c.Send("POST",root+"/orders",input,key)).Status);Assert.Equal(201,(await c.Send("POST",root+"/orders",input,key)).Status);
        await metrics.Refresh();var text=metrics.Export();Assert.Contains("source_kind=\"live\"",text);Assert.Contains("rims_snapshot_success",text);Assert.Contains("rims_api_request_duration_seconds_bucket",text);
        Assert.Contains($"rims_inventory_out_of_stock_ingredients{{warehouse_id=\"{w}\"}} 0",text);
        Assert.Contains($"rims_orders_total{{warehouse_id=\"{w}\",source=\"staff\",result=\"accepted\"}} 1",text);
        Assert.DoesNotContain("source_kind=\"mock\"",text);
        f.Clock.Set(new(2026,10,14,12,0,1,TimeSpan.Zero));try { await metrics.Refresh();var expired=metrics.Export();Assert.Contains($"rims_inventory_batches{{warehouse_id=\"{w}\",state=\"expired\"}} 1",expired);Assert.Contains($"rims_menu_dishes{{warehouse_id=\"{w}\",state=\"stopped\"}} 1",expired); }finally{f.Clock.Set(new(2026,10,14,12,0,0,TimeSpan.Zero));}
    }
    [Fact] public async Task HostRestartKeepsRuntimeSessionsAndReplay()
    {
        var(_,c,w,_)=await f.Warehouse();var original=await c.Send("GET","/api/v2/runtime");var key=Guid.NewGuid();var root="/api/v2/warehouses/"+w;
        var ingredient=await c.Send("POST",root+"/ingredients",new{name="Restart",unit="g",defaultShelfLifeHours=72,reorderPoint="0.000",targetStock="1.000"});
        var input=new{number="RESTART",expectedAt=(string?)null,note=(string?)null,lines=new[]{new{ingredientId=ingredient.Data!["id"]!.GetValue<string>(),quantity="1.000",expiresAt="2026-10-15T12:00:00Z"}}};var first=await c.Send("POST",root+"/deliveries",input,key);Assert.Equal(201,first.Status);
        var cookies=(await c.Http.GetAsync("/api/v2/auth/me")).RequestMessage!.Headers.TryGetValues("Cookie",out var values)?values.ToArray():[];
        await using var restarted=new TestHost(f.Connection,f.Clock);
        var restartClient=new ApiClient(restarted.CreateClient());await restartClient.Csrf();
        var login=await restartClient.Send("POST","/api/v2/auth/login",new{username="admin",password=PostgresFixture.AdminPassword});Assert.Equal(200,login.Status);
        restartClient.UserId=Guid.Parse(login.Data!["id"]!.GetValue<string>());await restartClient.Csrf();
        var runtime=await restartClient.Send("GET","/api/v2/runtime");Assert.Equal(original.Data!["backendInstanceId"]!.GetValue<string>(),runtime.Data!["backendInstanceId"]!.GetValue<string>());
        using var scope=f.Host.Services.CreateScope();var db=scope.ServiceProvider.GetRequiredService<AppDbContext>();Assert.True(await db.Sessions.CountAsync()>1);
        // Replay requires the original principal; reuse its persisted session cookie across a new API host.
        var originalClient=new ApiClient(restarted.CreateClient());foreach(var cookie in cookies)originalClient.Http.DefaultRequestHeaders.Add("Cookie",cookie);
        var me=await originalClient.Send("GET","/api/v2/auth/me");Assert.Equal(200,me.Status);originalClient.UserId=Guid.Parse(me.Data!["id"]!.GetValue<string>());await originalClient.Csrf();
        Assert.Equal(first.Raw,(await originalClient.Send("POST",root+"/deliveries",input,key)).Raw);
    }
    [Fact] public async Task NativeBackupRestorePreservesLedgerAndRuntimeCanBeRotated()
    {
        using(var seedScope=f.Host.Services.CreateScope())await seedScope.ServiceProvider.GetRequiredService<WarehouseService>().SeedDemo("seed-test-only-password");
        var options=new NpgsqlConnectionStringBuilder(f.Connection);var target="rims_restore_"+Guid.NewGuid().ToString("N")+"_test";
        var backup=Path.Combine(Path.GetTempPath(),target+".dump");
        await Process("pg_dump",options,"--format=custom","--file",backup);
        await using(var connection=new NpgsqlConnection(f.Connection)){await connection.OpenAsync();await new NpgsqlCommand($"CREATE DATABASE {target}",connection).ExecuteNonQueryAsync();}
        options.Database=target;await Process("pg_restore",options,"--no-owner","--exit-on-error",backup);
        await using var restored=new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(options.ConnectionString).Options);
        using var scope=f.Host.Services.CreateScope();var original=scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.Equal(await original.Orders.CountAsync(),await restored.Orders.CountAsync());Assert.Equal(await original.Replays.CountAsync(),await restored.Replays.CountAsync());
        Assert.Equal(await original.Documents.CountAsync(d=>d.Kind=="movement"),await restored.Documents.CountAsync(d=>d.Kind=="movement"));
        var sourceRuntime=await original.Runtime.AsNoTracking().SingleAsync();var recoveredRuntime=await restored.Runtime.SingleAsync();Assert.Equal(sourceRuntime.BackendInstanceId,recoveredRuntime.BackendInstanceId);
        recoveredRuntime.BackendInstanceId=Guid.NewGuid();await restored.SaveChangesAsync();Assert.NotEqual(sourceRuntime.BackendInstanceId,recoveredRuntime.BackendInstanceId);
    }
    static async Task Process(string executable,NpgsqlConnectionStringBuilder connection,params string[] args)
    {
        var info=new ProcessStartInfo(executable){UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true,RedirectStandardOutput=true};
        foreach(var a in new[]{"--host",connection.Host,"--port",connection.Port.ToString(),"--username",connection.Username,"--dbname",connection.Database}.Concat(args))info.ArgumentList.Add(a!);
        info.Environment["PGPASSWORD"]=connection.Password??"";using var process=System.Diagnostics.Process.Start(info)!;
        var stdout=process.StandardOutput.ReadToEndAsync();var stderr=process.StandardError.ReadToEndAsync();await process.WaitForExitAsync();await stdout;var error=await stderr;Assert.True(process.ExitCode==0,$"{executable} failed: {error}");
    }
}
