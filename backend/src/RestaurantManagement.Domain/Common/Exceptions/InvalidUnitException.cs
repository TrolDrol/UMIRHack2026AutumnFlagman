namespace RestaurantManagement.Domain.Common.Exceptions;

public class InvalidUnitException : DomainException
{
    public InvalidUnitException(string message) : base(message) { }
}
