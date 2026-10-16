using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.Domain.Recommendations.Models;

public class HotOffer
{
    public DishId DishId { get; }
    public string DishName { get; }
    public double Score { get; }
    public long MaxPortions { get; }
    public long SuggestedPortions { get; }
    public ExpirationDate EarliestExpiresAt { get; }
    public IReadOnlyCollection<HotOfferReason> Reasons { get; }
    public string Explanation { get; }

    public HotOffer(
        DishId dishId, 
        string dishName, 
        double score, 
        long maxPortions, 
        long suggestedPortions, 
        ExpirationDate earliestExpiresAt, 
        IReadOnlyCollection<HotOfferReason> reasons, 
        string explanation)
    {
        DishId = dishId ?? throw new ArgumentNullException(nameof(dishId));
        DishName = dishName;
        Score = score;
        MaxPortions = maxPortions;
        SuggestedPortions = suggestedPortions;
        EarliestExpiresAt = earliestExpiresAt ?? throw new ArgumentNullException(nameof(earliestExpiresAt));
        Reasons = reasons ?? throw new ArgumentNullException(nameof(reasons));
        Explanation = explanation;
    }
}