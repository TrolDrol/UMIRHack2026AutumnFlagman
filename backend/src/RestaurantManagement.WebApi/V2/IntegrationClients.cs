using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using RestaurantManagement.Application.Contracts;
using RestaurantManagement.Infrastructure.Persistence;

namespace RestaurantManagement.WebApi.V2;

public sealed partial class WarehouseService
{
    static object ClientDto(IntegrationClientRecord c) => new { c.Id, c.WarehouseId, c.Name, c.Kind, c.CreatedAt };
    static object KeyDto(IntegrationKeyRecord k) => new { k.Id, k.ClientId, k.Label, k.CreatedAt, k.ExpiresAt, k.RevokedAt };
    public CommandResult CreateClient(WarehouseSnapshot s, ClientInput input)
    {
        var c = new IntegrationClientRecord { Id = Guid.NewGuid(), WarehouseId = s.Warehouse.Id, Name = input.Name.Trim(), Kind = input.Kind, CreatedAt = s.Now };
        db.IntegrationClients.Add(c); s.Clients.Add(c); return Ok(ClientDto(c), 201);
    }
    public CommandResult CreateKey(WarehouseSnapshot s, Guid id, KeyInput input)
    {
        if (!s.Clients.Any(c => c.Id == id)) throw ApiFailure.Missing();
        if (input.ExpiresAt <= s.Now) throw ApiFailure.Invalid("expiresAt");
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var k = new IntegrationKeyRecord { Id = Guid.NewGuid(), ClientId = id, Label = input.Label.Trim(), CreatedAt = s.Now, ExpiresAt = input.ExpiresAt, SecretHash = AccessService.Hash(token) };
        db.IntegrationKeys.Add(k); return Ok(new { key = KeyDto(k), token }, 201);
    }
    public CommandResult ReadClients(WarehouseSnapshot s, string resource, Guid? id, IQueryCollection q)
    {
        QueryKeys(q, "page", "pageSize");
        if (resource == "integration-clients") return Ok(Paginate(s.Clients.OrderBy(c => c.Name, StringComparer.Ordinal).ThenBy(c => c.Id.ToString(), StringComparer.Ordinal).Select(ClientDto), q));
        if (!s.Clients.Any(c => c.Id == id)) throw ApiFailure.Missing();
        var keys = db.IntegrationKeys.Where(k => k.ClientId == id).ToList().OrderByDescending(k => k.CreatedAt).ThenByDescending(k => k.Id.ToString(), StringComparer.Ordinal).Select(KeyDto);
        return Ok(Paginate(keys, q));
    }
    public CommandResult RevokeKey(WarehouseSnapshot s, Guid id, Guid keyId)
    {
        if (!s.Clients.Any(c => c.Id == id)) throw ApiFailure.Missing();
        var k = db.IntegrationKeys.FirstOrDefault(k => k.Id == keyId && k.ClientId == id) ?? throw ApiFailure.Missing();
        k.RevokedAt ??= s.Now; return new(204, null);
    }
}
