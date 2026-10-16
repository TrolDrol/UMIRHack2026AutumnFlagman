using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Menu.ValueObjects;

namespace RestaurantManagement.Domain.Ingredients.Models;

public class PurchaseSuggestion
{
    public IngredientId IngredientId { get; }
    public string IngredientName { get; }
    public Unit Unit { get; }
    public Quantity AvailableQuantity { get; }
    public Quantity ExpiringQuantity { get; }
    public Quantity PlanningQuantity { get; }
    public Quantity ReorderPoint { get; }
    public Quantity TargetStock { get; }
    public Quantity TargetQuantity { get; }
    public Quantity SuggestedQuantity { get; }
    public IReadOnlyCollection<string> Reasons { get; } 
    public IReadOnlyCollection<DishId> AffectedDishIds { get; }

    public PurchaseSuggestion(
        IngredientId ingredientId, 
        string ingredientName, 
        Unit unit, 
        Quantity availableQuantity, 
        Quantity expiringQuantity, 
        Quantity planningQuantity, 
        Quantity reorderPoint, 
        Quantity targetStock, 
        Quantity targetQuantity, 
        Quantity suggestedQuantity, 
        IReadOnlyCollection<string> reasons, 
        IReadOnlyCollection<DishId> affectedDishIds)
    {
        IngredientId = ingredientId ?? throw new ArgumentNullException(nameof(ingredientId));
        IngredientName = ingredientName;
        Unit = unit ?? throw new ArgumentNullException(nameof(unit));
        AvailableQuantity = availableQuantity ?? throw new ArgumentNullException(nameof(availableQuantity));
        ExpiringQuantity = expiringQuantity ?? throw new ArgumentNullException(nameof(expiringQuantity));
        PlanningQuantity = planningQuantity ?? throw new ArgumentNullException(nameof(planningQuantity));
        ReorderPoint = reorderPoint ?? throw new ArgumentNullException(nameof(reorderPoint));
        TargetStock = targetStock ?? throw new ArgumentNullException(nameof(targetStock));
        TargetQuantity = targetQuantity ?? throw new ArgumentNullException(nameof(targetQuantity));
        SuggestedQuantity = suggestedQuantity ?? throw new ArgumentNullException(nameof(suggestedQuantity));
        Reasons = reasons ?? throw new ArgumentNullException(nameof(reasons));
        AffectedDishIds = affectedDishIds ?? throw new ArgumentNullException(nameof(affectedDishIds));
    }
}
