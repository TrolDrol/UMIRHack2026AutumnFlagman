using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Orders.Entities;
using RestaurantManagement.Domain.Orders.Interfaces;
using RestaurantManagement.Domain.Orders.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Repositories;

public class OrderRepository : IOrderRepository
{
    private readonly AppDbContext _context;

    public OrderRepository(AppDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task<Order?> GetByIdAsync(OrderId id, CancellationToken ct = default)
    {
        return await _context.Orders
            .Include(o => o.Items)
            .Include(o => o.Allocations)
            .FirstOrDefaultAsync(o => o.Id == id, ct);
    }

    public async Task<IReadOnlyCollection<Order>> GetByWarehouseAsync(WarehouseId warehouseId, CancellationToken ct = default)
    {
        return await _context.Orders
            .Include(o => o.Items)
            .Include(o => o.Allocations)
            .Where(o => o.WarehouseId == warehouseId)
            .ToListAsync(ct);
    }

    public async Task SaveAsync(Order order, CancellationToken ct = default)
    {
        var entry = _context.Entry(order);
        if (entry.State == EntityState.Detached)
        {
            await _context.Orders.AddAsync(order, ct);
        }
        await _context.SaveChangesAsync(ct);
    }
}
