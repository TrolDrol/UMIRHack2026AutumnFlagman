using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Orders.Exceptions;

namespace RestaurantManagement.Domain.Orders.ValueObjects;

public class OrderAllocationId : ValueObject
{
    public Guid Value { get; }

    private OrderAllocationId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidOrderAllocationIdException("Идентификатор строки аудита списания не может быть пустым.");
        
        Value = value;
    }

    public static OrderAllocationId New() => new(Guid.NewGuid());
    public static OrderAllocationId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
