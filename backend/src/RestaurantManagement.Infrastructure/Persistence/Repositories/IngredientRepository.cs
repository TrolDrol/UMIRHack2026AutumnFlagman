using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Ingredients.Entities;
using RestaurantManagement.Domain.Ingredients.Interfaces;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Repositories;

public class IngredientRepository : IIngredientRepository
{
    private readonly AppDbContext _context;

    public IngredientRepository(AppDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task SaveAsync(Ingredient ingredient, CancellationToken ct = default)
    {
        var entry = _context.Entry(ingredient);
        if (entry.State == EntityState.Detached)
        {
            await _context.Ingredients.AddAsync(ingredient, ct);
        }
        
        await _context.SaveChangesAsync(ct);
    }

    public async Task<Ingredient?> GetByIdAsync(IngredientId id, CancellationToken ct = default)
    {
        return await _context.Ingredients
            .FirstOrDefaultAsync(i => i.Id == id, ct);
    }

    public async Task<IReadOnlyCollection<Ingredient>> GetAllAsync(CancellationToken ct = default)
    {
        return await _context.Ingredients
            .OrderBy(i => i.Name)
            .ToListAsync(ct);
    }

    public async Task<bool> ExistsByNameAsync(string name, CancellationToken ct = default)
    {
        var normalizedName = name.Trim().ToLowerInvariant();
        return await _context.Ingredients
            .AnyAsync(i => i.Name.ToLower() == normalizedName, ct);
    }
}
