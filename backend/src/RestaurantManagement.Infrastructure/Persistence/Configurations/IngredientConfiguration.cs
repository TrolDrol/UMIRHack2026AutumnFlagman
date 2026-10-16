using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class IngredientConfiguration : IEntityTypeConfiguration<Ingredient>
{
    public void Configure(EntityTypeBuilder<Ingredient> builder)
    {
        builder.ToTable("ingredients");
        builder.HasKey(i => i.Id);

        builder.Property(i => i.Id)
            .HasConversion(id => id.Value, v => IngredientId.From(v))
            .HasColumnName("id");

        builder.Property(i => i.WarehouseId)
            .HasConversion(id => id.Value, v => WarehouseId.From(v))
            .HasColumnName("warehouse_id").IsRequired();

        builder.Property(i => i.Name)
            .HasMaxLength(120).IsRequired().HasColumnName("name");

        builder.Property(i => i.DefaultShelfLifeHours).HasColumnName("default_shelf_life_hours");

        builder.Property(i => i.ReorderPoint)
            .HasConversion(q => q.Value, v => Quantity.From(v))
            .HasColumnName("reorder_point").HasPrecision(18, 3).IsRequired();

        builder.Property(i => i.TargetStock)
            .HasConversion(q => q.Value, v => Quantity.From(v))
            .HasColumnName("target_stock").HasPrecision(18, 3).IsRequired();

        builder.Property(i => i.Unit)
            .HasConversion(u => u.Value, v => Unit.From(v))
            .HasColumnName("unit").HasMaxLength(10).IsRequired();
    }
}
