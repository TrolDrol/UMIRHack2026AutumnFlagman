using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Orders.Exceptions;

namespace RestaurantManagement.Domain.Orders.ValueObjects;

public class OrderItemId : ValueObject
{
    public Guid Value { get; }

    private OrderItemId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidOrderItemIdException("Идентификатор позиции заказа не может быть пустым.");
        
        Value = value;
    }

    public static OrderItemId New() => new(Guid.NewGuid());
    public static OrderItemId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
