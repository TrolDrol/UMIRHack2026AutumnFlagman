import type {
  ManualOffer,
  ManualOfferInput,
  OfferCard,
  PublicOfferCard,
} from "./shared/api/offers";
import {
  createForecastFixture,
  forecastEnterpriseId,
  forecastWarehouseId,
} from "./domain/demoFixture";
import { forecast } from "./domain/stopForecast";
import { riskReport } from "./domain/riskReports";
import {
  expandOrder,
  jointPlan,
  recipeFingerprint,
  publicCombo,
} from "./domain/comboPlanner";
import { openQuarantine, decideQuarantine } from "./domain/quarantine";
import { demoStorage } from "./storage";
import type {
  PurchaseRequest,
  PurchaseRequestInput,
} from "../../portal-contracts/src";
import {
  available,
  free,
  held,
  inventory,
  riskSnapshot,
  stockPlan,
} from "./domain/stock";
import type {
  Quarantine,
  Combo,
  LedgerOpeningBalance,
} from "./shared/api/extensions";
// Backend simulation used exclusively by the explicit MSW demo mode.
// Real API builds do not import this module; business calculations belong to the backend.
import type {
  Allocation,
  Enterprise,
  Membership,
  Member,
  Role,
  IntegrationClient,
  IntegrationKey,
  ApiError,
  Batch,
  Dashboard,
  Delivery,
  DeliveryInput,
  Dish,
  DishAvailability,
  DishInput,
  Envelope,
  HotOffer,
  Ingredient,
  IngredientInput,
  InventoryRow,
  Movement,
  User,
  Order,
  OrderInput,
  OrderPreview,
  Page,
  PurchaseSuggestion,
  Requirement,
  WriteOff,
  WriteOffInput,
} from "./shared/api/types";
import { thousandths, quantity } from "./shared/lib/decimal";
import {
  dishSchema,
  ingredientSchema,
  orderSchema,
} from "./shared/lib/schemas";
import { z } from "zod";
export const demoOperator: User = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  username: "operator",
  displayName: "Демо-оператор",
};
let databaseKey = "rims.demo.database.v2.aaaaaaaa-0000-4000-8000-000000000001";
const sessionKey = "flagman.demo.signedIn";
type ResponseRecord = {
  status: number;
  body: Envelope<unknown> | ApiError | null;
};
type Database = {
  manualOffers?: ManualOffer[];
  schemaVersion?: number;
  quarantines?: Quarantine[];
  combos?: Combo[];
  comboVersions?: Combo[];
  stateRevision?: number;
  eventSequence?: number;
  analyticsTrackingStartedAt?: string;
  forecastObservationStartedAt?: string;
  datasetKind?: "observed" | "demo_seeded";
  openingBalances?: LedgerOpeningBalance[];
  ingredients: Ingredient[];
  dishes: Dish[];
  deliveries: Delivery[];
  orders: Order[];
  writeOffs: WriteOff[];
  movements: Movement[];
  replays: Record<string, { hash: string; response: ResponseRecord }>;
};
const uuid = () => crypto.randomUUID();
const normalized = (n: bigint) =>
  `${n / 1000n}.${String(n % 1000n).padStart(3, "0")}`;
const uuidSchema = z.string().uuid();
const timestampSchema = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(
        v,
      ) && Number.isFinite(Date.parse(v)),
    "Укажите RFC 3339 с часовым поясом",
  );
function normalizedTime(value: string, shift = 0) {
  const iso = new Date(Date.parse(value) + shift).toISOString();
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] || "0";
  return iso.replace(/\.\d{3}Z$/, `.${fraction.padEnd(6, "0")}Z`);
}
const positive = z.string().refine((v) => {
  try {
    return thousandths(v) > 0n;
  } catch {
    return false;
  }
}, "Некорректное положительное количество");
const deliverySchema = z
  .object({
    purchaseRequestId: uuidSchema.nullable().optional(),
    number: z.string().trim().min(1).max(64),
    expectedAt: timestampSchema.nullable(),
    note: z.string().max(500).nullable(),
    lines: z
      .array(
        z.union([
          z
            .object({
              ingredientId: uuidSchema,
              quantity: positive,
              expiresAt: timestampSchema,
            })
            .strict(),
          z
            .object({
              ingredientId: uuidSchema,
              quantity: positive,
              manufacturedAt: timestampSchema,
              shelfLifeHours: z.number().int().min(1).max(87600).optional(),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(100),
  })
  .strict();
const writeOffSchema = z
  .object({
    batchId: uuidSchema,
    quantity: positive,
    reason: z.enum(["expired", "damaged"]),
    note: z.string().max(500).nullable(),
  })
  .strict();
function seed(): Database {
  const now = Date.now();
  const iso = (hours: number) => new Date(now + hours * 3600000).toISOString();
  const ingredients: Ingredient[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Томаты",
      unit: "g",
      defaultShelfLifeHours: 72,
      reorderPoint: "600.000",
      targetStock: "1500.000",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Сыр",
      unit: "g",
      defaultShelfLifeHours: 72,
      reorderPoint: "200.000",
      targetStock: "1000.000",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Хлеб",
      unit: "pcs",
      defaultShelfLifeHours: 72,
      reorderPoint: "5.000",
      targetStock: "20.000",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Молоко",
      unit: "ml",
      defaultShelfLifeHours: 48,
      reorderPoint: "500.000",
      targetStock: "2000.000",
    },
  ];
  const dishes: Dish[] = [
    {
      id: uuid(),
      name: "Брускетта",
      active: true,
      recipe: [
        { ingredientId: ingredients[0].id, quantity: "100.000" },
        { ingredientId: ingredients[1].id, quantity: "50.000" },
        { ingredientId: ingredients[2].id, quantity: "1.000" },
      ],
      createdAt: iso(-1),
      updatedAt: iso(-1),
    },
    {
      id: uuid(),
      name: "Салат с томатами и сыром",
      active: true,
      recipe: [
        { ingredientId: ingredients[0].id, quantity: "150.000" },
        { ingredientId: ingredients[1].id, quantity: "80.000" },
      ],
      createdAt: iso(-1),
      updatedAt: iso(-1),
    },
    {
      id: uuid(),
      name: "Молочный напиток",
      active: true,
      recipe: [{ ingredientId: ingredients[3].id, quantity: "200.000" }],
      createdAt: iso(-1),
      updatedAt: iso(-1),
    },
    {
      id: uuid(),
      name: "Сезонная закуска",
      active: false,
      recipe: [
        { ingredientId: ingredients[0].id, quantity: "50.000" },
        { ingredientId: ingredients[2].id, quantity: "0.500" },
      ],
      createdAt: iso(-1),
      updatedAt: iso(-1),
    },
  ];
  const deliveryId = uuid();
  const entries: [number, string, number][] = [
    [0, "300.000", 6],
    [0, "500.000", 72],
    [0, "200.000", -1],
    [1, "150.000", 72],
    [2, "10.000", 72],
  ];
  const batches: Batch[] = entries.map(([i, q, h]) => ({
    id: uuid(),
    deliveryId,
    deliveryNumber: "DEMO-001",
    ingredientId: ingredients[i].id,
    ingredientName: ingredients[i].name,
    unit: ingredients[i].unit,
    receivedAt: iso(-2),
    manufacturedAt: null,
    deliveryItemId: uuid(),
    shelfLifeHours: ingredients[i].defaultShelfLifeHours,
    expiresAt: iso(h),
    initialQuantity: q,
    remainingQuantity: q,
    heldQuantity: "0.000",
    availableQuantity: q,
    heldExpiredQuantity: "0.000",
    version: 1,
    receiptCommittedAt: null,
    status:
      h < 0
        ? "expired"
        : h <= ingredients[i].defaultShelfLifeHours * 0.1
          ? "expiring"
          : "fresh",
    remainingSeconds: h * 3600,
  }));
  const movements: Movement[] = batches.map((b) => ({
    id: uuid(),
    createdAt: iso(-2),
    ingredientId: b.ingredientId,
    ingredientName: b.ingredientName,
    unit: b.unit,
    batchId: b.id,
    type: "receipt",
    heldQuantityDelta: "0.000",
    heldAfter: "0.000",
    quarantineId: null,
    actorUserId: null,
    integrationClientId: null,
    eventSequence: 0,
    riskSnapshot: null,
    quantityDelta: b.initialQuantity,
    remainingAfter: b.remainingQuantity,
    referenceId: deliveryId,
    referenceNumber: "DEMO-001",
  }));
  return {
    ingredients,
    dishes,
    deliveries: [
      {
        id: deliveryId,
        number: "DEMO-001",
        createdAt: iso(-2),
        receivedAt: iso(-2),
        status: "confirmed",
        source: "manual",
        externalId: null,
        expectedAt: null,
        confirmedByUserId: demoOperator.id,
        rejectedAt: null,
        rejectionReason: null,
        lines: batches.map((b) => ({
          id: b.deliveryItemId,
          ingredientId: b.ingredientId,
          ingredientName: b.ingredientName,
          unit: b.unit,
          quantity: b.initialQuantity,
          manufacturedAt: b.manufacturedAt,
          shelfLifeHours: b.shelfLifeHours,
          expiresAt: b.expiresAt,
        })),
        note: "Демо-поставка: свежие, истекающие и просроченные партии.",
        batches,
      },
    ],
    orders: [],
    writeOffs: [],
    movements,
    replays: {},
  };
}
function load(): Database {
  try {
    const raw = demoStorage.getItem(databaseKey);
    return migrate(raw ? JSON.parse(raw) : seed(), Date.now());
  } catch {
    throw new Error("DEMO_STORAGE_ERROR");
  }
}
function migrate(value: Database, now: number): Database {
  value.manualOffers ??= [];
  if (value.schemaVersion === 4) return value;
  const at = new Date(now).toISOString();
  value.quarantines ??= [];
  value.combos ??= [];
  value.comboVersions ??= [];
  value.stateRevision ??= 1;
  value.eventSequence ??= 0;
  value.analyticsTrackingStartedAt ??= at;
  value.forecastObservationStartedAt ??= at;
  value.datasetKind ??= "observed";
  for (const m of value.movements) {
    m.eventSequence = ++value.eventSequence;
    m.heldQuantityDelta ??= "0.000";
    m.heldAfter ??= "0.000";
    m.quarantineId ??= null;
    m.actorUserId ??= null;
    m.integrationClientId ??= null;
    m.riskSnapshot ??= null;
  }
  value.openingBalances = value.deliveries
    .flatMap((d) => d.batches)
    .map((b) => {
      b.heldQuantity ??= "0.000";
      b.version ??= 1;
      // An entered receipt date is not evidence of the actual system commit.
      b.receiptCommittedAt ??=
        value.movements.find((m) => m.batchId === b.id && m.type === "receipt")
          ?.createdAt ?? null;
      return {
        batchId: b.id,
        recordedAt: at,
        physicalQuantity: b.remainingQuantity,
        heldQuantity: b.heldQuantity,
        eventSequence: value.eventSequence!,
      };
    });
  for (const o of value.orders) {
    o.composition ??= o.lines.map((l) => ({ kind: "dish" as const, ...l }));
    for (const a of o.allocations) a.riskSnapshot ??= null;
  }
  for (const d of value.dishes) d.createdAt ||= at;
  value.schemaVersion = 4;
  return value;
}
let db = load();
export function resetDemoData() {
  resetDemoGlobals();
  sessionStorage.removeItem(sessionKey);
}
function persist() {
  db = migrate(db, Date.now());
  db.schemaVersion = 4;
  for (const order of db.orders) order.customerId ??= null;
  demoStorage.setItem(databaseKey, JSON.stringify(db));
}
export class DemoFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: ApiError["error"]["details"] = {},
  ) {
    super(message);
  }
}
function fail(
  status: number,
  code: string,
  message: string,
  details?: ApiError["error"]["details"],
): never {
  const extensionMessages: Record<string, string> = {
    BATCH_VERSION_CHANGED:
      "Партия изменилась. Данные обновлены; проверьте количество и повторите действие.",
    QUARANTINE_VERSION_CHANGED:
      "По карантину принято другое решение. Проверьте обновлённый остаток.",
    INSUFFICIENT_FREE_BATCH_STOCK:
      "В партии недостаточно свободного количества. Удержанный запас списывается через карантин.",
    INSUFFICIENT_HELD_STOCK: "Количество превышает остаток этого карантина.",
    QUARANTINE_CLOSED:
      "Этот карантин уже закрыт. Для нового удержания создайте отдельный случай.",
    COMBO_VERSION_CHANGED:
      "Версия комбо изменилась. Обновите позицию в корзине.",
    COMBO_UNAVAILABLE:
      "Комбо временно недоступно. Обновите меню и скорректируйте корзину.",
    COMBO_RECIPE_CHANGED:
      "Рецепт комбо изменился. Требуется новая опубликованная версия.",
    COMBO_STATE_CONFLICT:
      "Состояние комбо изменилось. Проверьте карточку перед повторным действием.",
    ORDER_LIMIT_EXCEEDED:
      "После раскрытия комбо допускается до 100 блюд и до 1000 порций каждого.",
    EXTERNAL_ID_CONFLICT:
      "Внешний номер уже использован для другого состава заказа.",
  };
  const localized = /^[a-zA-Z]/.test(message)
    ? status === 404
      ? "Документ недоступен в этом предприятии"
      : status === 422
        ? "Проверьте поля формы и параметры запроса"
        : "Состояние изменилось. Обновите данные и проверьте действие."
    : message;
  throw new DemoFailure(
    status,
    code,
    extensionMessages[code] ?? localized,
    details,
  );
}
function validate<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    return fail(422, "VALIDATION_ERROR", "Проверьте поля формы", {
      fields: result.error.issues.map((x) => ({
        path: x.path.join("."),
        message: x.message,
      })),
    });
  return result.data;
}
function strictFields(body: unknown, allowed: string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail(422, "VALIDATION_ERROR", "Ожидается объект");
  const unknown = Object.keys(body as object).filter(
    (k) => !allowed.includes(k),
  );
  if (unknown.length)
    fail(422, "VALIDATION_ERROR", "Неизвестные поля", {
      fields: unknown.map((path) => ({
        path,
        message: "Поле не поддерживается",
      })),
    });
}
const ascending = <T>(
  items: T[],
  name: (x: T) => string,
  id: (x: T) => string,
) =>
  [...items].sort(
    (a, b) =>
      name(a).localeCompare(name(b), "ru") || id(a).localeCompare(id(b)),
  );
const history = <T extends { id: string; createdAt: string }>(items: T[]) =>
  [...items].sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
const allBatches = () => db.deliveries.flatMap((x) => x.batches);
function expiryWarningMilliseconds(b: Batch) {
  const hours =
    b.shelfLifeHours ?? ingredient(b.ingredientId).defaultShelfLifeHours;
  return hours * 3600000 * 0.1;
}
const isExpiring = (b: Batch, now: number) =>
  thousandths(b.remainingQuantity) > 0n &&
  Date.parse(b.expiresAt) > now &&
  Date.parse(b.expiresAt) - now <= expiryWarningMilliseconds(b);
function batchSnapshot(b: Batch, now: number): Batch {
  const seconds = Math.floor((Date.parse(b.expiresAt) - now) / 1000);
  return {
    ...b,
    heldQuantity: b.heldQuantity ?? "0.000",
    availableQuantity: normalized(available(b, now)),
    heldExpiredQuantity:
      Date.parse(b.expiresAt) <= now ? normalized(held(b)) : "0.000",
    version: b.version ?? 1,
    status:
      thousandths(b.remainingQuantity) === 0n
        ? "empty"
        : seconds < 0 || Date.parse(b.expiresAt) <= now
          ? "expired"
          : isExpiring(b, now)
            ? "expiring"
            : "fresh",
    remainingSeconds: seconds,
  };
}
const usable = (b: Batch, now: number) => available(b, now) > 0n;
const fefo = (items: Batch[]) =>
  [...items].sort(
    (a, b) =>
      a.expiresAt.localeCompare(b.expiresAt) ||
      a.receivedAt.localeCompare(b.receivedAt) ||
      a.id.localeCompare(b.id),
  );
const ingredient = (id: string) =>
  db.ingredients.find((x) => x.id === id) ||
  fail(422, "VALIDATION_ERROR", "Ингредиент не найден");
function inventories(now: number): InventoryRow[] {
  return ascending(
    inventory(db.ingredients, allBatches(), now),
    (x) => x.ingredientName,
    (x) => x.ingredientId,
  );
}
function plan(input: OrderInput, now: number): OrderPreview {
  for (const line of input.lines) {
    const dish =
      db.dishes.find((d) => d.id === line.dishId) ||
      fail(422, "VALIDATION_ERROR", "Dish not found");
    if (!dish.active) fail(409, "DISH_INACTIVE", "Dish inactive");
  }
  try {
    return stockPlan(db.ingredients, db.dishes, allBatches(), input, now);
  } catch (e) {
    return fail(422, "QUANTITY_LIMIT_EXCEEDED", String(e));
  }
}
function availability(now: number): DishAvailability[] {
  const stock = inventories(now);
  return ascending(
    db.dishes.map((d) => {
      if (!d.active)
        return {
          dishId: d.id,
          dishName: d.name,
          active: false,
          maxPortions: 0,
          status: "inactive" as const,
          shortages: [],
        };
      const maxPortions = Math.min(
        ...d.recipe.map((r) =>
          Number(
            thousandths(
              stock.find((x) => x.ingredientId === r.ingredientId)!
                .availableQuantity,
            ) / thousandths(r.quantity),
          ),
        ),
      );
      const requirements = plan(
        { lines: [{ dishId: d.id, portions: 1 }] },
        now,
      ).requirements;
      return {
        dishId: d.id,
        dishName: d.name,
        active: true,
        maxPortions,
        status: maxPortions > 0 ? ("available" as const) : ("stopped" as const),
        shortages: requirements.filter(
          (r) => thousandths(r.missingQuantity) > 0n,
        ),
      };
    }),
    (x) => x.dishName,
    (x) => x.dishId,
  );
}
function offers(now: number): HotOffer[] {
  const stock = inventories(now);
  const menu = availability(now);
  const results: HotOffer[] = [];
  for (const d of db.dishes) {
    const a = menu.find((x) => x.dishId === d.id)!;
    if (a.status !== "available") continue;
    const risk = d.recipe
      .map((r) => ({
        ...r,
        risk: thousandths(
          stock.find((x) => x.ingredientId === r.ingredientId)!
            .expiringQuantity,
        ),
      }))
      .filter((r) => r.risk > 0n);
    if (!risk.length) continue;
    const needed = Math.max(
      ...risk.map((r) =>
        Number(
          (r.risk + thousandths(r.quantity) - 1n) / thousandths(r.quantity),
        ),
      ),
    );
    const suggestedPortions = Math.min(a.maxPortions, 20, needed);
    const allocations = plan(
      { lines: [{ dishId: d.id, portions: suggestedPortions }] },
      now,
    ).allocations;
    let urgency = 0;
    let coverage = 0;
    const reasons: HotOffer["reasons"] = [];
    for (const r of risk) {
      const used = allocations.filter(
        (x) =>
          x.ingredientId === r.ingredientId &&
          isExpiring(
            allBatches().find((b) => b.id === x.batchId)!,
            now,
          ),
      );
      const usedQuantity = used.reduce(
        (n, x) => n + thousandths(x.quantity),
        0n,
      );
      coverage += Number(usedQuantity) / Number(r.risk);
      for (const b of used)
        urgency = Math.max(
          urgency,
          1 -
            (Date.parse(b.expiresAt) - now) /
              expiryWarningMilliseconds(
                allBatches().find((batch) => batch.id === b.batchId)!,
              ),
        );
      if (usedQuantity > 0n) {
        const i = ingredient(r.ingredientId);
        reasons.push({
          ingredientId: i.id,
          ingredientName: i.name,
          unit: i.unit,
          batchIds: used.map((x) => x.batchId),
          usableExpiringQuantity: normalized(r.risk),
          plannedUsage: normalized(usedQuantity),
          earliestExpiresAt: used[0].expiresAt,
        });
      }
    }
    if (!reasons.length) continue;
    const earliestExpiresAt = reasons.map((x) => x.earliestExpiresAt).sort()[0];
    results.push({
      dishId: d.id,
      dishName: d.name,
      score: Math.round(((100 * urgency * coverage) / risk.length) * 100) / 100,
      maxPortions: a.maxPortions,
      suggestedPortions,
      earliestExpiresAt,
      reasons: ascending(
        reasons,
        (x) => x.ingredientName,
        (x) => x.ingredientId,
      ),
      explanation: `Продайте ${suggestedPortions} порций, чтобы использовать истекающие продукты: ${reasons.map((x) => x.ingredientName.toLocaleLowerCase("ru")).join(", ")}.`,
    });
  }
  return results.sort(
    (a, b) =>
      b.score - a.score ||
      a.earliestExpiresAt.localeCompare(b.earliestExpiresAt) ||
      a.dishId.localeCompare(b.dishId),
  );
}
function purchases(now: number): PurchaseSuggestion[] {
  const menu = availability(now);
  return inventories(now).flatMap((x) => {
    const available = thousandths(x.availableQuantity),
      expiring = thousandths(x.expiringQuantity),
      planning = available - expiring,
      reorder = thousandths(x.reorderPoint);
    const affectedDishIds = menu
      .filter(
        (d) =>
          d.active &&
          d.shortages.some((r) => r.ingredientId === x.ingredientId),
      )
      .map((d) => d.dishId);
    let recipeMinimum = 0n;
    for (const dish of db.dishes.filter((d) => d.active))
      for (const line of dish.recipe)
        if (
          line.ingredientId === x.ingredientId &&
          thousandths(line.quantity) > recipeMinimum
        )
          recipeMinimum = thousandths(line.quantity);
    const target =
      thousandths(x.targetStock) > recipeMinimum
        ? thousandths(x.targetStock)
        : recipeMinimum;
    const reasons: PurchaseSuggestion["reasons"] = [];
    if (available < reorder) reasons.push("below_minimum");
    if (expiring > 0n && planning < reorder) reasons.push("expiring_stock");
    if (affectedDishIds.length) reasons.push("stopped_dish");
    const suggested = target > planning ? target - planning : 0n;
    return reasons.length && suggested > 0n
      ? [
          {
            ...x,
            planningQuantity: normalized(planning),
            targetQuantity: normalized(target),
            suggestedQuantity: normalized(suggested),
            reasons,
            affectedDishIds,
          },
        ].map(
          ({
            physicalQuantity: _physical,
            expiredQuantity: _expired,
            nearestExpiresAt: _nearest,
            isLowStock: _low,
            ...dto
          }) => dto,
        )
      : [];
  });
}
function pagination<T>(items: T[], url: URL, allowed: string[]): Page<T> {
  for (const key of url.searchParams.keys())
    if (!["page", "pageSize", ...allowed].includes(key))
      fail(422, "VALIDATION_ERROR", "Фильтр не поддерживается");
  const page = Number(url.searchParams.get("page") || 1),
    pageSize = Number(url.searchParams.get("pageSize") || 50);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    fail(422, "VALIDATION_ERROR", "Некорректная пагинация");
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: items.length,
  };
}
const matchQuery = (url: URL, name: string) =>
  name
    .toLocaleLowerCase("ru")
    .includes((url.searchParams.get("q") || "").trim().toLocaleLowerCase("ru"));
