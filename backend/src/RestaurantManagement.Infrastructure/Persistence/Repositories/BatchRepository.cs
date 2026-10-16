using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.Interfaces;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Repositories;

public class BatchRepository : IBatchRepository
{
    private readonly AppDbContext _context;

    public BatchRepository(AppDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task<Batch?> GetByIdAsync(BatchId id, CancellationToken ct = default)
    {
        return await _context.Batches.FirstOrDefaultAsync(b => b.Id == id, ct);
    }

    public async Task<IReadOnlyCollection<Batch>> GetActiveBatchesByIngredientAsync(
        WarehouseId warehouseId, 
        IngredientId ingredientId, 
        CancellationToken ct = default)
    {
        var batches = await _context.Batches
            .Where(b => b.WarehouseId == warehouseId && b.IngredientId == ingredientId)
            .ToListAsync(ct);

        return batches.Where(b => b.RemainingQuantity.Value > 0).ToList();
    }

    public async Task<IReadOnlyCollection<Batch>> GetAllActiveBatchesAsync(
        WarehouseId warehouseId, 
        CancellationToken ct = default)
    {
        var batches = await _context.Batches
            .Where(b => b.WarehouseId == warehouseId)
            .ToListAsync(ct);

        return batches.Where(b => b.RemainingQuantity.Value > 0).ToList();
    }

    public async Task SaveAsync(Batch batch, CancellationToken ct = default)
    {
        var entry = _context.Entry(batch);
        if (entry.State == EntityState.Detached)
        {
            await _context.Batches.AddAsync(batch, ct);
        }
        await _context.SaveChangesAsync(ct);
    }

    public async Task SaveManyAsync(IReadOnlyCollection<Batch> batches, CancellationToken ct = default)
    {
        foreach (var batch in batches)
        {
            var entry = _context.Entry(batch);
            if (entry.State == EntityState.Detached)
            {
                await _context.Batches.AddAsync(batch, ct);
            }
        }
        await _context.SaveChangesAsync(ct);
    }

    public async Task SaveBatchChangesAsync(CancellationToken ct = default)
    {
        await _context.SaveChangesAsync(ct);
    }
}
