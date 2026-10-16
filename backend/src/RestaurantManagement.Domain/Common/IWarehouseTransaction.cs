using RestaurantManagement.Domain.Common.ValueObjects;
namespace RestaurantManagement.Domain.Common;

public interface IWarehouseTransaction
{
    Task<T> ExecuteAsync<T>(WarehouseId warehouse, Func<DateTime, Task<T>> command, CancellationToken ct);
}
