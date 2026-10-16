using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.Exceptions;

namespace RestaurantManagement.Domain.Common.ValueObjects;

public class WarehouseId : ValueObject
{
    public Guid Value { get; }

    private WarehouseId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidWarehouseIdException("Идентификатор склада не может быть пустым.");
        Value = value;
    }

    public static WarehouseId New() => new(Guid.NewGuid());
    public static WarehouseId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
