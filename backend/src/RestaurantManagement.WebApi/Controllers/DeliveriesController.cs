using Microsoft.AspNetCore.Mvc;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.Interfaces;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Supplies.Services;
using RestaurantManagement.Domain.Ingredients.ValueObjects;

namespace RestaurantManagement.WebApi.Controllers;

[ApiController]
[Route("api/v1/warehouses/{warehouseId}/deliveries")]
public class DeliveriesController : ControllerBase
{
    private readonly IDeliveryRepository _deliveries;
    private readonly DeliveryConfirmationService _confirmationService;

    public DeliveriesController(IDeliveryRepository deliveries, DeliveryConfirmationService confirmationService)
    {
        _deliveries = deliveries;
        _confirmationService = confirmationService;
    }

    [HttpPost]
    public async Task<IActionResult> Create(
        [FromRoute] Guid warehouseId,
        [FromBody] CreateDeliveryRequest request)
    {
        var expectedDate = request.ExpectedAt ?? DateTime.UtcNow.AddDays(1);
        var deliveryNote = request.Note ?? string.Empty;

        var delivery = new Delivery(
            DeliveryId.New(),
            WarehouseId.From(warehouseId),
            request.Number ?? $"INV-{Guid.NewGuid().ToString()[..8].ToUpper()}",
            DateTime.UtcNow,
            expectedDate,
            deliveryNote,
            "manual"
        );

        if (request.Items != null)
        {
            foreach (var item in request.Items)
            {
                if (item.ExplicitExpiresAt.HasValue)
                {
                    delivery.AddItem(
                        IngredientId.From(item.IngredientId),
                        item.IngredientName ?? "Неизвестный ингредиент",
                        Quantity.From(item.Quantity),
                        Unit.From(item.Unit ?? "ml"),
                        null,
                        null,
                        item.ExplicitExpiresAt.Value,
                        item.DefaultShelfLifeHours
                    );
                }
                else
                {
                    var manufacturedDate = item.ManufacturedAt ?? DateTime.UtcNow;
                    var lifeHours = item.ShelfLifeHours ?? item.DefaultShelfLifeHours;

                    delivery.AddItem(
                        IngredientId.From(item.IngredientId),
                        item.IngredientName ?? "Неизвестный ингредиент",
                        Quantity.From(item.Quantity),
                        Unit.From(item.Unit ?? "ml"),
                        manufacturedDate,
                        lifeHours,
                        null,
                        item.DefaultShelfLifeHours
                    );
                }
            }
        }

        await _deliveries.SaveAsync(delivery);
        return Ok(new { data = new { id = delivery.Id.Value, status = delivery.Status.ToString() } });
    }

    [HttpPost("{id}/confirm")]
    public async Task<IActionResult> Confirm(
        [FromRoute] Guid warehouseId,
        [FromRoute] Guid id,
        [FromBody] ConfirmDeliveryRequest request)
    {
        var delivery = await _confirmationService.ConfirmAsync(
            DeliveryId.From(id),
            WarehouseId.From(warehouseId),
            request.ReceivedAt ?? DateTime.UtcNow,
            DateTime.UtcNow,
            request.UserId ?? "system",
            CancellationToken.None
        );

        return Ok(new { data = new { id = delivery.Id.Value, status = delivery.Status.ToString() } });
    }
}

public record CreateDeliveryRequest(string? Number, DateTime? ExpectedAt, string? Note, List<CreateDeliveryItemRequest> Items);
public record CreateDeliveryItemRequest(Guid IngredientId, string? IngredientName, decimal Quantity, string? Unit, DateTime? ManufacturedAt, int? ShelfLifeHours, DateTime? ExplicitExpiresAt, int DefaultShelfLifeHours);
public record ConfirmDeliveryRequest(DateTime? ReceivedAt, string? UserId);
