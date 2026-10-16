using System.Data;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Common;
using RestaurantManagement.Domain.Common.ValueObjects;
namespace RestaurantManagement.Infrastructure.Persistence;

// Legacy domain entry points share the same PostgreSQL warehouse lock as the v2 facade.
public sealed class WarehouseTransaction(AppDbContext db, TimeProvider clock) : IWarehouseTransaction
{
    public async Task<T> ExecuteAsync<T>(WarehouseId warehouse, Func<DateTime, Task<T>> command, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction != null) throw new InvalidOperationException("Nested warehouse writer is not permitted.");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        try {
            await db.Database.ExecuteSqlRawAsync("SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '5s'", ct);
            await db.Warehouses.FromSqlInterpolated($"SELECT * FROM warehouses WHERE \"Id\" = {warehouse.Value} FOR UPDATE").SingleAsync(ct);
            db.ChangeTracker.Clear();
            var result = await command(clock.GetUtcNow().UtcDateTime);
            await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return result;
        } catch { await tx.RollbackAsync(CancellationToken.None); db.ChangeTracker.Clear(); throw; }
    }
}
