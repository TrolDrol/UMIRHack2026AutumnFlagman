using System.Data;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Infrastructure.Persistence;

namespace RestaurantManagement.WebApi.V2;

[ApiController]
[Route("api/v2")]
public sealed class AccountsController(AppDbContext db, AccessService access, TimeProvider clock) : ControllerBase
{
    IResult OkEnvelope(object data, int status = 200) => Results.Json(new Envelope<object>(data, ApiMiddleware.Meta(HttpContext, ContractJson.Now(clock))), ContractJson.Options, statusCode: status);
    string Kind => Request.Path.StartsWithSegments("/api/v2/customer",StringComparison.OrdinalIgnoreCase) ? "customer" : "staff";
    [HttpGet("runtime")]
    public async Task<IResult> Runtime() => OkEnvelope(new { backendInstanceId = (await db.Runtime.AsNoTracking().SingleAsync()).BackendInstanceId, sourceKind = "server", contractVersion = "2.1.0" });
    [HttpGet("auth/csrf")][HttpGet("customer/auth/csrf")]
    public IResult Csrf() => OkEnvelope(access.Csrf(HttpContext));
    [HttpPost("auth/register")][HttpPost("customer/auth/register")][EnableRateLimiting("auth")]
    public async Task<IResult> Register([FromBody] JsonElement body) { await access.CookieMutation(HttpContext); AuthShape(body,true); return OkEnvelope(await access.Register(HttpContext, WarehouseService.Body<UserInput>(body), Kind), 201); }
    [HttpPost("auth/login")][HttpPost("customer/auth/login")][EnableRateLimiting("auth")]
    public async Task<IResult> Login([FromBody] JsonElement body) { await access.CookieMutation(HttpContext); AuthShape(body,false); return OkEnvelope(await access.Login(HttpContext, WarehouseService.Body<UserInput>(body), Kind)); }
    static void AuthShape(JsonElement body,bool register) {
        if(body.ValueKind!=JsonValueKind.Object)throw ApiFailure.Invalid("body");
        string[] keys=register?["username","password","displayName"]:["username","password"];
        foreach(var key in keys)if(!body.TryGetProperty(key,out var v)||v.ValueKind!=JsonValueKind.String)throw ApiFailure.Invalid(key);
        foreach(var p in body.EnumerateObject())if(!keys.Contains(p.Name))throw ApiFailure.Invalid(p.Name);
    }
    [HttpGet("auth/me")][HttpGet("customer/auth/me")]
    public async Task<IResult> Me() => OkEnvelope(AccessService.Dto(await access.User(HttpContext, Kind)));
    [HttpPost("auth/logout")][HttpPost("customer/auth/logout")]
    public async Task<IResult> Logout() { await access.CookieMutation(HttpContext); if(Request.ContentLength>0||Request.Headers.ContainsKey("Transfer-Encoding"))throw ApiFailure.Invalid("body","Тело logout должно быть пустым"); await access.Logout(HttpContext, Kind); return Results.NoContent(); }
    [HttpGet("me/memberships")]
    public async Task<IResult> Memberships()
    {
        var user = await access.User(HttpContext, "staff");
        var rows = await (from w in db.Warehouses from e in db.Enterprises where e.Id == w.EnterpriseId
            from m in db.Memberships.Where(m => m.EnterpriseId == e.Id && m.UserId == user.Id).DefaultIfEmpty()
            where user.IsSuperAdmin || m != null
            orderby e.Name, e.Id
            select new { enterpriseId = e.Id, enterpriseName = e.Name, warehouseId = w.Id, role = user.IsSuperAdmin ? "super_admin" : m.Role }).ToArrayAsync();
        return OkEnvelope(rows);
    }
    [HttpGet("customer/outlets")]
    public async Task<IResult> Outlets()
    {
        await access.User(HttpContext, "customer"); WarehouseService.QueryKeys(Request.Query, "q", "page", "pageSize");
        var rows = await (from w in db.Warehouses where w.CustomerPublished join e in db.Enterprises on w.EnterpriseId equals e.Id select new { warehouseId = w.Id, name = e.Name, timeZone = "Europe/Moscow" }).ToArrayAsync();
        return OkEnvelope(WarehouseService.Paginate(rows.Where(r => r.name.Contains(Request.Query["q"].ToString().Trim(), StringComparison.OrdinalIgnoreCase)).OrderBy(r => r.name, StringComparer.Ordinal).ThenBy(r => r.warehouseId.ToString(), StringComparer.Ordinal), Request.Query));
    }
    [HttpPost("enterprises")]
    public async Task<IResult> Enterprise([FromBody] EnterpriseInput input)
    {
        var user = await access.User(HttpContext, "staff"); AccessService.ExpectedUser(HttpContext, user.Id); await access.CookieMutation(HttpContext);
        if (!user.IsSuperAdmin) throw new ApiFailure(403, "FORBIDDEN", "Требуется супер-администратор");
        WarehouseService.Name(input.Name); WarehouseService.Name(input.OwnerUsername, "ownerUsername", 64);
        var owner = await Owner(input.OwnerUsername);
        var now = ContractJson.Now(clock); var id = Guid.NewGuid(); var wid = Guid.NewGuid();
        await using var tx = await db.Database.BeginTransactionAsync();
        db.Enterprises.Add(new() { Id = id, Name = input.Name.Trim(), CreatedAt = now });
        db.Warehouses.Add(new() { Id = wid, EnterpriseId = id, TrackingStartedAt = now });
        db.Memberships.Add(new() { EnterpriseId = id, UserId = owner.Id, Role = "owner" });
        await db.SaveChangesAsync(); await tx.CommitAsync();
        return OkEnvelope(new { id, name = input.Name.Trim(), warehouseId = wid, createdAt = now }, 201);
    }
    async Task<UserAccount> Owner(string username)
    {
        var normal = username.Trim().ToUpperInvariant(); var user = await db.Users.FirstOrDefaultAsync(u => u.Kind == "staff" && u.NormalizedUsername == normal) ?? throw new ApiFailure(404, "USER_NOT_FOUND", "Пользователь не зарегистрирован");
        if (user.IsSuperAdmin) throw ApiFailure.Invalid("ownerUsername", "Выберите обычного пользователя"); return user;
    }
    async Task<Guid> EnterpriseAccess(Guid id)
    {
        await access.User(HttpContext,"staff");
        var warehouse = await db.Warehouses.AsNoTracking().FirstOrDefaultAsync(w => w.EnterpriseId == id) ?? throw ApiFailure.Missing();
        await access.Warehouse(HttpContext, warehouse.Id, "staff", WarehouseService.OwnerRoles);
        return warehouse.Id;
    }
    [HttpPost("enterprises/staff")]
    [HttpPost("enterprises/{id:guid}/members/register")]
    public async Task<IResult> RegisterStaff(Guid? id, [FromBody] StaffInput input)
    {
        var user = await access.User(HttpContext, "staff");
        AccessService.ExpectedUser(HttpContext, user.Id);
        await access.CookieMutation(HttpContext);
        if (id == null && !user.IsSuperAdmin) throw new ApiFailure(403, "FORBIDDEN", "Требуется супер-администратор");
        if (id != null && input.Role is not ("manager" or "warehouse" or "waiter")) throw ApiFailure.Invalid("role");
        if (id == null && input.Role != null) throw ApiFailure.Invalid("role");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, HttpContext.RequestAborted);
        if (id != null) {
            var wid = await EnterpriseAccess(id.Value);
            await db.Database.ExecuteSqlRawAsync("SET LOCAL lock_timeout = '3s'", HttpContext.RequestAborted);
            await db.Warehouses.FromSqlInterpolated($"SELECT * FROM warehouses WHERE \"Id\" = {wid} FOR UPDATE").SingleAsync(HttpContext.RequestAborted);
            // Recheck ownership after taking the membership serialization lock.
            await access.Warehouse(HttpContext, wid, "staff", WarehouseService.OwnerRoles);
        }
        var target = await access.CreateUser(new UserInput(input.Username, input.Password, input.DisplayName), "staff", HttpContext.RequestAborted);
        if (id != null) db.Memberships.Add(new() { EnterpriseId = id.Value, UserId = target.Id, Role = input.Role! });
        try { await db.SaveChangesAsync(HttpContext.RequestAborted); }
        catch (DbUpdateException ex) when (ex.InnerException is Npgsql.PostgresException { SqlState: "23505" }) { throw ApiFailure.Conflict("USERNAME_EXISTS"); }
        await tx.CommitAsync(HttpContext.RequestAborted);
        return OkEnvelope(new { userId = target.Id, target.Username, target.DisplayName, enterpriseId = id, role = input.Role }, 201);
    }
    public record StaffInput(string Username, string Password, string DisplayName, string? Role = null);
    [HttpGet("enterprises/{id:guid}/members")]
    public async Task<IResult> Members(Guid id)
    {
        await EnterpriseAccess(id); WarehouseService.QueryKeys(Request.Query, "page", "pageSize");
        var rows = await (from m in db.Memberships where m.EnterpriseId == id join u in db.Users on m.UserId equals u.Id orderby u.Username, u.Id select new { userId = u.Id, u.Username, u.DisplayName, m.Role }).ToArrayAsync();
        return OkEnvelope(WarehouseService.Paginate(rows, Request.Query));
    }
    [HttpPost("enterprises/{id:guid}/members")][HttpPatch("enterprises/{id:guid}/members/{userId:guid}")][HttpDelete("enterprises/{id:guid}/members/{userId:guid}")][HttpPost("enterprises/{id:guid}/owner")]
    public async Task<IResult> ChangeMember(Guid id, Guid? userId)
    {
        var wid = await EnterpriseAccess(id); await access.CookieMutation(HttpContext);
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        await db.Database.ExecuteSqlRawAsync("SET LOCAL lock_timeout = '3s'");
        await db.Warehouses.FromSqlInterpolated($"SELECT * FROM warehouses WHERE \"Id\" = {wid} FOR UPDATE").SingleAsync();
        var actor = await access.Warehouse(HttpContext, wid, "staff", WarehouseService.OwnerRoles);
        var ownerChange = Request.Path.Value!.EndsWith("/owner", StringComparison.Ordinal);
        var body = Request.Method == "DELETE" ? null : await JsonSerializer.DeserializeAsync<JsonElement?>(Request.Body, ContractJson.Options);
        UserAccount target; string? role;
        if (ownerChange) {
            if (actor.Role != "super_admin") throw new ApiFailure(403, "FORBIDDEN", "Требуется супер-администратор");
            var name = WarehouseService.Body<OwnerInput>(body!.Value).OwnerUsername; WarehouseService.Name(name, "ownerUsername", 64); target = await Owner(name); role = "owner";
            foreach (var old in await db.Memberships.Where(m => m.EnterpriseId == id && m.Role == "owner").ToArrayAsync()) old.Role = "manager";
        } else if (userId == null) {
            var input = WarehouseService.Body<MemberInput>(body!.Value); target = await Owner(input.Username); role = input.Role;
        } else {
            target = await db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.Kind == "staff") ?? throw ApiFailure.Missing();
            role = Request.Method == "DELETE" ? null : WarehouseService.Body<RoleInput>(body!.Value).Role;
        }
        if (!ownerChange && role != null && role is not ("manager" or "warehouse" or "waiter")) throw ApiFailure.Invalid("role");
        var member = await db.Memberships.FirstOrDefaultAsync(m => m.EnterpriseId == id && m.UserId == target.Id);
        if (!ownerChange && member?.Role == "owner") throw ApiFailure.Conflict("OWNER_IMMUTABLE");
        if (role == null) { if (member == null) throw ApiFailure.Missing(); db.Memberships.Remove(member); }
        else if (member == null) { member = new() { EnterpriseId = id, UserId = target.Id, Role = role }; db.Memberships.Add(member); }
        else { if (userId == null && !ownerChange) throw ApiFailure.Conflict("MEMBERSHIP_EXISTS"); member.Role = role; }
        await db.SaveChangesAsync(); await tx.CommitAsync();
        return role == null ? Results.NoContent() : OkEnvelope(new { userId = target.Id, target.Username, target.DisplayName, role }, userId == null && !ownerChange ? 201 : 200);
    }
    public record OwnerInput(string OwnerUsername);
}

