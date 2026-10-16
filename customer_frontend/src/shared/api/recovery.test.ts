import { expect, it } from "vitest";
import { ApiError } from "./client";
import { isTerminalOrderFailure } from "./recovery";

it("keeps unknown intentions for access, rate-limit, validation and context failures", () => {
  for (const [status, code] of [
    [0, "CONNECTION_ERROR"], [401, "UNAUTHENTICATED"], [403, "FORBIDDEN"],
    [404, "NOT_FOUND"], [429, "RATE_LIMITED"], [400, "INVALID_JSON"],
    [422, "VALIDATION_ERROR"], [409, "UNKNOWN_CONFLICT"],
    [409, "IDEMPOTENCY_KEY_REUSED"], [409, "SESSION_CONTEXT_CHANGED"],
    [403, "CSRF_INVALID"],
  ] as const) {
    expect(isTerminalOrderFailure(new ApiError(status, code, code))).toBe(false);
  }
});
it("permits a new intent only after a known persisted terminal business outcome", () => {
  for (const code of ["INSUFFICIENT_STOCK", "COMBO_VERSION_CHANGED", "COMBO_UNAVAILABLE", "COMBO_RECIPE_CHANGED"]) {
    expect(isTerminalOrderFailure(new ApiError(409, code, code))).toBe(true);
    expect(isTerminalOrderFailure(new ApiError(500, code, code))).toBe(false);
    const runtimeFailure = new ApiError(409, code, code);
    runtimeFailure.runtimeCheckFailed = true;
    expect(isTerminalOrderFailure(runtimeFailure)).toBe(false);
  }
});
