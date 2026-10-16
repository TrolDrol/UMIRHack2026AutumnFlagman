using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Orders.Entities;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> builder)
    {
        builder.ToTable("orders");
        builder.HasKey(o => o.Id);

        builder.Property(o => o.Id)
            .HasConversion(id => id.Value, v => OrderId.From(v))
            .HasColumnName("id");

        builder.Property(o => o.WarehouseId)
            .HasConversion(id => id.Value, v => WarehouseId.From(v))
            .HasColumnType("uuid").IsRequired().HasColumnName("warehouse_id");

        builder.Property(o => o.CreatedAt).IsRequired().HasColumnName("created_at");

        builder.Property(o => o.Status)
            .HasConversion<int>()
            .HasColumnName("status").IsRequired();

        builder.HasMany(o => o.Items)
            .WithOne()
            .HasForeignKey("order_id")
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(o => o.Allocations)
            .WithOne()
            .HasForeignKey("order_id")
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(o => o.Items).UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(o => o.Allocations).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
