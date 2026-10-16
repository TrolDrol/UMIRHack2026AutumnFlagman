using System.Threading.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Infrastructure;
using RestaurantManagement.Infrastructure.Persistence;
using RestaurantManagement.WebApi.V2;

var administrative = args.FirstOrDefault(a => a is "migrate" or "bootstrap-admin" or "rotate-instance" or "seed-demo");
var builder = WebApplication.CreateBuilder(args.Where(a => a != administrative).ToArray());
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Default") ?? builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString)) throw new InvalidOperationException("Explicit ConnectionStrings__Default is required; no database fallback.");
builder.Services.AddInfrastructure(connectionString);
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<AccessService>();
builder.Services.AddScoped<WarehouseService>();
builder.Services.AddSingleton<AvailabilityFeed>();
builder.Services.AddAuthentication("rims_session")
    .AddPolicyScheme("rims_session","RIMS session",o=>o.ForwardDefaultSelector=http=>http.Request.Path.StartsWithSegments("/api/v2/customer",StringComparison.OrdinalIgnoreCase)?"customer":"staff")
    .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions,PersistentSessionHandler>("staff",_=>{})
    .AddScheme<Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions,PersistentSessionHandler>("customer",_=>{});
builder.Services.AddAuthorization();
builder.Services.AddSingleton<LiveMetrics>();
if (builder.Configuration.GetValue<bool>("App:MetricsEnabled")) builder.Services.AddHostedService(sp => sp.GetRequiredService<LiveMetrics>());
builder.Services.AddAntiforgery(o => { o.HeaderName = "X-CSRF-TOKEN"; o.Cookie.Name = "rims_csrf"; o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Lax; o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; });
var keyDirectory = builder.Configuration["App:DataProtectionPath"] ?? Path.Combine(builder.Environment.ContentRootPath, ".keys");
builder.Services.AddDataProtection().SetApplicationName("rims-backend").PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));
builder.Services.AddControllers().AddJsonOptions(o => {
    o.JsonSerializerOptions.PropertyNamingPolicy = ContractJson.Options.PropertyNamingPolicy;
    o.JsonSerializerOptions.PropertyNameCaseInsensitive = false;
    o.JsonSerializerOptions.NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.Strict;
    o.JsonSerializerOptions.UnmappedMemberHandling = ContractJson.Options.UnmappedMemberHandling;
    o.JsonSerializerOptions.Converters.Add(new UtcConverter());
}).ConfigureApplicationPartManager(m => m.FeatureProviders.Add(new RetireV1Controllers()));
builder.Services.Configure<ApiBehaviorOptions>(o => o.InvalidModelStateResponseFactory = context => {
    var fields = context.ModelState.SelectMany(p => p.Value!.Errors.Select(e => new { path = ApiMiddleware.FieldPath(p.Key), message = "Неверный формат поля" })).ToArray();
    var failure = new ApiFailure(422, "VALIDATION_ERROR", "Проверьте поля запроса", new { fields });
    return new JsonResult(ApiMiddleware.Error(context.HttpContext, context.HttpContext.RequestServices.GetRequiredService<TimeProvider>().GetUtcNow().UtcDateTime, failure), ContractJson.Options) { StatusCode = 422 };
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
var trustedProxies = builder.Configuration.GetSection("App:TrustedProxies").Get<string[]>() ?? [];
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(o => {
    o.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Clear();
    o.KnownIPNetworks.Clear();
    foreach (var proxy in trustedProxies) o.KnownProxies.Add(System.Net.IPAddress.Parse(proxy));
});
builder.Services.AddRateLimiter(o => {
    o.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(http.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions { PermitLimit = builder.Configuration.GetValue("App:AuthRateLimit",30), Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.OnRejected = async (context, ct) => {
        context.HttpContext.Response.StatusCode = 429; context.HttpContext.Response.Headers.RetryAfter = "60";
        await context.HttpContext.Response.WriteAsJsonAsync(ApiMiddleware.Error(context.HttpContext, DateTime.UtcNow, new ApiFailure(429, "RATE_LIMITED", "Слишком много попыток")), ContractJson.Options, ct);
    };
});
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 1048576);
var origins = builder.Configuration.GetSection("App:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p => { if (origins.Length > 0) p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials(); }));
var app = builder.Build();
if (administrative != null) {
    await using var scope = app.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (administrative == "migrate") await db.Database.MigrateAsync();
    else if (administrative == "bootstrap-admin") {
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Runtime.FromSqlRaw("SELECT * FROM runtime_metadata WHERE \"Id\"=1 FOR UPDATE").SingleAsync();
        var username = builder.Configuration["Bootstrap:Username"]; var password = builder.Configuration["Bootstrap:Password"];
        if (string.IsNullOrWhiteSpace(username) || password == null || password.Length < 12) throw new InvalidOperationException("Bootstrap__Username and Bootstrap__Password (12+ characters) required.");
        if (await db.Users.AnyAsync(u => u.IsSuperAdmin)) throw new InvalidOperationException("A super administrator already exists; bootstrap is one-time.");
        var user = new UserAccount { Id = Guid.NewGuid(), Username = username.Trim(), NormalizedUsername = username.Trim().ToUpperInvariant(), DisplayName = builder.Configuration["Bootstrap:DisplayName"] ?? username, IsSuperAdmin = true };
        user.PasswordHash = new Microsoft.AspNetCore.Identity.PasswordHasher<UserAccount>().HashPassword(user, password);
        db.Users.Add(user); await db.SaveChangesAsync(); await tx.CommitAsync();
    } else if (administrative == "seed-demo") {
        if (!app.Environment.IsDevelopment()) throw new InvalidOperationException("seed-demo is only permitted in Development.");
        await scope.ServiceProvider.GetRequiredService<WarehouseService>().SeedDemo(builder.Configuration["Demo:Password"] ?? "");
    } else { var runtime = await db.Runtime.SingleAsync(); runtime.BackendInstanceId = Guid.NewGuid(); await db.SaveChangesAsync(); }
    return;
}
if (trustedProxies.Length > 0) app.UseForwardedHeaders();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });
app.UseMiddleware<ApiMiddleware>();
app.UseStatusCodePages(async c => {
    var status = c.HttpContext.Response.StatusCode;
    var code = status switch { 404 => "NOT_FOUND", 405 => "METHOD_NOT_ALLOWED", 415 => "UNSUPPORTED_MEDIA_TYPE", 413 => "PAYLOAD_TOO_LARGE", _ => "REQUEST_REJECTED" };
    await c.HttpContext.Response.WriteAsJsonAsync(ApiMiddleware.Error(c.HttpContext, DateTime.UtcNow, new ApiFailure(status, code, "Запрос отклонён")), ContractJson.Options);
});
app.UseCors();
// Register on the main pipeline so WebApplication does not insert another
// authentication middleware before health/metrics. The handler limits itself
// to cookie API routes; infrastructure endpoints stay usable during DB loss.
app.UseAuthentication();
app.UseRateLimiter();
if (app.Environment.IsDevelopment()) {
    app.MapGet("/openapi/v2.json", () => Results.Json(ContractOpenApi.Generate(app.Services, app.Environment.ContentRootPath)));
    app.UseSwaggerUI(o => o.SwaggerEndpoint("/openapi/v2.json", "RIMS 2.1"));
}
app.MapControllers();
app.MapGet("/api/v2/warehouses/{warehouseId:guid}/availability/ws", AvailabilitySocket.Handle);
app.MapGet("/api/v2/customer/warehouses/{warehouseId:guid}/availability/ws", AvailabilitySocket.Handle);
if (builder.Configuration.GetValue<bool>("App:MetricsEnabled")) app.MapGet("/metrics", (LiveMetrics metrics) => Results.Text(metrics.Export(), "text/plain; version=0.0.4"));
app.MapGet("/health/live", () => Results.Json(new { status = "ok" }));
app.MapGet("/health/ready", async (AppDbContext db) => {
    try { if (!await db.Database.CanConnectAsync() || (await db.Database.GetPendingMigrationsAsync()).Any() || (await db.Database.GetAppliedMigrationsAsync()).Except(db.Database.GetMigrations()).Any() || db.Database.HasPendingModelChanges() || !await db.Runtime.AnyAsync()) return Results.Json(new { status = "unavailable" }, statusCode: 503); return Results.Json(new { status = "ok" }); }
    catch { return Results.Json(new { status = "unavailable" }, statusCode: 503); }
});
app.Run();
public partial class Program;
sealed class RetireV1Controllers : IApplicationFeatureProvider<ControllerFeature>
{
    public void PopulateFeature(IEnumerable<ApplicationPart> parts, ControllerFeature feature)
    {
        foreach (var type in feature.Controllers.Where(t => t.Namespace == "RestaurantManagement.WebApi.Controllers").ToArray()) feature.Controllers.Remove(type);
    }
}
