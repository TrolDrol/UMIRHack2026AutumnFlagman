using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Orders.Entities;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Menu.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class OrderItemConfiguration : IEntityTypeConfiguration<OrderItem>
{
    public void Configure(EntityTypeBuilder<OrderItem> builder)
    {
        builder.ToTable("order_items");
        builder.HasKey(o => o.Id);

        builder.Property(o => o.Id)
            .HasConversion(id => id.Value, v => OrderItemId.From(v))
            .HasColumnName("id");

        builder.Property(o => o.DishId)
            .HasConversion(id => id.Value, v => DishId.From(v))
            .HasColumnName("dish_id").IsRequired();

        builder.Property(o => o.DishName)
            .HasMaxLength(120).IsRequired().HasColumnName("dish_name");

        builder.Property(o => o.Quantity).IsRequired().HasColumnName("quantity");
    }
}
