using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Ingredients.Exceptions;

namespace RestaurantManagement.Domain.Ingredients.ValueObjects;

public class IngredientId : ValueObject
{
    public Guid Value { get; }

    private IngredientId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidIngredientIdException("Идентификатор ингредиента не может быть пустым.");
        
        Value = value;
    }

    public static IngredientId New() => new(Guid.NewGuid());
    public static IngredientId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
