using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Orders.Services;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using Xunit;

namespace RestaurantManagement.Tests;

public class DomainTests
{
    readonly WarehouseId warehouse = WarehouseId.From(Guid.NewGuid());
    static readonly DateTime Now = new(2026, 10, 14, 12, 0, 0, DateTimeKind.Utc);
    static RecipeIngredient Recipe(IngredientId id, decimal q = 1, string unit = "g") => new(RecipeIngredientId.New(), "Продукт", new(id, Quantity.From(q), Unit.From(unit)));
    [Fact] public void InitialRecipeRejectsDuplicateAndZeroAndTooMany()
    {
        var id = IngredientId.New();
        Assert.ThrowsAny<Exception>(() => new Dish(DishId.New(), warehouse, "Блюдо", [Recipe(id), Recipe(id)]));
        Assert.ThrowsAny<Exception>(() => new Dish(DishId.New(), warehouse, "Блюдо", [Recipe(id, 0)]));
        Assert.ThrowsAny<Exception>(() => new Dish(DishId.New(), warehouse, "Блюдо", Enumerable.Range(0, 51).Select(_ => Recipe(IngredientId.New())).ToArray()));
    }
    [Fact] public void EmptyReceiptAndInvalidShelfLifeCannotConfirm()
    {
        var d = new Delivery(DeliveryId.New(), warehouse, "TEST", Now, null, null, "manual");
        Assert.ThrowsAny<Exception>(() => d.Confirm(Now, Now, Guid.NewGuid().ToString()));
        Assert.ThrowsAny<Exception>(() => d.AddItem(IngredientId.New(), "Продукт", Quantity.Zero, Unit.Grams(), null, null, Now.AddDays(1), 72));
        Assert.ThrowsAny<Exception>(() => d.AddItem(IngredientId.New(), "Продукт", Quantity.From(1), Unit.Grams(), Now, 0, null, 72));
        Assert.Equal(DeliveryStatus.Pending, d.Status); Assert.Empty(d.Items);
    }
    [Fact] public void ExpiryPreservesSecondsAndBoundary()
    {
        var at = Now.AddMinutes(23).AddSeconds(12); var expiry = ExpirationDate.From(at);
        Assert.Equal(at, expiry.Value); Assert.True(expiry.IsExpired(at)); Assert.False(expiry.IsExpired(at.AddTicks(-1)));
    }
    [Fact] public void ExactQuantitiesAndMaximum()
    {
        Assert.Equal("0.300", Quantity.From(0.1m).Add(Quantity.From(0.2m)).ToString());
        Assert.ThrowsAny<Exception>(() => Quantity.From(0.0001m)); Assert.ThrowsAny<Exception>(() => Quantity.From(1000000000m));
    }
    [Fact] public void HeldStockCannotBeSpentAndRiskUsesSnapshot()
    {
        var b = new Batch(BatchId.New(), warehouse, DeliveryId.New(), DeliveryItemId.New(), IngredientId.New(), "Продукт", Quantity.From(10), Now, null, 72, ExpirationDate.From(Now.AddHours(6)), Unit.Grams());
        b.Hold(8); Assert.Equal(2, b.FreeQuantity); Assert.True(b.IsExpiringSoon(Now));
        Assert.ThrowsAny<Exception>(() => b.Deduct(Quantity.From(3))); Assert.Equal(10, b.RemainingQuantity.Value);
        b.WriteOffHeld(2); Assert.Equal(8, b.RemainingQuantity.Value); Assert.Equal(6, b.HeldQuantity); b.Release(6); Assert.Equal(8, b.FreeQuantity);
    }
}
