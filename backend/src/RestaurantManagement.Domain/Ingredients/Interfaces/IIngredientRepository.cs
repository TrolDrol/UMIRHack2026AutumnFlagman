using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Ingredients.ValueObjects;

namespace RestaurantManagement.Domain.Ingredients.Interfaces;

public interface IIngredientRepository
{
    Task SaveAsync(Ingredient ingredient, CancellationToken cancellationToken = default);
    Task<Ingredient?> GetByIdAsync(IngredientId id, CancellationToken cancellationToken = default);
    Task<IReadOnlyCollection<Ingredient>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<bool> ExistsByNameAsync(string name, CancellationToken cancellationToken = default);
}
