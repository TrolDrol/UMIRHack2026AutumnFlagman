using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Common.Exceptions;

namespace RestaurantManagement.Domain.Common.ValueObjects;

public class Unit : ValueObject
{
    private static readonly HashSet<string> AllowedUnits = new() { "g", "ml", "pcs" };

    public string Value { get; }

    private Unit(string value)
    {
        var normalized = value?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(normalized) || !AllowedUnits.Contains(normalized))
            throw new InvalidUnitException("Единица измерения может быть только 'g', 'ml' или 'pcs'.");

        Value = normalized;
    }

    public static Unit Grams() => new("g");
    public static Unit Milliliters() => new("ml");
    public static Unit Pieces() => new("pcs");

    public static Unit From(string value) => new(value);

    public override string ToString() => Value;

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
