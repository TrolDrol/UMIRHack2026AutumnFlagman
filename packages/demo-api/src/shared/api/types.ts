import type {
  RiskSnapshot,
  CompositionSnapshot,
  OrderInput21,
} from "./extensions";
export type UUID = string;
export type Timestamp = string;
export type Quantity = string;
export type Unit = "g" | "ml" | "pcs";
export type Meta = { serverTime: Timestamp; requestId: UUID };
export type Envelope<T> = { data: T; meta: Meta };
export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
export type User = {
  id: UUID;
  username: string;
  displayName: string;
  isSuperAdmin?: boolean;
};
export type Role = "super_admin" | "owner" | "manager" | "warehouse" | "waiter";
export type Enterprise = {
  id: UUID;
  name: string;
  warehouseId: UUID;
  createdAt: Timestamp;
};
export type Membership = {
  enterpriseId: UUID;
  enterpriseName: string;
  warehouseId: UUID;
  role: Role;
};
export type Member = {
  userId: UUID;
  username: string;
  displayName: string;
  role: Role;
};
export type StaffAccount = {
  userId: UUID;
  username: string;
  displayName: string;
  isSuperAdmin: boolean;
  canDeleteAccount: boolean;
  memberships: { enterpriseId: UUID; enterpriseName: string; role: Role }[];
};
export type Config = {
  restaurantName: string;
  timeZone: "Europe/Moscow";
  expiryWarningPercent: 10;
  hotOfferMaxPortions: 20;
  contractVersion: "2.1.0";
};
export type Ingredient = {
  id: UUID;
  name: string;
  unit: Unit;
  defaultShelfLifeHours: number;
  reorderPoint: Quantity;
  targetStock: Quantity;
};
export type IngredientInput = Omit<Ingredient, "id">;
export type IngredientPatch = Partial<Omit<IngredientInput, "unit">>;
export type RecipeLine = { ingredientId: UUID; quantity: Quantity };
export type Dish = {
  id: UUID;
  name: string;
  active: boolean;
  recipe: RecipeLine[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
};
export type DishInput = Pick<Dish, "name" | "active" | "recipe">;
export type DeliveryLineInput =
  | { ingredientId: UUID; quantity: Quantity; expiresAt: Timestamp }
  | {
      ingredientId: UUID;
      quantity: Quantity;
      manufacturedAt: Timestamp;
      shelfLifeHours?: number;
    };
export type DeliveryInput = {
  number: string;
  expectedAt: Timestamp | null;
  note: string | null;
  lines: DeliveryLineInput[];
};
export type DeliveryItem = {
  id: UUID;
  ingredientId: UUID;
  ingredientName: string;
  unit: Unit;
  quantity: Quantity;
  manufacturedAt: Timestamp | null;
  shelfLifeHours: number;
  expiresAt: Timestamp;
};
export type Batch = {
  id: UUID;
  deliveryId: UUID;
  deliveryNumber: string;
  deliveryItemId: UUID;
  ingredientId: UUID;
  ingredientName: string;
  unit: Unit;
  receivedAt: Timestamp;
  manufacturedAt: Timestamp | null;
  shelfLifeHours: number;
  expiresAt: Timestamp;
  initialQuantity: Quantity;
  remainingQuantity: Quantity;
  heldQuantity: Quantity;
  availableQuantity: Quantity;
  heldExpiredQuantity: Quantity;
  version: number;
  receiptCommittedAt: Timestamp | null;
  status: "fresh" | "expiring" | "expired" | "empty";
  remainingSeconds: number;
};
export type Delivery = {
  id: UUID;
  number: string;
  createdAt: Timestamp;
  expectedAt: Timestamp | null;
  receivedAt: Timestamp | null;
  status: "pending" | "confirmed" | "rejected";
  source: "manual" | "integration";
  externalId: string | null;
  note: string | null;
  lines: DeliveryItem[];
  batches: Batch[];
  confirmedByUserId: UUID | null;
  rejectedAt: Timestamp | null;
  rejectionReason: string | null;
};
export type InventoryRow = {
  ingredientId: UUID;
  ingredientName: string;
  unit: Unit;
  physicalQuantity: Quantity;
  heldQuantity: Quantity;
  heldExpiredQuantity: Quantity;
  availableQuantity: Quantity;
  expiringQuantity: Quantity;
  expiredQuantity: Quantity;
  nearestExpiresAt: Timestamp | null;
  reorderPoint: Quantity;
  targetStock: Quantity;
  isLowStock: boolean;
};
export type Requirement = {
  ingredientId: UUID;
  ingredientName: string;
  unit: Unit;
  requiredQuantity: Quantity;
  availableQuantity: Quantity;
  missingQuantity: Quantity;
};
export type Allocation = {
  batchId: UUID;
  ingredientId: UUID;
  quantity: Quantity;
  expiresAt: Timestamp;
  riskSnapshot: RiskSnapshot | null;
};
export type OrderInput = OrderInput21;
export type OrderPreview = {
  canCreate: boolean;
  requirements: Requirement[];
  allocations: Allocation[];
};
export type Order = {
  id: UUID;
  number: string;
  createdAt: Timestamp;
  status: "completed";
  source: "staff" | "waiter" | "integration" | "customer";
  customerId?: string | null;
  externalId: string | null;
  lines: { dishId: UUID; dishName: string; portions: number }[];
  allocations: Allocation[];
  composition: CompositionSnapshot[];
  recipeSnapshot?: { dishId: UUID; recipe: RecipeLine[] }[];
};
export type DishAvailability = {
  dishId: UUID;
  dishName: string;
  active: boolean;
  maxPortions: number;
  status: "available" | "stopped" | "inactive";
  shortages: Requirement[];
};
export type HotOfferReason = {
  ingredientId: UUID;
  ingredientName: string;
  unit: Unit;
  batchIds: UUID[];
  usableExpiringQuantity: Quantity;
  plannedUsage: Quantity;
  earliestExpiresAt: Timestamp;
};
export type HotOffer = {
  dishId: UUID;
  dishName: string;
  score: number;
  maxPortions: number;
  suggestedPortions: number;
  earliestExpiresAt: Timestamp;
  reasons: HotOfferReason[];
  explanation: string;
};
export type PurchaseSuggestion = {
  ingredientId: UUID;
  ingredientName: string;
  unit: Unit;
  availableQuantity: Quantity;
  expiringQuantity: Quantity;
  planningQuantity: Quantity;
  reorderPoint: Quantity;
  targetStock: Quantity;
  targetQuantity: Quantity;
  suggestedQuantity: Quantity;
  reasons: ("below_minimum" | "expiring_stock" | "stopped_dish")[];
  affectedDishIds: UUID[];
};
export type WriteOffInput = {
  batchId: UUID;
  quantity: Quantity;
  reason: "expired" | "damaged";
  note: string | null;
};
export type WriteOff = WriteOffInput & { id: UUID; createdAt: Timestamp };
export type Movement = {
  id: UUID;
  createdAt: Timestamp;
  ingredientId: UUID;
  ingredientName: string;
  unit: Unit;
  batchId: UUID;
  type:
    | "receipt"
    | "order"
    | "write_off"
    | "quarantine_open"
    | "quarantine_release";
  quantityDelta: string;
  heldQuantityDelta: string;
  heldAfter: Quantity;
  quarantineId: UUID | null;
  actorUserId: UUID | null;
  integrationClientId: UUID | null;
  eventSequence: number;
  riskSnapshot: RiskSnapshot | null;
  remainingAfter: Quantity;
  referenceId: UUID;
  referenceNumber: string | null;
};
export type Dashboard = {
  ingredientCount: number;
  activeDishCount: number;
  stoppedDishCount: number;
  lowStockIngredientCount: number;
  expiringBatchCount: number;
  expiredBatchCount: number;
  todayOrderCount: number;
  hotOfferCount: number;
  pendingDeliveryCount: number;
};
// Без рецептур, партий, закупочных порогов и статистики склада.
export type ServiceMenuItem = {
  dishId: UUID;
  dishName: string;
  maxPortions: number;
  status: "available" | "stopped";
  unavailableReason: string | null;
};
export type ServiceOffer = {
  dishId: UUID;
  dishName: string;
  suggestedPortions: number;
  maxPortions: number;
};
export type ServiceShortage = {
  ingredientName: string;
  unit: Unit;
  missingQuantity: Quantity;
};
export type ServicePreview = {
  canCreate: boolean;
  shortages: ServiceShortage[];
};
export type OrderReceipt = Pick<
  Order,
  "id" | "number" | "createdAt" | "status" | "lines" | "composition"
>;
export type IntegrationClient = {
  id: UUID;
  warehouseId: UUID;
  name: string;
  kind: "supplier" | "pos";
  createdAt: Timestamp;
};
export type IntegrationKey = {
  id: UUID;
  clientId: UUID;
  label: string;
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
  revokedAt: Timestamp | null;
};
export type ApiError = {
  error: {
    code: string;
    message: string;
    details: {
      fields?: { path: string; message: string }[];
      shortages?: Requirement[] | ServiceShortage[];
    };
  };
  meta: Meta;
};
