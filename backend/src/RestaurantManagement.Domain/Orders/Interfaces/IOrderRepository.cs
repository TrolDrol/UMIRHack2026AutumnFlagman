using RestaurantManagement.Domain.Orders.Entities;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Domain.Orders.Interfaces;

public interface IOrderRepository
{
    Task SaveAsync(Order order, CancellationToken cancellationToken = default);
    Task<Order?> GetByIdAsync(OrderId id, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<Order>> GetByWarehouseAsync(WarehouseId warehouseId, CancellationToken cancellationToken = default);
}
