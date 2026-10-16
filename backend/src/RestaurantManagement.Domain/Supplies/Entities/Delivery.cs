using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Supplies.Exceptions;

namespace RestaurantManagement.Domain.Supplies.Entities;

public class Delivery : AggregateRoot<DeliveryId>
{
    public WarehouseId WarehouseId { get; private set; }
    public string Number { get; private set; }
    public DeliveryStatus Status { get; private set; }
    public DateTime CreatedAt { get; private set; }
    public DateTime? ExpectedAt { get; private set; }
    public DateTime? ReceivedAt { get; private set; }
    public string? Note { get; private set; }
    public string? RejectionReason { get; private set; }
    public string Source { get; private set; }
    public string? ExternalId { get; private set; }
    public string? ConfirmedByUserId { get; private set; }
    public Guid? IntegrationClientId { get; private set; }
    public Guid? PurchaseRequestId { get; private set; }
    public DateTime? RejectedAt { get; private set; }
    public void SetIntegration(Guid clientId, Guid? requestId) { IntegrationClientId = clientId; PurchaseRequestId = requestId; }
    public void MarkRejected(DateTime now) => RejectedAt = now;

    private readonly List<DeliveryItem> _items = new();
    public IReadOnlyCollection<DeliveryItem> Items => _items.AsReadOnly();

    public Delivery(
        DeliveryId id, 
        WarehouseId warehouseId, 
        string number, 
        DateTime createdAt, 
        DateTime? expectedAt, 
        string? note, 
        string source,
        string? externalId = null) : base(id)
    {
        if (string.IsNullOrWhiteSpace(number))
            throw new InvalidDeliveryNumberException("Номер поставки не может быть пустым.");

        if (createdAt == default)
            throw new InvalidDeliveryDateException("Дата создания записи должна быть корректной.");

        WarehouseId = warehouseId ?? throw new ArgumentNullException(nameof(warehouseId));
        Number = number.Trim();
        CreatedAt = createdAt;
        ExpectedAt = expectedAt;
        Note = note;
        Source = string.IsNullOrWhiteSpace(source) ? "manual" : source;
        ExternalId = externalId?.Trim();
        Status = DeliveryStatus.Pending;
    }

    #pragma warning disable CS8618
    private Delivery() : base() { }
    #pragma warning restore CS8618

    public void AddItem(
        IngredientId ingredientId, 
        string ingredientName, 
        Quantity quantity, 
        Unit unit, 
        DateTime? manufacturedAt, 
        int? shelfLifeHours, 
        DateTime? explicitExpiresAt, 
        int defaultShelfLifeHours)
    {
        ArgumentNullException.ThrowIfNull(ingredientId);
        ArgumentNullException.ThrowIfNull(quantity);
        ArgumentNullException.ThrowIfNull(unit);

        if (Status != DeliveryStatus.Pending)
            throw new InvalidDeliveryStateException("Нельзя добавлять позиции в закрытый документ поставки.");

        if (_items.Count >= 100 || quantity.Value <= 0 || defaultShelfLifeHours is < 1 or > 87600 || shelfLifeHours is < 1 or > 87600)
            throw new ArgumentException("Недопустимое количество, срок хранения или число строк поставки.");

        DateTime finalExpiration;
        int finalShelfLifeHours = shelfLifeHours ?? defaultShelfLifeHours;

        if (explicitExpiresAt.HasValue)
        {
            if (manufacturedAt.HasValue || shelfLifeHours.HasValue)
                throw new InvalidExpirationDateException("При явном указании срока годности дата изготовления и срок в часах должны отсутствовать.");
            
            finalExpiration = explicitExpiresAt.Value;
        }
        else
        {
            if (!manufacturedAt.HasValue)
                throw new InvalidExpirationDateException("Необходимо указать либо явный срок годности, либо дату изготовления совместно со сроком в часах.");

            finalExpiration = manufacturedAt.Value.AddHours(finalShelfLifeHours);
        }

        var item = new DeliveryItem(
            DeliveryItemId.New(),
            ingredientId,
            ingredientName,
            quantity,
            unit,
            finalShelfLifeHours,
            manufacturedAt,
            finalExpiration
        );

        _items.Add(item);
    }

    public void Confirm(DateTime receivedAt, DateTime asOf, string confirmedByUserId)
    {
        if (Status != DeliveryStatus.Pending)
            throw new InvalidDeliveryStateException("Подтвердить можно только pending-поставку.");
        
        if (receivedAt > asOf)
            throw new InvalidDeliveryConfirmationException("Фактическая приёмка не может быть в будущем.");
        if (receivedAt == default || _items.Count == 0)
            throw new InvalidDeliveryConfirmationException("Нельзя подтвердить пустую поставку или неизвестную дату приёмки.");

        if (string.IsNullOrWhiteSpace(confirmedByUserId))
            throw new ArgumentException("Идентификатор пользователя, подтвердившего приёмку, не может быть пустым.");
        
        foreach (var item in _items)
        {
            if (item.ManufacturedAt.HasValue && item.ManufacturedAt.Value > receivedAt)
                throw new InvalidDeliveryConfirmationException($"Изготовление ингредиента '{item.IngredientName}' не может быть позже приёмки.");
            
            if (item.ExpiresAt <= receivedAt)
                throw new InvalidDeliveryConfirmationException($"Срок годности ингредиента '{item.IngredientName}' должен быть строго после даты фактической приёмки.");
        }
        
        Status = DeliveryStatus.Confirmed;
        ReceivedAt = receivedAt;
        ConfirmedByUserId = confirmedByUserId;
    }

    public void Reject(string reason)
    {
        if (Status != DeliveryStatus.Pending)
            throw new InvalidDeliveryStateException("Отклонить можно только pending-поставку.");

        if (string.IsNullOrWhiteSpace(reason))
            throw new ArgumentException("Причина отклонения поставки должна быть заполнена.");
        
        Status = DeliveryStatus.Rejected;
        RejectionReason = reason.Trim();
    }
}
