using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class DeliveryItemConfiguration : IEntityTypeConfiguration<DeliveryItem>
{
    public void Configure(EntityTypeBuilder<DeliveryItem> builder)
    {
        builder.ToTable("delivery_items");
        builder.HasKey(di => di.Id);

        builder.Property(di => di.Id)
            .HasConversion(id => id.Value, v => DeliveryItemId.From(v))
            .HasColumnName("id");

        builder.Property(di => di.IngredientId)
            .HasConversion(id => id.Value, v => IngredientId.From(v))
            .HasColumnName("ingredient_id").IsRequired();

        builder.Property(di => di.IngredientName)
            .HasMaxLength(120).IsRequired().HasColumnName("ingredient_name");

        builder.Property(di => di.ManufacturedAt).HasColumnName("manufactured_at");
        builder.Property(di => di.ShelfLifeHours).HasColumnName("shelf_life_hours");

        builder.Property(di => di.Quantity)
            .HasConversion(q => q.Value, v => Quantity.From(v))
            .HasColumnName("quantity").HasPrecision(18, 3).IsRequired();

        builder.Property(di => di.Unit)
            .HasConversion(u => u.Value, v => Unit.From(v))
            .HasColumnName("unit").HasMaxLength(10).IsRequired();

        builder.Property(di => di.ExpiresAt)
            .HasColumnName("expiration_date")
            .IsRequired();
    }
}
