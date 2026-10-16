namespace RestaurantManagement.Infrastructure.Persistence;
public class ExternalDocumentRecord
{
    public Guid WarehouseId { get; set; }
    public Guid ClientId { get; set; }
    public string Kind { get; set; } = "";
    public string ExternalId { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public Guid DocumentId { get; set; }
}
