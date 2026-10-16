using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Orders.Exceptions;

namespace RestaurantManagement.Domain.Orders.ValueObjects;

public class OrderId : ValueObject
{
    public Guid Value { get; }

    private OrderId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidOrderIdException("Идентификатор заказа не может быть пустым.");
        
        Value = value;
    }

    public static OrderId New() => new(Guid.NewGuid());
    public static OrderId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
