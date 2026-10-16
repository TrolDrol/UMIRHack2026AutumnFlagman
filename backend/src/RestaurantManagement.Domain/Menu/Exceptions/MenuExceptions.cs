using RestaurantManagement.Domain.Common.Exceptions;

namespace RestaurantManagement.Domain.Menu.Exceptions;

public class InvalidDishIdException : DomainException
{
    public InvalidDishIdException(string message) : base(message) { }
}

public class InvalidDishNameException : DomainException
{
    public InvalidDishNameException(string message) : base(message) { }
}

public class InvalidRecipeIngredientNameException : DomainException
{
    public InvalidRecipeIngredientNameException(string message) : base(message) { }
}

public class DuplicateRecipeIngredientException : DomainException
{
    public DuplicateRecipeIngredientException(string message) : base(message) { }
}

public class RecipeIngredientNotFoundException : DomainException
{
    public RecipeIngredientNotFoundException(string message) : base(message) { }
}

public class InvalidRecipeIngredientIdException : DomainException
{
    public InvalidRecipeIngredientIdException(string message) : base(message) { }
}

public class CannotChangeIngredientProductException : DomainException
{
    public CannotChangeIngredientProductException(string message) : base(message) { }
}

public class TooManyRecipeIngredientsException : DomainException
{
    public TooManyRecipeIngredientsException(string message) : base(message) { }
}

public class InvalidIngredientRequirementException : DomainException
{
    public InvalidIngredientRequirementException(string message) : base(message) { }
}
