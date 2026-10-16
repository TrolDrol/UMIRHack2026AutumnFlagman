using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Orders.Exceptions;

namespace RestaurantManagement.Domain.Orders.Entities;

public class OrderItem : Entity<OrderItemId>
{
    public DishId DishId { get; private set; }
    public string DishName { get; private set; }
    public int Quantity { get; private set; }

    public OrderItem(OrderItemId id, DishId dishId, string dishName, int quantity) : base(id)
    {
        if (string.IsNullOrWhiteSpace(dishName))
            throw new InvalidOrderItemNameException("Название блюда не может быть пустым.");

        if (quantity <= 0)
            throw new InvalidOrderQuantityException("Количество блюд в заказе должно быть больше нуля.");

        DishId = dishId ?? throw new ArgumentNullException(nameof(dishId));
        DishName = dishName;
        Quantity = quantity;
    }

    #pragma warning disable CS8618
    private OrderItem() : base() { }
    #pragma warning restore CS8618

    public void IncreaseQuantity(int amount)
    {
        if (amount <= 0)
            throw new InvalidOrderQuantityException("Количество для добавления должно быть больше нуля.");

        Quantity += amount;
    }
}
