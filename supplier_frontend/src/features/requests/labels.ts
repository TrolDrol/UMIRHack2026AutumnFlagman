import type { PurchaseRequestStatus } from "@rims/portal-contracts";
export const statusLabels: Record<PurchaseRequestStatus, string> = {
  draft: "Черновик",
  submitted: "Ожидает решения",
  approved: "Принята поставщиком",
  delivery_pending: "Ожидает приёмки",
  received: "Товар принят на склад",
  rejected: "Отклонена поставщиком",
  cancelled: "Отменена менеджером",
  delivery_rejected: "Отказ в приёмке",
};
