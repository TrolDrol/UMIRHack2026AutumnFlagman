import { expect, it, vi } from "vitest";
import { ServerClock } from "@rims/demo-api/server-clock";
it.each([-300000, 300000])(
  "server clock follows monotonic elapsed despite device skew %i",
  (skew) => {
    const clock = new ServerClock();
    let elapsed = 100;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const timestamp = "2026-10-15T12:00:00Z";
    clock.observe("runtime-A:session1", timestamp);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(timestamp) + skew);
    elapsed += 1000;
    expect(clock.now("runtime-A:session1")).toBe(Date.parse(timestamp) + 1000);
    expect(clock.now("runtime-B:session1")).toBeNull();
    expect(clock.now("runtime-A:session1")).toBeNull();
    expect(clock.now("runtime-A:session2")).toBeNull();
    clock.reset();
    expect(clock.now("runtime-A:session1")).toBeNull();
    vi.restoreAllMocks();
  },
);
