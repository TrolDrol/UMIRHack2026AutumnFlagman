using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.Domain.Supplies.Entities;

public class DeliveryItem : Entity<DeliveryItemId>
{
    public IngredientId IngredientId { get; private set; }
    public string IngredientName { get; private set; }
    public Quantity Quantity { get; private set; }
    public Unit Unit { get; private set; }
    public int ShelfLifeHours { get; private set; }
    public DateTime? ManufacturedAt { get; private set; }
    public DateTime ExpiresAt { get; private set; }

    public DeliveryItem(
        DeliveryItemId id, 
        IngredientId ingredientId, 
        string ingredientName,
        Quantity quantity, 
        Unit unit, 
        int shelfLifeHours, 
        DateTime? manufacturedAt, 
        DateTime expiresAt) : base(id)
    {
        if (string.IsNullOrWhiteSpace(ingredientName))
            throw new ArgumentException("Название ингредиента не может быть пустым.");

        IngredientId = ingredientId ?? throw new ArgumentNullException(nameof(ingredientId));
        IngredientName = ingredientName.Trim();
        Quantity = quantity ?? throw new ArgumentNullException(nameof(quantity));
        if (quantity.Value <= 0 || shelfLifeHours is < 1 or > 87600 || expiresAt == default)
            throw new ArgumentException("Количество и срок хранения должны быть положительными и допустимыми.");
        Unit = unit ?? throw new ArgumentNullException(nameof(unit));
        ShelfLifeHours = shelfLifeHours;
        ManufacturedAt = manufacturedAt;
        ExpiresAt = expiresAt;
    }

    #pragma warning disable CS8618
    private DeliveryItem() : base() { }
    #pragma warning restore CS8618
}
