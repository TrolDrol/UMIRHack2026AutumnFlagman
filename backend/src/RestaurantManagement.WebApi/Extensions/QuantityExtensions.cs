using System.Globalization;

namespace RestaurantManagement.WebApi.Extensions;

public static class QuantityExtensions
{
    public static string ToApiString(this decimal value)
    {
        return value.ToString("0.000", CultureInfo.InvariantCulture);
    }
}
