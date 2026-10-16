using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RestaurantManagement.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class PersistentV21 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CustomerId",
                table: "orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalId",
                table: "orders",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "IntegrationClientId",
                table: "orders",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Number",
                table: "orders",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SnapshotJson",
                table: "orders",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "orders",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AlterColumn<string>(
                name: "name",
                table: "ingredients",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100);

            migrationBuilder.AddColumn<DateTime>(
                name: "created_at",
                table: "dishes",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "updated_at",
                table: "dishes",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "number",
                table: "deliveries",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(50)",
                oldMaxLength: 50);

            migrationBuilder.AddColumn<Guid>(
                name: "IntegrationClientId",
                table: "deliveries",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PurchaseRequestId",
                table: "deliveries",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "RejectedAt",
                table: "deliveries",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "held_quantity",
                table: "batches",
                type: "numeric(12,3)",
                precision: 12,
                scale: 3,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<DateTime>(
                name: "receipt_committed_at",
                table: "batches",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "version",
                table: "batches",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "enterprises",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_enterprises", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "runtime_metadata",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BackendInstanceId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_runtime_metadata", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Username = table.Column<string>(type: "text", nullable: false),
                    NormalizedUsername = table.Column<string>(type: "text", nullable: false),
                    DisplayName = table.Column<string>(type: "text", nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    IsSuperAdmin = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_users", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "warehouses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    EnterpriseId = table.Column<Guid>(type: "uuid", nullable: false),
                    CustomerPublished = table.Column<bool>(type: "boolean", nullable: false),
                    StateRevision = table.Column<long>(type: "bigint", nullable: false),
                    EventSequence = table.Column<long>(type: "bigint", nullable: false),
                    OrderSequence = table.Column<long>(type: "bigint", nullable: false),
                    PurchaseSequence = table.Column<long>(type: "bigint", nullable: false),
                    TrackingStartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_warehouses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_warehouses_enterprises_EnterpriseId",
                        column: x => x.EnterpriseId,
                        principalTable: "enterprises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "memberships",
                columns: table => new
                {
                    EnterpriseId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Role = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_memberships", x => new { x.EnterpriseId, x.UserId });
                    table.ForeignKey(
                        name: "FK_memberships_enterprises_EnterpriseId",
                        column: x => x.EnterpriseId,
                        principalTable: "enterprises",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_memberships_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "sessions",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sessions_users_UserId",
                        column: x => x.UserId,
                        principalTable: "users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "idempotency_records",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Principal = table.Column<string>(type: "text", nullable: false),
                    Method = table.Column<string>(type: "text", nullable: false),
                    Path = table.Column<string>(type: "text", nullable: false),
                    Key = table.Column<Guid>(type: "uuid", nullable: false),
                    HashVersion = table.Column<int>(type: "integer", nullable: false),
                    Hash = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ResponseJson = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_idempotency_records", x => x.Id);
                    table.ForeignKey(
                        name: "FK_idempotency_records_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "integration_clients",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_integration_clients", x => x.Id);
                    table.ForeignKey(
                        name: "FK_integration_clients_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "integration_keys",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<Guid>(type: "uuid", nullable: false),
                    SecretHash = table.Column<string>(type: "text", nullable: false),
                    Label = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_integration_keys", x => x.Id);
                    table.ForeignKey(
                        name: "FK_integration_keys_integration_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "integration_clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "operational_documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    WarehouseId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "text", nullable: false),
                    ClientId = table.Column<Guid>(type: "uuid", nullable: true),
                    BatchId = table.Column<Guid>(type: "uuid", nullable: true),
                    Version = table.Column<long>(type: "bigint", nullable: false),
                    EventSequence = table.Column<long>(type: "bigint", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Json = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_operational_documents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_operational_documents_integration_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "integration_clients",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_operational_documents_warehouses_WarehouseId",
                        column: x => x.WarehouseId,
                        principalTable: "warehouses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_orders_warehouse_id_IntegrationClientId_ExternalId",
                table: "orders",
                columns: new[] { "warehouse_id", "IntegrationClientId", "ExternalId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_deliveries_PurchaseRequestId",
                table: "deliveries",
                column: "PurchaseRequestId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_deliveries_warehouse_id_IntegrationClientId_external_id",
                table: "deliveries",
                columns: new[] { "warehouse_id", "IntegrationClientId", "external_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_batches_source_item_id",
                table: "batches",
                column: "source_item_id",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_idempotency_records_WarehouseId_Principal_Method_Path_Key",
                table: "idempotency_records",
                columns: new[] { "WarehouseId", "Principal", "Method", "Path", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_integration_clients_WarehouseId",
                table: "integration_clients",
                column: "WarehouseId");

            migrationBuilder.CreateIndex(
                name: "IX_integration_keys_ClientId",
                table: "integration_keys",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_integration_keys_SecretHash",
                table: "integration_keys",
                column: "SecretHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_memberships_UserId",
                table: "memberships",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_operational_documents_ClientId",
                table: "operational_documents",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_operational_documents_WarehouseId_EventSequence",
                table: "operational_documents",
                columns: new[] { "WarehouseId", "EventSequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_operational_documents_WarehouseId_Kind_CreatedAt",
                table: "operational_documents",
                columns: new[] { "WarehouseId", "Kind", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_sessions_ExpiresAt",
                table: "sessions",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_sessions_UserId",
                table: "sessions",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_users_Kind_NormalizedUsername",
                table: "users",
                columns: new[] { "Kind", "NormalizedUsername" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_warehouses_EnterpriseId",
                table: "warehouses",
                column: "EnterpriseId",
                unique: true);

            migrationBuilder.Sql("""
                INSERT INTO runtime_metadata ("Id", "BackendInstanceId") VALUES (1, gen_random_uuid());
                INSERT INTO enterprises ("Id", "Name", "CreatedAt")
                  SELECT warehouse_id, 'Legacy warehouse ' || warehouse_id::text, now() FROM (
                    SELECT warehouse_id FROM ingredients UNION SELECT warehouse_id FROM dishes
                    UNION SELECT warehouse_id FROM batches UNION SELECT warehouse_id FROM deliveries UNION SELECT warehouse_id FROM orders
                  ) old;
                INSERT INTO warehouses ("Id", "EnterpriseId", "CustomerPublished", "StateRevision", "EventSequence", "OrderSequence", "PurchaseSequence", "TrackingStartedAt")
                  SELECT "Id", "Id", false, 1, 0, (SELECT count(*) FROM orders o WHERE o.warehouse_id = e."Id"), 0, now() FROM enterprises e;
                UPDATE batches SET version = 1;
                UPDATE orders SET "Source" = 'staff', "Number" = 'LEGACY-' || id::text WHERE "Number" IS NULL;
                INSERT INTO operational_documents ("Id", "WarehouseId", "Kind", "ClientId", "BatchId", "Version", "EventSequence", "CreatedAt", "Json")
                  SELECT gen_random_uuid(), warehouse_id, 'opening_balance', NULL, id, 1, NULL, now(),
                    jsonb_build_object('batchId', id, 'recordedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'physicalQuantity', to_char(remaining_quantity, 'FM9999999999999990.000'), 'heldQuantity', '0.000', 'eventSequence', 0)
                    FROM batches;
                CREATE UNIQUE INDEX ux_ingredient_normalized_name ON ingredients (warehouse_id, lower(btrim(name)));
                CREATE UNIQUE INDEX ux_dish_normalized_name ON dishes (warehouse_id, lower(btrim(name)));
                CREATE UNIQUE INDEX ux_recipe_ingredient ON recipe_ingredients (dish_id, ingredient_id);
                CREATE UNIQUE INDEX ux_order_batch ON order_allocations (order_id, batch_id);
                CREATE UNIQUE INDEX ux_order_dish ON order_items (order_id, dish_id);
                CREATE UNIQUE INDEX ux_order_number ON orders (warehouse_id, "Number");
                CREATE UNIQUE INDEX ux_single_owner ON memberships ("EnterpriseId") WHERE "Role" = 'owner';
                CREATE INDEX ix_batches_fefo ON batches (warehouse_id, ingredient_id, expires_at, received_at, id) WHERE remaining_quantity > 0;
                ALTER TABLE batches ADD CONSTRAINT ck_stock_balance CHECK (0 <= held_quantity AND held_quantity <= remaining_quantity AND remaining_quantity <= initial_quantity AND initial_quantity > 0 AND initial_quantity <= 999999999.999 AND shelf_life_hours BETWEEN 1 AND 87600 AND version > 0);
                ALTER TABLE ingredients ADD CONSTRAINT ck_ingredient_stock CHECK (0 <= reorder_point AND reorder_point <= target_stock AND target_stock <= 999999999.999 AND default_shelf_life_hours BETWEEN 1 AND 87600 AND unit IN ('g','ml','pcs'));
                ALTER TABLE recipe_ingredients ADD CONSTRAINT ck_recipe_quantity CHECK (quantity > 0 AND quantity <= 999999999.999);
                ALTER TABLE delivery_items ADD CONSTRAINT ck_receipt_quantity CHECK (quantity > 0 AND quantity <= 999999999.999 AND shelf_life_hours BETWEEN 1 AND 87600);
                ALTER TABLE order_allocations ADD CONSTRAINT ck_allocation_quantity CHECK (quantity > 0 AND quantity <= 999999999.999);
                ALTER TABLE memberships ADD CONSTRAINT ck_membership_role CHECK ("Role" IN ('owner','manager','warehouse','waiter'));
                ALTER TABLE users ADD CONSTRAINT ck_account_kind CHECK ("Kind" IN ('staff','customer'));
                ALTER TABLE integration_clients ADD CONSTRAINT ck_client_kind CHECK ("Kind" IN ('supplier','pos'));
                ALTER TABLE batches ADD CONSTRAINT fk_batch_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses("Id");
                ALTER TABLE ingredients ADD CONSTRAINT fk_ingredient_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses("Id");
                ALTER TABLE dishes ADD CONSTRAINT fk_dish_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses("Id");
                ALTER TABLE deliveries ADD CONSTRAINT fk_delivery_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses("Id");
                ALTER TABLE orders ADD CONSTRAINT fk_order_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses("Id");
                ALTER TABLE batches ADD CONSTRAINT fk_batch_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients(id);
                ALTER TABLE batches ADD CONSTRAINT fk_batch_delivery FOREIGN KEY (delivery_id) REFERENCES deliveries(id);
                ALTER TABLE batches ADD CONSTRAINT fk_batch_item FOREIGN KEY (source_item_id) REFERENCES delivery_items(id);
                ALTER TABLE recipe_ingredients ADD CONSTRAINT fk_recipe_ingredient FOREIGN KEY (ingredient_id) REFERENCES ingredients(id);
                ALTER TABLE order_allocations ADD CONSTRAINT fk_allocation_batch FOREIGN KEY (batch_id) REFERENCES batches(id);
                ALTER TABLE order_items ADD CONSTRAINT fk_order_dish FOREIGN KEY (dish_id) REFERENCES dishes(id);
                CREATE FUNCTION protect_immutable_document() RETURNS trigger LANGUAGE plpgsql AS $$
                  BEGIN IF OLD."Kind" IN ('movement','opening_balance','combo_version') THEN RAISE EXCEPTION 'immutable journal/version'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER immutable_journal BEFORE UPDATE OR DELETE ON operational_documents FOR EACH ROW EXECUTE FUNCTION protect_immutable_document();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder) => throw new NotSupportedException("Forward-only: use a compatible release or the reviewed backup/restore procedure.");
    }
}

