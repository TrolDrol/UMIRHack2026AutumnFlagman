using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Supplies.Interfaces;
using RestaurantManagement.Domain.Supplies.Exceptions;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Domain.Supplies.Services;

public class DeliveryConfirmationService
{
    private readonly IDeliveryRepository _deliveryRepository;
    private readonly IBatchRepository _batchRepository;
    private readonly RestaurantManagement.Domain.Common.IWarehouseTransaction _transaction;

    public DeliveryConfirmationService(IDeliveryRepository deliveryRepository, IBatchRepository batchRepository, RestaurantManagement.Domain.Common.IWarehouseTransaction transaction)
    {
        _deliveryRepository = deliveryRepository ?? throw new ArgumentNullException(nameof(deliveryRepository));
        _batchRepository = batchRepository ?? throw new ArgumentNullException(nameof(batchRepository));
        _transaction = transaction;
    }

    public async Task<Delivery> ConfirmAsync(
        DeliveryId deliveryId, 
        WarehouseId expectedWarehouseId,
        DateTime receivedAt, 
        DateTime asOf,
        string confirmedByUserId,
        CancellationToken ct)
        => await _transaction.ExecuteAsync(expectedWarehouseId, now => ConfirmCore(deliveryId, expectedWarehouseId, receivedAt, now, confirmedByUserId, ct), ct);

    private async Task<Delivery> ConfirmCore(DeliveryId deliveryId, WarehouseId expectedWarehouseId, DateTime receivedAt, DateTime asOf, string confirmedByUserId, CancellationToken ct)
    {
        var delivery = await _deliveryRepository.GetByIdAsync(deliveryId, ct)
            ?? throw new DeliveryNotFoundException($"Поставка {deliveryId} не найдена.");

        if (delivery.WarehouseId != expectedWarehouseId)
            throw new WarehouseMismatchException("Документ поставки принадлежит другому складу.");

        delivery.Confirm(receivedAt, asOf, confirmedByUserId);

        var batches = new List<Batch>();
        foreach (var item in delivery.Items)
        {
            var batch = new Batch(
                BatchId.New(),
                delivery.WarehouseId,
                delivery.Id,
                item.Id,
                item.IngredientId,
                item.IngredientName,
                item.Quantity,
                receivedAt,
                item.ManufacturedAt,
                item.ShelfLifeHours,
                ExpirationDate.From(item.ExpiresAt),
                item.Unit
            );
            batches.Add(batch);
        }

        await _deliveryRepository.SaveAsync(delivery, ct);
        await _batchRepository.SaveManyAsync(batches, ct);

        return delivery;
    }

    public async Task<Delivery> RejectAsync(DeliveryId deliveryId, WarehouseId expectedWarehouseId, string reason, CancellationToken ct)
        => await _transaction.ExecuteAsync(expectedWarehouseId, _ => RejectCore(deliveryId, expectedWarehouseId, reason, ct), ct);

    private async Task<Delivery> RejectCore(DeliveryId deliveryId, WarehouseId expectedWarehouseId, string reason, CancellationToken ct)
    {
        var delivery = await _deliveryRepository.GetByIdAsync(deliveryId, ct)
            ?? throw new DeliveryNotFoundException($"Поставка {deliveryId} не найдена.");

        if (delivery.WarehouseId != expectedWarehouseId)
            throw new WarehouseMismatchException("Документ поставки принадлежит другому складу.");

        delivery.Reject(reason);

        await _deliveryRepository.SaveAsync(delivery, ct);
        return delivery;
    }
}
