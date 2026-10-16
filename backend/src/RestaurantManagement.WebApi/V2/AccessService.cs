using System.Security.Cryptography;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Infrastructure.Persistence;

namespace RestaurantManagement.WebApi.V2;

public record Actor(Guid Id, string Kind, string? Role = null, Guid? ClientId = null)
{
    public string ReplayScope => Kind + ":" + (ClientId ?? Id);
}

public sealed class AccessService(AppDbContext db, TimeProvider clock, IDataProtectionProvider protection, IAntiforgery antiforgery, IConfiguration config)
{
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value)));
    static string Cookie(string kind) => kind == "customer" ? "rims_customer_session" : "rims_staff_session";
    IDataProtector Protector(string kind) => protection.CreateProtector("rims.session." + kind);
    public async Task<UserAccount> User(HttpContext http, string kind)
    {
        string? sessionId = null;
        try { if (http.Request.Cookies.TryGetValue(Cookie(kind), out var cookie)) sessionId = Hash(Protector(kind).Unprotect(cookie)); }
        catch (Exception ex) when(ex is CryptographicException or FormatException or ArgumentException) { }
        if (sessionId == null) throw new ApiFailure(401, "UNAUTHENTICATED", "Войдите в систему");
        var now = ContractJson.Now(clock);
        var session = await db.Sessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sessionId && s.Kind == kind && s.ExpiresAt > now, http.RequestAborted);
        if (session == null) throw new ApiFailure(401, "UNAUTHENTICATED", "Войдите в систему");
        return await db.Users.AsNoTracking().FirstAsync(u => u.Id == session.UserId && u.Kind == kind, http.RequestAborted);
    }
    public async Task<Actor> Warehouse(HttpContext http, Guid warehouseId, string channel, string[] roles, bool requirePublished = true)
    {
        if (channel == "integration")
        {
            var auth = http.Request.Headers.Authorization.ToString();
            if (!auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) throw new ApiFailure(401, "UNAUTHENTICATED", "Требуется ключ интеграции");
            var hash = Hash(auth[7..]);
            var now = ContractJson.Now(clock);
            var key = await db.IntegrationKeys.AsNoTracking().FirstOrDefaultAsync(k => k.SecretHash == hash && k.RevokedAt == null && (k.ExpiresAt == null || k.ExpiresAt > now), http.RequestAborted);
            if (key == null) throw new ApiFailure(401, "INVALID_INTEGRATION_KEY", "Ключ недействителен");
            var client = await db.IntegrationClients.AsNoTracking().FirstAsync(c => c.Id == key.ClientId, http.RequestAborted);
            if (client.WarehouseId != warehouseId) throw ApiFailure.Missing();
            if (!roles.Contains(client.Kind)) throw new ApiFailure(403, "INSUFFICIENT_SCOPE", "Недостаточно прав интеграции");
            return new(client.Id, "integration", client.Kind, client.Id);
        }
        var user = await User(http, channel == "customer" ? "customer" : "staff");
        var warehouse = await db.Warehouses.AsNoTracking().FirstOrDefaultAsync(w => w.Id == warehouseId, http.RequestAborted) ?? throw ApiFailure.Missing();
        if (channel == "customer")
        {
            if (requirePublished && !warehouse.CustomerPublished) throw ApiFailure.Missing();
            ExpectedUser(http, user.Id);
            return new(user.Id, "customer", "customer");
        }
        var membership = await db.Memberships.AsNoTracking().FirstOrDefaultAsync(m => m.EnterpriseId == warehouse.EnterpriseId && m.UserId == user.Id, http.RequestAborted);
        if (!user.IsSuperAdmin && membership == null) throw ApiFailure.Missing();
        var role = user.IsSuperAdmin ? "super_admin" : membership!.Role;
        if (!roles.Contains(role)) throw new ApiFailure(403, "FORBIDDEN", "Недостаточно прав");
        ExpectedUser(http, user.Id);
        return new(user.Id, "staff", role);
    }
    public static void ExpectedUser(HttpContext http, Guid userId)
    {
        if (http.Request.Method is "GET" or "HEAD" or "OPTIONS") return;
        if (!Guid.TryParse(http.Request.Headers["X-Rims-Expected-User-Id"], out var expected) || expected != userId)
            throw ApiFailure.Conflict("SESSION_CONTEXT_CHANGED");
    }
    public async Task CookieMutation(HttpContext http)
    {
        var origin = http.Request.Headers.Origin.ToString();
        var allowed = config.GetSection("App:AllowedOrigins").Get<string[]>() ?? [];
        if (origin.Length == 0 || !allowed.Contains(origin, StringComparer.Ordinal))
            throw new ApiFailure(403, "ORIGIN_FORBIDDEN", "Источник запроса не разрешён");
        try { await antiforgery.ValidateRequestAsync(http); }
        catch (AntiforgeryValidationException) { throw new ApiFailure(403, "CSRF_INVALID", "Обновите защитный токен"); }
    }
    public object Csrf(HttpContext http) => new { requestToken = antiforgery.GetAndStoreTokens(http).RequestToken };
    public async Task<object> Register(HttpContext http, UserInput input, string kind)
    {
        var user = await CreateUser(input, kind, http.RequestAborted);
        await db.SaveChangesAsync(http.RequestAborted);
        await LoginCookie(http, user);
        return Dto(user);
    }
    // Administrative account creation must not replace the caller's session.
    public async Task<UserAccount> CreateUser(UserInput input, string kind, CancellationToken cancellationToken)
    {
        if (input.Username == null || !System.Text.RegularExpressions.Regex.IsMatch(input.Username.Trim(), "^[a-zA-Z0-9_.-]{3,64}$") || string.IsNullOrWhiteSpace(input.DisplayName) || input.DisplayName.Trim().Length > 120 || input.Password is null || input.Password.Length is < 12 or > 128)
            throw ApiFailure.Invalid("username", "Логин, имя и пароль (12–128 символов) обязательны");
        var normalized = input.Username.Trim().ToUpperInvariant();
        if (await db.Users.AnyAsync(u => u.Kind == kind && u.NormalizedUsername == normalized, cancellationToken)) throw ApiFailure.Conflict("USERNAME_EXISTS");
        var user = new UserAccount { Id = Guid.NewGuid(), Username = input.Username.Trim(), NormalizedUsername = normalized, DisplayName = input.DisplayName.Trim(), Kind = kind };
        user.PasswordHash = new PasswordHasher<UserAccount>().HashPassword(user, input.Password);
        db.Users.Add(user);
        return user;
    }
    public async Task<object> Login(HttpContext http, UserInput input, string kind)
    {
        if (input.Username == null || input.Password == null || input.Password.Length > 256) throw ApiFailure.Invalid("username");
        var normalized = input.Username.Trim().ToUpperInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Kind == kind && u.NormalizedUsername == normalized);
        // The dummy hash keeps the nonexistent-account path on the same expensive password verifier.
        var hasher = new PasswordHasher<UserAccount>();
        var candidate = user ?? new UserAccount();
        var hash = user?.PasswordHash ?? DummyHash;
        if (hasher.VerifyHashedPassword(candidate, hash, input.Password) == PasswordVerificationResult.Failed || user == null)
            throw new ApiFailure(401, "INVALID_CREDENTIALS", "Неверный логин или пароль");
        await LoginCookie(http, user);
        return Dto(user);
    }
    static readonly string DummyHash = new PasswordHasher<UserAccount>().HashPassword(new(), Convert.ToHexString(RandomNumberGenerator.GetBytes(32)));
    async Task LoginCookie(HttpContext http, UserAccount user)
    {
        await Logout(http, user.Kind);
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var expires = ContractJson.Now(clock).AddHours(12);
        db.Sessions.Add(new() { Id = Hash(token), Kind = user.Kind, UserId = user.Id, ExpiresAt = expires });
        await db.SaveChangesAsync(http.RequestAborted);
        http.Response.Cookies.Append(Cookie(user.Kind), Protector(user.Kind).Protect(token), new CookieOptions {
            HttpOnly = true, Secure = http.Request.IsHttps, SameSite = SameSiteMode.Lax, Path = "/", Expires = new DateTimeOffset(expires)
        });
    }
    public async Task Logout(HttpContext http, string kind)
    {
        if (http.Request.Cookies.TryGetValue(Cookie(kind), out var cookie))
        {
            try {
                var id = Hash(Protector(kind).Unprotect(cookie));
                await db.Sessions.Where(s => s.Id == id && s.Kind == kind).ExecuteDeleteAsync(http.RequestAborted);
            } catch (Exception ex) when(ex is CryptographicException or FormatException or ArgumentException) { }
        }
        http.Response.Cookies.Delete(Cookie(kind), new CookieOptions { Path = "/", Secure = http.Request.IsHttps, HttpOnly = true, SameSite = SameSiteMode.Lax });
    }
    public static object Dto(UserAccount u) => u.Kind == "customer" ? (object)new { u.Id, u.Username, u.DisplayName, role = "customer" } : new { u.Id, u.Username, u.DisplayName, u.IsSuperAdmin };
}

