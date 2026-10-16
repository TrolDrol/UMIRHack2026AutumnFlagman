using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.Domain.Orders.Models;

public class Requirement
{
    public IngredientId IngredientId { get; }
    public string IngredientName { get; }
    public Unit Unit { get; }
    public Quantity RequiredQuantity { get; }
    public Quantity AvailableQuantity { get; }
    public Quantity MissingQuantity { get; }

    public Requirement(
        IngredientId ingredientId, 
        string ingredientName, 
        Unit unit, 
        Quantity requiredQuantity, 
        Quantity availableQuantity, 
        Quantity missingQuantity)
    {
        IngredientId = ingredientId ?? throw new ArgumentNullException(nameof(ingredientId));
        IngredientName = ingredientName;
        Unit = unit ?? throw new ArgumentNullException(nameof(unit));
        RequiredQuantity = requiredQuantity ?? throw new ArgumentNullException(nameof(requiredQuantity));
        AvailableQuantity = availableQuantity ?? throw new ArgumentNullException(nameof(availableQuantity));
        MissingQuantity = missingQuantity ?? throw new ArgumentNullException(nameof(missingQuantity));
    }
}
