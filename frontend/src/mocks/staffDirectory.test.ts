// Simulator regressions only. Live acceptance is integration/staff-directory.mjs.
import { beforeEach, expect, it } from "vitest";
import {
  demoRequest,
  resetDemoData,
  initializeDemoData,
} from "@rims/demo-api/model";
import type { Envelope, Page, StaffAccount } from "../shared/api/types";
function call<T = unknown>(path: string, method = "GET", body?: unknown) {
  const url = new URL(`http://localhost/api/v2${path}`);
  return demoRequest(path.split("?")[0], method, body, url, null) as {
    status: number;
    body: Envelope<T>;
  };
}
beforeEach(() => {
  resetDemoData();
  initializeDemoData();
});
const login = (username: string) =>
  expect(
    call("/auth/login", "POST", { username, password: "demo" }).status,
  ).toBe(200);
it("DEMO directory includes unassigned staff and deletes ordinary accounts while protecting administrators", () => {
  login("superadmin");
  expect(
    call("/enterprises/staff", "POST", {
      username: "directory-fixture",
      password: "demo-test-password",
      displayName: "Fixture",
    }).status,
  ).toBe(201);
  const row = call<Page<StaffAccount>>("/staff?q=directory-fixture").body.data
    .items[0];
  expect(row.memberships).toEqual([]);
  expect(row.canDeleteAccount).toBe(true);
  expect(call(`/staff/${row.userId}`, "DELETE").status).toBe(204);
  expect(
    call<Page<StaffAccount>>("/staff?q=directory-fixture").body.data.total,
  ).toBe(0);
  const admin = call<Page<StaffAccount>>("/staff?q=superadmin").body.data
    .items[0];
  expect(admin.canDeleteAccount).toBe(false);
  expect(call(`/staff/${admin.userId}`, "DELETE").status).toBe(409);
});
it("DEMO directory hides foreign enterprises and denies manager access", () => {
  login("superadmin");
  call("/enterprises/staff", "POST", {
    username: "foreign-owner",
    password: "demo-test-password",
    displayName: "Foreign owner",
  });
  const enterprise = call<{ id: string }>("/enterprises", "POST", {
    name: "Foreign enterprise",
    ownerUsername: "foreign-owner",
  }).body.data;
  call(`/enterprises/${enterprise.id}/members/register`, "POST", {
    username: "foreign-worker",
    password: "demo-test-password",
    displayName: "Foreign worker",
    role: "waiter",
  });
  login("operator");
  expect(
    call<Page<StaffAccount>>("/staff?q=foreign-worker").body.data.total,
  ).toBe(0);
  expect(call(`/staff?enterpriseId=${enterprise.id}`).status).toBe(404);
  login("manager");
  expect(call("/staff").status).toBe(403);
});
