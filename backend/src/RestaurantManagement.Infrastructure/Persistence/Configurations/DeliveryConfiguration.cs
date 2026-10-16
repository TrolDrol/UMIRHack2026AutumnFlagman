using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class DeliveryConfiguration : IEntityTypeConfiguration<Delivery>
{
    public void Configure(EntityTypeBuilder<Delivery> builder)
    {
        builder.ToTable("deliveries");
        builder.HasKey(d => d.Id);

        builder.Property(d => d.Id)
            .HasConversion(id => id.Value, v => DeliveryId.From(v))
            .HasColumnName("id");

        builder.Property(d => d.WarehouseId)
            .HasConversion(id => id.Value, v => WarehouseId.From(v))
            .HasColumnType("uuid")
            .IsRequired()
            .HasColumnName("warehouse_id");

        builder.Property(d => d.Number)
            .HasMaxLength(64).IsRequired().HasColumnName("number");

        builder.Property(d => d.Status)
            .HasConversion<int>()
            .HasColumnName("status").IsRequired();

        builder.Property(d => d.CreatedAt).IsRequired().HasColumnName("created_at");
        builder.Property(d => d.ExpectedAt).HasColumnName("expected_at");
        builder.Property(d => d.ReceivedAt).HasColumnName("received_at");
        builder.Property(d => d.Note).HasMaxLength(500).HasColumnName("note");
        builder.Property(d => d.RejectionReason).HasMaxLength(500).HasColumnName("rejection_reason");
        builder.Property(d => d.Source).HasMaxLength(50).IsRequired().HasColumnName("source");
        builder.Property(d => d.ExternalId).HasMaxLength(128).HasColumnName("external_id");
        builder.Property(d => d.ConfirmedByUserId).HasMaxLength(100).HasColumnName("confirmed_by_user_id");

        builder.HasMany(d => d.Items)
            .WithOne()
            .HasForeignKey("delivery_id")
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(d => d.Items)
            .UsePropertyAccessMode(PropertyAccessMode.Field);

        builder.HasIndex(d => new { d.WarehouseId, d.Number })
            .IsUnique().HasDatabaseName("ix_deliveries_warehouse_number");
    }
}
