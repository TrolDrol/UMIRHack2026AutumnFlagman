using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.Domain.Supplies.Entities;

public class Batch : Entity<BatchId>
{
    public WarehouseId WarehouseId { get; private set; }
    public DeliveryId DeliveryId { get; private set; }
    public DeliveryItemId SourceItemId { get; private set; }
    public IngredientId IngredientId { get; private set; }
    public string IngredientName { get; private set; }
    public ExpirationDate ExpirationDate { get; private set; }
    public Unit Unit { get; private set; }
    
    public DateTime ReceivedAt { get; private set; }
    public DateTime? ManufacturedAt { get; private set; }
    public int ShelfLifeHours { get; private set; } 

    public Quantity InitialQuantity { get; private set; }
    public Quantity RemainingQuantity { get; private set; }
    public decimal HeldQuantity { get; private set; }
    public long Version { get; private set; } = 1;
    public DateTime? ReceiptCommittedAt { get; private set; }

    public void MarkReceipt(DateTime now)
    {
        if (ReceiptCommittedAt != null) throw new InvalidOperationException("Момент прихода неизменяем.");
        ReceiptCommittedAt = now;
    }
    public decimal FreeQuantity => RemainingQuantity.Value - HeldQuantity;
    public void Hold(decimal amount)
    {
        if (amount <= 0 || amount > FreeQuantity) throw new ArgumentException("Недостаточно свободного остатка.");
        HeldQuantity += amount;
        Version++;
    }
    public void Release(decimal amount)
    {
        if (amount <= 0 || amount > HeldQuantity) throw new ArgumentException("Недостаточно удержанного остатка.");
        HeldQuantity -= amount;
        Version++;
    }
    public void WriteOffHeld(decimal amount)
    {
        if (amount <= 0 || amount > HeldQuantity) throw new ArgumentException("Недостаточно удержанного остатка.");
        HeldQuantity -= amount;
        RemainingQuantity = RemainingQuantity.Subtract(Quantity.From(amount));
        Version++;
    }

    public Batch(
        BatchId id, 
        WarehouseId warehouseId,
        DeliveryId deliveryId,
        DeliveryItemId sourceItemId,
        IngredientId ingredientId, 
        string ingredientName, 
        Quantity quantity, 
        DateTime receivedAt,
        DateTime? manufacturedAt,
        int shelfLifeHours,
        ExpirationDate expirationDate, 
        Unit unit) 
        : base(id)
    {
        if (string.IsNullOrWhiteSpace(ingredientName))
            throw new ArgumentException("Название ингредиента не может быть пустым.");

        WarehouseId = warehouseId ?? throw new ArgumentNullException(nameof(warehouseId));
        DeliveryId = deliveryId ?? throw new ArgumentNullException(nameof(deliveryId));
        SourceItemId = sourceItemId ?? throw new ArgumentNullException(nameof(sourceItemId));
        IngredientId = ingredientId ?? throw new ArgumentNullException(nameof(ingredientId));
        
        IngredientName = ingredientName;
        ReceivedAt = receivedAt;
        ManufacturedAt = manufacturedAt;
        ShelfLifeHours = shelfLifeHours;
        ExpirationDate = expirationDate ?? throw new ArgumentNullException(nameof(expirationDate));
        Unit = unit ?? throw new ArgumentNullException(nameof(unit));

        InitialQuantity = quantity ?? throw new ArgumentNullException(nameof(quantity));
        if (quantity.Value <= 0 || shelfLifeHours is < 1 or > 87600)
            throw new ArgumentException("Недопустимые количество или срок хранения партии.");
        RemainingQuantity = quantity;
    }

    #pragma warning disable CS8618
    private Batch() : base() { }
    #pragma warning restore CS8618

    public double GetCriticalThresholdSeconds() => ShelfLifeHours * 3600 * 0.1;

    public void Deduct(Quantity amount)
    {
        ArgumentNullException.ThrowIfNull(amount);
        if (amount.Value <= 0 || amount.Value > FreeQuantity)
            throw new ArgumentException("Расход должен быть положительным и не превышать свободный остаток.");
        RemainingQuantity = RemainingQuantity.Subtract(amount);
        Version++;
    }

    public bool IsExpired(DateTime currentDate) => ExpirationDate.IsExpired(currentDate);
    
    public bool IsExpiringSoon(DateTime currentDate)
    {
        return ExpirationDate.IsExpiringSoon(currentDate, GetCriticalThresholdSeconds());
    }

    public bool IsEmpty => RemainingQuantity.Value == 0;
}
