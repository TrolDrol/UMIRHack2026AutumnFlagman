namespace RestaurantManagement.Domain.Orders.ValueObjects;

public enum OrderStatus
{
    Created = 1,   // Заказ создан, ожидает проверки остатков/кухни
    Paid = 2,      // Заказ успешно оплачен и списан со склада
    Cancelled = 3  // Отклонен (например, если не хватило продуктов)
}
