using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RestaurantManagement.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DocumentInvariantConstraints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DatasetKind",
                table: "warehouses",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<Guid>(
                name: "ActorUserId",
                table: "operational_documents",
                type: "uuid",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "external_id",
                table: "deliveries",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);
            migrationBuilder.Sql("""
                UPDATE warehouses SET "DatasetKind" = 'observed' WHERE "DatasetKind" = '';
                ALTER TABLE warehouses ADD CONSTRAINT ck_dataset_kind CHECK ("DatasetKind" IN ('observed','demo_seeded'));
                ALTER TABLE external_documents ADD CONSTRAINT ck_external_kind CHECK ("Kind" IN ('delivery','order'));
                ALTER TABLE operational_documents ADD CONSTRAINT fk_document_actor FOREIGN KEY ("ActorUserId") REFERENCES users("Id");
                CREATE UNIQUE INDEX ux_scoped_ingredient ON ingredients (warehouse_id,id);
                CREATE UNIQUE INDEX ux_scoped_delivery ON deliveries (warehouse_id,id);
                CREATE UNIQUE INDEX ux_delivery_item ON delivery_items (delivery_id,id);
                ALTER TABLE batches ADD CONSTRAINT fk_scoped_batch_ingredient FOREIGN KEY (warehouse_id,ingredient_id) REFERENCES ingredients(warehouse_id,id);
                ALTER TABLE batches ADD CONSTRAINT fk_scoped_batch_delivery FOREIGN KEY (warehouse_id,delivery_id) REFERENCES deliveries(warehouse_id,id);
                ALTER TABLE batches ADD CONSTRAINT fk_scoped_source_item FOREIGN KEY (delivery_id,source_item_id) REFERENCES delivery_items(delivery_id,id);
                CREATE FUNCTION validate_recipe_scope() RETURNS trigger LANGUAGE plpgsql AS $$
                  BEGIN IF NOT EXISTS (SELECT 1 FROM ingredients i JOIN dishes d ON d.id=NEW.dish_id WHERE i.id=NEW.ingredient_id AND i.warehouse_id=d.warehouse_id AND i.unit=NEW.unit)
                    THEN RAISE EXCEPTION 'recipe scope/unit mismatch' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER recipe_scope BEFORE INSERT OR UPDATE ON recipe_ingredients FOR EACH ROW EXECUTE FUNCTION validate_recipe_scope();
                CREATE FUNCTION validate_delivery_item_scope() RETURNS trigger LANGUAGE plpgsql AS $$
                  BEGIN IF NOT EXISTS (SELECT 1 FROM ingredients i JOIN deliveries d ON d.id=NEW.delivery_id WHERE i.id=NEW.ingredient_id AND i.warehouse_id=d.warehouse_id AND i.unit=NEW.unit)
                    THEN RAISE EXCEPTION 'delivery item scope/unit mismatch' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER delivery_item_scope BEFORE INSERT OR UPDATE ON delivery_items FOR EACH ROW EXECUTE FUNCTION validate_delivery_item_scope();
                CREATE FUNCTION protect_batch_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
                  BEGIN IF ROW(NEW.warehouse_id,NEW.delivery_id,NEW.source_item_id,NEW.ingredient_id,NEW.unit,NEW.initial_quantity,NEW.received_at,NEW.manufactured_at,NEW.shelf_life_hours,NEW.expires_at,NEW.receipt_committed_at)
                    IS DISTINCT FROM ROW(OLD.warehouse_id,OLD.delivery_id,OLD.source_item_id,OLD.ingredient_id,OLD.unit,OLD.initial_quantity,OLD.received_at,OLD.manufactured_at,OLD.shelf_life_hours,OLD.expires_at,OLD.receipt_committed_at)
                    THEN RAISE EXCEPTION 'immutable receipt metadata'; END IF;
                    IF ROW(NEW.remaining_quantity,NEW.held_quantity) IS DISTINCT FROM ROW(OLD.remaining_quantity,OLD.held_quantity) AND NEW.version<=OLD.version
                    THEN RAISE EXCEPTION 'stock version must increase'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER batch_metadata BEFORE UPDATE ON batches FOR EACH ROW EXECUTE FUNCTION protect_batch_metadata();
                CREATE FUNCTION protect_completed_order() RETURNS trigger LANGUAGE plpgsql AS $$
                  BEGIN IF OLD.status=2 THEN RAISE EXCEPTION 'completed order is immutable'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER completed_order BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION protect_completed_order();
                CREATE OR REPLACE FUNCTION protect_immutable_document() RETURNS trigger LANGUAGE plpgsql AS $$
                  BEGIN IF OLD."Kind" IN ('movement','opening_balance','combo_version','purchase_version','purchase_transition','delivery_created','order_recipe_snapshot') THEN RAISE EXCEPTION 'immutable journal/version'; END IF; RETURN NEW; END $$;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Forward-only: use a compatible release or the reviewed backup/restore procedure.");
    }
}

