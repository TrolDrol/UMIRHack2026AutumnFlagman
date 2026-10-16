FROM mcr.microsoft.com/dotnet/sdk:10.0.401 AS build
WORKDIR /src
COPY backend/src/RestaurantManagement.Domain/RestaurantManagement.Domain.csproj backend/src/RestaurantManagement.Domain/
COPY backend/src/RestaurantManagement.Application/RestaurantManagement.Application.csproj backend/src/RestaurantManagement.Application/
COPY backend/src/RestaurantManagement.Infrastructure/RestaurantManagement.Infrastructure.csproj backend/src/RestaurantManagement.Infrastructure/
COPY backend/src/RestaurantManagement.WebApi/RestaurantManagement.WebApi.csproj backend/src/RestaurantManagement.WebApi/
COPY backend/src/RestaurantManagement.Domain/packages.lock.json backend/src/RestaurantManagement.Domain/
COPY backend/src/RestaurantManagement.Application/packages.lock.json backend/src/RestaurantManagement.Application/
COPY backend/src/RestaurantManagement.Infrastructure/packages.lock.json backend/src/RestaurantManagement.Infrastructure/
COPY backend/src/RestaurantManagement.WebApi/packages.lock.json backend/src/RestaurantManagement.WebApi/
RUN dotnet restore backend/src/RestaurantManagement.WebApi/RestaurantManagement.WebApi.csproj --locked-mode
COPY backend/src/ backend/src/
RUN dotnet publish backend/src/RestaurantManagement.WebApi/RestaurantManagement.WebApi.csproj --no-restore -c Release -o /app
FROM mcr.microsoft.com/dotnet/aspnet:10.0.12
WORKDIR /app
RUN mkdir -p /var/lib/rims/keys && chown app:app /var/lib/rims/keys
COPY --from=build /app .
USER app
ENV ASPNETCORE_URLS=http://+:8080 App__DataProtectionPath=/var/lib/rims/keys
EXPOSE 8080
ENTRYPOINT ["dotnet","RestaurantManagement.WebApi.dll"]
