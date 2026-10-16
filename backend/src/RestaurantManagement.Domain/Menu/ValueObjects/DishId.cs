using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Menu.Exceptions;

namespace RestaurantManagement.Domain.Menu.ValueObjects;

public class DishId : ValueObject
{
    public Guid Value { get; }

    private DishId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidDishIdException("Идентификатор блюда не может быть пустым.");
        
        Value = value;
    }

    public static DishId New() => new(Guid.NewGuid());
    public static DishId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
