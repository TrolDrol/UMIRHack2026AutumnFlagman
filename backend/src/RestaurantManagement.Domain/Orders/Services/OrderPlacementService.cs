using RestaurantManagement.Domain.Menu.Interfaces;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Orders.Entities;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Orders.Exceptions;
using RestaurantManagement.Domain.Orders.Models;
using RestaurantManagement.Domain.Orders.Interfaces;
using RestaurantManagement.Domain.Supplies.Interfaces;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Supplies.Exceptions;

namespace RestaurantManagement.Domain.Orders.Services;

public class OrderPlacementService
{
    private readonly IDishRepository _dishRepository;
    private readonly IBatchRepository _batchRepository;
    private readonly IOrderRepository _orderRepository;
    private readonly RestaurantManagement.Domain.Common.IWarehouseTransaction _transaction;

    public OrderPlacementService(
        IDishRepository dishRepository,
        IBatchRepository batchRepository,
        IOrderRepository orderRepository, RestaurantManagement.Domain.Common.IWarehouseTransaction transaction)
    {
        _dishRepository = dishRepository ?? throw new ArgumentNullException(nameof(dishRepository));
        _batchRepository = batchRepository ?? throw new ArgumentNullException(nameof(batchRepository));
        _orderRepository = orderRepository ?? throw new ArgumentNullException(nameof(orderRepository));
        _transaction = transaction;
    }

    public async Task<Order> PlaceAsync(
        OrderId orderId,
        WarehouseId warehouseId,
        IReadOnlyCollection<(DishId DishId, int Portions)> lines,
        DateTime currentTime,
        CancellationToken ct = default)
        => await _transaction.ExecuteAsync(warehouseId, now => PlaceCore(orderId, warehouseId, lines, now, ct), ct);

