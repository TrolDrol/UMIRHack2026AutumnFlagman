using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Orders.Entities;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class OrderAllocationConfiguration : IEntityTypeConfiguration<OrderAllocation>
{
    public void Configure(EntityTypeBuilder<OrderAllocation> builder)
    {
        builder.ToTable("order_allocations");
        builder.HasKey(oa => oa.Id);

        builder.Property(oa => oa.Id)
            .HasConversion(id => id.Value, v => OrderAllocationId.From(v))
            .HasColumnName("id");

        builder.Property(oa => oa.BatchId)
            .HasConversion(id => id.Value, v => BatchId.From(v))
            .HasColumnName("batch_id").IsRequired();

        builder.Property(oa => oa.IngredientId)
            .HasConversion(id => id.Value, v => IngredientId.From(v))
            .HasColumnName("ingredient_id").IsRequired();

        builder.Property(oa => oa.Quantity)
            .HasConversion(q => q.Value, v => Quantity.From(v))
            .HasColumnName("quantity").HasPrecision(18, 3).IsRequired();

        builder.Property(oa => oa.ExpiresAt)
            .HasConversion(e => e.Value, v => ExpirationDate.From(v))
            .HasColumnName("expires_at").IsRequired();
    }
}