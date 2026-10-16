using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;

namespace RestaurantManagement.Domain.Orders.Entities;

public class OrderAllocation : Entity<OrderAllocationId>
{
    public BatchId BatchId { get; private set; }
    public IngredientId IngredientId { get; private set; }
    public Quantity Quantity { get; private set; }
    public ExpirationDate ExpiresAt { get; private set; }

    public OrderAllocation(OrderAllocationId id, BatchId batchId, IngredientId ingredientId, Quantity quantity, ExpirationDate expiresAt) 
        : base(id)
    {
        BatchId = batchId ?? throw new ArgumentNullException(nameof(batchId));
        IngredientId = ingredientId ?? throw new ArgumentNullException(nameof(ingredientId));
        Quantity = quantity ?? throw new ArgumentNullException(nameof(quantity));
        ExpiresAt = expiresAt ?? throw new ArgumentNullException(nameof(expiresAt));
    }

    #pragma warning disable CS8618
    private OrderAllocation() : base() { }
    #pragma warning restore CS8618
}
