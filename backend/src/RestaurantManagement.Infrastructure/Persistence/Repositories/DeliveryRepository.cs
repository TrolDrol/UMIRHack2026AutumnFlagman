using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Domain.Supplies.Entities;
using RestaurantManagement.Domain.Supplies.Interfaces;
using RestaurantManagement.Domain.Supplies.ValueObjects;
using RestaurantManagement.Domain.Common.ValueObjects;

namespace RestaurantManagement.Infrastructure.Persistence.Repositories;

public class DeliveryRepository : IDeliveryRepository
{
    private readonly AppDbContext _context;

    public DeliveryRepository(AppDbContext context)
    {
        _context = context ?? throw new ArgumentNullException(nameof(context));
    }

    public async Task<Delivery?> GetByIdAsync(DeliveryId id, CancellationToken ct = default)
    {
        return await _context.Deliveries
            .Include(d => d.Items)
            .FirstOrDefaultAsync(d => d.Id == id, ct);
    }

    public async Task<IReadOnlyCollection<Delivery>> GetByWarehouseAsync(WarehouseId warehouseId, DeliveryStatus? status = null, CancellationToken ct = default)
    {
        var query = _context.Deliveries.Include(d => d.Items).Where(d => d.WarehouseId == warehouseId);
        if (status.HasValue)
        {
            query = query.Where(d => d.Status == status.Value);
        }
        return await query.ToListAsync(ct);
    }

    public async Task SaveAsync(Delivery delivery, CancellationToken ct = default)
    {
        var entry = _context.Entry(delivery);
        if (entry.State == EntityState.Detached)
        {
            await _context.Deliveries.AddAsync(delivery, ct);
        }
        await _context.SaveChangesAsync(ct);
    }
}
