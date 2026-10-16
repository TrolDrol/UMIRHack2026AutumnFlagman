using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Ingredients.Exceptions;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.Domain.Ingredients.Entities;

public class Ingredient : AggregateRoot<IngredientId>
{
    public WarehouseId WarehouseId { get; private set; }
    public string Name { get; private set; }
    public Unit Unit { get; private set; }
    public int DefaultShelfLifeHours { get; private set; }
    public Quantity ReorderPoint { get; private set; }
    public Quantity TargetStock { get; private set; }

    public Ingredient(
        IngredientId id, 
        WarehouseId warehouseId,
        string name, 
        Unit unit, 
        int defaultShelfLifeHours, 
        Quantity reorderPoint, 
        Quantity targetStock) : base(id)
    {
        WarehouseId = warehouseId ?? throw new ArgumentNullException(nameof(warehouseId));
        Unit = unit ?? throw new ArgumentNullException(nameof(unit));
        Validate(name, defaultShelfLifeHours, reorderPoint, targetStock);

        Name = name.Trim();
        DefaultShelfLifeHours = defaultShelfLifeHours;
        ReorderPoint = reorderPoint;
        TargetStock = targetStock;
    }

    #pragma warning disable CS8618
    private Ingredient() : base() { }
    #pragma warning restore CS8618

    public void UpdateProperties(string name, int defaultShelfLifeHours, Quantity reorderPoint, Quantity targetStock)
    {
        Validate(name, defaultShelfLifeHours, reorderPoint, targetStock);

        Name = name.Trim();
        DefaultShelfLifeHours = defaultShelfLifeHours;
        ReorderPoint = reorderPoint;
        TargetStock = targetStock;
    }

    private void Validate(string name, int defaultShelfLifeHours, Quantity reorderPoint, Quantity targetStock)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Trim().Length > 120)
            throw new InvalidIngredientNameException("Название ингредиента не может быть пустым.");

        if (defaultShelfLifeHours < 1 || defaultShelfLifeHours > 87600)
            throw new InvalidIngredientShelfLifeException("Срок хранения по умолчанию должен быть в диапазоне от 1 до 87600 часов.");

        ArgumentNullException.ThrowIfNull(reorderPoint);
        ArgumentNullException.ThrowIfNull(targetStock);

        if (targetStock.Value < reorderPoint.Value)
            throw new InvalidIngredientStockException("Целевой остаток (TargetStock) не может быть меньше порога заказа (ReorderPoint).");
    }
}
