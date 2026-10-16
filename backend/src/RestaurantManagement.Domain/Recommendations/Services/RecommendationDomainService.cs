using RestaurantManagement.Domain.Menu.Interfaces;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Supplies.Interfaces;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Recommendations.Models;
using RestaurantManagement.Domain.Recommendations.Exceptions;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Domain.Recommendations.Services;

public class RecommendationDomainService
{
    private readonly IDishRepository _dishRepository;
    private readonly IBatchRepository _batchRepository;

    public RecommendationDomainService(IDishRepository dishRepository, IBatchRepository batchRepository)
    {
        _dishRepository = dishRepository ?? throw new ArgumentNullException(nameof(dishRepository));
        _batchRepository = batchRepository ?? throw new ArgumentNullException(nameof(batchRepository));
    }

    public async Task<IReadOnlyCollection<HotOffer>> GetHotOffersAsync(
        WarehouseId warehouseId, 
        DateTime currentTime, 
        CancellationToken ct = default)
    {
        var allDishes = await _dishRepository.GetAllAsync(ct);
        var dishes = allDishes.Where(d => d.WarehouseId == warehouseId).ToList();
        var allActiveBatches = await _batchRepository.GetAllActiveBatchesAsync(warehouseId, ct);

        var freshBatches = allActiveBatches.Where(b => !b.IsExpired(currentTime)).ToList();
        var hotOffers = new List<HotOffer>();

        foreach (var dish in dishes.Where(d => d.Active))
        {
            if (!dish.RecipeIngredients.Any()) continue;

            long maxPortions = long.MaxValue;
            foreach (var ingredient in dish.RecipeIngredients)
            {
                var ingId = ingredient.Requirement.IngredientId;
                var totalAvailable = freshBatches.Where(b => b.IngredientId == ingId).Sum(b => b.FreeQuantity);
                var requiredPerPortion = ingredient.Requirement.Quantity.Value;

                if (requiredPerPortion == 0) continue;

                long portionsForIngredient = (long)(totalAvailable / requiredPerPortion);
                if (portionsForIngredient < maxPortions)
                {
                    maxPortions = portionsForIngredient;
                }
            }

            if (maxPortions <= 0) continue;

            decimal maxRiskNeededPortions = 0;
            var ingredientRisks = new Dictionary<IngredientId, decimal>();

            foreach (var ingredient in dish.RecipeIngredients)
            {
                var ingId = ingredient.Requirement.IngredientId;
                
                var expiringBatches = freshBatches
                    .Where(b => b.IngredientId == ingId && b.IsExpiringSoon(currentTime))
                    .ToList();

                var expiringQty = expiringBatches.Sum(b => b.FreeQuantity);
                ingredientRisks[ingId] = expiringQty;

                if (expiringQty > 0)
                {
                    decimal needed = Math.Ceiling(expiringQty / ingredient.Requirement.Quantity.Value);
                    if (needed > maxRiskNeededPortions) maxRiskNeededPortions = needed;
                }
            }

            if (ingredientRisks.Values.All(r => r == 0)) continue;

            long suggestedPortions = (long)Math.Min(maxPortions, Math.Min(20, maxRiskNeededPortions));
            if (suggestedPortions <= 0) continue;

            var batchSnapshots = freshBatches.Select(b => new { b.Id, b.IngredientId, b.ExpirationDate, b.ManufacturedAt, b.ReceivedAt, Remaining = b.FreeQuantity, BatchOriginal = b }).ToList();
            var reasons = new List<HotOfferReason>();
            double maxUrgency = 0;

            foreach (var ingredient in dish.RecipeIngredients)
            {
                var ingId = ingredient.Requirement.IngredientId;
                var totalNeededVolume = ingredient.Requirement.Quantity.Value * suggestedPortions;
                decimal usedRisk = 0;

                var productBatches = batchSnapshots
                    .Where(b => b.IngredientId == ingId)
                    .OrderBy(b => b.ExpirationDate.Value)
                    .ThenBy(b => b.ReceivedAt)
                    .ThenBy(b => b.Id.Value)
                    .ToList();

                var usedBatchIds = new List<BatchId>();
                DateTime localEarliestDate = DateTime.MaxValue;

                foreach (var batch in productBatches)
                {
                    if (totalNeededVolume <= 0) break;

                    bool isExpiring = batch.BatchOriginal.IsExpiringSoon(currentTime);
                    decimal taken = Math.Min(batch.Remaining, totalNeededVolume);

                    if (taken > 0)
                    {
                        totalNeededVolume -= taken;
                        if (isExpiring)
                        {
                            usedRisk += taken;
                            usedBatchIds.Add(batch.Id);
                            if (batch.ExpirationDate.Value < localEarliestDate)
                                localEarliestDate = batch.ExpirationDate.Value;
                        }
                    }
                }

                if (usedRisk <= 0) continue;

                double maxUrgencyForIngredient = 0;
                foreach (var batchId in usedBatchIds)
                {
                    var b = productBatches.First(x => x.Id.Value == batchId.Value);
                    double threshold = b.BatchOriginal.GetCriticalThresholdSeconds();
                    double remaining = (b.ExpirationDate.Value - currentTime).TotalSeconds;
                    
                    double u = 1.0 - (remaining / threshold);
                    if (u < 0) u = 0;
                    if (u > maxUrgencyForIngredient) maxUrgencyForIngredient = u;
                }

                if (maxUrgencyForIngredient > maxUrgency) 
                    maxUrgency = maxUrgencyForIngredient;

                reasons.Add(new HotOfferReason(
                    ingId,
                    ingredient.Name,
                    ingredient.Requirement.Unit,
                    usedBatchIds,
                    Quantity.From(ingredientRisks[ingId]),
                    Quantity.From(usedRisk),
                    ExpirationDate.From(localEarliestDate)
                ));
            }

            if (!reasons.Any()) continue;

            double totalCoverageSum = 0;
            int riskIngredientCount = 0;

            foreach (var ingredient in dish.RecipeIngredients)
            {
                var ingId = ingredient.Requirement.IngredientId;
                if (ingredientRisks[ingId] == 0) continue;
                riskIngredientCount++;

                var reason = reasons.FirstOrDefault(r => r.IngredientId == ingId);
                decimal used = reason?.PlannedUsage.Value ?? 0;
                totalCoverageSum += (double)(used / ingredientRisks[ingId]);
            }

            double averageCoverage = riskIngredientCount > 0 ? totalCoverageSum / riskIngredientCount : 0;

            double score = Math.Round(100 * maxUrgency * averageCoverage, 2, MidpointRounding.AwayFromZero);

            var reasonTexts = string.Join(", ", reasons.Select(r => 
                $"{r.ProductName} ({r.UsableExpiringQuantity} {r.Unit}, осталось меньше {Math.Ceiling((r.EarliestExpiresAt.Value - currentTime).TotalHours)} ч.)"));

            var explanation = $"Рекомендуется продвигать блюдо '{dish.Name}' (эффективность спасения склада: {Math.Round(averageCoverage * 100, 1)}%). Риск списания ингредиентов: {reasonTexts}.";

            hotOffers.Add(new HotOffer(
                dish.Id,
                dish.Name,
                score,
                maxPortions,
                suggestedPortions,
                ExpirationDate.From(reasons.Min(r => r.EarliestExpiresAt.Value)),
                reasons,
                explanation
            ));
        }

        return hotOffers
            .OrderByDescending(o => o.Score)
            .ThenBy(o => o.EarliestExpiresAt.Value)
            .ThenBy(o => o.DishId.Value)
            .ToList();
    }
}

