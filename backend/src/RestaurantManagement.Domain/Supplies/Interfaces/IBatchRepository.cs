using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;

namespace RestaurantManagement.Domain.Supplies.Interfaces;

public interface IBatchRepository
{
    Task SaveAsync(Batch batch, CancellationToken cancellationToken = default);
    Task SaveManyAsync(IReadOnlyCollection<Batch> batches, CancellationToken cancellationToken = default);
    Task<Batch?> GetByIdAsync(BatchId id, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<Batch>> GetActiveBatchesByIngredientAsync(WarehouseId warehouseId, IngredientId ingredientId, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<Batch>> GetAllActiveBatchesAsync(WarehouseId warehouseId, CancellationToken cancellationToken = default);
    Task SaveBatchChangesAsync(CancellationToken cancellationToken = default);
}