function boolFilter(url: URL, key: string): boolean | undefined {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  if (!["true", "false"].includes(value))
    fail(422, "VALIDATION_ERROR", "Некорректный фильтр");
  return value === "true";
}
const existsName = (
  name: string,
  items: { id: string; name: string }[],
  ignore?: string,
) =>
  items.some(
    (x) =>
      x.id !== ignore &&
      x.name.toLocaleLowerCase("ru") === name.trim().toLocaleLowerCase("ru"),
  );
function addMovement(
  batch: Batch,
  type: Movement["type"],
  amount: bigint,
  id: string,
  number: string | null,
  now: number,
) {
  if (type !== "receipt") batch.version = (batch.version ?? 1) + 1;
  db.movements.push({
    id: uuid(),
    createdAt: new Date(now).toISOString(),
    ingredientId: batch.ingredientId,
    ingredientName: ingredient(batch.ingredientId).name,
    unit: batch.unit,
    batchId: batch.id,
    type,
    quantityDelta: `${type === "receipt" ? "" : "-"}${normalized(amount)}`,
    heldQuantityDelta: "0.000",
    heldAfter: normalized(held(batch)),
    quarantineId: null,
    actorUserId: currentActor.startsWith("user:")
      ? currentActor.slice(5)
      : null,
    integrationClientId: currentActor.startsWith("client:")
      ? currentActor.slice(7)
      : null,
    eventSequence: (db.eventSequence = (db.eventSequence ?? 0) + 1),
    riskSnapshot:
      type === "order" || type === "write_off"
        ? riskSnapshot(batch, now)
        : null,
    remainingAfter: batch.remainingQuantity,
    referenceId: id,
    referenceNumber: number,
  });
}
const manualInputSchema = z
  .object({
    dishId: uuidSchema,
    title: z.string().trim().min(1).max(120),
    publicText: z.string().max(500).nullable(),
    startsAt: timestampSchema.nullable(),
    endsAt: timestampSchema,
  })
  .strict();
