using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Orders.Exceptions;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;

namespace RestaurantManagement.Domain.Orders.Entities;

public class Order : AggregateRoot<OrderId>
{
    public WarehouseId WarehouseId { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public OrderStatus Status { get; private set; }
    public string? Number { get; private set; }
    public string Source { get; private set; } = "staff";
    public Guid? CustomerId { get; private set; }
    public Guid? IntegrationClientId { get; private set; }
    public string? ExternalId { get; private set; }
    public string? SnapshotJson { get; private set; }

    public void SetSnapshot(string number, string source, Guid? customerId, Guid? clientId, string? externalId, string json)
    {
        if (SnapshotJson != null) throw new InvalidOperationException("Проведённый снимок заказа неизменяем.");
        Number = number; Source = source; CustomerId = customerId;
        IntegrationClientId = clientId; ExternalId = externalId?.Trim(); SnapshotJson = json;
    }

    private readonly List<OrderItem> _items = new();
    public IReadOnlyCollection<OrderItem> Items => _items.AsReadOnly();

    private readonly List<OrderAllocation> _allocations = new();
    public IReadOnlyCollection<OrderAllocation> Allocations => _allocations.AsReadOnly();

    public Order(OrderId id, WarehouseId warehouseId, DateTime createdAt) : base(id)
    {
        WarehouseId = warehouseId ?? throw new ArgumentNullException(nameof(warehouseId));
        if (createdAt == default)
            throw new InvalidOrderDateException("Дата создания заказа указана некорректно.");

        CreatedAt = createdAt;
        Status = OrderStatus.Created;
    }

    #pragma warning disable CS8618
    private Order() : base() { }
    #pragma warning restore CS8618

    public void AddItem(Dish dish, long quantity)
    {
        ArgumentNullException.ThrowIfNull(dish);

        if (Status != OrderStatus.Created)
            throw new InvalidOrderStatusTransitionException("Нельзя изменять позиции в уже обработанном заказе.");

        if (quantity < 1 || quantity > 1000)
            throw new InvalidOrderQuantityException("Количество порций одного блюда должно быть в диапазоне от 1 до 1000.");

        if (_items.Any(i => i.DishId == dish.Id))
            throw new DuplicateDishInOrderException($"Блюдо '{dish.Name}' уже добавлено в заказ. Дублирование позиций запрещено.");

        if (_items.Count >= 100)
            throw new TooManyDishesInOrderException("Заказ не может содержать более 100 уникальных строк блюд.");

        _items.Add(new OrderItem(OrderItemId.New(), dish.Id, dish.Name, (int)quantity));
    }

    public void RecordAllocation(BatchId batchId, IngredientId ingredientId, Quantity quantity, ExpirationDate expiresAt)
    {
        if (Status != OrderStatus.Created)
            throw new InvalidOrderStatusTransitionException("Нельзя добавлять данные аудита списаний в уже закрытый заказ.");

        var allocation = new OrderAllocation(OrderAllocationId.New(), batchId, ingredientId, quantity, expiresAt);
        _allocations.Add(allocation);
    }

    public void ConfirmPayment()
    {
        if (!_items.Any())
            throw new EmptyOrderException("Невозможно оплатить пустой заказ.");

        if (Status != OrderStatus.Created)
            throw new InvalidOrderStatusTransitionException("Заказ может быть оплачен только из статуса Created.");

        Status = OrderStatus.Paid;
    }

    public void Cancel()
    {
        if (Status == OrderStatus.Paid)
            throw new InvalidOrderStatusTransitionException("Нельзя отменить уже оплаченный и выполненный заказ.");

        if (Status == OrderStatus.Cancelled)
            throw new InvalidOrderStatusTransitionException("Заказ уже отменен.");

        Status = OrderStatus.Cancelled;
    }
}
