using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Infrastructure.Persistence;

namespace RestaurantManagement.WebApi.V2;
public sealed partial class WarehouseService
{
    public async Task SeedDemo(string password, CancellationToken ct = default)
    {
        if (password.Length < 12) throw new InvalidOperationException("Demo__Password must have at least 12 characters.");
        var warehouseId = Guid.Parse("eeeeeeee-0000-4000-8000-000000000001");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // Runtime row serializes explicit administrative seed/bootstrap commands, not HTTP stock traffic.
        await db.Runtime.FromSqlRaw("SELECT * FROM runtime_metadata WHERE \"Id\"=1 FOR UPDATE").SingleAsync(ct);
        var now = ContractJson.Now(clock);
        var owner = await db.Users.FirstOrDefaultAsync(u => u.Kind == "staff" && u.NormalizedUsername == "DEMO-OWNER",ct);
        if (owner == null) {
            owner = new() { Id = Guid.NewGuid(), Username = "demo-owner", NormalizedUsername = "DEMO-OWNER", DisplayName = "Учебный владелец" };
            owner.PasswordHash = new PasswordHasher<UserAccount>().HashPassword(owner,password); db.Users.Add(owner);
        }
        var warehouse = await db.Warehouses.FirstOrDefaultAsync(w => w.Id == warehouseId,ct);
        if (warehouse == null) {
            var enterprise = Guid.Parse("eeeeeeee-0000-4000-8000-000000000011");
            db.Enterprises.Add(new() { Id = enterprise, Name = "Flagman · учебный ресторан", CreatedAt = now });
            warehouse = new() { Id = warehouseId, EnterpriseId = enterprise, TrackingStartedAt = now, DatasetKind = "demo_seeded" };
            db.Warehouses.Add(warehouse); db.Memberships.Add(new() { EnterpriseId = enterprise, UserId = owner.Id, Role = "owner" });
        }
        await db.SaveChangesAsync(ct);
        await db.Warehouses.FromSqlInterpolated($"SELECT * FROM warehouses WHERE \"Id\"={warehouseId} FOR UPDATE").SingleAsync(ct);
        if (await db.Documents.AnyAsync(d => d.WarehouseId == warehouseId && d.Kind == "demo_seed_marker",ct)) { await tx.CommitAsync(ct); return; }
        if (await db.Ingredients.AnyAsync(i => i.WarehouseId == WarehouseId.From(warehouseId),ct)) throw new InvalidOperationException("Demo warehouse contains unrecognized data; seed refuses to overwrite it.");
        var s = await Load(warehouse,now,new(owner.Id,"staff","owner"),ct);
        SaveIngredient(s,new("Томаты","g",72,300m,1000m),null);
        SaveIngredient(s,new("Сыр","g",72,100m,500m),null);
        SaveIngredient(s,new("Хлеб","pcs",72,2m,20m),null);
        await db.SaveChangesAsync(ct);
        var tomatoes=s.Ingredients.Single(i=>i.Name=="Томаты");var cheese=s.Ingredients.Single(i=>i.Name=="Сыр");var bread=s.Ingredients.Single(i=>i.Name=="Хлеб");
        SaveDish(s,new("Брускетта",true,[new(tomatoes.Id.Value,100m),new(cheese.Id.Value,50m),new(bread.Id.Value,1m)]),null);
        CreateDelivery(s,new("DEMO-001",null,"Учебные данные",[
            new(tomatoes.Id.Value,300m,now.AddHours(6),null,null),new(tomatoes.Id.Value,500m,now.AddHours(72),null,null),new(tomatoes.Id.Value,200m,now.AddHours(-1),null,null),
            new(cheese.Id.Value,150m,now.AddHours(72),null,null),new(bread.Id.Value,10m,now.AddHours(72),null,null)]),false);
        await db.SaveChangesAsync(ct);
        ConfirmDelivery(s,s.Deliveries.Single().Id.Value,new(now.AddHours(-3)));
        CreateClient(s,new("Учебный поставщик","supplier"));CreateClient(s,new("Учебная POS","pos"));
        AddDocument(s,"demo_seed_marker",new { seededAt = now, schemaVersion = "2.1.0" });
        warehouse.StateRevision++;
        await db.SaveChangesAsync(ct);await tx.CommitAsync(ct);
    }
}
