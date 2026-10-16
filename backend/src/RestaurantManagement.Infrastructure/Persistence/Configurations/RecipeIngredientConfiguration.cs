using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.ValueObjects;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Configurations;

public class RecipeIngredientConfiguration : IEntityTypeConfiguration<RecipeIngredient>
{
    public void Configure(EntityTypeBuilder<RecipeIngredient> builder)
    {
        builder.ToTable("recipe_ingredients");
        builder.HasKey(ri => ri.Id);

        builder.Property(ri => ri.Id)
            .HasConversion(id => id.Value, v => RecipeIngredientId.From(v))
            .HasColumnName("id");

        builder.Property(ri => ri.Name)
            .HasMaxLength(120).IsRequired().HasColumnName("name");

        builder.OwnsOne(r => r.Requirement, req =>
        {
            req.Property(x => x.IngredientId)
                .HasConversion(id => id.Value, v => IngredientId.From(v))
                .HasColumnName("ingredient_id").IsRequired();

            req.Property(x => x.Quantity)
                .HasConversion(q => q.Value, v => Quantity.From(v))
                .HasColumnName("quantity").HasPrecision(18, 3).IsRequired();

            req.Property(x => x.Unit)
                .HasConversion(u => u.Value, v => Unit.From(v))
                .HasColumnName("unit").HasMaxLength(10).IsRequired();
        });
    }
}
