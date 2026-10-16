using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace RestaurantManagement.Application.Contracts;

public sealed class ApiFailure(int status, string code, string message, object? details = null) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public object Details { get; } = details ?? new { };
    public static ApiFailure Invalid(string path, string message = "Недопустимое значение") =>
        new(422, "VALIDATION_ERROR", message, new { fields = new[] { new { path, message } } });
    public static ApiFailure Missing() => new(404, "NOT_FOUND", "Объект не найден");
    public static ApiFailure Conflict(string code) => new(409, code, "Операция конфликтует с текущим состоянием");
}

[JsonConverter(typeof(AmountConverter))]
public readonly record struct Amount(decimal Value)
{
    public override string ToString() => Value.ToString("0.000", CultureInfo.InvariantCulture);
    public static implicit operator Amount(decimal value) => new(value);
}
public sealed class AmountConverter : JsonConverter<Amount>
{
    public override Amount Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.String) throw new JsonException("Quantity должна быть строкой");
        var s = reader.GetString()!;
        if (!Regex.IsMatch(s, @"^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$", RegexOptions.CultureInvariant))
            throw new JsonException("Неверный формат Quantity");
        return new(decimal.Parse(s, CultureInfo.InvariantCulture));
    }
    public override void Write(Utf8JsonWriter writer, Amount value, JsonSerializerOptions options) => writer.WriteStringValue(value.ToString());
}
public static class ContractJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    { PropertyNameCaseInsensitive = false, NumberHandling = JsonNumberHandling.Strict, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow, Converters = { new UtcConverter() } };
    public static string Serialize(object value) => JsonSerializer.Serialize(value, Options);
    public static T Parse<T>(string json) => JsonSerializer.Deserialize<T>(json, Options)!;
    public static DateTime Now(TimeProvider clock) {
        var ticks = clock.GetUtcNow().UtcDateTime.Ticks;
        return new DateTime((ticks + 9) / 10 * 10, DateTimeKind.Utc);
    }
    public static decimal Limit(decimal value)
    {
        if (value > 999999999.999m) throw new ApiFailure(422, "QUANTITY_LIMIT_EXCEEDED", "Превышен предел количества");
        return value;
    }
}
public sealed class UtcConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
    {
        var s = reader.GetString();
        if (s is null || !Regex.IsMatch(s, @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$") ||
            !DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out var value))
            throw new JsonException("Требуется RFC3339 с часовым поясом");
        if (value.UtcDateTime.Ticks % 10 != 0) throw new JsonException("Точность PostgreSQL Timestamp — до микросекунды");
        return value.UtcDateTime;
    }
    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToUniversalTime().ToString(value.Ticks % TimeSpan.TicksPerMillisecond == 0 ? "yyyy-MM-dd'T'HH:mm:ss.fff'Z'" : "yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'", CultureInfo.InvariantCulture));
}
public record Meta(DateTime ServerTime, Guid RequestId);
public record Envelope<T>(T Data, Meta Meta);
public record Page<T>(IReadOnlyList<T> Items, int PageNumber, int PageSize, int Total)
{
    [JsonPropertyName("page")] public int PageNumber { get; init; } = PageNumber;
}
public record IngredientInput(string Name, string Unit, int DefaultShelfLifeHours, Amount ReorderPoint, Amount TargetStock);
public record IngredientDto(Guid Id, string Name, string Unit, int DefaultShelfLifeHours, Amount ReorderPoint, Amount TargetStock);
public record RecipeLine(Guid IngredientId, Amount Quantity);
public record DishInput(string Name, bool Active, RecipeLine[] Recipe);
public record DishDto(Guid Id, string Name, bool Active, RecipeLine[] Recipe, DateTime CreatedAt, DateTime UpdatedAt);
public record DeliveryLineInput(Guid IngredientId, Amount Quantity, DateTime? ExpiresAt, DateTime? ManufacturedAt, int? ShelfLifeHours);
public record DeliveryInput(string Number, DateTime? ExpectedAt, string? Note, DeliveryLineInput[] Lines, string? ExternalId = null, Guid? PurchaseRequestId = null);
public record OrderLine(Guid DishId, int Portions);
public record ComboOrderLine(Guid ComboId, long Version, int Quantity);
public record OrderInput(OrderLine[] Lines, ComboOrderLine[]? Combos = null, string? ExternalId = null);
public record RiskSnapshot(string PolicyVersion, DateTime EvaluatedAt, DateTime ExpiresAt, int ShelfLifeHours, DateTime RiskStartsAt, string Phase);
public record AllocationDto(Guid BatchId, Guid IngredientId, Amount Quantity, DateTime ExpiresAt, RiskSnapshot? RiskSnapshot);
public record RequirementDto(Guid IngredientId, string IngredientName, string Unit, Amount RequiredQuantity, Amount AvailableQuantity, Amount MissingQuantity);
public record PreviewDto(bool CanCreate, RequirementDto[] Requirements, AllocationDto[] Allocations);
public record WriteOffInput(Guid BatchId, Amount Quantity, string Reason, string? Note);
public record Component(Guid DishId, int Portions);
public record ComboInput(string Title, Component[] Components, long? ExpectedVersion = null);
public record QuarantineInput(Guid BatchId, long ExpectedBatchVersion, Amount Quantity, string Reason, string? Note);
public record DecisionInput(long ExpectedVersion, Amount Quantity, string Reason, string? Note = null);
public record PurchaseInput(Guid SupplierClientId, DateTime? ExpectedAt, string? Note, RecipeLine[] Lines, long? Version = null);
public record VersionInput(long Version, string? Reason = null);
public record ExpectedVersionInput(long ExpectedVersion);
public record ConfirmInput(DateTime? ReceivedAt = null, string? ReceivedAtMode = null);
public record ReasonInput(string Reason);
public record ComboPlanInput(Guid[] CandidateDishIds);
public record UserInput(string Username, string Password, string? DisplayName = null);
public record EnterpriseInput(string Name, string OwnerUsername);
public record MemberInput(string Username, string Role);
public record RoleInput(string Role);
public record ClientInput(string Name, string Kind);
public record KeyInput(string Label, DateTime? ExpiresAt);
public record PublicationInput(bool Enabled);