    private async Task<Order> PlaceCore(OrderId orderId, WarehouseId warehouseId, IReadOnlyCollection<(DishId DishId, int Portions)> lines, DateTime currentTime, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(orderId);
        ArgumentNullException.ThrowIfNull(warehouseId);
        ArgumentNullException.ThrowIfNull(lines);

        if (!lines.Any())
            throw new EmptyOrderException("Невозможно оформить заказ без позиций блюд.");

        var dishCache = new Dictionary<DishId, Dish>();
        var seenDishIds = new HashSet<DishId>();

        foreach (var line in lines)
        {
            if (line.Portions <= 0 || line.Portions > 1000)
                throw new InvalidOrderQuantityException("Количество порций для блюда должно быть от 1 до 1000.");

            if (!seenDishIds.Add(line.DishId))
                throw new DuplicateDishInOrderException("Дублирование идентификаторов блюд в заказе запрещено.");
        }

        if (lines.Count > 100)
            throw new TooManyDishesInOrderException("Заказ не может содержать более 100 уникальных строк блюд.");

        var totalRequirements = new Dictionary<IngredientId, decimal>();
        var totalUnits = new Dictionary<IngredientId, Common.ValueObjects.Unit>();
        var totalNames = new Dictionary<IngredientId, string>();

        foreach (var line in lines)
        {
            var dish = await _dishRepository.GetByIdAsync(line.DishId, ct);
            if (dish == null)
                throw new DishNotFoundException($"Блюдо с ID {line.DishId} не найдено в меню.");

            if (dish.WarehouseId != warehouseId)
                throw new WarehouseMismatchException($"Блюдо '{dish.Name}' принадлежит другому предприятию.");

            if (!dish.Active)
                throw new DishInactiveException($"Блюдо '{dish.Name}' неактивно.");

            dishCache[line.DishId] = dish;

            foreach (var ingredient in dish.RecipeIngredients)
            {
                var ingId = ingredient.Requirement.IngredientId;
                var neededVolume = ingredient.Requirement.Quantity.Value * line.Portions;

                if (totalRequirements.ContainsKey(ingId))
                {
                    if (totalUnits[ingId] != ingredient.Requirement.Unit)
                        throw new UnitMeasurementConflictException("Разные единицы одного ингредиента в рецептах.");
                    totalRequirements[ingId] += neededVolume;
                }
                else
                {
                    totalRequirements[ingId] = neededVolume;
                    totalUnits[ingId] = ingredient.Requirement.Unit;
                    totalNames[ingId] = ingredient.Name;
                }
            }
        }

        var allActiveBatches = await _batchRepository.GetAllActiveBatchesAsync(warehouseId, ct);
        var availableBatches = allActiveBatches.Where(b => !b.IsExpired(currentTime)).ToList();

        foreach (var batch in availableBatches)
        {
            if (totalUnits.ContainsKey(batch.IngredientId) && totalUnits[batch.IngredientId] != batch.Unit)
                throw new UnitMeasurementConflictException($"Конфликт единиц измерения для ингредиента '{batch.IngredientName}'.");
        }

        var allocationsToRecord = new List<(Batch Batch, IngredientId IngredientId, Quantity Qty, ExpirationDate ExpiresAt)>();
        var missingReport = new Dictionary<IngredientId, Requirement>();

        foreach (var req in totalRequirements)
        {
            var ingredientId = req.Key;
            var amountToDeduct = req.Value;

            var productBatches = availableBatches
                .Where(b => b.IngredientId == ingredientId)
                .OrderBy(b => b.ExpirationDate.Value)
                .ThenBy(b => b.ReceivedAt)
                .ThenBy(b => b.Id.Value)
                .ToList();

            decimal totalAvailable = productBatches.Sum(b => b.FreeQuantity);

            if (totalAvailable < amountToDeduct)
            {
                missingReport[ingredientId] = new Requirement(
                    ingredientId, totalNames[ingredientId], totalUnits[ingredientId],
                    Quantity.From(amountToDeduct), Quantity.From(totalAvailable), Quantity.From(amountToDeduct - totalAvailable));
                continue;
            }

            var remainingToDeduct = amountToDeduct;
            foreach (var batch in productBatches)
            {
                if (remainingToDeduct <= 0) break;
                var currentAvailable = batch.FreeQuantity;

                if (currentAvailable >= remainingToDeduct)
                {
                    allocationsToRecord.Add((batch, ingredientId, Quantity.From(remainingToDeduct), batch.ExpirationDate));
                    remainingToDeduct = 0;
                }
                else
                {
                    allocationsToRecord.Add((batch, ingredientId, Quantity.From(currentAvailable), batch.ExpirationDate));
                    remainingToDeduct -= currentAvailable;
                }
            }
        }

        if (missingReport.Any())
            throw new InsufficientIngredientsException("Недостаточно ингредиентов на складе.", missingReport);

        foreach (var alloc in allocationsToRecord)
        {
            alloc.Batch.Deduct(alloc.Qty);
        }

        var order = new Order(orderId, warehouseId, currentTime);
        foreach (var line in lines)
        {
            order.AddItem(dishCache[line.DishId], line.Portions);
        }

        foreach (var alloc in allocationsToRecord)
        {
            order.RecordAllocation(alloc.Batch.Id, alloc.IngredientId, alloc.Qty, alloc.ExpiresAt);
        }

        order.ConfirmPayment();

        await _orderRepository.SaveAsync(order, ct);
        await _batchRepository.SaveBatchChangesAsync(ct);

        return order;
    }

