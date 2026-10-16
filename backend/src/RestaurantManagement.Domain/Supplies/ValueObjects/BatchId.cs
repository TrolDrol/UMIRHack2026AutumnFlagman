using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Supplies.Exceptions;

namespace RestaurantManagement.Domain.Supplies.ValueObjects;

public class BatchId : ValueObject
{
    public Guid Value { get; }

    private BatchId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidBatchIdException("Идентификатор партии не может быть пустым.");
        
        Value = value;
    }

    public static BatchId New() => new(Guid.NewGuid());
    public static BatchId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
