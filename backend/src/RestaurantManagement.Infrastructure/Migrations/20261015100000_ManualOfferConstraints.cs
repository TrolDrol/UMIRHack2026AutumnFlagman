using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using RestaurantManagement.Infrastructure.Persistence;

namespace RestaurantManagement.Infrastructure.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20261015100000_ManualOfferConstraints")]
public class ManualOfferConstraints : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
        CREATE FUNCTION valid_manual_offer(j jsonb, version bigint, id uuid) RETURNS boolean
        LANGUAGE plpgsql IMMUTABLE AS $$
        BEGIN
          IF NOT (j ?& ARRAY['id','dishId','title','publicText','startsAt','endsAt','status','version','createdAt','updatedAt','publishedAt','createdByUserId','updatedByUserId','effectiveStartsAt']) THEN RETURN false; END IF;
          RETURN COALESCE(
            jsonb_typeof(j->'title')='string' AND length(btrim(j->>'title')) BETWEEN 1 AND 120
            AND jsonb_typeof(j->'publicText') IN ('string','null') AND COALESCE(length(j->>'publicText'),0)<=500
            AND (j->>'id')::uuid=id AND (j->>'dishId')::uuid IS NOT NULL
            AND (j->>'createdByUserId')::uuid IS NOT NULL AND (j->>'updatedByUserId')::uuid IS NOT NULL
            AND j->>'status' IN ('draft','published','archived')
            AND jsonb_typeof(j->'version')='number' AND (j->>'version')::bigint=version AND version BETWEEN 1 AND 9007199254740991
            AND (j->>'createdAt')::timestamptz IS NOT NULL AND (j->>'updatedAt')::timestamptz IS NOT NULL
            AND (j->>'endsAt')::timestamptz IS NOT NULL
            AND (jsonb_typeof(j->'startsAt')='null' OR (j->>'endsAt')::timestamptz>(j->>'startsAt')::timestamptz)
            AND (j->>'status'<>'published' OR ((j->>'publishedAt')::timestamptz IS NOT NULL AND (j->>'effectiveStartsAt')::timestamptz IS NOT NULL)), false);
        EXCEPTION WHEN others THEN RETURN false;
        END $$;
        ALTER TABLE operational_documents ADD CONSTRAINT ck_manual_offer CHECK ("Kind"<>'manual_offer' OR valid_manual_offer("Json", "Version", "Id"));
        CREATE UNIQUE INDEX ux_manual_offer_dish ON operational_documents ("WarehouseId", ("Json"->>'dishId')) WHERE "Kind"='manual_offer' AND "Json"->>'status'<>'archived';
        """);
    protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Forward-only migration; retain offers and history.");
}
