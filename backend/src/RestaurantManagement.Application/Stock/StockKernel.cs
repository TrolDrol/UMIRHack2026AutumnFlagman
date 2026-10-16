using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Supplies.Entities;

namespace RestaurantManagement.Application.Stock;

public static class StockKernel
{
    public static decimal Available(Batch b, DateTime now) => b.IsExpired(now) ? 0 : b.FreeQuantity;
    public static RiskSnapshot Risk(Batch b, DateTime now) => new("expiry-10pct-v1", now, b.ExpirationDate.Value,
        b.ShelfLifeHours, b.ExpirationDate.Value.AddHours(-b.ShelfLifeHours * 0.1),
        b.IsExpired(now) ? "expired" : b.IsExpiringSoon(now) ? "expiring" : "fresh");

    public static PreviewDto Plan(IReadOnlyList<Ingredient> ingredients, IReadOnlyList<Dish> dishes,
        IReadOnlyList<Batch> batches, IReadOnlyList<OrderLine> lines, DateTime now, bool includeRisk = false)
    {
        var needs = new Dictionary<Guid, decimal>();
        foreach (var line in lines)
        {
            var dish = dishes.FirstOrDefault(d => d.Id.Value == line.DishId) ?? throw ApiFailure.Invalid("lines", "Блюдо не найдено");
            if (!dish.Active) throw ApiFailure.Conflict("DISH_INACTIVE");
            foreach (var r in dish.RecipeIngredients)
            {
                var i = ingredients.FirstOrDefault(i => i.Id == r.Requirement.IngredientId) ?? throw ApiFailure.Invalid("recipe");
                if (i.Unit != r.Requirement.Unit) throw ApiFailure.Invalid("recipe", "Разные единицы ингредиента");
                needs[i.Id.Value] = ContractJson.Limit(needs.GetValueOrDefault(i.Id.Value) + r.Requirement.Quantity.Value * line.Portions);
            }
        }
        var reqs = needs.Select(n => {
            var i = ingredients.First(i => i.Id.Value == n.Key);
            var available = ContractJson.Limit(batches.Where(b => b.IngredientId == i.Id).Sum(b => Available(b, now)));
            return new RequirementDto(i.Id.Value, i.Name, i.Unit.Value, n.Value, available, Math.Max(0, n.Value - available));
        }).OrderBy(x => x.IngredientName, StringComparer.Ordinal).ThenBy(x => x.IngredientId.ToString(), StringComparer.Ordinal).ToArray();
        if (reqs.Any(r => r.MissingQuantity.Value > 0)) return new(false, reqs, []);
        var allocations = new List<AllocationDto>();
        foreach (var n in needs.OrderBy(n => n.Key.ToString(), StringComparer.Ordinal))
        {
            var remaining = n.Value;
            foreach (var b in Fefo(batches.Where(b => b.IngredientId.Value == n.Key)))
            {
                var taken = Math.Min(remaining, Available(b, now));
                if (taken <= 0) continue;
                allocations.Add(new(b.Id.Value, n.Key, taken, b.ExpirationDate.Value, includeRisk ? Risk(b, now) : null));
                remaining -= taken;
                if (remaining == 0) break;
            }
        }
        return new(true, reqs, allocations.ToArray());
    }
    public static IEnumerable<Batch> Fefo(IEnumerable<Batch> batches) => batches.OrderBy(b => b.ExpirationDate.Value)
        .ThenBy(b => b.ReceivedAt).ThenBy(b => b.Id.Value.ToString(), StringComparer.Ordinal);
    public static long MaxPortions(Dish dish, IReadOnlyList<Batch> batches, DateTime now) => !dish.Active ? 0 :
        dish.RecipeIngredients.Min(r => (long)(ContractJson.Limit(batches.Where(b => b.IngredientId == r.Requirement.IngredientId)
            .Sum(b => Available(b, now))) / r.Requirement.Quantity.Value));
}