function validateManualBody(path: string, method: string, body: unknown) {
  if (/\/(publish|unpublish|archive)$/.test(path))
    return validate(
      z
        .object({
          expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        })
        .strict(),
      body,
    );
  return validate(
    method === "PUT"
      ? manualInputSchema.extend({
          expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        })
      : manualInputSchema,
    body,
  );
}
function manualDto(o: ManualOffer, now: number): ManualOffer {
  const dish = db.dishes.find((d) => d.id === o.dishId),
    av = availability(now).find((d) => d.dishId === o.dishId);
  const state =
    o.status !== "published"
      ? o.status
      : Date.parse(o.endsAt) <= now
        ? "ended"
        : Date.parse(o.effectiveStartsAt!) > now
          ? "scheduled"
          : !dish?.active || !av?.maxPortions
            ? "unavailable"
            : "visible";
  return {
    ...o,
    dishName: dish?.name || "Блюдо удалено",
    effectiveState: state,
    unavailableReason:
      state === "unavailable"
        ? "Блюдо неактивно или нет ингредиентов на порцию"
        : null,
  };
}
function filteredOffers(
  url: URL,
  now: number,
  safe: boolean,
): (OfferCard | PublicOfferCard)[] {
  const kind = url.searchParams.get("kind") || "all";
  if (!["all", "automatic", "manual"].includes(kind))
    fail(422, "VALIDATION_ERROR", "Неверный вид предложения");
  const automatic = offers(now),
    remaining = new Map(automatic.map((a) => [a.dishId, a]));
  const manual = (db.manualOffers || [])
    .map((o) => manualDto(o, now))
    .filter((o) => o.effectiveState === "visible")
    .sort(
      (a, b) =>
        Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!) ||
        a.id.localeCompare(b.id),
    );
  const rows: OfferCard[] = [];
  for (const o of manual) {
    const auto = remaining.get(o.dishId) || null;
    remaining.delete(o.dishId);
    rows.push({
      dishId: o.dishId,
      dishName: o.dishName,
      maxPortions: availability(now).find((d) => d.dishId === o.dishId)!
        .maxPortions,
      suggestedPortions: auto?.suggestedPortions || 1,
      automatic: auto,
      manual: {
        id: o.id,
        version: o.version,
        title: o.title,
        publicText: o.publicText,
        startsAt: o.effectiveStartsAt!,
        endsAt: o.endsAt,
      },
    });
  }
  for (const auto of automatic)
    if (remaining.has(auto.dishId))
      rows.push({
        dishId: auto.dishId,
        dishName: auto.dishName,
        maxPortions: auto.maxPortions,
        suggestedPortions: auto.suggestedPortions,
        automatic: auto,
        manual: null,
      });
  return rows
    .filter(
      (o) =>
        (kind === "all" ||
          (kind === "automatic" && o.automatic) ||
          (kind === "manual" && o.manual)) &&
        matchQuery(url, o.dishName + " " + (o.manual?.title || "")),
    )
    .map((o) =>
      safe
        ? {
            dishId: o.dishId,
            dishName: o.dishName,
            maxPortions: o.maxPortions,
            suggestedPortions: o.suggestedPortions,
            isAutomatic: !!o.automatic,
            promotion: o.manual
              ? {
                  title: o.manual.title,
                  publicText: o.manual.publicText,
                  startsAt: o.manual.startsAt,
                  endsAt: o.manual.endsAt,
                }
              : null,
          }
        : o,
    );
}
function executeManual(
  path: string,
  method: string,
  body: unknown,
  url: URL,
  now: number,
): { data: unknown; status: number } {
  db.manualOffers ??= [];
  const id = path.split("/")[2];
  const action = path.split("/")[3];
  const at = new Date(now).toISOString(),
    actor = currentActor.replace("user:", "");
  const existing = id ? db.manualOffers.find((o) => o.id === id) : undefined;
  if (id && !existing) fail(404, "NOT_FOUND", "Предложение недоступно");
  if (method === "GET") {
    if (existing) return { data: manualDto(existing, now), status: 200 };
    const status = url.searchParams.get("status");
    if (status && !["draft", "published", "archived"].includes(status))
      fail(422, "VALIDATION_ERROR", "Неверный статус");
    return {
      data: pagination(
        db.manualOffers
          .map((o) => manualDto(o, now))
          .filter(
            (o) =>
              (!status || o.status === status) &&
              matchQuery(url, o.title + " " + o.dishName),
          )
          .sort(
            (a, b) =>
              Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
              a.id.localeCompare(b.id),
          ),
        url,
        ["status", "q"],
      ),
      status: 200,
    };
  }
  if (!["POST", "PUT"].includes(method) || (action && method !== "POST"))
    fail(404, "NOT_FOUND", "Маршрут недоступен");
  const input = validateManualBody(path, method, body) as ManualOfferInput & {
    expectedVersion?: number;
  };
  if (existing) {
    if (existing.version !== input.expectedVersion)
      fail(
        409,
        "MANUAL_OFFER_VERSION_CONFLICT",
        "Версия изменилась: перечитайте предложение",
      );
    if (
      existing.status === "archived" ||
      (!action && existing.status !== "draft") ||
      (action === "publish" && existing.status !== "draft") ||
      (action === "unpublish" && existing.status !== "published")
    )
      fail(
        409,
        "MANUAL_OFFER_STATE_CONFLICT",
        "Состояние предложения изменилось",
      );
  }
  if (action) {
    if (!existing || !["publish", "unpublish", "archive"].includes(action))
      fail(404, "NOT_FOUND", "Маршрут недоступен");
    if (action === "publish") {
      if (!db.dishes.find((d) => d.id === existing!.dishId)?.active)
        fail(409, "DISH_INACTIVE", "Блюдо неактивно");
      if (Date.parse(existing!.endsAt) <= now)
        fail(422, "VALIDATION_ERROR", "Окончание должно быть в будущем", {
          fields: [
            {
              path: "endsAt",
              message: "Окончание должно быть после серверного времени",
            },
          ],
        });
      if (
        !availability(now).find((d) => d.dishId === existing!.dishId)
          ?.maxPortions
      )
        fail(409, "MANUAL_OFFER_UNAVAILABLE", "Нет ингредиентов на порцию");
      existing!.publishedAt = at;
      existing!.effectiveStartsAt = existing!.startsAt || at;
    }
    existing!.status =
      action === "publish"
        ? "published"
        : action === "unpublish"
          ? "draft"
          : "archived";
    existing!.version++;
    existing!.updatedAt = at;
    existing!.updatedByUserId = actor;
    return { data: manualDto(existing!, now), status: 200 };
  }
  const dish =
    db.dishes.find((d) => d.id === input.dishId) ||
    fail(422, "VALIDATION_ERROR", "Блюдо не найдено");
  if (existing && existing.dishId !== input.dishId)
    fail(422, "VALIDATION_ERROR", "Блюдо неизменяемо");
  if (!existing && !dish.active) fail(409, "DISH_INACTIVE", "Блюдо неактивно");
  if (input.startsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt))
    fail(422, "VALIDATION_ERROR", "Окончание раньше начала");
  if (
    !existing &&
    db.manualOffers.some(
      (o) => o.dishId === input.dishId && o.status !== "archived",
    )
  )
    fail(
      409,
      "MANUAL_OFFER_EXISTS",
      "Архивируйте прежнее предложение этого блюда",
    );
  const fields = {
    dishId: input.dishId,
    title: input.title,
    publicText: input.publicText,
    startsAt: input.startsAt ? normalizedTime(input.startsAt) : null,
    endsAt: normalizedTime(input.endsAt),
  };
  const o: ManualOffer = existing
    ? Object.assign(existing, fields, {
        version: existing.version + 1,
        updatedAt: at,
        updatedByUserId: actor,
      })
    : {
        ...fields,
        id: uuid(),
        dishName: dish.name,
        status: "draft",
        version: 1,
        createdAt: at,
        updatedAt: at,
        publishedAt: null,
        createdByUserId: actor,
        updatedByUserId: actor,
        effectiveStartsAt: null,
        effectiveState: "draft",
        unavailableReason: null,
      };
  if (!existing) db.manualOffers.push(o);
  return { data: manualDto(o, now), status: existing ? 200 : 201 };
}
function execute(
  path: string,
  method: string,
  body: unknown,
  url: URL,
  now: number,
  replayRoute = path,
): { data: unknown; status: number } {
  const at = new Date(now).toISOString();
  if (path === "/offers" && method === "GET")
    return {
      data: pagination(filteredOffers(url, now, false), url, ["q", "kind"]),
      status: 200,
    };
  if (/^\/manual-offers(?:\/|$)/.test(path))
    return executeManual(path, method, body, url, now);
  if (path === "/stop-list/forecast" && method === "GET") {
    for (const key of url.searchParams.keys())
      if (!["historyDays", "horizonHours"].includes(key))
        fail(422, "VALIDATION_ERROR", "Unknown query parameter");
    const historyDays = Number(url.searchParams.get("historyDays") ?? 14),
      horizonHours = Number(url.searchParams.get("horizonHours") ?? 48);
    if (
      ![7, 14, 28].includes(historyDays) ||
      ![6, 12, 24, 48].includes(horizonHours)
    )
      fail(422, "VALIDATION_ERROR", "Invalid forecast window");
    return {
      data: forecast(
        {
          ingredients: db.ingredients,
          dishes: db.dishes,
          batches: allBatches(),
          orders: db.orders,
          observationStartedAt: db.forecastObservationStartedAt!,
          datasetKind: db.datasetKind ?? "observed",
          revision: db.stateRevision ?? 1,
        },
        now,
        historyDays,
        horizonHours,
      ),
      status: 200,
    };
  }
  if (path === "/analytics/risk-inventory" && method === "GET") {
    const params = Object.fromEntries(url.searchParams);
    const input = validate(
      z
        .object({
          view: z.enum(["period", "cohort"]).default("period"),
          cohortEntry: z.enum(["dated", "unknown"]).optional(),
          from: timestampSchema,
          to: timestampSchema,
          ingredientId: uuidSchema.optional(),
          batchId: uuidSchema.optional(),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
        })
        .strict(),
      params,
    );
    if (input.view !== "cohort" && input.cohortEntry)
      fail(422, "VALIDATION_ERROR", "cohortEntry is only valid for cohorts");
    try {
      return {
        data: riskReport(
          {
            batches: allBatches(),
            movements: db.movements,
            writeOffs: db.writeOffs,
            openingBalances: db.openingBalances ?? [],
            trackingStartedAt: db.analyticsTrackingStartedAt!,
          },
          input,
          now,
        ),
        status: 200,
      };
    } catch {
      return fail(
        422,
        "VALIDATION_ERROR",
        "Choose a past period of no more than 90 days",
      );
    }
  }
  const comboView = (c: Combo): Combo => ({
    ...c,
    needsReview:
      c.recipeFingerprint !== recipeFingerprint(c.components, db.dishes),
  });
  if (path === "/service/combos" && method === "GET")
    return {
      data: pagination(
        (db.combos ?? [])
          .filter((c) => c.status === "published")
          .map((c) =>
            publicCombo(c, db.dishes, db.ingredients, allBatches(), now),
          ),
        url,
        [],
      ),
      status: 200,
    };
  if (path === "/combo-plans/preview" && method === "POST") {
    const input = validate(
      z
        .object({
          candidateDishIds: z
            .array(uuidSchema)
            .min(2)
            .max(12)
            .refine((ids) => new Set(ids).size === ids.length),
        })
        .strict(),
      body,
    );
    if (
      input.candidateDishIds.some(
        (id) => !db.dishes.find((d) => d.id === id)?.active,
      )
    )
      fail(422, "VALIDATION_ERROR", "Select active dishes");
    return {
      data: jointPlan(
        db.ingredients,
        db.dishes,
        allBatches(),
        input.candidateDishIds,
        now,
        db.stateRevision ?? 1,
      ),
      status: 200,
    };
  }
  if (path.startsWith("/combos")) {
    const parts = path.split("/"),
      combo = (db.combos ?? []).find((c) => c.id === parts[2]);
    const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
    const shape = {
      title: z.string().trim().min(1).max(120),
      components: z
        .array(
          z.object({ dishId: uuidSchema, portions: z.literal(1) }).strict(),
        )
        .length(2)
        .refine((c) => c[0].dishId !== c[1].dishId),
    };
    if (method === "GET") {
      if (parts.length === 2)
        return {
          data: pagination(
            (db.combos ?? [])
              .map(comboView)
              .filter(
                (c) =>
                  matchQuery(url, c.title) &&
                  (!url.searchParams.get("status") ||
                    c.status === url.searchParams.get("status")),
              ),
            url,
            ["q", "status"],
          ),
          status: 200,
        };
      if (combo && parts.length === 3)
        return { data: comboView(combo), status: 200 };
    }
    if (method === "POST") {
      if (parts.length === 2 || parts[3] === "versions") {
        const input =
          parts.length === 2
            ? validate(z.object(shape).strict(), body)
            : validate(
                z.object({ ...shape, expectedVersion: version }).strict(),
                body,
              );
        if (parts.length > 2 && !combo)
          fail(404, "NOT_FOUND", "Combo not found");
        if (
          combo &&
          "expectedVersion" in input &&
          combo.version !== input.expectedVersion
        )
          fail(409, "COMBO_VERSION_CHANGED", "Combo version changed");
        if (
          input.components.some(
            (c) => !db.dishes.find((d) => d.id === c.dishId)?.active,
          )
        )
          fail(422, "VALIDATION_ERROR", "Choose two active dishes");
        if (
          (db.combos ?? []).some(
            (c) =>
              c.id !== combo?.id &&
              c.title.toLocaleLowerCase("ru") ===
                input.title.toLocaleLowerCase("ru"),
          )
        )
          fail(409, "NAME_EXISTS", "Combo title exists");
        const next: Combo = {
          id: combo?.id ?? uuid(),
          title: input.title,
          components: input.components,
          version: (combo?.version ?? 0) + 1,
          status: "draft",
          createdAt: combo?.createdAt ?? at,
          updatedAt: at,
          recipeFingerprint: recipeFingerprint(input.components, db.dishes),
          needsReview: false,
          pricingMode: "unpriced",
        };
        if (combo) {
          (db.comboVersions ??= []).push(structuredClone(combo));
          Object.assign(combo, next);
        } else (db.combos ??= []).push(next);
        return { data: next, status: 201 };
      }
      if (!combo) fail(404, "NOT_FOUND", "Combo not found");
      const input = validate(
        z.object({ expectedVersion: version }).strict(),
        body,
      );
      if (combo.version !== input.expectedVersion)
        fail(409, "COMBO_VERSION_CHANGED", "Combo version changed");
      if (parts[3] === "publish") {
        if (combo.status !== "draft")
          fail(409, "COMBO_STATE_CONFLICT", "Only drafts can be published");
        if (comboView(combo).needsReview)
          fail(
            409,
            "COMBO_RECIPE_CHANGED",
            "Recipe changed; create a new version",
          );
        if (
          publicCombo(
            { ...combo, status: "published" },
            db.dishes,
            db.ingredients,
            allBatches(),
            now,
          ).maxUnits < 1
        )
          fail(409, "COMBO_UNAVAILABLE", "Ingredients unavailable");
        combo.status = "published";
      } else if (parts[3] === "archive") {
        if (combo.status === "archived")
          fail(409, "COMBO_STATE_CONFLICT", "Already archived");
        combo.status = "archived";
      } else fail(404, "NOT_FOUND", "Unknown combo action");
      combo.updatedAt = at;
      return { data: comboView(combo), status: 200 };
    }
    fail(404, "NOT_FOUND", "Combo not found");
  }
  if (path.startsWith("/quarantines")) {
    const parts = path.split("/");
    const record = db.quarantines?.find((q) => q.id === parts[2]);
    const batch = record
      ? allBatches().find((b) => b.id === record.batchId)!
      : undefined;
    if (method === "GET" && parts.length === 2) {
      const status = url.searchParams.get("status"),
        batchId = url.searchParams.get("batchId"),
        ingredientId = url.searchParams.get("ingredientId");
      if (status && !["open", "closed"].includes(status))
        fail(422, "VALIDATION_ERROR", "Invalid status");
      return {
        data: pagination(
          history(db.quarantines ?? []).filter(
            (q) =>
              (!status || q.status === status) &&
              (!batchId || q.batchId === batchId) &&
              (!ingredientId ||
                allBatches().find((b) => b.id === q.batchId)?.ingredientId ===
                  ingredientId),
          ),
          url,
          ["status", "batchId", "ingredientId"],
        ),
        status: 200,
      };
    }
    if (method === "GET" && record && parts.length === 3)
      return { data: record, status: 200 };
    if (method === "GET" && record && parts[3] === "orders") {
      return {
        data: pagination(
          history(db.orders)
            .filter((o) =>
              o.allocations.some((a) => a.batchId === record.batchId),
            )
            .map((o) => ({
              orderId: o.id,
              number: o.number,
              createdAt: o.createdAt,
              source: o.source,
              usedFromBatchQuantity: normalized(
                o.allocations
                  .filter((a) => a.batchId === record.batchId)
                  .reduce((n, a) => n + thousandths(a.quantity), 0n),
              ),
              unit: batch!.unit,
            })),
          url,
          [],
        ),
        status: 200,
      };
    }
    if (method === "POST") {
      const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
      try {
        if (parts.length === 2) {
          const input = validate(
            z
              .object({
                batchId: uuidSchema,
                expectedBatchVersion: version,
                quantity: positive,
                reason: z.string().trim().min(1).max(500),
                note: z.string().max(500).nullable(),
              })
              .strict(),
            body,
          );
          const b =
            allBatches().find((b) => b.id === input.batchId) ||
            fail(404, "NOT_FOUND", "Batch not found");
          const result = openQuarantine(b, input, {
            id: uuid(),
            warehouseId: databaseKey.split(".").at(-1)!,
            actorId: currentActor.slice(5),
            asOf: at,
          });
          Object.assign(b, result.batch);
          (db.quarantines ??= []).push(result.quarantine);
          addMovement(
            b,
            "quarantine_open",
            0n,
            result.quarantine.id,
            null,
            now,
          );
          Object.assign(db.movements.at(-1)!, {
            quantityDelta: "0.000",
            heldQuantityDelta: quantity(input.quantity),
            quarantineId: result.quarantine.id,
          });
          return { data: result.quarantine, status: 201 };
        }
        if (!record || !batch) fail(404, "NOT_FOUND", "Quarantine not found");
        if (!["release", "write-off"].includes(parts[3]))
          fail(404, "NOT_FOUND", "Unknown action");
        const release = parts[3] === "release";
        const input = validate(
          release
            ? z
                .object({
                  expectedVersion: version,
                  quantity: positive,
                  reason: z.string().trim().min(1).max(500),
                })
                .strict()
            : z
                .object({
                  expectedVersion: version,
                  quantity: positive,
                  reason: z.enum(["expired", "damaged"]),
                  note: z.string().max(500).nullable(),
                })
                .strict(),
          body,
        );
        const writeOff: WriteOff | null = release
          ? null
          : {
              id: uuid(),
              createdAt: at,
              batchId: batch.id,
              quantity: quantity(input.quantity),
              reason: input.reason as "expired" | "damaged",
              note: "note" in input ? (input.note as string | null) : null,
            };
        const result = decideQuarantine(batch, record, input, {
          action: release ? "release" : "write_off",
          decisionId: uuid(),
          writeOffId: writeOff?.id ?? null,
          actorId: currentActor.slice(5),
          asOf: at,
        });
        Object.assign(batch, result.batch);
        Object.assign(record, result.quarantine);
        if (writeOff) db.writeOffs.push(writeOff);
        addMovement(
          batch,
          release ? "quarantine_release" : "write_off",
          release ? 0n : thousandths(input.quantity),
          writeOff?.id ?? record.id,
          null,
          now,
        );
        Object.assign(db.movements.at(-1)!, {
          heldQuantityDelta: "-" + quantity(input.quantity),
          quarantineId: record.id,
          ...(release ? { quantityDelta: "0.000" } : {}),
        });
        return {
          data: release ? record : { quarantine: record, writeOff },
          status: 200,
        };
      } catch (e) {
        if (e instanceof DemoFailure) throw e;
        fail(
          409,
          e instanceof Error ? e.message : "QUARANTINE_CONFLICT",
          "Stock or quarantine changed; refresh and try again",
        );
      }
    }
    fail(404, "NOT_FOUND", "Quarantine not found");
  }
  if (path === "/config" && method === "GET")
    return {
      data: {
        restaurantName: "RIMS · демо-ресторан",
        timeZone: "Europe/Moscow",
        expiryWarningPercent: 10,
        hotOfferMaxPortions: 20,
        contractVersion: "2.1.0",
      },
      status: 200,
    };
  if (path === "/dashboard" && method === "GET") {
    const menu = availability(now),
      batches = allBatches().map((b) => batchSnapshot(b, now));
    const today = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Moscow",
    }).format(now);
    const data: Dashboard = {
      pendingDeliveryCount: db.deliveries.filter((d) => d.status === "pending")
        .length,
      ingredientCount: db.ingredients.length,
      activeDishCount: db.dishes.filter((x) => x.active).length,
      stoppedDishCount: menu.filter((x) => x.status === "stopped").length,
      lowStockIngredientCount: inventories(now).filter((x) => x.isLowStock)
        .length,
      expiringBatchCount: batches.filter((x) => x.status === "expiring").length,
      expiredBatchCount: batches.filter((x) => x.status === "expired").length,
      todayOrderCount: db.orders.filter(
        (x) =>
          new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Europe/Moscow",
          }).format(new Date(x.createdAt)) === today,
      ).length,
      hotOfferCount: offers(now).length,
    };
    return { data, status: 200 };
  }
  if (path === "/ingredients" && method === "GET")
    return {
      data: pagination(
        ascending(
          db.ingredients.filter((x) => matchQuery(url, x.name)),
          (x) => x.name,
          (x) => x.id,
        ),
        url,
        ["q"],
      ),
      status: 200,
    };
  if (path === "/ingredients" && method === "POST") {
    strictFields(body, [
      "name",
      "unit",
      "defaultShelfLifeHours",
      "reorderPoint",
      "targetStock",
    ]);
    const input = validate<IngredientInput>(ingredientSchema, body);
    if (existsName(input.name, db.ingredients))
      fail(409, "NAME_CONFLICT", "Ингредиент с таким названием уже существует");
    const item = {
      ...input,
      id: uuid(),
      reorderPoint: quantity(input.reorderPoint),
      targetStock: quantity(input.targetStock),
    };
    db.ingredients.push(item);
    return { data: item, status: 201 };
  }
  if (/^\/ingredients\/[^/]+$/.test(path) && method === "PATCH") {
    const id = path.split("/")[2];
    const item =
      db.ingredients.find((x) => x.id === id) ||
      fail(404, "NOT_FOUND", "Ингредиент не найден");
    strictFields(body, [
      "name",
      "defaultShelfLifeHours",
      "reorderPoint",
      "targetStock",
    ]);
    if (!Object.keys(body as object).length)
      fail(422, "VALIDATION_ERROR", "Укажите изменённые поля");
    const updated = validate<IngredientInput>(ingredientSchema, {
      ...item,
      ...(body as object),
    });
    if (existsName(updated.name, db.ingredients, id))
      fail(409, "NAME_CONFLICT", "Ингредиент с таким названием уже существует");
    Object.assign(item, updated, {
      reorderPoint: quantity(updated.reorderPoint),
      targetStock: quantity(updated.targetStock),
    });
    return { data: item, status: 200 };
  }
  if (path === "/dishes" && method === "GET") {
    const active = boolFilter(url, "active");
    return {
      data: pagination(
        ascending(
          db.dishes.filter(
            (x) =>
              matchQuery(url, x.name) &&
              (active === undefined || x.active === active),
          ),
          (x) => x.name,
          (x) => x.id,
        ),
        url,
        ["q", "active"],
      ),
      status: 200,
    };
  }
  if (
    (path === "/dishes" && method === "POST") ||
    (/^\/dishes\/[^/]+$/.test(path) && method === "PUT")
  ) {
    strictFields(body, ["name", "active", "recipe"]);
    const input = validate<DishInput>(dishSchema, body);
    for (const r of input.recipe) {
      strictFields(r, ["ingredientId", "quantity"]);
      ingredient(r.ingredientId);
    }
    const id = method === "PUT" ? path.split("/")[2] : uuid();
    const existing =
      method === "PUT"
        ? db.dishes.find((x) => x.id === id) ||
          fail(404, "NOT_FOUND", "Блюдо не найдено")
        : null;
    if (existsName(input.name, db.dishes, id))
      fail(409, "NAME_CONFLICT", "Блюдо с таким названием уже существует");
    const item: Dish = {
      ...input,
      id,
      createdAt: existing?.createdAt || at,
      updatedAt: at,
      recipe: input.recipe.map((r) => ({
        ...r,
        quantity: quantity(r.quantity),
      })),
    };
    if (existing) Object.assign(existing, item);
    else db.dishes.push(item);
    return { data: item, status: existing ? 200 : 201 };
  }
  if (/^\/dishes\/[^/]+$/.test(path) && method === "GET")
    return {
      data:
        db.dishes.find((x) => x.id === path.split("/")[2]) ||
        fail(404, "NOT_FOUND", "Блюдо не найдено"),
      status: 200,
    };
  if (path === "/deliveries" && method === "POST") {
    const input = validate<DeliveryInput>(deliverySchema, body);
    if (db.deliveries.some((x) => x.number === input.number))
      fail(409, "DELIVERY_NUMBER_EXISTS", "Номер поставки уже существует");
    const lines = input.lines.map((line) => {
      const i = ingredient(line.ingredientId);
      const manufacturedAt =
        "manufacturedAt" in line ? normalizedTime(line.manufacturedAt) : null;
      const shelfLifeHours =
        "manufacturedAt" in line
          ? (line.shelfLifeHours ?? i.defaultShelfLifeHours)
          : i.defaultShelfLifeHours;
      const expiresAt =
        "expiresAt" in line
          ? normalizedTime(line.expiresAt)
          : normalizedTime(manufacturedAt!, shelfLifeHours * 3600000);
      return {
        id: uuid(),
        ingredientId: i.id,
        ingredientName: i.name,
        unit: i.unit,
        quantity: quantity(line.quantity),
        manufacturedAt,
        shelfLifeHours,
        expiresAt,
      };
    });
    const item: Delivery = {
      id: uuid(),
      number: input.number,
      createdAt: at,
      expectedAt: input.expectedAt ? normalizedTime(input.expectedAt) : null,
      receivedAt: null,
      status: "pending",
      source: currentActor.startsWith("client:") ? "integration" : "manual",
      externalId: currentExternalId,
      note: input.note,
      lines,
      batches: [],
      confirmedByUserId: null,
      rejectedAt: null,
      rejectionReason: null,
    };
    db.deliveries.push(item);
    return { data: item, status: 201 };
  }
  if (
    /^\/deliveries\/[^/]+\/(confirm|reject)$/.test(path) &&
    method === "POST"
  ) {
    const item =
      db.deliveries.find((x) => x.id === path.split("/")[2]) ||
      fail(404, "NOT_FOUND", "Поставка недоступна");
    if (path.endsWith("/reject")) {
      const input = validate(
        z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
        body,
      );
      if (item.status === "rejected" && item.rejectionReason === input.reason)
        return { data: item, status: 200 };
      if (item.status !== "pending")
        fail(
          409,
          "DELIVERY_STATE_CONFLICT",
          "По поставке уже принято другое решение",
        );
      Object.assign(item, {
        status: "rejected",
        rejectedAt: at,
        rejectionReason: input.reason,
      });
      return { data: item, status: 200 };
    }
    const input = validate(
      z.union([
        z.object({ receivedAt: timestampSchema }).strict(),
        z.object({ receivedAtMode: z.literal("server") }).strict(),
      ]),
      body,
    );
    const receivedAt =
      "receivedAtMode" in input
        ? normalizedTime(at)
        : normalizedTime(input.receivedAt);
    if (
      item.status === "confirmed" &&
      ("receivedAtMode" in input || item.receivedAt === receivedAt)
    )
      return {
        data: {
          ...item,
          batches: item.batches.map((b) => batchSnapshot(b, now)),
        },
        status: 200,
      };
    if (item.status !== "pending")
      fail(
        409,
        "DELIVERY_STATE_CONFLICT",
        "По поставке уже принято другое решение",
      );
    if (Date.parse(receivedAt) > now)
      fail(422, "VALIDATION_ERROR", "Приёмка не может быть в будущем", {
        fields: [
          { path: "receivedAt", message: "Приёмка не может быть в будущем" },
        ],
      });
    for (const line of item.lines) {
      if (
        (line.manufacturedAt &&
          Date.parse(line.manufacturedAt) > Date.parse(receivedAt)) ||
        Date.parse(line.expiresAt) <= Date.parse(receivedAt)
      )
        fail(
          422,
          "VALIDATION_ERROR",
          "Проверьте фактическую приёмку: изготовление не позже приёмки, истечение строго после неё",
        );
      const current = thousandths(
        inventories(now).find((i) => i.ingredientId === line.ingredientId)!
          .physicalQuantity,
      );
      const extra = item.lines
        .filter((x) => x.ingredientId === line.ingredientId)
        .reduce((n, x) => n + thousandths(x.quantity), 0n);
      if (current + extra > 999999999999n)
        fail(422, "QUANTITY_LIMIT_EXCEEDED", "Превышен предел остатка");
    }
    item.batches = item.lines.map((line) =>
      batchSnapshot(
        {
          id: uuid(),
          deliveryId: item.id,
          deliveryNumber: item.number,
          deliveryItemId: line.id,
          ingredientId: line.ingredientId,
          ingredientName: line.ingredientName,
          unit: line.unit,
          receivedAt,
          manufacturedAt: line.manufacturedAt,
          shelfLifeHours: line.shelfLifeHours,
          expiresAt: line.expiresAt,
          initialQuantity: line.quantity,
          remainingQuantity: line.quantity,
          heldQuantity: "0.000",
          availableQuantity: line.quantity,
          heldExpiredQuantity: "0.000",
          version: 1,
          receiptCommittedAt: at,
          status: "fresh",
          remainingSeconds: 0,
        },
        now,
      ),
    );
    item.status = "confirmed";
    item.receivedAt = receivedAt;
    item.confirmedByUserId = currentActor.replace("user:", "");
    for (const batch of item.batches)
      addMovement(
        batch,
        "receipt",
        thousandths(batch.initialQuantity),
        item.id,
        item.number,
        now,
      );
    return { data: item, status: 200 };
  }
  const deliveryView = (d: Delivery) => ({
    ...d,
    batches: d.batches.map((b) => ({
      ...batchSnapshot(b, now),
    })),
  });
  if (path === "/deliveries" && method === "GET")
    return {
      data: pagination(
        history(db.deliveries)
          .filter(
            (d) =>
              !url.searchParams.get("status") ||
              d.status === url.searchParams.get("status"),
          )
          .map(deliveryView),
        url,
        ["status"],
      ),
      status: 200,
    };
  if (/^\/deliveries\/[^/]+$/.test(path) && method === "GET")
    return {
      data: deliveryView(
        db.deliveries.find((x) => x.id === path.split("/")[2]) ||
          fail(404, "NOT_FOUND", "Поставка не найдена"),
      ),
      status: 200,
    };
  if (path === "/inventory" && method === "GET") {
    const low = boolFilter(url, "lowStock");
    return {
      data: pagination(
        inventories(now).filter(
          (x) =>
            matchQuery(url, x.ingredientName) &&
            (low === undefined || x.isLowStock === low),
        ),
        url,
        ["q", "lowStock"],
      ),
      status: 200,
    };
  }
  if (path === "/batches" && method === "GET") {
    const status = url.searchParams.get("status");
    if (status && !["fresh", "expiring", "expired", "empty"].includes(status))
      fail(422, "VALIDATION_ERROR", "Некорректный статус");
    const includeEmpty = boolFilter(url, "includeEmpty");
    const ingredientId = url.searchParams.get("ingredientId");
    if (ingredientId) validate(uuidSchema, ingredientId);
    const items = fefo(allBatches())
      .map((b) => ({
        ...batchSnapshot(b, now),
      }))
      .filter(
        (x) =>
          (!ingredientId || x.ingredientId === ingredientId) &&
          (!status || x.status === status) &&
          (includeEmpty || status === "empty" || x.status !== "empty"),
      );
    return {
      data: pagination(items, url, ["status", "includeEmpty", "ingredientId"]),
      status: 200,
    };
  }
  if (path === "/movements" && method === "GET") {
    const i = url.searchParams.get("ingredientId"),
      b = url.searchParams.get("batchId"),
      type = url.searchParams.get("type");
    if (i) validate(uuidSchema, i);
    if (b) validate(uuidSchema, b);
    if (
      type &&
      ![
        "receipt",
        "order",
        "write_off",
        "quarantine_open",
        "quarantine_release",
      ].includes(type)
    )
      fail(422, "VALIDATION_ERROR", "Некорректный тип");
    return {
      data: pagination(
        history(db.movements).filter(
          (x) =>
            (!i || x.ingredientId === i) &&
            (!b || x.batchId === b) &&
            (!type || x.type === type),
        ),
        url,
        ["ingredientId", "batchId", "type"],
      ),
      status: 200,
    };
  }
  if (path === "/menu/availability" && method === "GET")
    return {
      data: pagination(
        availability(now).filter((x) => matchQuery(url, x.dishName)),
        url,
        ["q"],
      ),
      status: 200,
    };
  if (path === "/stop-list" && method === "GET")
    return {
      data: pagination(
        availability(now).filter((x) => x.status === "stopped"),
        url,
        [],
      ),
      status: 200,
    };
  if ((path === "/orders" || path === "/orders/preview") && method === "POST") {
    strictFields(body, ["lines", "combos"]);
    const originalInput = validate<OrderInput>(orderSchema, body);
    if (
      path === "/orders" &&
      currentExternalId &&
      currentActor.startsWith("client:")
    ) {
      const existing =
        registry.external[
          `${databaseKey.split(".").at(-1)}:${currentActor.slice(7)}:/orders:${currentExternalId}`
        ];
      if (existing && existing.hash !== JSON.stringify(semantic(body)))
        fail(
          409,
          "EXTERNAL_ID_CONFLICT",
          "External ID used with different body",
        );
      if (existing)
        return {
          data:
            db.orders.find((o) => o.id === existing.id) ||
            fail(409, "EXTERNAL_ID_CONFLICT", "Unknown saved order"),
          status: 200,
        };
    }
    let expanded: ReturnType<typeof expandOrder>;
    try {
      expanded = expandOrder(originalInput, db.dishes, db.combos ?? []);
    } catch (e) {
      const code = e instanceof Error ? e.message : "COMBO_UNAVAILABLE";
      return fail(
        code === "ORDER_LIMIT_EXCEEDED" || code === "DISH_NOT_FOUND"
          ? 422
          : 409,
        code,
        "Order contents changed; refresh the menu",
      );
    }
    const input = expanded.input;
    for (const line of input.lines) strictFields(line, ["dishId", "portions"]);
    const preview = plan(input, now);
    if (path === "/orders/preview") return { data: preview, status: 200 };
    if (!preview.canCreate)
      fail(409, "INSUFFICIENT_STOCK", "Недостаточно ингредиентов для заказа", {
        shortages: preview.requirements.filter(
          (r) => thousandths(r.missingQuantity) > 0n,
        ),
      });
    const item: Order = {
      id: uuid(),
      number: `ORD-${String(db.orders.length + 1).padStart(4, "0")}`,
      createdAt: at,
      status: "completed",
      customerId: currentActor.startsWith("customer:")
        ? currentActor.slice(9)
        : null,
      source: currentActor.startsWith("customer:")
        ? "customer"
        : currentActor.startsWith("client:")
          ? "integration"
          : replayRoute.startsWith("/service/")
            ? "waiter"
            : "staff",
      externalId: currentExternalId,
      lines: input.lines.map((x) => ({
        ...x,
        dishName: db.dishes.find((d) => d.id === x.dishId)!.name,
      })),
      allocations: preview.allocations.map((a) => ({
        ...a,
        riskSnapshot: riskSnapshot(
          allBatches().find((b) => b.id === a.batchId)!,
          now,
        ),
      })),
      composition: expanded.composition,
      recipeSnapshot: input.lines.map((l) => ({
        dishId: l.dishId,
        recipe: structuredClone(
          db.dishes.find((d) => d.id === l.dishId)!.recipe,
        ),
      })),
    };
    for (const allocation of preview.allocations) {
      const b = allBatches().find((x) => x.id === allocation.batchId)!;
      b.remainingQuantity = normalized(
        thousandths(b.remainingQuantity) - thousandths(allocation.quantity),
      );
      addMovement(
        b,
        "order",
        thousandths(allocation.quantity),
        item.id,
        item.number,
        now,
      );
    }
    db.orders.push(item);
    return { data: item, status: 201 };
  }
  if (path === "/orders" && method === "GET")
    return { data: pagination(history(db.orders), url, []), status: 200 };
  if (/^\/orders\/[^/]+$/.test(path) && method === "GET")
    return {
      data:
        db.orders.find((x) => x.id === path.split("/")[2]) ||
        fail(404, "NOT_FOUND", "Заказ не найден"),
      status: 200,
    };
  if (path === "/recommendations" && method === "GET")
    return { data: pagination(offers(now), url, []), status: 200 };
  if (path === "/purchase-suggestions" && method === "GET")
    return { data: pagination(purchases(now), url, []), status: 200 };
  if (path === "/write-offs" && method === "POST") {
    const input = validate<WriteOffInput>(writeOffSchema, body);
    const b =
      allBatches().find((x) => x.id === input.batchId) ||
      fail(422, "VALIDATION_ERROR", "Партия не найдена");
    if (input.reason === "expired" && Date.parse(b.expiresAt) > now)
      fail(409, "BATCH_NOT_EXPIRED", "Срок партии ещё не истёк");
    if (thousandths(input.quantity) > free(b))
      fail(409, "INSUFFICIENT_FREE_BATCH_STOCK", "Остаток партии изменился");
    const item: WriteOff = {
      ...input,
      quantity: quantity(input.quantity),
      id: uuid(),
      createdAt: at,
    };
    b.remainingQuantity = normalized(
      thousandths(b.remainingQuantity) - thousandths(input.quantity),
    );
    addMovement(
      b,
      "write_off",
      thousandths(input.quantity),
      item.id,
      null,
      now,
    );
    db.writeOffs.push(item);
    return { data: item, status: 201 };
  }
  return fail(404, "NOT_FOUND", "Маршрут не найден");
}
function semantic(value: unknown, field = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => semantic(v));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, semantic(v, k)]),
    );
  if (typeof value === "string") {
    if (["quantity", "reorderPoint", "targetStock"].includes(field)) {
      try {
        return quantity(value);
      } catch {
        return value;
      }
    }
    if (field.endsWith("At") && Number.isFinite(Date.parse(value)))
      return normalizedTime(value);
    if (["name", "number"].includes(field)) return value.trim();
  }
  return value;
}
function engineRequest(
  path: string,
  method: string,
  body: unknown,
  url: URL,
  key: string | null,
  replayRoute = path,
): ResponseRecord {
  const now = Date.now();
  const meta = { serverTime: new Date(now).toISOString(), requestId: uuid() };
  const before = structuredClone(db);
  const idempotent =
    ((method === "POST" || method === "PUT") &&
      /^\/manual-offers(?:\/|$)/.test(path)) ||
    (method === "POST" &&
      ([
        "/deliveries",
        "/orders",
        "/write-offs",
        "/quarantines",
        "/combos",
      ].includes(path) ||
        /^\/(quarantines|combos)\/[^/]+\/(release|write-off|versions|publish|archive)$/.test(
          path,
        ) ||
        /^\/deliveries\/[^/]+\/(confirm|reject)$/.test(path)));
  const replayKey = `${currentActor}:${method}:${replayRoute}:${key}`;
  const legacyHash = JSON.stringify(semantic(body));
  const hash =
    path === "/orders" && currentExternalId
      ? JSON.stringify(
          semantic({ ...(body as object), externalId: currentExternalId }),
        )
      : legacyHash;
  try {
    if (idempotent) {
      if (!key || !uuidSchema.safeParse(key).success)
        fail(400, "INVALID_IDEMPOTENCY_KEY", "Нужен UUID ключ");
      if (path === "/deliveries") validate(deliverySchema, body);
      if (path === "/orders") {
        strictFields(body, ["lines", "combos"]);
        validate(orderSchema, body);
      }
      if (path === "/write-offs") validate(writeOffSchema, body);
      if (/^\/manual-offers(?:\/|$)/.test(path))
        validateManualBody(path, method, body);
      if (/\/confirm$/.test(path))
        validate(
          z.union([
            z.object({ receivedAt: timestampSchema }).strict(),
            z.object({ receivedAtMode: z.literal("server") }).strict(),
          ]),
          body,
        );
      if (/\/reject$/.test(path))
        validate(
          z.object({ reason: z.string().trim().min(1).max(500) }).strict(),
          body,
        );
      const replay = db.replays[replayKey];
      if (replay) {
        const legacyOrder =
          replay.response.body && "data" in replay.response.body
            ? (replay.response.body.data as Order)
            : null;
        const compatibleLegacy =
          path === "/orders" &&
          currentExternalId &&
          replay.hash === legacyHash &&
          legacyOrder?.externalId === currentExternalId;
        if (replay.hash !== hash && !compatibleLegacy)
          fail(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Этот ключ уже использован с другим body",
          );
        return structuredClone(replay.response);
      }
    }
    const result = execute(path, method, body, url, now, replayRoute);
    const response: ResponseRecord = {
      status: result.status,
      body: result.status === 204 ? null : { data: result.data, meta },
    };
    if (idempotent)
      db.replays[replayKey] = { hash, response: structuredClone(response) };
    if (method !== "GET" && !path.endsWith("/preview")) {
      db.stateRevision = (db.stateRevision ?? 1) + 1;
      persist();
    }
    return response;
  } catch (error) {
    db = before;
    const failure =
      error instanceof DemoFailure
        ? error
        : new DemoFailure(500, "INTERNAL_ERROR", "Ошибка demo API");
    const response: ResponseRecord = {
      status: failure.status,
      body: {
        error: {
          code: failure.code,
          message: failure.message,
          details: failure.details,
        },
        meta,
      },
    };
    if (
      idempotent &&
      failure.status === 409 &&
      failure.code !== "IDEMPOTENCY_KEY_REUSED"
    ) {
      db.replays[replayKey] = { hash, response };
      persist();
    }
    return response;
  }
}

