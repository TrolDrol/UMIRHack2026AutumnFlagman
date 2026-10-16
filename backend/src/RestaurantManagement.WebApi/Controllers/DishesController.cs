using Microsoft.AspNetCore.Mvc;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.Interfaces;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.WebApi.Controllers;

[ApiController]
[Route("api/v1/warehouses/{warehouseId}/dishes")]
public class DishesController : ControllerBase
{
    private readonly IDishRepository _dishes;

    public DishesController(IDishRepository dishes)
    {
        _dishes = dishes;
    }

    [HttpPost]
    public async Task<IActionResult> Create(
        [FromRoute] Guid warehouseId,
        [FromBody] CreateDishRequest request)
    {
        var recipeItems = request.Recipe.Select(r => new RecipeIngredient(
            RecipeIngredientId.New(),
            r.Name,
            new IngredientRequirement(
                IngredientId.From(r.IngredientId),
                Quantity.From(r.Quantity),
                Unit.From(r.Unit)
            )
        )).ToList();

        var dish = new Dish(DishId.New(), WarehouseId.From(warehouseId), request.Name, recipeItems);

        await _dishes.SaveAsync(dish);

        return Ok(new { data = new { id = dish.Id.Value } });
    }
}

public record CreateDishRequest(string Name, List<CreateRecipeItemRequest> Recipe);
public record CreateRecipeItemRequest(Guid IngredientId, string Name, decimal Quantity, string Unit);
