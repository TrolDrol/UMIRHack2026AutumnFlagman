using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Menu.Exceptions;

namespace RestaurantManagement.Domain.Menu.Entities;

public class RecipeIngredient : Entity<RecipeIngredientId>
{
    public string Name { get; private set; }
    public IngredientRequirement Requirement { get; private set; }

    public RecipeIngredient(RecipeIngredientId id, string name, IngredientRequirement requirement) : base(id)
    {
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidRecipeIngredientNameException("Название ингредиента не может быть пустым.");

        Name = name;
        Requirement = requirement ?? throw new ArgumentNullException(nameof(requirement));
    }

    #pragma warning disable CS8618
    private RecipeIngredient() : base() { }
    #pragma warning restore CS8618

    public void UpdateRequirement(IngredientRequirement newRequirement)
    {
        ArgumentNullException.ThrowIfNull(newRequirement);

        if (newRequirement.IngredientId != Requirement.IngredientId)
            throw new CannotChangeIngredientProductException("Нельзя изменить привязанный продукт у существующего ингредиента. Удалите ингредиент и добавьте заново.");

        Requirement = newRequirement;
    }
}
