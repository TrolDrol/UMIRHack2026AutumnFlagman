using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;

namespace RestaurantManagement.Domain.Recommendations.Models;

public class HotOfferReason
{
    public IngredientId IngredientId { get; }
    public string ProductName { get; }
    public Unit Unit { get; }
    public IReadOnlyCollection<BatchId> BatchIds { get; }
    public Quantity UsableExpiringQuantity { get; } 
    public Quantity PlannedUsage { get; }
    public ExpirationDate EarliestExpiresAt { get; }

    public HotOfferReason(
        IngredientId ingredientId, 
        string productName, 
        Unit unit, 
        IReadOnlyCollection<BatchId> batchIds, 
        Quantity usableExpiringQuantity,
        Quantity plannedUsage,
        ExpirationDate earliestExpiresAt)
    {
        IngredientId = ingredientId ?? throw new ArgumentNullException(nameof(ingredientId));
        ProductName = productName;
        Unit = unit ?? throw new ArgumentNullException(nameof(unit));
        BatchIds = batchIds ?? throw new ArgumentNullException(nameof(batchIds));
        UsableExpiringQuantity = usableExpiringQuantity ?? throw new ArgumentNullException(nameof(usableExpiringQuantity));
        PlannedUsage = plannedUsage ?? throw new ArgumentNullException(nameof(plannedUsage));
        EarliestExpiresAt = earliestExpiresAt ?? throw new ArgumentNullException(nameof(earliestExpiresAt));
    }
}
