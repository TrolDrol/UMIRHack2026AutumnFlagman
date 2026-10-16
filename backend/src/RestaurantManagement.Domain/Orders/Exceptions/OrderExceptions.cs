using RestaurantManagement.Domain.Common.Exceptions;
using RestaurantManagement.Domain.Ingredients.ValueObjects;
using RestaurantManagement.Domain.Orders.Models;

namespace RestaurantManagement.Domain.Orders.Exceptions;

public class InvalidOrderIdException : DomainException
{
    public InvalidOrderIdException(string message) : base(message) { }
}

public class InvalidOrderItemIdException : DomainException
{
    public InvalidOrderItemIdException(string message) : base(message) { }
}

public class InvalidOrderQuantityException : DomainException
{
    public InvalidOrderQuantityException(string message) : base(message) { }
}

public class EmptyOrderException : DomainException
{
    public EmptyOrderException(string message) : base(message) { }
}

public class InvalidOrderStatusTransitionException : DomainException
{
    public InvalidOrderStatusTransitionException(string message) : base(message) { }
}

public class InvalidOrderDateException : DomainException
{
    public InvalidOrderDateException(string message) : base(message) { }
}

public class DishNotFoundException : DomainException
{
    public DishNotFoundException(string message) : base(message) { }
}

public class DishInactiveException : DomainException
{
    public DishInactiveException(string message) : base(message) { }
}

public class InvalidOrderItemNameException : DomainException
{
    public InvalidOrderItemNameException(string message) : base(message) { }
}

public class InsufficientIngredientsException : DomainException
{
    public IReadOnlyDictionary<IngredientId, Requirement> MissingIngredients { get; }

    public InsufficientIngredientsException(string message, IReadOnlyDictionary<IngredientId, Requirement> missingIngredients) 
        : base(message)
    {
        MissingIngredients = missingIngredients;
    }
}

public class InvalidOrderAllocationIdException : DomainException
{
    public InvalidOrderAllocationIdException(string message) : base(message) { }
}

public class UnitMeasurementConflictException : DomainException
{
    public UnitMeasurementConflictException(string message) : base(message) { }
}

public class DuplicateDishInOrderException : DomainException
{
    public DuplicateDishInOrderException(string message) : base(message) { }
}

public class TooManyDishesInOrderException : DomainException
{
    public TooManyDishesInOrderException(string message) : base(message) { }
}
