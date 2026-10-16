import type { HotOffer } from "./types";
import type { UUID, Timestamp } from "./types";
export type ConfirmDeliveryInput =
  { receivedAtMode: "server" } | { receivedAt: Timestamp };
export type ManualOfferInput = {
  dishId: UUID;
  title: string;
  publicText: string | null;
  startsAt: Timestamp | null;
  endsAt: Timestamp;
};
export type ManualOffer = ManualOfferInput & {
  id: UUID;
  dishName: string;
  status: "draft" | "published" | "archived";
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  publishedAt: Timestamp | null;
  createdByUserId: UUID;
  updatedByUserId: UUID;
  effectiveStartsAt: Timestamp | null;
  effectiveState:
    "draft" | "scheduled" | "visible" | "unavailable" | "ended" | "archived";
  unavailableReason: string | null;
};
export type PublicPromotion = {
  title: string;
  publicText: string | null;
  startsAt: Timestamp;
  endsAt: Timestamp;
};
export type OfferCard = {
  dishId: UUID;
  dishName: string;
  maxPortions: number;
  suggestedPortions: number;
  automatic: HotOffer | null;
  manual: (PublicPromotion & { id: UUID; version: number }) | null;
};
export type PublicOfferCard = {
  dishId: UUID;
  dishName: string;
  maxPortions: number;
  suggestedPortions: number;
  isAutomatic: boolean;
  promotion: PublicPromotion | null;
};