const demoWarehouseA = "aaaaaaaa-0000-4000-8000-000000000001";
const demoWarehouseB = "bbbbbbbb-0000-4000-8000-000000000002";
export { demoWarehouseA, demoWarehouseB };
type DemoRegistry = {
  purchaseRequests?: PurchaseRequest[];
  purchaseReplays?: Record<string, { hash: string; result: ResponseRecord }>;
  schemaVersion?: number;
  users: (User & { accountKind?: "staff" | "customer" })[];
  publication?: Record<string, boolean>;
  passwords: Record<string, string>;
  enterprises: Enterprise[];
  members: (Member & { enterpriseId: string })[];
  clients: IntegrationClient[];
  keys: (IntegrationKey & { hash: string })[];
  external: Record<string, { hash: string; id: string }>;
};
// This is a demo backend simulator, never authentication code for production.
function demoHash(value: string) {
  let hash = 2166136261;
  for (const char of value)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return String(hash >>> 0);
}
function seedRegistry(): DemoRegistry {
  const users = [
    demoOperator,
    ...(["manager", "warehouse", "waiter"] as const).map((username, i) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${i + 1}`,
      username,
      displayName: {
        manager: "Демо-менеджер",
        warehouse: "Демо-склад",
        waiter: "Демо-официант",
      }[username],
    })),
  ];
  const enterprises = [
    {
      id: "aaaaaaaa-0000-4000-8000-000000000011",
      name: "RIMS · Центральный ресторан",
      warehouseId: demoWarehouseA,
      createdAt: new Date().toISOString(),
    },
    {
      id: "bbbbbbbb-0000-4000-8000-000000000022",
      name: "RIMS · Второй ресторан",
      warehouseId: demoWarehouseB,
      createdAt: new Date().toISOString(),
    },
  ];
  return {
    users: [
      ...users,
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        username: "superadmin",
        displayName: "Супер-админ",
        isSuperAdmin: true,
      },
    ],
    passwords: {
      ...Object.fromEntries(users.map((u) => [u.id, demoHash("demo")])),
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc": demoHash("demo"),
    },
    enterprises,
    members: [
      ...users.map((u, i) => ({
        userId: u.id,
        username: u.username,
        displayName: u.displayName,
        role: (["owner", "manager", "warehouse", "waiter"] as Role[])[i],
        enterpriseId: enterprises[0].id,
      })),
      {
        userId: demoOperator.id,
        username: "operator",
        displayName: demoOperator.displayName,
        role: "manager",
        enterpriseId: enterprises[1].id,
      },
    ],
    clients: [],
    keys: [],
    external: {},
  };
}
let registry: DemoRegistry = (() => {
  try {
    return (
      JSON.parse(demoStorage.getItem("rims.demo.registry.v2") || "null") ||
      seedRegistry()
    );
  } catch {
    throw new Error("DEMO_STORAGE_ERROR");
  }
})();
// Upgrade existing demo tabs without granting elevated access to ordinary users.
if (!registry.users.some((u) => u.username === "superadmin")) {
  const admin = seedRegistry().users.find((u) => u.isSuperAdmin)!;
  registry.users.push(admin);
  registry.passwords[admin.id] = demoHash("demo");
}
function saveRegistry() {
  if (!registry.users.some((u) => u.username === "superadmin")) {
    const admin = seedRegistry().users.find((u) => u.isSuperAdmin)!;
    registry.users.push(admin);
    registry.passwords[admin.id] = demoHash("demo");
  }
  registry.schemaVersion = 3;
  for (const user of registry.users) user.accountKind ??= "staff";
  demoStorage.setItem("rims.demo.registry.v2", JSON.stringify(registry));
}
function resetDemoGlobals() {
  const previousEnterprises = registry.enterprises;
  registry = seedRegistry();
  saveRegistry();
  for (const enterprise of previousEnterprises)
    demoStorage.removeItem("rims.demo.database.v2." + enterprise.warehouseId);
  databaseKey = "rims.demo.database.v2." + demoWarehouseA;
  db = seed();
  persist();
  initializeDemoData();
}
let currentActor = "";
let currentExternalId: string | null = null;
const membershipsFor = (userId: string): Membership[] =>
  registry.users.find((u) => u.id === userId)?.isSuperAdmin
    ? registry.enterprises.map((e) => ({
        enterpriseId: e.id,
        enterpriseName: e.name,
        warehouseId: e.warehouseId,
        role: "super_admin",
      }))
    : registry.members
        .filter((m) => m.userId === userId)
        .map((m) => {
          const e = registry.enterprises.find((e) => e.id === m.enterpriseId)!;
          return {
            enterpriseId: e.id,
            enterpriseName: e.name,
            warehouseId: e.warehouseId,
            role: m.role,
          };
        });
function checkRole(role: Role, path: string, method: string) {
  if (path === "/config") return;
  const service = path.startsWith("/service/");
  if (
    service &&
    !(
      (method === "GET" &&
        [
          "/service/menu",
          "/service/stop-list",
          "/service/recommendations",
          "/service/offers",
          "/service/combos",
        ].includes(path)) ||
      (method === "POST" &&
        ["/service/orders", "/service/orders/preview"].includes(path))
    )
  )
    fail(404, "NOT_FOUND", "Сервисный маршрут не найден");
  const readWarehouse =
    /^\/(ingredients|inventory|batches|movements|deliveries|purchase-suggestions|quarantines|stop-list\/forecast|analytics\/risk-inventory)(\/|$)/.test(
      path,
    );
  if (role === "waiter" && !service)
    fail(403, "FORBIDDEN", "Официанту доступен только сервисный интерфейс");
  if (
    role === "warehouse" &&
    (!readWarehouse ||
      path.endsWith("/orders") ||
      (method !== "GET" &&
        !(["/deliveries", "/quarantines"].includes(path) && method === "POST")))
  )
    fail(403, "FORBIDDEN", "Действие недоступно сотруднику склада");
  if (
    path.startsWith("/integration-clients") &&
    role !== "owner" &&
    role !== "super_admin"
  )
    fail(403, "FORBIDDEN", "Ключи доступны только владельцу");
}
export function demoRequest(
  path: string,
  method: string,
  body: unknown,
  url: URL,
  key: string | null,
  token?: string | null,
): ResponseRecord {
  const meta = { serverTime: new Date().toISOString(), requestId: uuid() };
  const ok = (data: unknown, status = 200): ResponseRecord => ({
    status,
    body: status === 204 ? null : { data, meta },
  });
  try {
    const storedRegistry = demoStorage.getItem("rims.demo.registry.v2");
    if (storedRegistry) registry = JSON.parse(storedRegistry);
    if (path.startsWith("/customer/"))
      return customerRequest(path.slice(9), method, body, url, key, ok);
    if (path === "/auth/logout" && method === "POST") {
      sessionStorage.removeItem(sessionKey);
      return ok(null, 204);
    }
    if (
      (path === "/auth/login" || path === "/auth/register") &&
      method === "POST"
    ) {
      const register = path.endsWith("register");
      const input = validate(
        register
          ? z
              .object({
                username: z
                  .string()
                  .trim()
                  .regex(/^[a-zA-Z0-9_.-]{3,64}$/),
                password: z.string().min(12).max(128),
                displayName: z.string().trim().min(1).max(120),
              })
              .strict()
          : z.object({ username: z.string(), password: z.string() }).strict(),
        body,
      );
      const name = input.username.trim().toLowerCase();
      let user = registry.users.find((u) => u.username.toLowerCase() === name);
      if (register) {
        if (user) fail(409, "USERNAME_EXISTS", "Логин уже занят");
        const displayName =
          "displayName" in input ? String(input.displayName) : name;
        user = { id: uuid(), username: name, displayName };
        registry.users.push(user);
        registry.passwords[user.id] = demoHash(input.password);
        saveRegistry();
      } else if (
        !user ||
        user.accountKind === "customer" ||
        registry.passwords[user.id] !== demoHash(input.password)
      )
        fail(401, "INVALID_CREDENTIALS", "Неверный логин или пароль");
      sessionStorage.setItem(sessionKey, user!.id);
      return ok(user, register ? 201 : 200);
    }
    const signedIn = registry.users.find(
      (u) =>
        u.accountKind !== "customer" &&
        u.id === sessionStorage.getItem(sessionKey),
    );
    const external = /^\/integrations\/v1\/warehouses\/([^/]+)(\/.*)$/.exec(
      path,
    );
    let supplier: IntegrationClient | undefined;
    let warehouseId: string | undefined;
    if (external) {
      const integrationKey =
        registry.keys.find(
          (k) =>
            k.hash === demoHash(token || "") &&
            !k.revokedAt &&
            (!k.expiresAt || Date.parse(k.expiresAt) > Date.now()),
        ) || fail(401, "INVALID_INTEGRATION_KEY", "Ключ интеграции недоступен");
      supplier = registry.clients.find(
        (c) => c.id === integrationKey.clientId,
      )!;
      if (supplier.warehouseId !== external[1])
        fail(404, "NOT_FOUND", "Склад недоступен");
      warehouseId = external[1];
      path = external[2];
      currentActor = "client:" + supplier.id;
      if (path === "/identity" && method === "GET")
        return ok({
          clientId: supplier.id,
          warehouseId,
          name: supplier.name,
          kind: supplier.kind,
        });
      const allowed =
        supplier.kind === "supplier"
          ? (method === "GET" &&
              (path === "/catalog/ingredients" ||
                path === "/purchase-requests" ||
                /^\/purchase-requests\/[^/]+$/.test(path) ||
                /^\/deliveries\/[^/]+$/.test(path))) ||
            (method === "POST" &&
              (path === "/deliveries" ||
                /^\/purchase-requests\/[^/]+\/(approve|reject)$/.test(path)))
          : (method === "GET" &&
              ([
                "/menu",
                "/stop-list",
                "/recommendations",
                "/offers",
                "/combos",
              ].includes(path) ||
                /^\/orders\/[^/]+$/.test(path))) ||
            (method === "POST" && path === "/orders");
      if (!allowed)
        fail(403, "INSUFFICIENT_SCOPE", "Недостаточно прав интеграции");
      if (method === "GET" && /^\/(deliveries|orders)\/[^/]+$/.test(path)) {
        const [resource, id] = path.slice(1).split("/");
        const owned = Object.entries(registry.external).some(
          ([scope, document]) =>
            scope.startsWith(`${warehouseId}:${supplier!.id}:/${resource}:`) &&
            document.id === id,
        );
        if (!owned) fail(404, "NOT_FOUND", "Документ недоступен");
      }
    } else {
      const user =
        signedIn || fail(401, "UNAUTHENTICATED", "Войдите в учётную запись");
      currentActor = "user:" + user.id;
      if (path === "/auth/me" && method === "GET") return ok(user);
      if (path === "/me/memberships" && method === "GET")
        return ok(membershipsFor(user.id));
      if (path === "/staff" && method === "GET") {
        const owned = membershipsFor(user.id)
          .filter((m) => m.role === "owner")
          .map((m) => m.enterpriseId);
        if (!user.isSuperAdmin && !owned.length)
          fail(403, "FORBIDDEN", "Требуются права владельца предприятия");
        const enterpriseId = url.searchParams.get("enterpriseId");
        if (enterpriseId && !user.isSuperAdmin && !owned.includes(enterpriseId))
          fail(404, "NOT_FOUND", "Предприятие недоступно");
        const search = (url.searchParams.get("q") || "").trim().toLowerCase();
        if (search.length > 120)
          fail(422, "VALIDATION_ERROR", "Слишком длинный поисковый запрос");
        const staff = registry.users
          .filter(
            (u) =>
              u.accountKind !== "customer" &&
              (user.isSuperAdmin ||
                registry.members.some(
                  (m) => m.userId === u.id && owned.includes(m.enterpriseId),
                )) &&
              (!enterpriseId ||
                registry.members.some(
                  (m) => m.userId === u.id && m.enterpriseId === enterpriseId,
                )) &&
              (u.username.toLowerCase().includes(search) ||
                u.displayName.toLowerCase().includes(search)),
          )
          .sort(
            (a, b) =>
              a.username
                .toLowerCase()
                .localeCompare(b.username.toLowerCase()) ||
              a.id.localeCompare(b.id),
          )
          .map((u) => ({
            userId: u.id,
            username: u.username,
            displayName: u.displayName,
            isSuperAdmin: !!u.isSuperAdmin,
            canDeleteAccount:
              !!user.isSuperAdmin &&
              !u.isSuperAdmin &&
              u.id !== user.id &&
              !registry.members.some(
                (m) => m.userId === u.id && m.role === "owner",
              ),
            memberships: registry.members
              .filter(
                (m) =>
                  m.userId === u.id &&
                  (user.isSuperAdmin || owned.includes(m.enterpriseId)),
              )
              .map((m) => ({
                enterpriseId: m.enterpriseId,
                enterpriseName: registry.enterprises.find(
                  (e) => e.id === m.enterpriseId,
                )!.name,
                role: m.role,
              })),
          }));
        return ok(pagination(staff, url, ["q", "enterpriseId"]));
      }
      const staffDelete = /^\/staff\/([^/]+)$/.exec(path);
      if (staffDelete && method === "DELETE") {
        if (!user.isSuperAdmin)
          fail(
            403,
            "FORBIDDEN",
            "Удалять аккаунты может только супер-администратор",
          );
        const target =
          registry.users.find(
            (u) => u.id === staffDelete[1] && u.accountKind !== "customer",
          ) || fail(404, "NOT_FOUND", "Сотрудник недоступен");
        if (target.id === user.id)
          fail(
            409,
            "SELF_DELETE_FORBIDDEN",
            "Нельзя удалить собственный аккаунт",
          );
        if (target.isSuperAdmin)
          fail(409, "SUPERADMIN_PROTECTED", "Аккаунт администратора защищён");
        if (
          registry.members.some(
            (m) => m.userId === target.id && m.role === "owner",
          )
        )
          fail(409, "OWNER_IMMUTABLE", "Сначала назначьте нового владельца");
        registry.users = registry.users.filter((u) => u.id !== target.id);
        registry.members = registry.members.filter(
          (m) => m.userId !== target.id,
        );
        delete registry.passwords[target.id];
        saveRegistry();
        return ok(null, 204);
      }
      if (path === "/enterprises" && method === "POST") {
        if (!user.isSuperAdmin)
          fail(
            403,
            "FORBIDDEN",
            "Создавать предприятия может только супер-админ",
          );
        const input = validate(
          z
            .object({
              name: z.string().trim().min(1).max(120),
              ownerUsername: z.string().trim().min(1).max(64),
            })
            .strict(),
          body,
        );
        const owner =
          registry.users.find(
            (u) =>
              u.username.toLowerCase() === input.ownerUsername.toLowerCase(),
          ) || fail(404, "USER_NOT_FOUND", "Владелец не зарегистрирован");
        if (owner.accountKind === "customer")
          fail(
            422,
            "ACCOUNT_TYPE_NOT_ALLOWED",
            "Покупателя нельзя назначить владельцем",
          );
        if (owner.isSuperAdmin)
          fail(
            400,
            "VALIDATION_ERROR",
            "Выберите обычного пользователя владельцем",
          );
        const enterprise = {
          id: uuid(),
          name: input.name,
          warehouseId: uuid(),
          createdAt: meta.serverTime,
        };
        registry.enterprises.push(enterprise);
        registry.members.push({
          username: owner.username,
          displayName: owner.displayName,
          userId: owner.id,
          role: "owner",
          enterpriseId: enterprise.id,
        });
        saveRegistry();
        databaseKey = "rims.demo.database.v2." + enterprise.warehouseId;
        db = {
          ingredients: [],
          dishes: [],
          deliveries: [],
          orders: [],
          writeOffs: [],
          movements: [],
          replays: {},
        };
        persist();
        return ok(enterprise, 201);
      }
      const ownerRoute = /^\/enterprises\/([^/]+)\/owner$/.exec(path);
      if (ownerRoute && method === "POST") {
        if (!user.isSuperAdmin)
          fail(
            403,
            "FORBIDDEN",
            "Назначать владельца может только супер-админ",
          );
        if (!registry.enterprises.some((e) => e.id === ownerRoute[1]))
          fail(404, "NOT_FOUND", "Предприятие недоступно");
        const input = validate(
          z
            .object({ ownerUsername: z.string().trim().min(1).max(64) })
            .strict(),
          body,
        );
        const owner =
          registry.users.find(
            (u) =>
              u.username.toLowerCase() === input.ownerUsername.toLowerCase(),
          ) || fail(404, "USER_NOT_FOUND", "Владелец не зарегистрирован");
        if (owner.accountKind === "customer")
          fail(
            422,
            "ACCOUNT_TYPE_NOT_ALLOWED",
            "Покупателя нельзя назначить владельцем",
          );
        if (owner.isSuperAdmin)
          fail(
            400,
            "VALIDATION_ERROR",
            "Выберите обычного пользователя владельцем",
          );
        for (const member of registry.members) {
          if (member.enterpriseId === ownerRoute[1] && member.role === "owner")
            member.role = "manager";
        }
        let member = registry.members.find(
          (m) => m.enterpriseId === ownerRoute[1] && m.userId === owner.id,
        );
        if (member) member.role = "owner";
        else {
          member = {
            userId: owner.id,
            username: owner.username,
            displayName: owner.displayName,
            role: "owner",
            enterpriseId: ownerRoute[1],
          };
          registry.members.push(member);
        }
        saveRegistry();
        return ok({
          userId: member.userId,
          username: member.username,
          displayName: member.displayName,
          role: member.role,
        });
      }
      const registration = /^\/enterprises\/([^/]+)\/members\/register$/.exec(
        path,
      );
      if (
        method === "POST" &&
        (path === "/enterprises/staff" || registration)
      ) {
        const enterpriseId = registration?.[1];
        if (enterpriseId) {
          const membership =
            membershipsFor(user.id).find(
              (m) => m.enterpriseId === enterpriseId,
            ) || fail(404, "NOT_FOUND", "Предприятие недоступно");
          if (!["owner", "super_admin"].includes(membership.role))
            fail(
              403,
              "FORBIDDEN",
              "Требуется владелец или супер-администратор",
            );
        } else if (!user.isSuperAdmin)
          fail(403, "FORBIDDEN", "Требуется супер-администратор");
        const input = validate(
          z
            .object({
              username: z
                .string()
                .trim()
                .regex(/^[a-zA-Z0-9_.-]{3,64}$/),
              password: z.string().min(12).max(128),
              displayName: z.string().trim().min(1).max(120),
              role: z.enum(["manager", "warehouse", "waiter"]).optional(),
            })
            .strict(),
          body,
        );
        if (Boolean(enterpriseId) !== Boolean(input.role))
          fail(422, "VALIDATION_ERROR", "Проверьте роль сотрудника");
        if (
          registry.users.some(
            (u) =>
              u.accountKind !== "customer" &&
              u.username.toLowerCase() === input.username.toLowerCase(),
          )
        )
          fail(409, "USERNAME_EXISTS", "Логин уже занят");
        const target = {
          id: uuid(),
          username: input.username,
          displayName: input.displayName,
        };
        registry.users.push(target);
        registry.passwords[target.id] = demoHash(input.password);
        if (enterpriseId && input.role)
          registry.members.push({
            userId: target.id,
            username: target.username,
            displayName: target.displayName,
            enterpriseId,
            role: input.role,
          });
        saveRegistry();
        return ok(
          {
            userId: target.id,
            username: target.username,
            displayName: target.displayName,
            enterpriseId: enterpriseId || null,
            role: input.role || null,
          },
          201,
        );
      }
      const members = /^\/enterprises\/([^/]+)\/members(?:\/([^/]+))?$/.exec(
        path,
      );
      if (members) {
        const membership =
          membershipsFor(user.id).find((m) => m.enterpriseId === members[1]) ||
          fail(404, "NOT_FOUND", "Предприятие недоступно");
        if (membership.role !== "owner" && membership.role !== "super_admin")
          fail(403, "FORBIDDEN", "Сотрудники доступны только владельцу");
        if (method === "GET")
          return ok(
            pagination(
              registry.members
                .filter((m) => m.enterpriseId === members[1])
                .map(({ userId, username, displayName, role }) => ({
                  userId,
                  username,
                  displayName,
                  role,
                })),
              url,
              [],
            ),
          );
        const target = registry.members.find(
          (m) => m.enterpriseId === members[1] && m.userId === members[2],
        );
        if (target?.role === "owner")
          fail(409, "OWNER_IMMUTABLE", "Нельзя изменить или удалить владельца");
        if (method === "DELETE") {
          if (!target) fail(404, "NOT_FOUND", "Сотрудник недоступен");
          registry.members = registry.members.filter((m) => m !== target);
          saveRegistry();
          return ok(null, 204);
        }
        const input = validate(
          method === "POST"
            ? z
                .object({
                  username: z.string().trim().min(1),
                  role: z.enum(["manager", "warehouse", "waiter"]),
                })
                .strict()
            : z
                .object({ role: z.enum(["manager", "warehouse", "waiter"]) })
                .strict(),
          body,
        );
        if (method === "POST") {
          const username =
            "username" in input ? String(input.username).toLowerCase() : "";
          const found =
            registry.users.find((u) => u.username.toLowerCase() === username) ||
            fail(404, "USER_NOT_FOUND", "Пользователь не зарегистрирован");
          if (found.accountKind === "customer")
            fail(
              422,
              "ACCOUNT_TYPE_NOT_ALLOWED",
              "Покупателя нельзя назначить сотрудником",
            );
          if (
            registry.members.some(
              (m) => m.enterpriseId === members[1] && m.userId === found.id,
            )
          )
            fail(409, "MEMBERSHIP_EXISTS", "Пользователь уже добавлен");
          const member = {
            userId: found.id,
            username: found.username,
            displayName: found.displayName,
            role: input.role,
            enterpriseId: members[1],
          };
          registry.members.push(member);
          saveRegistry();
          return ok(
            {
              userId: member.userId,
              username: member.username,
              displayName: member.displayName,
              role: member.role,
            },
            201,
          );
        }
        if (!target) fail(404, "NOT_FOUND", "Сотрудник недоступен");
        target.role = input.role;
        saveRegistry();
        return ok({
          userId: target.userId,
          username: target.username,
          displayName: target.displayName,
          role: target.role,
        });
      }
      const scoped = /^\/warehouses\/([^/]+)(\/.*)$/.exec(path);
      if (!scoped) fail(404, "NOT_FOUND", "Маршрут API v2 не найден");
      warehouseId = scoped[1];
      path = scoped[2];
      const membership =
        membershipsFor(user.id).find((m) => m.warehouseId === warehouseId) ||
        fail(404, "NOT_FOUND", "Склад недоступен");
      checkRole(membership.role, path, method);
      if (path === "/customer-publication") {
        if (!["owner", "super_admin"].includes(membership.role))
          fail(403, "FORBIDDEN", "Доступно владельцу");
        registry.publication ??= {
          [demoWarehouseA]: true,
          [demoWarehouseB]: true,
        };
        if (method === "PATCH") {
          const input = validate(
            z.object({ enabled: z.boolean() }).strict(),
            body,
          );
          registry.publication[warehouseId] = input.enabled;
          saveRegistry();
        } else if (method !== "GET")
          fail(404, "NOT_FOUND", "Маршрут не найден");
        return ok({ enabled: registry.publication[warehouseId] === true });
      }
    }
    databaseKey = "rims.demo.database.v2." + warehouseId;
    try {
      const stored = demoStorage.getItem(databaseKey);
      db = migrate(stored ? JSON.parse(stored) : seed(), Date.now());
      if (!stored && warehouseId === demoWarehouseB) {
        db.deliveries = [];
        db.movements = [];
      }
      if (
        !stored &&
        warehouseId !== demoWarehouseA &&
        warehouseId !== demoWarehouseB
      ) {
        db = {
          ingredients: [],
          dishes: [],
          deliveries: [],
          orders: [],
          writeOffs: [],
          movements: [],
          replays: {},
        };
      }
      db = migrate(db, Date.now());
      persist();
    } catch {
      fail(
        500,
        "DEMO_STORAGE_ERROR",
        "Не удалось прочитать данные этого демонстрационного склада",
      );
    }
    if (path.startsWith("/integration-clients")) {
      const parts = path.split("/");
      const client = registry.clients.find(
        (c) => c.id === parts[2] && c.warehouseId === warehouseId,
      );
      if (parts.length === 2) {
        if (method === "GET")
          return ok(
            pagination(
              registry.clients.filter((c) => c.warehouseId === warehouseId),
              url,
              [],
            ),
          );
        const input = validate(
          z
            .object({
              name: z.string().trim().min(1).max(120),
              kind: z.enum(["supplier", "pos"]),
            })
            .strict(),
          body,
        );
        const item = {
          id: uuid(),
          warehouseId: warehouseId!,
          name: input.name,
          kind: input.kind,
          createdAt: meta.serverTime,
        };
        registry.clients.push(item);
        saveRegistry();
        return ok(item, 201);
      }
      if (!client) fail(404, "NOT_FOUND", "Клиент интеграции недоступен");
      const clean = (k: DemoRegistry["keys"][number]) => ({
        id: k.id,
        clientId: k.clientId,
        label: k.label,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        revokedAt: k.revokedAt,
      });
      if (method === "GET")
        return ok(
          pagination(
            registry.keys.filter((k) => k.clientId === client.id).map(clean),
            url,
            [],
          ),
        );
      if (method === "DELETE") {
        const item =
          registry.keys.find(
            (k) => k.id === parts[4] && k.clientId === client.id,
          ) || fail(404, "NOT_FOUND", "Ключ недоступен");
        item.revokedAt = item.revokedAt || meta.serverTime;
        saveRegistry();
        return ok(null, 204);
      }
      const input = validate(
        z
          .object({
            label: z.string().trim().min(1).max(120),
            expiresAt: timestampSchema.nullable(),
          })
          .strict(),
        body,
      );
      if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now())
        fail(422, "VALIDATION_ERROR", "Срок ключа должен быть в будущем");
      const secret = uuid() + uuid();
      const item = {
        id: uuid(),
        clientId: client.id,
        label: input.label,
        createdAt: meta.serverTime,
        expiresAt: input.expiresAt,
        revokedAt: null,
        hash: demoHash(secret),
      };
      registry.keys.push(item);
      saveRegistry();
      return ok({ key: clean(item), token: secret }, 201);
    }
    registry.purchaseRequests ??= [];
    if (path === "/purchase-suppliers" && method === "GET")
      return ok(
        pagination(
          registry.clients
            .filter(
              (c) => c.warehouseId === warehouseId && c.kind === "supplier",
            )
            .map(({ id, name }) => ({ id, name })),
          url,
          ["q"],
        ),
      );
    if (path.startsWith("/purchase-requests")) {
      const items = registry.purchaseRequests.filter(
        (p) =>
          p.warehouseId === warehouseId &&
          (!supplier ||
            (p.supplierClientId === supplier.id && p.submittedAt !== null)),
      );
      if (method === "GET") {
        if (path === "/purchase-requests")
          return ok(
            pagination(
              items.filter(
                (p) =>
                  !url.searchParams.get("status") ||
                  p.status === url.searchParams.get("status"),
              ),
              url,
              ["status"],
            ),
          );
        return ok(
          items.find((p) => p.id === path.split("/")[2]) ||
            fail(404, "NOT_FOUND", "Заявка недоступна"),
        );
      }
      if (!key) fail(400, "IDEMPOTENCY_KEY_REQUIRED", "Укажите ключ операции");
      const replayScope = `${currentActor}:${warehouseId}:${method}:${path}:${key}`;
      const hash = JSON.stringify(semantic(body));
      registry.purchaseReplays ??= {};
      const replay = registry.purchaseReplays[replayScope];
      if (replay) {
        if (replay.hash !== hash)
          fail(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "Ключ использован с другим запросом",
          );
        return replay.result;
      }
      const id = path.split("/")[2],
        action = path.split("/")[3];
      const item = id
        ? items.find((p) => p.id === id) ||
          fail(404, "NOT_FOUND", "Заявка недоступна")
        : null;
      let result: ResponseRecord;
      if (
        (!id && method === "POST") ||
        (id && !action && method === "PUT" && !supplier)
      ) {
        if (item && item.status !== "draft")
          fail(
            409,
            "PURCHASE_REQUEST_STATE_CONFLICT",
            "Можно править только черновик",
          );
        const input = validate(
          z
            .object({
              supplierClientId: uuidSchema,
              expectedAt: timestampSchema.nullable(),
              note: z.string().max(500).nullable(),
              lines: z
                .array(
                  z
                    .object({ ingredientId: uuidSchema, quantity: positive })
                    .strict(),
                )
                .min(1)
                .max(100),
              ...(item ? { version: z.number().int().positive() } : {}),
            })
            .strict(),
          body,
        ) as PurchaseRequestInput & { version?: number };
        if (item && input.version !== item.version)
          fail(409, "PURCHASE_REQUEST_VERSION_CONFLICT", "Версия изменилась");
        const client =
          registry.clients.find(
            (c) =>
              c.id === input.supplierClientId &&
              c.warehouseId === warehouseId &&
              c.kind === "supplier",
          ) || fail(422, "VALIDATION_ERROR", "Поставщик недоступен");
        if (
          new Set(input.lines.map((l) => l.ingredientId)).size !==
          input.lines.length
        )
          fail(422, "VALIDATION_ERROR", "Ингредиенты повторяются");
        const lines = input.lines.map((l) => {
          const i = ingredient(l.ingredientId);
          return {
            ingredientId: i.id,
            ingredientName: i.name,
            unit: i.unit,
            quantity: quantity(l.quantity),
          };
        });
        const value: PurchaseRequest = item || {
          id: uuid(),
          number: `ЗП-${String(registry.purchaseRequests.length + 1).padStart(3, "0")}`,
          warehouseId: warehouseId!,
          version: 0,
          supplierClientId: client.id,
          supplierName: client.name,
          status: "draft",
          createdAt: meta.serverTime,
          submittedAt: null,
          approvedAt: null,
          closedAt: null,
          expectedAt: null,
          note: null,
          rejectionReason: null,
          deliveryId: null,
          lines: [],
        };
        Object.assign(value, {
          supplierClientId: client.id,
          supplierName: client.name,
          expectedAt: input.expectedAt,
          note: input.note,
          lines,
          version: value.version + 1,
        });
        if (!item) registry.purchaseRequests.push(value);
        result = ok(structuredClone(value), item ? 200 : 201);
      } else {
        if (!item) fail(404, "NOT_FOUND", "Заявка недоступна");
        const input = validate(
          z
            .object({
              version: z.number().int().positive(),
              ...(action === "reject"
                ? { reason: z.string().trim().min(1).max(500) }
                : {}),
            })
            .strict(),
          body,
        ) as { version: number; reason?: string };
        if (input.version !== item.version)
          fail(409, "PURCHASE_REQUEST_VERSION_CONFLICT", "Версия изменилась");
        if (supplier && !["approve", "reject"].includes(action))
          fail(403, "INSUFFICIENT_SCOPE", "Действие недоступно");
        if (!supplier && !["submit", "cancel"].includes(action))
          fail(403, "FORBIDDEN", "Действие недоступно");
        if (
          (action === "submit" && item.status !== "draft") ||
          (["approve", "reject"].includes(action) &&
            item.status !== "submitted") ||
          (action === "cancel" &&
            (!["draft", "submitted", "approved"].includes(item.status) ||
              item.deliveryId))
        )
          fail(
            409,
            "PURCHASE_REQUEST_STATE_CONFLICT",
            "Статус заявки изменился",
          );
        item.version++;
        item.status =
          action === "submit"
            ? "submitted"
            : action === "approve"
              ? "approved"
              : action === "reject"
                ? "rejected"
                : "cancelled";
        if (action === "submit") item.submittedAt = meta.serverTime;
        if (action === "approve") item.approvedAt = meta.serverTime;
        if (action === "reject" || action === "cancel")
          item.closedAt = meta.serverTime;
        if (action === "reject") item.rejectionReason = input.reason!;
        result = ok(structuredClone(item));
      }
      registry.purchaseReplays[replayScope] = { hash, result };
      saveRegistry();
      return result;
    }
    const service = path.startsWith("/service/") || supplier?.kind === "pos";

    const originalPath = path;
    if (path.startsWith("/service/")) path = path.replace("/service", "");
    if (path === "/menu" && service) path = "/menu/availability";
    if (path === "/catalog/ingredients") path = "/ingredients";
    if (service && path === "/offers" && method === "GET")
      return ok(
        pagination(filteredOffers(url, Date.now(), true), url, ["q", "kind"]),
      );
    if (service && path === "/combos" && method === "GET")
      return ok(
        pagination(
          (db.combos ?? [])
            .filter((c) => c.status === "published")
            .map((c) =>
              publicCombo(
                c,
                db.dishes,
                db.ingredients,
                allBatches(),
                Date.now(),
              ),
            ),
          url,
          [],
        ),
      );
    if (
      service &&
      method === "GET" &&
      ["/menu/availability", "/stop-list", "/recommendations"].includes(path)
    ) {
      const now = Date.now();
      if (path === "/recommendations")
        return ok(
          pagination(
            offers(now).map(
              ({ dishId, dishName, maxPortions, suggestedPortions }) => ({
                dishId,
                dishName,
                maxPortions,
                suggestedPortions,
              }),
            ),
            url,
            [],
          ),
        );
      const items = availability(now)
        .filter(
          (item) =>
            item.active &&
            (path !== "/stop-list" || item.status === "stopped") &&
            (path !== "/menu/availability" || matchQuery(url, item.dishName)),
        )
        .map(({ dishId, dishName, maxPortions, status }) => ({
          dishId,
          dishName,
          maxPortions,
          status,
          unavailableReason:
            status === "stopped" ? "Не хватает ингредиентов" : null,
        }));
      return ok(
        pagination(items, url, path === "/menu/availability" ? ["q"] : []),
      );
    }
    currentExternalId = null;
    let externalKey: string | undefined;
    let fingerprint: string | undefined;
    let linkedPurchase: PurchaseRequest | undefined;
    if (supplier && method === "POST") {
      const input = body as Record<string, unknown>;
      if (
        typeof input?.externalId !== "string" ||
        !input.externalId.trim() ||
        input.externalId.trim().length > 128
      )
        fail(422, "VALIDATION_ERROR", "Укажите externalId");
      currentExternalId = input.externalId.trim();
      externalKey = `${warehouseId}:${supplier.id}:${path}:${currentExternalId}`;
      const { externalId, purchaseRequestId, ...rest } = input;
      void externalId;
      body = purchaseRequestId == null ? rest : { ...rest, purchaseRequestId };
      fingerprint = JSON.stringify(semantic(body));
      const stored = registry.external[externalKey];
      if (purchaseRequestId != null) {
        linkedPurchase = registry.purchaseRequests?.find(
          (p) =>
            p.id === purchaseRequestId &&
            p.warehouseId === warehouseId &&
            p.supplierClientId === supplier!.id &&
            p.submittedAt !== null,
        );
        if (!linkedPurchase) fail(404, "NOT_FOUND", "Заявка недоступна");
        if (
          !stored &&
          (linkedPurchase.status !== "approved" || linkedPurchase.deliveryId)
        )
          fail(
            409,
            "PURCHASE_REQUEST_STATE_CONFLICT",
            "Заявка не разрешает новую отгрузку",
          );
      }
      if (stored && path !== "/orders" && stored.hash !== fingerprint)
        fail(
          409,
          "EXTERNAL_ID_CONFLICT",
          "Внешний номер использован с другим документом",
        );
      // Exact-key replay is resolved by engine before returning a current document.
      if (
        stored &&
        path !== "/orders" &&
        !db.replays[`${currentActor}:${method}:${originalPath}:${key}`]
      ) {
        path = path + "/" + stored.id;
        method = "GET";
      }
    }
    const result = engineRequest(path, method, body, url, key, originalPath);
    if (result.status < 300 && result.body && "data" in result.body) {
      let data = result.body.data;
      if (path.startsWith("/deliveries") && typeof data === "object" && data) {
        const delivery = data as Delivery;
        const purchase =
          linkedPurchase ||
          registry.purchaseRequests?.find((p) => p.deliveryId === delivery.id);
        if (purchase) {
          const state =
            delivery.status === "confirmed"
              ? "received"
              : delivery.status === "rejected"
                ? "delivery_rejected"
                : "delivery_pending";
          if (
            purchase.deliveryId !== delivery.id ||
            purchase.status !== state
          ) {
            purchase.deliveryId = delivery.id;
            purchase.status = state;
            purchase.version++;
            if (state !== "delivery_pending")
              purchase.closedAt = meta.serverTime;
            saveRegistry();
          }
          data = { ...delivery, purchaseRequestId: purchase.id };
        } else data = { ...delivery, purchaseRequestId: null };
      }
      if (externalKey && fingerprint && method === "POST") {
        registry.external[externalKey] = {
          hash: fingerprint,
          id: (data as Delivery | Order).id,
        };
        saveRegistry();
      }
      if (service) {
        if (originalPath.endsWith("/orders/preview")) {
          const preview = data as OrderPreview;
          data = {
            canCreate: preview.canCreate,
            shortages: preview.requirements
              .filter((r) => thousandths(r.missingQuantity) > 0n)
              .map(({ ingredientName, unit, missingQuantity }) => ({
                ingredientName,
                unit,
                missingQuantity,
              })),
          };
        } else if (
          originalPath.endsWith("/orders") ||
          (supplier && /^\/orders\//.test(path))
        ) {
          const order = data as Order;
          data = {
            id: order.id,
            number: order.number,
            createdAt: order.createdAt,
            status: order.status,
            lines: order.lines,
            composition:
              order.composition ??
              order.lines.map((l) => ({ kind: "dish", ...l })),
          };
        } else if (data && typeof data === "object" && "items" in data) {
          const page = data as Page<DishAvailability | HotOffer>;
          data = {
            ...page,
            items: page.items
              .filter((x) => !("active" in x) || x.active)
              .map((x) =>
                "suggestedPortions" in x
                  ? {
                      dishId: x.dishId,
                      dishName: x.dishName,
                      maxPortions: x.maxPortions,
                      suggestedPortions: x.suggestedPortions,
                    }
                  : {
                      dishId: x.dishId,
                      dishName: x.dishName,
                      maxPortions: x.maxPortions,
                      status: x.status,
                      unavailableReason:
                        x.status === "stopped"
                          ? "Не хватает ингредиентов"
                          : null,
                    },
              ),
          };
        }
      }
      if (supplier?.kind === "supplier") {
        if (path.startsWith("/ingredients")) {
          const page = data as Page<Ingredient>;
          data = {
            ...page,
            items: page.items.map(({ id, name, unit }) => ({ id, name, unit })),
          };
        } else {
          const { batches, confirmedByUserId, ...delivery } = data as Delivery;
          void batches;
          void confirmedByUserId;
          data = delivery;
        }
      }
      return { ...result, body: { data, meta: result.body.meta } };
    }
    if (
      service &&
      result.body &&
      "error" in result.body &&
      result.body.error.details.shortages
    ) {
      const shortages = result.body.error.details.shortages;
      return {
        ...result,
        body: {
          ...result.body,
          error: {
            ...result.body.error,
            details: {
              ...result.body.error.details,
              shortages: shortages.map(
                ({ ingredientName, unit, missingQuantity }) => ({
                  ingredientName,
                  unit,
                  missingQuantity,
                }),
              ),
            },
          },
        },
      };
    }
    return result;
  } catch (error) {
    const failure =
      error instanceof DemoFailure
        ? error
        : new DemoFailure(500, "INTERNAL_ERROR", "Ошибка mock API");
    return {
      status: failure.status,
      body: {
        error: {
          code: failure.code,
          message: failure.message,
          details: failure.details,
        },
        meta,
      },
    };
  }
}

const customerSession = "rims.demo.customer.signedIn.v1";
function receipt(o: Order) {
  const { id, number, createdAt, status, lines, composition } = o;
  return {
    id,
    number,
    createdAt,
    status,
    lines,
    composition: composition ?? lines.map((l) => ({ kind: "dish", ...l })),
  };
}
function customerRequest(
  path: string,
  method: string,
  body: unknown,
  url: URL,
  key: string | null,
  ok: (data: unknown, status?: number) => ResponseRecord,
): ResponseRecord {
  registry.publication ??= { [demoWarehouseA]: true, [demoWarehouseB]: true };
  for (const u of registry.users) u.accountKind ??= "staff";
  saveRegistry();
  if (path === "/auth/logout" && method === "POST") {
    sessionStorage.removeItem(customerSession);
    return ok(null, 204);
  }
  if (["/auth/login", "/auth/register"].includes(path) && method === "POST") {
    const registering = path.endsWith("register");
    const input = validate(
      registering
        ? z
            .object({
              username: z.string().regex(/^[a-zA-Z0-9_.-]{3,64}$/),
              password: z.string().min(12).max(128),
              displayName: z.string().trim().min(1).max(120),
            })
            .strict()
        : z.object({ username: z.string(), password: z.string() }).strict(),
      body,
    );
    let user = registry.users.find(
      (u) => u.username.toLowerCase() === input.username.toLowerCase(),
    );
    if (registering) {
      if (user) fail(409, "USERNAME_EXISTS", "Логин уже занят");
      user = {
        id: uuid(),
        username: input.username.toLowerCase(),
        displayName: String("displayName" in input ? input.displayName : ""),
        accountKind: "customer",
      };
      registry.users.push(user);
      registry.passwords[user.id] = demoHash(input.password);
      saveRegistry();
    }
    if (
      !user ||
      user.accountKind !== "customer" ||
      registry.passwords[user.id] !== demoHash(input.password)
    )
      fail(401, "INVALID_CREDENTIALS", "Неверный логин или пароль");
    sessionStorage.setItem(customerSession, user!.id);
    return ok(
      { ...user, accountKind: undefined, role: "customer" },
      registering ? 201 : 200,
    );
  }
  const user =
    registry.users.find(
      (u) =>
        u.id === sessionStorage.getItem(customerSession) &&
        u.accountKind === "customer",
    ) || fail(401, "UNAUTHENTICATED", "Войдите в аккаунт покупателя");
  if (path === "/auth/me" && method === "GET")
    return ok({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: "customer",
    });
  if (path === "/outlets" && method === "GET")
    return ok(
      pagination(
        registry.enterprises
          .filter(
            (e) =>
              registry.publication![e.warehouseId] && matchQuery(url, e.name),
          )
          .map((e) => ({
            warehouseId: e.warehouseId,
            name: e.name,
            timeZone: "Europe/Moscow",
          })),
        url,
        ["q"],
      ),
    );
  const scoped =
    /^\/warehouses\/([^/]+)(\/.*)$/.exec(path) ||
    fail(404, "NOT_FOUND", "Заведение недоступно");
  const warehouseId = scoped[1];
  path = scoped[2];
  if (!registry.enterprises.some((e) => e.warehouseId === warehouseId))
    fail(404, "NOT_FOUND", "Заведение недоступно");
  databaseKey = "rims.demo.database.v2." + warehouseId;
  const existed = demoStorage.getItem(databaseKey);
  db = load();
  if (!existed && warehouseId === demoWarehouseB) {
    db.deliveries = [];
    db.movements = [];
  }
  if (!existed && ![demoWarehouseA, demoWarehouseB].includes(warehouseId)) {
    db = {
      ingredients: [],
      dishes: [],
      deliveries: [],
      orders: [],
      writeOffs: [],
      movements: [],
      replays: {},
    };
  }
  persist();
  currentActor = "customer:" + user.id;
  currentExternalId = null;
  if (method === "GET" && path === "/orders")
    return ok(
      pagination(
        history(db.orders.filter((o) => o.customerId === user.id)).map(receipt),
        url,
        [],
      ),
    );
  if (method === "GET" && /^\/orders\/[^/]+$/.test(path))
    return ok(
      receipt(
        db.orders.find(
          (o) => o.id === path.split("/")[2] && o.customerId === user.id,
        ) || fail(404, "NOT_FOUND", "Заказ недоступен"),
      ),
    );
  if (method === "POST" && path === "/orders") {
    validate(orderSchema, body);
    if (
      !registry.publication[warehouseId] &&
      !db.replays[`${currentActor}:${method}:${scoped[2]}:${key}`]
    )
      fail(404, "NOT_FOUND", "Заведение снято с публикации");
  } else if (!registry.publication[warehouseId])
    fail(404, "NOT_FOUND", "Заведение снято с публикации");
  if (method === "GET" && path === "/offers")
    return ok(
      pagination(filteredOffers(url, Date.now(), true), url, ["q", "kind"]),
    );
  if (
    method === "GET" &&
    ["/menu", "/stop-list", "/recommendations"].includes(path)
  ) {
    if (path === "/recommendations")
      return ok(
        pagination(
          offers(Date.now()).map(
            ({ dishId, dishName, maxPortions, suggestedPortions }) => ({
              dishId,
              dishName,
              maxPortions,
              suggestedPortions,
            }),
          ),
          url,
          [],
        ),
      );
    return ok(
      pagination(
        availability(Date.now())
          .filter(
            (x) =>
              x.active &&
              matchQuery(url, x.dishName) &&
              (path !== "/stop-list" || x.status === "stopped"),
          )
          .map(({ dishId, dishName, maxPortions, status }) => ({
            dishId,
            dishName,
            maxPortions,
            status,
            unavailableReason:
              status === "stopped" ? "Не хватает ингредиентов" : null,
          })),
        url,
        path === "/menu" ? ["q"] : [],
      ),
    );
  }
  if (method === "GET" && path === "/combos")
    return ok(
      pagination(
        (db.combos ?? [])
          .filter((c) => c.status === "published")
          .map((c) =>
            publicCombo(c, db.dishes, db.ingredients, allBatches(), Date.now()),
          ),
        url,
        [],
      ),
    );
  if (method !== "POST" || !["/orders", "/orders/preview"].includes(path))
    fail(404, "NOT_FOUND", "Маршрут недоступен");
  const result = engineRequest(path, method, body, url, key, path);
  if (result.body && "data" in result.body) {
    const value = result.body.data;
    return {
      ...result,
      body: {
        ...result.body,
        data: path.endsWith("preview")
          ? {
              canCreate: (value as OrderPreview).canCreate,
              shortages: (value as OrderPreview).requirements
                .filter((r) => thousandths(r.missingQuantity) > 0n)
                .map(({ ingredientName, unit, missingQuantity }) => ({
                  ingredientName,
                  unit,
                  missingQuantity,
                })),
            }
          : receipt(value as Order),
      },
    };
  }
  if (
    result.body &&
    "error" in result.body &&
    result.body.error.details.shortages
  )
    result.body.error.details.shortages =
      result.body.error.details.shortages.map(
        ({ ingredientName, unit, missingQuantity }) => ({
          ingredientName,
          unit,
          missingQuantity,
        }),
      );
  return result;
}

export function initializeDemoData() {
  const stored = demoStorage.getItem("rims.demo.registry.v2");
  if (stored) registry = JSON.parse(stored);
  registry.publication ??= { [demoWarehouseA]: true, [demoWarehouseB]: true };
  if (!registry.enterprises.some((e) => e.id === forecastEnterpriseId)) {
    registry.enterprises.push({
      id: forecastEnterpriseId,
      warehouseId: forecastWarehouseId,
      name: "RIMS · История за 14 дней (демо)",
      createdAt: new Date().toISOString(),
    });
    for (const user of registry.users.filter((u) =>
      ["operator"].includes(u.username),
    ))
      registry.members.push({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.username === "warehouse" ? "warehouse" : "manager",
        enterpriseId: forecastEnterpriseId,
      });
    registry.publication[forecastWarehouseId] = true;
  }
  const fixtureKey = "rims.demo.database.v2." + forecastWarehouseId;
  if (!demoStorage.getItem(fixtureKey))
    demoStorage.setItem(
      fixtureKey,
      JSON.stringify(createForecastFixture(Date.now(), demoOperator.id)),
    );
  saveRegistry();
  for (const id of [demoWarehouseA, demoWarehouseB]) {
    databaseKey = "rims.demo.database.v2." + id;
    const existed = demoStorage.getItem(databaseKey);
    db = load();
    if (!existed && id === demoWarehouseB) {
      db.deliveries = [];
      db.movements = [];
    }
    persist();
  }
}
export function listDemoSuppliers() {
  initializeDemoData();
  if (!registry.clients.some((c) => c.kind === "supplier")) {
    registry.clients.push({
      id: uuid(),
      warehouseId: demoWarehouseA,
      kind: "supplier",
      name: "Демо-поставщик",
      createdAt: new Date().toISOString(),
    });
    saveRegistry();
  }
  return registry.clients
    .filter((c) => c.kind === "supplier")
    .map((c) => ({
      warehouseId: c.warehouseId,
      clientId: c.id,
      name: c.name,
      warehouseName:
        registry.enterprises.find((e) => e.warehouseId === c.warehouseId)
          ?.name || c.warehouseId,
    }));
}
export function connectDemoSupplier(input: {
  warehouseId: string;
  clientId: string;
}) {
  initializeDemoData();
  const client = registry.clients.find(
    (c) =>
      c.id === input.clientId &&
      c.warehouseId === input.warehouseId &&
      c.kind === "supplier",
  );
  if (!client) throw new Error("Demo поставщик недоступен");
  const token = uuid() + uuid();
  registry.keys.push({
    id: uuid(),
    clientId: client.id,
    label: "Demo supplier portal",
    createdAt: new Date().toISOString(),
    expiresAt: null,
    revokedAt: null,
    hash: demoHash(token),
  });
  saveRegistry();
  return { token };
}
