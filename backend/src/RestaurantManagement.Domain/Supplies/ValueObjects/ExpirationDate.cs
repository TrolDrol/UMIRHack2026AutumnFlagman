using RestaurantManagement.Domain.Common.Base;
using RestaurantManagement.Domain.Supplies.Exceptions;

namespace RestaurantManagement.Domain.Supplies.ValueObjects;

public class ExpirationDate : ValueObject
{
    public DateTime Value { get; }

    private ExpirationDate(DateTime value)
    {
        if (value == default)
            throw new InvalidExpirationDateException("Срок годности должен иметь корректную дату.");

        Value = value;
    }

    public static ExpirationDate From(DateTime value) => new(value);

    public bool IsExpired(DateTime currentDate) => currentDate >= Value;

    public int DaysLeft(DateTime currentDate) => (int)Math.Floor((Value - currentDate).TotalDays);

    public bool IsExpiringSoon(DateTime currentDate, double criticalThresholdSeconds)
    {
        if (IsExpired(currentDate)) return false;
        var remainingTime = Value - currentDate;
        return remainingTime.TotalSeconds >= 0 && remainingTime.TotalSeconds <= criticalThresholdSeconds;
    }

    public override string ToString() => Value.ToString("yyyy-MM-dd HH:mm:ss");

    protected override IEnumerable<object> GetEqualityComponents()
    {
        yield return Value;
    }
}
