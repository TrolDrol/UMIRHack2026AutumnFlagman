using RestaurantManagement.Domain.Common.Exceptions;

namespace RestaurantManagement.Domain.Ingredients.Exceptions;

public class InvalidIngredientIdException : DomainException
{
    public InvalidIngredientIdException(string message) : base(message) { }
}

public class InvalidIngredientNameException : DomainException
{
    public InvalidIngredientNameException(string message) : base(message) { }
}

public class InvalidIngredientShelfLifeException : DomainException
{
    public InvalidIngredientShelfLifeException(string message) : base(message) { }
}

public class InvalidIngredientStockException : DomainException
{
    public InvalidIngredientStockException(string message) : base(message) { }
}