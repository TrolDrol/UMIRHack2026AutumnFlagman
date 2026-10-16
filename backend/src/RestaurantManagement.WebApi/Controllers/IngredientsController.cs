using Microsoft.AspNetCore.Mvc;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Ingredients.Interfaces;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.WebApi.Extensions;

namespace RestaurantManagement.WebApi.Controllers;

[ApiController]
[Route("api/v1/warehouses/{warehouseId}/ingredients")]
public class IngredientsController : ControllerBase
{
    private readonly IIngredientRepository _ingredients;

    public IngredientsController(IIngredientRepository ingredients)
    {
        _ingredients = ingredients;
    }

    [HttpGet]
    public async Task<IResult> GetAll([FromRoute] Guid warehouseId, CancellationToken ct)
    {
        var all = await _ingredients.GetAllAsync(ct);
        var warehouseIngredients = all.Where(i => i.WarehouseId.Value == warehouseId).ToList();

        return Results.Ok(new
        {
            data = warehouseIngredients.Select(i => new
            {
                id = i.Id.Value,
                warehouseId = i.WarehouseId.Value,
                name = i.Name,
                unit = i.Unit.Value,
                defaultShelfLifeHours = i.DefaultShelfLifeHours,
                reorderPoint = i.ReorderPoint.Value.ToApiString(),
                targetStock = i.TargetStock.Value.ToApiString()
            }),
            meta = new { serverTime = DateTime.UtcNow, requestId = Guid.NewGuid() }
        });
    }

    [HttpPost]
    public async Task<IResult> Create(
        [FromRoute] Guid warehouseId,
        [FromBody] CreateIngredientRequest request,
        CancellationToken ct)
    {
        var ingredient = new Ingredient(
            IngredientId.New(),
            WarehouseId.From(warehouseId),
            request.Name,
            Unit.From(request.Unit),
            request.DefaultShelfLifeHours,
            Quantity.From(request.ReorderPoint),
            Quantity.From(request.TargetStock)
        );

        await _ingredients.SaveAsync(ingredient, ct);

        return Results.Ok(new { data = new { id = ingredient.Id.Value } });
    }
}

public record CreateIngredientRequest(
    string Name,
    string Unit,
    int DefaultShelfLifeHours,
    decimal ReorderPoint,
    decimal TargetStock
);
