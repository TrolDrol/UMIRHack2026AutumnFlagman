using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Seed;

public static class DatabaseSeeder
{
    public static async Task SeedAsync(AppDbContext context)
    {
        if (await context.Ingredients.AnyAsync()) return;

        var warehouseId = WarehouseId.From(Guid.Parse("3fa85f64-5717-4562-b3fc-2c963f66afa6"));

        var milk = new Ingredient(
            IngredientId.New(), warehouseId, "Молоко",
            Unit.Milliliters(), 72,
            Quantity.From(500), Quantity.From(2000));

        var coffee = new Ingredient(
            IngredientId.New(), warehouseId, "Кофе",
            Unit.Grams(), 720,
            Quantity.From(200), Quantity.From(1000));

        await context.Ingredients.AddRangeAsync(milk, coffee);
        await context.SaveChangesAsync();

        var recipe = new List<RecipeIngredient>
        {
            new RecipeIngredient(
                RecipeIngredientId.New(),
                "Молоко",
                new IngredientRequirement(milk.Id, Quantity.From(200), Unit.Milliliters())),
            new RecipeIngredient(
                RecipeIngredientId.New(),
                "Кофе",
                new IngredientRequirement(coffee.Id, Quantity.From(10), Unit.Grams()))
        };

        var cappuccino = new Dish(DishId.New(), warehouseId, "Капучино", recipe);
        await context.Dishes.AddAsync(cappuccino);
        await context.SaveChangesAsync();
    }
}
