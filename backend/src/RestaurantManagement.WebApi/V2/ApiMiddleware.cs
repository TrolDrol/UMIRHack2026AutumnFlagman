using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Domain.Common.Exceptions;

namespace RestaurantManagement.WebApi.V2;

public sealed class ApiMiddleware(RequestDelegate next, ILogger<ApiMiddleware> log)
{
    public async Task InvokeAsync(HttpContext http, TimeProvider clock, LiveMetrics metrics)
    {
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var originalAbort = http.RequestAborted;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(originalAbort);
        if (!http.WebSockets.IsWebSocketRequest) timeout.CancelAfter(TimeSpan.FromSeconds(15));
        http.RequestAborted = timeout.Token;
        http.Items["requestId"] = Guid.NewGuid();
        if (http.Request.Method == "GET") http.Response.Headers.CacheControl = "no-store";
        try {
            if (http.Request.Method is "POST" or "PUT" or "PATCH" && !string.IsNullOrEmpty(http.Request.ContentType) && !http.Request.HasJsonContentType()) throw new ApiFailure(415,"UNSUPPORTED_MEDIA_TYPE","Требуется application/json");
            if (http.Request.Method is "POST" or "PUT" or "PATCH" && (http.Request.ContentLength > 0 || http.Request.Headers.ContainsKey("Transfer-Encoding"))) {
                if (!http.Request.HasJsonContentType()) throw new ApiFailure(415, "UNSUPPORTED_MEDIA_TYPE", "Требуется application/json");
                if (http.Request.ContentLength > 1048576) throw new ApiFailure(413, "PAYLOAD_TOO_LARGE", "Тело превышает 1 MiB");
                http.Request.EnableBuffering(65536, 1048576);
                try { using var document = await JsonDocument.ParseAsync(http.Request.Body, cancellationToken: http.RequestAborted); }
                catch (JsonException) { throw new ApiFailure(400, "INVALID_JSON", "Неверный JSON"); }
                catch (IOException) { throw new ApiFailure(413, "PAYLOAD_TOO_LARGE", "Тело превышает 1 MiB"); }
                http.Request.Body.Position = 0;
            }
            await next(http);
        }
        catch (Exception ex) when (!http.Response.HasStarted)
        {
            var root = ex;
            while (root.InnerException != null) root = root.InnerException;
            var failure = ex switch {
                ApiFailure a => a,
                OperationCanceledException => new ApiFailure(503, "RETRY_LATER", "Время обработки истекло; повторите с прежним ключом"),
                JsonException j => ApiFailure.Invalid(FieldPath(j.Path ?? "body"), "Неверный формат поля"),
                BadHttpRequestException b => new ApiFailure(b.StatusCode, b.StatusCode == 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", "Неверный запрос"),
                DomainException or ArgumentException => ApiFailure.Invalid("body", ex.Message),
                PostgresException p when p.SqlState is "55P03" or "57014" => new ApiFailure(503, "RETRY_LATER", "Повторите запрос с прежним ключом"),
                DbUpdateException d when d.InnerException is PostgresException { SqlState: "23505", ConstraintName: "ux_manual_offer_dish" } => ApiFailure.Conflict("MANUAL_OFFER_EXISTS"),
                DbUpdateException d when d.InnerException is PostgresException { SqlState: "23505" } => ApiFailure.Conflict("NAME_CONFLICT"),
                _ => new ApiFailure(500, "INTERNAL_ERROR", "Внутренняя ошибка сервера")
            };
            if (root is PostgresException { SqlState: "55P03" or "57014" }) failure = new ApiFailure(503, "RETRY_LATER", "Повторите запрос с прежним ключом");
            if (failure.Status >= 500) log.LogError(ex, "API failure {RequestId}", http.Items["requestId"]);
            http.Response.StatusCode = failure.Status;
            await http.Response.WriteAsJsonAsync(Error(http, ContractJson.Now(clock), failure), ContractJson.Options, originalAbort);
        }
        finally {
            http.RequestAborted = originalAbort; metrics.Observe(http, stopwatch.Elapsed.TotalSeconds);
            log.LogInformation("HTTP {Method} {Route} {Status} {DurationMs} {RequestId}",http.Request.Method,
                (http.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "unmatched",http.Response.StatusCode,stopwatch.Elapsed.TotalMilliseconds,http.Items["requestId"]);
        }
    }
    public static Meta Meta(HttpContext http, DateTime now) => new(now, (Guid)(http.Items["requestId"] ?? Guid.NewGuid()));
    public static string FieldPath(string path) => System.Text.RegularExpressions.Regex.Replace(path.TrimStart('$','.'),@"\[(\d+)\]",".$1");
    public static object Error(HttpContext http, DateTime now, ApiFailure f) => new { error = new { code = f.Code, message = f.Message, details = f.Details }, meta = Meta(http, now) };
}

