using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using RestaurantManagement.Domain.Common.Exceptions;
using RestaurantManagement.Domain.Supplies.Exceptions;
using RestaurantManagement.Domain.Orders.Exceptions;

namespace RestaurantManagement.WebApi.Middleware;

public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (DomainException ex)
        {
            _logger.LogWarning(ex, "Доменный инвариант нарушен: {Message}", ex.Message);
            await HandleDomainExceptionAsync(context, ex);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException pg && pg.SqlState == "23505")
        {
            _logger.LogWarning(ex, "Попытка записи дубликата уникального ключа в БД.");
            context.Response.ContentType = "application/json";
            context.Response.StatusCode = StatusCodes.Status409Conflict;

            var response = new
            {
                error = new
                {
                    code = "NAME_CONFLICT",
                    message = "Документ с таким номером уже существует для этого склада."
                },
                meta = new { serverTime = DateTime.UtcNow, requestId = Guid.NewGuid() }
            };
            await context.Response.WriteAsync(JsonSerializer.Serialize(response, JsonOptions));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Критическая ошибка сервера");
            await HandleExceptionAsync(context, ex);
        }
    }

    private static Task HandleDomainExceptionAsync(HttpContext context, DomainException exception)
    {
        context.Response.ContentType = "application/json";
        
        var statusCode = StatusCodes.Status422UnprocessableEntity; 
        var errorCode = "VALIDATION_ERROR";
        object? detailsObj = null;

        switch (exception)
        {
            case DishNotFoundException:
            case WarehouseMismatchException:
            case DeliveryNotFoundException:
                statusCode = StatusCodes.Status404NotFound;
                errorCode = "NOT_FOUND";
                break;

            case InsufficientIngredientsException iie:
                statusCode = StatusCodes.Status409Conflict;
                errorCode = "INSUFFICIENT_STOCK";
                detailsObj = new { shortages = iie.MissingIngredients.Values.Select(v => new { ingredientId = v.IngredientId.Value, name = v.IngredientName, missing = v.MissingQuantity.Value }) };
                break;

            case DishInactiveException:
                statusCode = StatusCodes.Status409Conflict;
                errorCode = "DISH_INACTIVE";
                break;

            case DuplicateDishInOrderException:
            case TooManyDishesInOrderException:
            case InvalidOrderQuantityException:
            case EmptyOrderException:
                statusCode = StatusCodes.Status422UnprocessableEntity;
                errorCode = "BAD_REQUEST_STRUCTURE";
                break;
        }

        context.Response.StatusCode = statusCode;

        var response = new
        {
            error = new
            {
                code = errorCode,
                message = exception.Message,
                details = detailsObj ?? new { exceptionType = exception.GetType().Name }
            },
            meta = new { serverTime = DateTime.UtcNow, requestId = Guid.NewGuid() }
        };

        return context.Response.WriteAsync(JsonSerializer.Serialize(response, JsonOptions));
    }

    private static Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        context.Response.ContentType = "application/json";
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;

        var response = new
        {
            error = new
            {
                code = "INTERNAL_SERVER_ERROR",
                message = "Произошла непредвиденная ошибка на стороне бэкенда."
            },
            meta = new { serverTime = DateTime.UtcNow, requestId = Guid.NewGuid() }
        };

        return context.Response.WriteAsync(JsonSerializer.Serialize(response, JsonOptions));
    }
}