    public async Task<OrderPreview> PreviewAsync(
        WarehouseId warehouseId,
        IReadOnlyCollection<(DishId DishId, int Portions)> lines,
        DateTime currentTime,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(warehouseId);
        ArgumentNullException.ThrowIfNull(lines);

        if (!lines.Any())
            throw new EmptyOrderException("Невозможно построить превью для пустого списка блюд.");

        var seenDishIds = new HashSet<DishId>();
        foreach (var line in lines)
        {
            if (line.Portions <= 0 || line.Portions > 1000)
                throw new InvalidOrderQuantityException("Количество порций для превью должно быть от 1 до 1000.");

            if (!seenDishIds.Add(line.DishId))
                throw new DuplicateDishInOrderException("Дублирование идентификаторов блюд в превью запроса запрещено.");
        }

        if (lines.Count > 100)
            throw new TooManyDishesInOrderException("Превью не может содержать более 100 уникальных строк блюд.");

        var totalRequirements = new Dictionary<IngredientId, decimal>();
        var totalUnits = new Dictionary<IngredientId, Common.ValueObjects.Unit>();
        var totalNames = new Dictionary<IngredientId, string>();
        var requirementsList = new List<Requirement>();

        foreach (var line in lines)
        {
            var dish = await _dishRepository.GetByIdAsync(line.DishId, ct);

            if (dish == null)
                throw new DishNotFoundException($"Блюдо с ID {line.DishId} не найдено в меню.");

            if (dish.WarehouseId != warehouseId)
                throw new WarehouseMismatchException("Блюдо принадлежит другому предприятию.");

            if (!dish.Active)
                throw new DishInactiveException($"Блюдо '{dish.Name}' неактивно.");

            foreach (var ingredient in dish.RecipeIngredients)
            {
                var ingId = ingredient.Requirement.IngredientId;
                var neededVolume = ingredient.Requirement.Quantity.Value * line.Portions;

                if (totalRequirements.ContainsKey(ingId))
                {
                    if (totalUnits[ingId] != ingredient.Requirement.Unit)
                        throw new UnitMeasurementConflictException("Разные единицы одного ингредиента в рецептах.");
                    totalRequirements[ingId] += neededVolume;
                }
                else
                {
                    totalRequirements[ingId] = neededVolume;
                    totalUnits[ingId] = ingredient.Requirement.Unit;
                    totalNames[ingId] = ingredient.Name;
                }
            }
        }
        var allActiveBatches = await _batchRepository.GetAllActiveBatchesAsync(warehouseId, ct);
        var availableBatches = allActiveBatches.Where(b => !b.IsExpired(currentTime)).ToList();
        foreach (var batch in availableBatches)
        {
            if (totalUnits.ContainsKey(batch.IngredientId) && totalUnits[batch.IngredientId] != batch.Unit)
                throw new UnitMeasurementConflictException($"Конфликт единиц измерения для ингредиента '{batch.IngredientName}'.");
        }
        var simulatedAllocations = new List<OrderAllocation>();
        bool canCreate = true;
        foreach (var req in totalRequirements)
        {
            var ingredientId = req.Key;
            var amountToDeduct = req.Value;
            var totalAvailable = availableBatches.Where(b => b.IngredientId == ingredientId).Sum(b => b.FreeQuantity);
            var missingValue = amountToDeduct > totalAvailable ? amountToDeduct - totalAvailable : 0m;
            requirementsList.Add(new Requirement(
            ingredientId,
            totalNames[ingredientId],
            totalUnits[ingredientId],
            Quantity.From(amountToDeduct),
            Quantity.From(totalAvailable),
            Quantity.From(missingValue)
            ));
            if (missingValue > 0)
            {
                canCreate = false;
            }
        }
        if (canCreate)
        {
            foreach (var req in totalRequirements)
            {
                var ingredientId = req.Key;
                var amountToDeduct = req.Value;
                var productBatches = availableBatches
                .Where(b => b.IngredientId == ingredientId)
                .OrderBy(b => b.ExpirationDate.Value)
                .ThenBy(b => b.ReceivedAt)
                .ThenBy(b => b.Id.Value)
                .ToList();
                foreach (var batch in productBatches)
                {
                    if (amountToDeduct <= 0) break;
                    var currentAvailable = batch.FreeQuantity;
                    if (currentAvailable >= amountToDeduct)
                    {
                        simulatedAllocations.Add(new OrderAllocation(OrderAllocationId.New(), batch.Id, ingredientId, Quantity.From(amountToDeduct), batch.ExpirationDate));
                        amountToDeduct = 0;
                    }
                    else
                    {
                        simulatedAllocations.Add(new OrderAllocation(OrderAllocationId.New(), batch.Id, ingredientId, Quantity.From(currentAvailable), batch.ExpirationDate));
                        amountToDeduct -= currentAvailable;
                    }
                }
            }
        }
        return new OrderPreview(canCreate, requirementsList, simulatedAllocations);
    }
}

