using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class BatchConfiguration : IEntityTypeConfiguration<Batch>
{
    public void Configure(EntityTypeBuilder<Batch> builder)
    {
        builder.ToTable("batches");
        builder.HasKey(b => b.Id);

        builder.Property(b => b.Id)
            .HasConversion(id => id.Value, v => BatchId.From(v))
            .HasColumnName("id");

        builder.Property(b => b.WarehouseId)
            .HasConversion(id => id.Value, v => WarehouseId.From(v))
            .HasColumnName("warehouse_id").IsRequired();

        builder.Property(b => b.DeliveryId)
            .HasConversion(id => id.Value, v => DeliveryId.From(v))
            .HasColumnName("delivery_id").IsRequired();

        builder.Property(b => b.SourceItemId)
            .HasConversion(id => id.Value, v => DeliveryItemId.From(v))
            .HasColumnName("source_item_id").IsRequired();

        builder.Property(b => b.IngredientId)
            .HasConversion(id => id.Value, v => IngredientId.From(v))
            .HasColumnName("ingredient_id").IsRequired();

        builder.Property(b => b.IngredientName)
            .HasMaxLength(120).IsRequired().HasColumnName("ingredient_name");

        builder.Property(b => b.ReceivedAt)
            .IsRequired().HasColumnName("received_at");

        builder.Property(b => b.ManufacturedAt)
            .HasColumnName("manufactured_at");

        builder.Property(b => b.ShelfLifeHours)
            .IsRequired().HasColumnName("shelf_life_hours");

        builder.Property(b => b.InitialQuantity)
            .HasConversion(q => q.Value, v => Quantity.From(v))
            .HasColumnName("initial_quantity").HasPrecision(18, 3).IsRequired();

        builder.Property(b => b.RemainingQuantity)
            .HasConversion(q => q.Value, v => Quantity.From(v))
            .HasColumnName("remaining_quantity").HasPrecision(18, 3).IsRequired();

        builder.Property(b => b.ExpirationDate)
            .HasConversion(e => e.Value, v => ExpirationDate.From(v))
            .HasColumnName("expires_at").IsRequired();

        builder.Property(b => b.Unit)
            .HasConversion(u => u.Value, v => Unit.From(v))
            .HasColumnName("unit").HasMaxLength(3).IsRequired();

        builder.HasIndex(b => new { b.WarehouseId, b.IngredientId })
            .HasDatabaseName("ix_batches_warehouse_ingredient");
    }
}