using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class DishConfiguration : IEntityTypeConfiguration<Dish>
{
    public void Configure(EntityTypeBuilder<Dish> builder)
    {
        builder.ToTable("dishes");
        builder.HasKey(d => d.Id);

        builder.Property(d => d.Id)
            .HasConversion(id => id.Value, v => DishId.From(v))
            .HasColumnName("id");

        builder.Property(d => d.WarehouseId)
            .HasConversion(id => id.Value, v => WarehouseId.From(v))
            .HasColumnType("uuid")
            .IsRequired()
            .HasColumnName("warehouse_id");

        builder.Property(d => d.Name)
            .HasMaxLength(120).IsRequired().HasColumnName("name");

        builder.Property(d => d.Active)
            .IsRequired().HasColumnName("active");

        builder.HasMany(d => d.RecipeIngredients)
            .WithOne()
            .HasForeignKey("dish_id")
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(d => d.RecipeIngredients)
            .UsePropertyAccessMode(PropertyAccessMode.Field);

        builder.HasIndex(d => new { d.WarehouseId, d.Name })
            .IsUnique().HasDatabaseName("ix_dishes_warehouse_name");
    }
}
