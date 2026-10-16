using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RestaurantManagement.Domain.Ingredients.Interfaces;
using RestaurantManagement.Domain.Menu.Interfaces;
using RestaurantManagement.Domain.Supplies.Interfaces;
using RestaurantManagement.Domain.Orders.Interfaces;
using RestaurantManagement.Infrastructure.Persistence;
using RestaurantManagement.Infrastructure.Persistence.Repositories;

namespace RestaurantManagement.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        string connectionString)
    {
        services.AddDbContext<AppDbContext>(options =>
            options.UseNpgsql(connectionString));

        services.AddScoped<IIngredientRepository, IngredientRepository>();
        services.AddScoped<IDishRepository, DishRepository>();
        services.AddScoped<IDeliveryRepository, DeliveryRepository>();
        services.AddScoped<IBatchRepository, BatchRepository>();
        services.AddScoped<IOrderRepository, OrderRepository>();
        services.AddScoped<RestaurantManagement.Domain.Common.IWarehouseTransaction, WarehouseTransaction>();
        services.AddScoped<RestaurantManagement.Domain.Supplies.Services.DeliveryConfirmationService>();
        services.AddScoped<RestaurantManagement.Domain.Orders.Services.OrderPlacementService>();

        return services;
    }
}
