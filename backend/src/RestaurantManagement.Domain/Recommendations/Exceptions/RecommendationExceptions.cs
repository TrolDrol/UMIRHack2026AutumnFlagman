using RestaurantManagement.Domain.Common.Exceptions;

namespace RestaurantManagement.Domain.Recommendations.Exceptions;

public class InvalidRecommendationThresholdException : DomainException
{
    public InvalidRecommendationThresholdException(string message) : base(message) { }
}
