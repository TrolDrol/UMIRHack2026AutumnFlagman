using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using RestaurantManagement.Application.Contracts;

namespace RestaurantManagement.WebApi.V2;

// Both schemes use opaque, revocable PostgreSQL sessions; no username/role is trusted from a cookie.
public sealed class PersistentSessionHandler(IOptionsMonitor<AuthenticationSchemeOptions> options,ILoggerFactory logger,UrlEncoder encoder,AccessService access)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options,logger,encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Path.StartsWithSegments("/api/v2", StringComparison.OrdinalIgnoreCase)
            || Request.Path.Equals("/api/v2/runtime", StringComparison.OrdinalIgnoreCase))
            return AuthenticateResult.NoResult();
        try {
            var user=await access.User(Context,Scheme.Name);
            var claims=new List<Claim>{new(ClaimTypes.NameIdentifier,user.Id.ToString()),new(ClaimTypes.Name,user.Username),new("account_kind",user.Kind)};
            if(user.IsSuperAdmin)claims.Add(new(ClaimTypes.Role,"super_admin"));
            return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims,Scheme.Name)),Scheme.Name));
        } catch(ApiFailure error) when(error.Status==401) { return AuthenticateResult.NoResult(); }
    }
    protected override Task HandleChallengeAsync(AuthenticationProperties properties) => throw new ApiFailure(401,"UNAUTHENTICATED","Войдите в систему");
    protected override Task HandleForbiddenAsync(AuthenticationProperties properties) => throw new ApiFailure(403,"FORBIDDEN","Недостаточно прав");
}
