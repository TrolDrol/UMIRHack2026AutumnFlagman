using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Menu.Entities;
using RestaurantManagement.Domain.Menu.Interfaces;
using RestaurantManagement.Domain.Menu.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Repositories;

public class DishRepository : IDishRepository
{
    private readonly AppDbContext _context;

    public DishRepository(AppDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task<Dish?> GetByIdAsync(DishId id, CancellationToken ct = default)
    {
        return await _context.Dishes
            .Include(d => d.RecipeIngredients)
            .FirstOrDefaultAsync(d => d.Id == id, ct);
    }

    public async Task<IReadOnlyCollection<Dish>> GetAllAsync(CancellationToken ct = default)
    {
        return await _context.Dishes
            .Include(d => d.RecipeIngredients)
            .ToListAsync(ct);
    }

    public async Task SaveAsync(Dish dish, CancellationToken ct = default)
    {
        var entry = _context.Entry(dish);
        if (entry.State == EntityState.Detached)
        {
            await _context.Dishes.AddAsync(dish, ct);
        }
        await _context.SaveChangesAsync(ct);
    }
}
