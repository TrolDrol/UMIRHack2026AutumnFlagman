import { ApiError } from "./client";

// These business conflicts are persisted as the final outcome of the exact
// idempotency key. An access, transport, validation or unknown failure does not
// prove that an earlier attempt failed; keep its body/key for reconciliation.
const terminalOrderCodes = new Set([
  "INSUFFICIENT_STOCK",
  "COMBO_VERSION_CHANGED",
  "COMBO_UNAVAILABLE",
  "COMBO_RECIPE_CHANGED",
]);
export function isTerminalOrderFailure(error: unknown) {
  return error instanceof ApiError && !error.runtimeCheckFailed && error.status === 409 && terminalOrderCodes.has(error.code);
}
