using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Supplies.Exceptions;

namespace RestaurantManagement.Domain.Supplies.ValueObjects;

public class DeliveryId : ValueObject
{
    public Guid Value { get; }

    private DeliveryId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidDeliveryIdException("Идентификатор поставки не может быть пустым.");
        Value = value;
    }

    public static DeliveryId New() => new(Guid.NewGuid());
    public static DeliveryId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}