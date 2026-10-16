using Microsoft.AspNetCore.Mvc;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Orders.Services;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.WebApi.Extensions;

namespace RestaurantManagement.WebApi.Controllers;

[ApiController]
[Route("api/v1/warehouses/{warehouseId}/orders")]
public class OrdersController : ControllerBase
{
    private readonly OrderPlacementService _orderPlacementService;

    public OrdersController(OrderPlacementService orderPlacementService)
    {
        _orderPlacementService = orderPlacementService;
    }

    [HttpPost]
    public async Task<IActionResult> Place(
        [FromRoute] Guid warehouseId,
        [FromBody] PlaceOrderRequest request)
    {
        var orderLines = request.Lines
            .Select(l => (DishId: DishId.From(l.DishId), Portions: l.Portions))
            .ToList();

        var order = await _orderPlacementService.PlaceAsync(
            OrderId.New(),
            WarehouseId.From(warehouseId),
            orderLines,
            DateTime.UtcNow
        );

        return Ok(new
        {
            data = new
            {
                id = order.Id.Value,
                status = order.Status.ToString(),
                createdAt = order.CreatedAt
            }
        });
    }

    [HttpPost("preview")]
    public async Task<IActionResult> Preview(
        [FromRoute] Guid warehouseId,
        [FromBody] PlaceOrderRequest request)
    {
        var lines = request.Lines
            .Select(l => (DishId: DishId.From(l.DishId), Portions: l.Portions))
            .ToList();

        var preview = await _orderPlacementService.PreviewAsync(
            WarehouseId.From(warehouseId),
            lines,
            DateTime.UtcNow
        );

        return Ok(new
        {
            data = new
            {
                canCreate = preview.CanCreate,
                
                requirements = preview.Requirements.Select(r => new
                {
                    ingredientId = r.IngredientId.Value,
                    ingredientName = r.IngredientName,
                    unit = r.Unit.Value,
                    requiredQuantity = r.RequiredQuantity.Value.ToApiString(),
                    availableQuantity = r.AvailableQuantity.Value.ToApiString(),
                    missingQuantity = r.MissingQuantity.Value.ToApiString()
                }),
                
                allocations = preview.Allocations.Select(a => new
                {
                    batchId = a.BatchId.Value,
                    ingredientId = a.IngredientId.Value,
                    quantity = a.Quantity.Value.ToApiString(),
                    expiresAt = a.ExpiresAt.Value
                })
            }
        });
    }
}

public record PlaceOrderRequest(List<OrderLineRequest> Lines);
public record OrderLineRequest(Guid DishId, int Portions);
