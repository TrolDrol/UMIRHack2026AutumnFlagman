using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Menu.Exceptions;

namespace RestaurantManagement.Domain.Menu.ValueObjects;

public class RecipeIngredientId : ValueObject
{
    public Guid Value { get; }

    private RecipeIngredientId(Guid value)
    {
        if (value == Guid.Empty)
            throw new InvalidRecipeIngredientIdException("Идентификатор позиции рецепта не может быть пустым.");
        
        Value = value;
    }

    public static RecipeIngredientId New() => new(Guid.NewGuid());
    public static RecipeIngredientId From(Guid value) => new(value);

    public override string ToString() => Value.ToString();

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
