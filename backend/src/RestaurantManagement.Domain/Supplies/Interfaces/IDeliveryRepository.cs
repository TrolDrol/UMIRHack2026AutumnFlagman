using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Domain.Supplies.Interfaces;

public interface IDeliveryRepository
{
    Task SaveAsync(Delivery delivery, CancellationToken cancellationToken = default);
    Task<Delivery?> GetByIdAsync(DeliveryId id, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<Delivery>> GetByWarehouseAsync(WarehouseId warehouseId, DeliveryStatus? status = null, CancellationToken cancellationToken = default);
}
