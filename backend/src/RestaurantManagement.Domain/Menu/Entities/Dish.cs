using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Menu.Exceptions;

namespace RestaurantManagement.Domain.Menu.Entities;

public class Dish : AggregateRoot<DishId>
{
    public WarehouseId WarehouseId { get; private set; }
    public string Name { get; private set; }
    public bool Active { get; private set; }
    public DateTime? CreatedAt { get; private set; }
    public DateTime? UpdatedAt { get; private set; }

    public void Replace(string name, bool active, IReadOnlyCollection<RecipeIngredient> recipe, DateTime now)
    {
        _ = new Dish(Id, WarehouseId, name, recipe);
        Name = name.Trim();
        Active = active;
        CreatedAt ??= now;
        UpdatedAt = now;
        _recipeIngredients.Clear();
        _recipeIngredients.AddRange(recipe);
    }

    private readonly List<RecipeIngredient> _recipeIngredients = new();
    public IReadOnlyCollection<RecipeIngredient> RecipeIngredients => _recipeIngredients.AsReadOnly();

    public Dish(DishId id, WarehouseId warehouseId, string name, IReadOnlyCollection<RecipeIngredient> initialRecipe) : base(id)
    {
        WarehouseId = warehouseId ?? throw new ArgumentNullException(nameof(warehouseId));
        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidDishNameException("Название блюда не может быть пустым.");

        if (initialRecipe == null || !initialRecipe.Any())
            throw new ArgumentException("Рецепт блюда не может быть пустым. Необходим минимум 1 ингредиент.");

        if (name.Trim().Length > 120 || initialRecipe.Count > 50)
            throw new ArgumentException("Название: до 120 символов; рецепт: до 50 строк.");
        if (initialRecipe.Any(r => r.Requirement.Quantity.Value <= 0))
            throw new ArgumentException("Расход ингредиента должен быть положительным.");
        if (initialRecipe.Select(r => r.Requirement.IngredientId).Distinct().Count() != initialRecipe.Count)
            throw new DuplicateRecipeIngredientException("Повтор ингредиента в рецепте запрещён.");

        Name = name.Trim();
        Active = true;
        _recipeIngredients.AddRange(initialRecipe);
    }

    #pragma warning disable CS8618
    private Dish() : base() { }
    #pragma warning restore CS8618

    public void Activate() => Active = true;
    public void Deactivate() => Active = false;

    public void AddIngredient(string name, IngredientRequirement requirement)
    {
        ArgumentNullException.ThrowIfNull(requirement);
        if (requirement.Quantity.Value <= 0)
            throw new ArgumentException("Расход ингредиента должен быть положительным.");

        if (string.IsNullOrWhiteSpace(name))
            throw new InvalidRecipeIngredientNameException("Название ингредиента не может быть пустым.");

        if (_recipeIngredients.Any(i => i.Requirement.IngredientId == requirement.IngredientId))
            throw new DuplicateRecipeIngredientException($"Ингредиент с ID {requirement.IngredientId} уже добавлен в рецепт.");

        if (_recipeIngredients.Count >= 50)
            throw new TooManyRecipeIngredientsException("Рецепт блюда не может содержать более 50 ингредиентов.");

        var recipeIngredient = new RecipeIngredient(RecipeIngredientId.New(), name, requirement);
        _recipeIngredients.Add(recipeIngredient);
    }

    public void UpdateIngredientRequirement(RecipeIngredientId ingredientId, IngredientRequirement newRequirement)
    {
        ArgumentNullException.ThrowIfNull(ingredientId);
        ArgumentNullException.ThrowIfNull(newRequirement);
        if (newRequirement.Quantity.Value <= 0)
            throw new ArgumentException("Расход ингредиента должен быть положительным.");

        var ingredient = _recipeIngredients.FirstOrDefault(i => i.Id == ingredientId);

        if (ingredient == null)
            throw new RecipeIngredientNotFoundException($"Позиция рецепта с ID {ingredientId} не найдена в блюде '{Name}'.");

        ingredient.UpdateRequirement(newRequirement);
    }
}
