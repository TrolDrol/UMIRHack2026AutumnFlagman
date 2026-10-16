namespace RestaurantManagement.Infrastructure.Persistence;

public class UserAccount
{
    public Guid Id { get; set; }
    public string Username { get; set; } = "";
    public string NormalizedUsername { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Kind { get; set; } = "staff";
    public bool IsSuperAdmin { get; set; }
}
public class EnterpriseRecord
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
public class WarehouseRecord
{
    public Guid Id { get; set; }
    public Guid EnterpriseId { get; set; }
    public bool CustomerPublished { get; set; }
    public long StateRevision { get; set; } = 1;
    public long EventSequence { get; set; }
    public long OrderSequence { get; set; }
    public long PurchaseSequence { get; set; }
    public DateTime TrackingStartedAt { get; set; }
    public string DatasetKind { get; set; } = "observed";
}
public class MembershipRecord
{
    public Guid EnterpriseId { get; set; }
    public Guid UserId { get; set; }
    public string Role { get; set; } = "waiter";
}
public class SessionRecord
{
    public string Id { get; set; } = "";
    public Guid UserId { get; set; }
    public string Kind { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
}
public class IntegrationClientRecord
{
    public Guid Id { get; set; }
    public Guid WarehouseId { get; set; }
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
public class IntegrationKeyRecord
{
    public Guid Id { get; set; }
    public Guid ClientId { get; set; }
    public string SecretHash { get; set; } = "";
    public string Label { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}
public class ReplayRecord
{
    public Guid Id { get; set; }
    public Guid WarehouseId { get; set; }
    public string Principal { get; set; } = "";
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public Guid Key { get; set; }
    public int HashVersion { get; set; } = 1;
    public string Hash { get; set; } = "";
    public int Status { get; set; }
    public string ResponseJson { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
// Versioned extension aggregates have independent durable rows; journal rows are immutable.
// Their contract payload is JSONB; warehouse/client/version remain relational scope/index fields.
public class OperationalDocument
{
    public Guid Id { get; set; }
    public Guid WarehouseId { get; set; }
    public string Kind { get; set; } = "";
    public Guid? ClientId { get; set; }
    public Guid? ActorUserId { get; set; }
    public Guid? BatchId { get; set; }
    public long Version { get; set; } = 1;
    public long? EventSequence { get; set; }
    public DateTime CreatedAt { get; set; }
    public string Json { get; set; } = "{}";
}
public class RuntimeMetadata
{
    public int Id { get; set; } = 1;
    public Guid BackendInstanceId { get; set; }
}
