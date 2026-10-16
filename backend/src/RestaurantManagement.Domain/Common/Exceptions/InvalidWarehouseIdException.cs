using RestaurantManagement.Domain.Common.Exceptions;

namespace RestaurantManagement.Domain.Common.Exceptions;

public class InvalidWarehouseIdException : DomainException
{
    public InvalidWarehouseIdException(string message) : base(message) { }
}
