using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Menu.Exceptions;

namespace RestaurantManagement.Domain.Menu.ValueObjects;

public class IngredientRequirement : ValueObject
{
    public IngredientId IngredientId { get; private set; }
    public Quantity Quantity { get; private set; }
    public Unit Unit { get; private set; }

    public IngredientRequirement(IngredientId ingredientId, Quantity quantity, Unit unit)
    {
        IngredientId = ingredientId ?? throw new ArgumentNullException(nameof(ingredientId));
        Unit = unit ?? throw new ArgumentNullException(nameof(unit));
        
        if (quantity == null || quantity.Value <= 0)
            throw new InvalidIngredientRequirementException("Количество ингредиента в рецепте должно быть строго больше нуля.");

        Quantity = quantity;
    }

    #pragma warning disable CS8618
    private IngredientRequirement() { }
    #pragma warning restore CS8618

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return IngredientId;
        yield return Quantity;
        yield return Unit;
    }
}
