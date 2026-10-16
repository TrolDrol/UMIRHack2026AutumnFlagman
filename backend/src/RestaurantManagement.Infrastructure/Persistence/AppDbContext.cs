using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Orders.Entities;

namespace RestaurantManagement.Infrastructure.Persistence;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<Ingredient> Ingredients => Set<Ingredient>();
    public DbSet<Dish> Dishes => Set<Dish>();
    public DbSet<Delivery> Deliveries => Set<Delivery>();
    public DbSet<Batch> Batches => Set<Batch>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<UserAccount> Users => Set<UserAccount>();
    public DbSet<EnterpriseRecord> Enterprises => Set<EnterpriseRecord>();
    public DbSet<WarehouseRecord> Warehouses => Set<WarehouseRecord>();
    public DbSet<MembershipRecord> Memberships => Set<MembershipRecord>();
    public DbSet<SessionRecord> Sessions => Set<SessionRecord>();
    public DbSet<IntegrationClientRecord> IntegrationClients => Set<IntegrationClientRecord>();
    public DbSet<IntegrationKeyRecord> IntegrationKeys => Set<IntegrationKeyRecord>();
    public DbSet<ReplayRecord> Replays => Set<ReplayRecord>();
    public DbSet<OperationalDocument> Documents => Set<OperationalDocument>();
    public DbSet<RuntimeMetadata> Runtime => Set<RuntimeMetadata>();
    public DbSet<ExternalDocumentRecord> ExternalDocuments => Set<ExternalDocumentRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        modelBuilder.Entity<UserAccount>(b => {
            b.ToTable("users"); b.HasKey(x => x.Id);
            b.HasIndex(x => new { x.Kind, x.NormalizedUsername }).IsUnique();
        });
        modelBuilder.Entity<EnterpriseRecord>().ToTable("enterprises");
        modelBuilder.Entity<WarehouseRecord>(b => {
            b.ToTable("warehouses"); b.HasKey(x => x.Id);
            b.HasOne<EnterpriseRecord>().WithMany().HasForeignKey(x => x.EnterpriseId);
            b.HasIndex(x => x.EnterpriseId).IsUnique();
        });
        modelBuilder.Entity<MembershipRecord>(b => {
            b.ToTable("memberships"); b.HasKey(x => new { x.EnterpriseId, x.UserId });
            b.HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId);
            b.HasOne<EnterpriseRecord>().WithMany().HasForeignKey(x => x.EnterpriseId);
        });
        modelBuilder.Entity<SessionRecord>(b => {
            b.ToTable("sessions"); b.HasKey(x => x.Id); b.HasIndex(x => x.ExpiresAt);
            b.HasOne<UserAccount>().WithMany().HasForeignKey(x => x.UserId);
        });
        modelBuilder.Entity<IntegrationClientRecord>(b => {
            b.ToTable("integration_clients"); b.HasKey(x => x.Id);
            b.HasOne<WarehouseRecord>().WithMany().HasForeignKey(x => x.WarehouseId);
        });
        modelBuilder.Entity<IntegrationKeyRecord>(b => {
            b.ToTable("integration_keys"); b.HasKey(x => x.Id);
            b.HasIndex(x => x.SecretHash).IsUnique();
            b.HasOne<IntegrationClientRecord>().WithMany().HasForeignKey(x => x.ClientId);
        });
        modelBuilder.Entity<ReplayRecord>(b => {
            b.ToTable("idempotency_records"); b.HasKey(x => x.Id);
            b.HasIndex(x => new { x.WarehouseId, x.Principal, x.Method, x.Path, x.Key }).IsUnique();
            b.Property(x => x.ResponseJson).HasColumnType("text");
            b.HasOne<WarehouseRecord>().WithMany().HasForeignKey(x => x.WarehouseId);
        });
        modelBuilder.Entity<OperationalDocument>(b => {
            b.ToTable("operational_documents"); b.HasKey(x => x.Id);
            b.Property(x => x.Json).HasColumnType("jsonb");
            b.HasIndex(x => new { x.WarehouseId, x.Kind, x.CreatedAt });
            b.HasIndex(x => new { x.WarehouseId, x.EventSequence }).IsUnique();
            b.Property(x => x.Version).IsConcurrencyToken();
            b.HasOne<WarehouseRecord>().WithMany().HasForeignKey(x => x.WarehouseId);
            b.HasOne<IntegrationClientRecord>().WithMany().HasForeignKey(x => x.ClientId);
        });
        modelBuilder.Entity<RuntimeMetadata>().ToTable("runtime_metadata");
        modelBuilder.Entity<ExternalDocumentRecord>(b => {
            b.ToTable("external_documents"); b.HasKey(x => new { x.WarehouseId, x.ClientId, x.Kind, x.ExternalId });
            b.HasOne<WarehouseRecord>().WithMany().HasForeignKey(x => x.WarehouseId);
            b.HasOne<IntegrationClientRecord>().WithMany().HasForeignKey(x => x.ClientId);
        });
        modelBuilder.Entity<Dish>().Property(x => x.CreatedAt).HasColumnName("created_at");
        modelBuilder.Entity<Dish>().Property(x => x.UpdatedAt).HasColumnName("updated_at");
        modelBuilder.Entity<Batch>().Ignore(x => x.FreeQuantity);
        modelBuilder.Entity<Batch>().Property(x => x.HeldQuantity).HasPrecision(12, 3).HasColumnName("held_quantity");
        modelBuilder.Entity<Batch>().Property(x => x.Version).IsConcurrencyToken().HasColumnName("version");
        modelBuilder.Entity<Batch>().Property(x => x.ReceiptCommittedAt).HasColumnName("receipt_committed_at");
        modelBuilder.Entity<Batch>().HasIndex(x => x.SourceItemId).IsUnique();
        modelBuilder.Entity<Order>().Property(x => x.SnapshotJson).HasColumnType("jsonb");
        modelBuilder.Entity<Order>().HasIndex(x => new { x.WarehouseId, x.IntegrationClientId, x.ExternalId }).IsUnique();
        modelBuilder.Entity<Delivery>().HasIndex(x => new { x.WarehouseId, x.IntegrationClientId, x.ExternalId }).IsUnique();
        modelBuilder.Entity<Delivery>().HasIndex(x => x.PurchaseRequestId).IsUnique();
        base.OnModelCreating(modelBuilder);
    }
}
