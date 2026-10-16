using RestaurantManagement.Domain.Common.Exceptions;

namespace RestaurantManagement.Domain.Supplies.Exceptions;

public class InvalidDeliveryNumberException : DomainException
{
    public InvalidDeliveryNumberException(string message) : base(message) { }
}

public class InvalidDeliveryDateException : DomainException
{
    public InvalidDeliveryDateException(string message) : base(message) { }
}

public class InvalidDeliveryConfirmationException : DomainException
{
    public InvalidDeliveryConfirmationException(string message) : base(message) { }
}

public class InvalidDeliveryStateException : DomainException
{
    public InvalidDeliveryStateException(string message) : base(message) { }
}

public class InvalidExpirationDateException : DomainException
{
    public InvalidExpirationDateException(string message) : base(message) { }
}

public class DeliveryNotFoundException : DomainException
{
    public DeliveryNotFoundException(string message) : base(message) { }
}

public class WarehouseMismatchException : DomainException
{
    public WarehouseMismatchException(string message) : base(message) { }
}

public class InvalidQuantityException : DomainException
{
    public InvalidQuantityException(string message) : base(message) { }
}

public class InsufficientStockException : DomainException
{
    public InsufficientStockException(string message) : base(message) { }
}

public class InvalidBatchIdException : DomainException
{
    public InvalidBatchIdException(string message) : base(message) { }
}

public class InvalidDeliveryIdException : DomainException
{
    public InvalidDeliveryIdException(string message) : base(message) { }
}

public class InvalidDeliveryItemIdException : DomainException
{
    public InvalidDeliveryItemIdException(string message) : base(message) { }
}