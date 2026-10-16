import type {
  OrderInput21,
  CompositionSnapshot,
} from "@rims/demo-api/contracts";
export type User = {
  id: string;
  username: string;
  displayName: string;
  role: "customer";
};
export type Outlet = {
  warehouseId: string;
  name: string;
  timeZone: "Europe/Moscow";
};
export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
export type MenuItem = {
  dishId: string;
  dishName: string;
  maxPortions: number;
  status: "available" | "stopped";
  unavailableReason: string | null;
};
export type { PublicOfferCard as Offer } from "@rims/demo-api/contracts";
export type OrderInput = OrderInput21;
export type Receipt = {
  composition?: CompositionSnapshot[];
  id: string;
  number: string;
  createdAt: string;
  status: "completed";
  lines: { dishId: string; dishName: string; portions: number }[];
};
export type Preview = {
  canCreate: boolean;
  shortages: {
    ingredientName: string;
    unit: string;
    missingQuantity: string;
  }[];
};
