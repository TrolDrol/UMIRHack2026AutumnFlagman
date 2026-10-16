import {
  activateContext,
  sessionVersion,
  type RequestContext,
} from "../app/workspace";
export const testContext: RequestContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  enterpriseId: "aaaaaaaa-0000-4000-8000-000000000011",
  enterpriseName: "Тест",
  warehouseId: "aaaaaaaa-0000-4000-8000-000000000001",
  role: "owner",
  sessionVersion: sessionVersion(),
};
export function activateTestContext() {
  testContext.sessionVersion = sessionVersion();
  activateContext(testContext);
  return testContext;
}
export const testApi = "/api/v2/warehouses/" + testContext.warehouseId;
