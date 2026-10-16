using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Supplies.Exceptions;

namespace RestaurantManagement.Domain.Supplies.ValueObjects;

public class Quantity : ValueObject
{
    public decimal Value { get; }

    private Quantity(decimal value)
    {
        if (value < 0)
            throw new InvalidQuantityException("Количество продукта не может быть отрицательным.");

        if (value > 999_999_999.999m)
            throw new InvalidQuantityException("Количество превышает допустимый максимум 999999999.999.");

        if (decimal.Round(value, 3) != value)
            throw new InvalidQuantityException("Количество не может иметь более 3 знаков после запятой.");
        
        Value = value;
    }

    public static Quantity From(decimal value) => new(value);
    public static Quantity Zero => new(0);

    public Quantity Subtract(Quantity amount)
    {
        ArgumentNullException.ThrowIfNull(amount);

        if (amount.Value > this.Value)
            throw new InsufficientStockException($"Невозможно списать {amount.Value}, в наличии только {this.Value}.");
        
        return new Quantity(this.Value - amount.Value);
    }

    public Quantity Add(Quantity amount)
    {
        ArgumentNullException.ThrowIfNull(amount);
        return new Quantity(this.Value + amount.Value);
    }

    public override string ToString() => Value.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture);

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
