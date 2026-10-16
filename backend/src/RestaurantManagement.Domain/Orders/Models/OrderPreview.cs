using RestaurantManagement.Domain.Orders.Entities;

namespace RestaurantManagement.Domain.Orders.Models;

public class OrderPreview
{
    public bool CanCreate { get; }
    public IReadOnlyCollection<Requirement> Requirements { get; }
    public IReadOnlyCollection<OrderAllocation> Allocations { get; }

    public OrderPreview(
        bool canCreate, 
        IReadOnlyCollection<Requirement> requirements, 
        IReadOnlyCollection<OrderAllocation> allocations)
    {
        CanCreate = canCreate;
        Requirements = requirements ?? throw new ArgumentNullException(nameof(requirements));
        Allocations = allocations ?? throw new ArgumentNullException(nameof(allocations));
    }
}
