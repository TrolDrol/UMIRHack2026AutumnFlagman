using System.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Infrastructure.Persistence;

namespace RestaurantManagement.WebApi.V2;

[ApiController]
[Route("api/v2/staff")]
public sealed class StaffController(AppDbContext db, AccessService access, TimeProvider clock) : ControllerBase
{
    [HttpGet]
    public async Task<IResult> List()
    {
        var actor = await access.User(HttpContext, "staff");
        WarehouseService.QueryKeys(Request.Query, "q", "enterpriseId", "page", "pageSize");
        var page = WarehouseService.Integer(Request.Query, "page", 1, 1, int.MaxValue);
        var size = WarehouseService.Integer(Request.Query, "pageSize", 50, 1, 100);
        var enterpriseId = WarehouseService.QueryId(Request.Query, "enterpriseId");
        var search = Request.Query["q"].ToString().Trim();
        if (search.Length > 120) throw ApiFailure.Invalid("q");
        var owned = db.Memberships.Where(m => m.UserId == actor.Id && m.Role == "owner").Select(m => m.EnterpriseId);
        if (!actor.IsSuperAdmin && !await owned.AnyAsync()) throw new ApiFailure(403, "FORBIDDEN", "Требуются права владельца предприятия");
        if (enterpriseId.HasValue && !actor.IsSuperAdmin && !await owned.ContainsAsync(enterpriseId.Value)) throw ApiFailure.Missing();
        var users = db.Users.AsNoTracking().Where(u => u.Kind == "staff");
        if (!actor.IsSuperAdmin) users = users.Where(u => db.Memberships.Any(m => m.UserId == u.Id && owned.Contains(m.EnterpriseId)));
        if (enterpriseId.HasValue) users = users.Where(u => db.Memberships.Any(m => m.UserId == u.Id && m.EnterpriseId == enterpriseId.Value));
        if (search.Length > 0) {
            // PostgreSQL C locales do not case-fold Cyrillic consistently.
            // Search only the already authorized projection, then let SQL page
            // the matching IDs; never load credentials or filter tenants in UI.
            var names = await users.Select(u => new { u.Id, u.Username, u.DisplayName }).ToArrayAsync();
            var matchingIds = names.Where(u => u.Username.Contains(search, StringComparison.OrdinalIgnoreCase) || u.DisplayName.Contains(search, StringComparison.OrdinalIgnoreCase)).Select(u => u.Id).ToArray();
            users = users.Where(u => matchingIds.Contains(u.Id));
        }
        var total = await users.CountAsync();
        var rows = await users.OrderBy(u => u.NormalizedUsername).ThenBy(u => u.Id)
            .Skip((int)Math.Min(int.MaxValue, (long)(page - 1) * size)).Take(size)
            .Select(u => new { u.Id, u.Username, u.DisplayName, u.IsSuperAdmin }).ToArrayAsync();
        var ids = rows.Select(u => u.Id).ToArray();
        var memberships = await (from m in db.Memberships.AsNoTracking()
            join e in db.Enterprises on m.EnterpriseId equals e.Id
            where ids.Contains(m.UserId) && (actor.IsSuperAdmin || owned.Contains(m.EnterpriseId))
            orderby e.Name, e.Id
            select new { m.UserId, enterpriseId = e.Id, enterpriseName = e.Name, m.Role }).ToArrayAsync();
        var items = rows.Select(u => new {
            userId = u.Id, u.Username, u.DisplayName, u.IsSuperAdmin,
            canDeleteAccount = actor.IsSuperAdmin && !u.IsSuperAdmin && u.Id != actor.Id && !memberships.Any(m => m.UserId == u.Id && m.Role == "owner"),
            memberships = memberships.Where(m => m.UserId == u.Id).Select(m => new { m.enterpriseId, m.enterpriseName, m.Role }).ToArray()
        }).ToArray();
        return Results.Json(new Envelope<object>(new { items, page, pageSize = size, total }, ApiMiddleware.Meta(HttpContext, ContractJson.Now(clock))), ContractJson.Options);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IResult> Delete(Guid id)
    {
        var actor = await access.User(HttpContext, "staff");
        AccessService.ExpectedUser(HttpContext, actor.Id);
        await access.CookieMutation(HttpContext);
        if (!actor.IsSuperAdmin) throw new ApiFailure(403, "FORBIDDEN", "Удалять аккаунты может только супер-администратор");
        if (actor.Id == id) throw ApiFailure.Conflict("SELF_DELETE_FORBIDDEN");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, HttpContext.RequestAborted);
        await db.Database.ExecuteSqlRawAsync("SET LOCAL lock_timeout = '3s'", HttpContext.RequestAborted);
        var target = await db.Users.FromSqlInterpolated($"SELECT * FROM users WHERE \"Id\" = {id} FOR UPDATE").SingleOrDefaultAsync(HttpContext.RequestAborted);
        if (target is not { Kind: "staff" }) throw ApiFailure.Missing();
        if (target.IsSuperAdmin) throw ApiFailure.Conflict("SUPERADMIN_PROTECTED");
        // Serialize against member/owner changes before checking ownership. Keep
        // business documents/history intact; only account, sessions and memberships cascade.
        await db.Warehouses.FromSqlInterpolated($"SELECT w.* FROM warehouses w WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.\"EnterpriseId\" = w.\"EnterpriseId\" AND m.\"UserId\" = {id}) ORDER BY w.\"Id\" FOR UPDATE").ToArrayAsync(HttpContext.RequestAborted);
        if (await db.Memberships.AnyAsync(m => m.UserId == id && m.Role == "owner", HttpContext.RequestAborted)) throw ApiFailure.Conflict("OWNER_IMMUTABLE");
        db.Users.Remove(target);
        await db.SaveChangesAsync(HttpContext.RequestAborted);
        await tx.CommitAsync(HttpContext.RequestAborted);
        return Results.NoContent();
    }
}
