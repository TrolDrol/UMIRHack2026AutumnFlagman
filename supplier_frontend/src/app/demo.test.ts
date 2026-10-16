import { describe, it, expect, vi } from "vitest";
vi.mock("@rims/demo-api", () => ({
  startBrowserDemo: vi.fn(),
  ensureDemoInitialized: undefined,
  listDemoSuppliers: undefined,
  connectDemoSupplier: undefined,
}));
import { startDemo } from "./demo";
import { startBrowserDemo } from "@rims/demo-api";
describe("Общий demo bootstrap", () => {
  it("без Web Locks демонстрация запрещена", async () => {
    vi.stubGlobal("navigator", {});
    await expect(startDemo()).rejects.toThrow("Web Locks");
    expect(startBrowserDemo).not.toHaveBeenCalled();
  });
  it("при отсутствии bootstrap не создаёт независимую модель", async () => {
    vi.stubGlobal("navigator", {
      locks: { request: vi.fn() },
      serviceWorker: {},
    });
    await expect(startDemo()).rejects.toThrow("bootstrap");
    expect(startBrowserDemo).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
