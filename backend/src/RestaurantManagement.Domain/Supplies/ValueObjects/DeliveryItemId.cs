using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Supplies.Exceptions;

namespace RestaurantManagement.Domain.Supplies.ValueObjects;

public class DeliveryItemId : ValueObject
{
    public Guid Value { get; }

    private DeliveryItemId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidDeliveryItemIdException("Идентификатор позиции поставки не может быть пустым.");
        Value = value;
    }

    public static DeliveryItemId New() => new(Guid.NewGuid());
    public static DeliveryItemId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}