using RestaurantManagement.Domain.Ingredients.Interfaces;
using RestaurantManagement.Domain.Ingredients.Models;
using RestaurantManagement.Domain.Menu.Interfaces;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Supplies.Interfaces;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Domain.Ingredients.Services;

public class PurchaseSuggestionService
{
    private readonly IIngredientRepository _ingredientRepository;
    private readonly IBatchRepository _batchRepository;
    private readonly IDishRepository _dishRepository;

    public PurchaseSuggestionService(
        IIngredientRepository ingredientRepository, 
        IBatchRepository batchRepository, 
        IDishRepository dishRepository)
    {
        _ingredientRepository = ingredientRepository ?? throw new ArgumentNullException(nameof(ingredientRepository));
        _batchRepository = batchRepository ?? throw new ArgumentNullException(nameof(batchRepository));
        _dishRepository = dishRepository ?? throw new ArgumentNullException(nameof(dishRepository));
    }

    public async Task<IReadOnlyCollection<PurchaseSuggestion>> GetPurchaseSuggestionsAsync(WarehouseId warehouseId, DateTime currentTime, CancellationToken ct = default)
    {
        var allIngredients = await _ingredientRepository.GetAllAsync(ct);
        var ingredients = allIngredients.Where(i => i.WarehouseId == warehouseId).ToList();
        
        var freshBatches = (await _batchRepository.GetAllActiveBatchesAsync(warehouseId, ct))
            .Where(b => !b.IsExpired(currentTime)).ToList();
            
        var allDishes = await _dishRepository.GetAllAsync(ct);
        var dishes = allDishes.Where(d => d.WarehouseId == warehouseId).ToList();

        var suggestions = new List<PurchaseSuggestion>();

        foreach (var ingredient in ingredients)
        {
            var ingId = ingredient.Id;

            var availableQty = freshBatches.Where(b => b.IngredientId == ingId).Sum(b => b.FreeQuantity);
            var expiringQty = freshBatches.Where(b => b.IngredientId == ingId && b.IsExpiringSoon(currentTime)).Sum(b => b.FreeQuantity);
            
            var planningQty = availableQty - expiringQty;

            decimal recipeMinimum = 0;
            var affectedDishIds = new List<DishId>(); 

            var activeDishesWithIngredient = dishes.Where(d => d.Active && d.RecipeIngredients.Any(i => i.Requirement.IngredientId == ingId)).ToList();

            foreach (var dish in activeDishesWithIngredient)
            {
                var requirement = dish.RecipeIngredients.First(i => i.Requirement.IngredientId == ingId).Requirement.Quantity.Value;
                if (requirement > recipeMinimum)
                {
                    recipeMinimum = requirement;
                }

                if (availableQty < requirement)
                {
                    affectedDishIds.Add(dish.Id); 
                }
            }

            var reasons = new List<string>();
            if (availableQty < ingredient.ReorderPoint.Value)
                reasons.Add("below_minimum");

            if (expiringQty > 0 && planningQty < ingredient.ReorderPoint.Value)
                reasons.Add("expiring_stock");

            if (affectedDishIds.Any())
                reasons.Add("stopped_dish");

            if (!reasons.Any()) continue;

            var targetQuantityValue = Math.Max(ingredient.TargetStock.Value, recipeMinimum);
            var suggestedQuantityValue = Math.Max(0, targetQuantityValue - planningQty);

            if (suggestedQuantityValue <= 0) continue;

            suggestions.Add(new PurchaseSuggestion(
                ingId,
                ingredient.Name,
                ingredient.Unit,
                Quantity.From(availableQty),
                Quantity.From(expiringQty),
                Quantity.From(planningQty),
                ingredient.ReorderPoint,
                ingredient.TargetStock,
                Quantity.From(targetQuantityValue),
                Quantity.From(suggestedQuantityValue),
                reasons,
                affectedDishIds
            ));
        }

        return suggestions;
    }
}
