using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.ValueObjects;

namespace RestaurantManagement.Domain.Menu.Interfaces;

public interface IDishRepository
{
    Task SaveAsync(Dish dish, CancellationToken cancellationToken = default);

    Task<Dish?> GetByIdAsync(DishId id, CancellationToken cancellationToken = default);

    Task<IReadOnlyCollection<Dish>> GetAllAsync(CancellationToken cancellationToken = default);
}
