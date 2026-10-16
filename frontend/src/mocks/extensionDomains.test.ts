import { expect, it } from "vitest";
import { createForecastFixture } from "../../../packages/demo-api/src/domain/demoFixture";
import { forecast } from "../../../packages/demo-api/src/domain/stopForecast";
import { riskReport } from "../../../packages/demo-api/src/domain/riskReports";
import { jointPlan } from "../../../packages/demo-api/src/domain/comboPlanner";
import {
  inventory,
  riskSnapshot,
  stockPlan,
  available,
  free,
} from "../../../packages/demo-api/src/domain/stock";
import {
  openQuarantine,
  decideQuarantine,
} from "../../../packages/demo-api/src/domain/quarantine";
const now = Date.parse("2026-10-12T12:00:00Z"),
  actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixture() {
  return createForecastFixture(now, actor);
}
function snapshot() {
  const db = fixture();
  return {
    ...db,
    batches: db.deliveries.flatMap((d) => d.batches),
    observationStartedAt: db.forecastObservationStartedAt,
    revision: db.stateRevision,
    trackingStartedAt: db.analyticsTrackingStartedAt,
  };
}
it("controlled fixture has 14 observed days and a conserved stock ledger", () => {
  const db = snapshot();
  expect(db.orders).toHaveLength(84);
  const before = JSON.stringify(db);
  const result = forecast(db, now, 14, 48);
  expect(result.history.observedFullDays).toBe(14);
  expect(result.items.some((d) => d.status === "predicted")).toBe(true);
  expect(
    result.items.find((d) => d.dishId === db.dishes[2].id)?.estimatedWindow?.to,
  ).toBe(new Date(now + 3600000).toISOString());
  expect(result.items.find((d) => d.dishId === db.dishes[3].id)?.status).toBe(
    "insufficient_history",
  );
  expect(forecast(db, now, 14, 48)).toEqual(result);
  expect(JSON.stringify(db)).toBe(before);
});
it("forecast event cap stops before a complete simultaneous timestamp group", () => {
  const db = snapshot();
  for (const b of db.batches)
    b.expiresAt = new Date(now + 72 * 3600000).toISOString();
  const limited = forecast(db, now, 14, 48, 2);
  expect(limited.calculatedThrough).toBe(limited.asOf);
  expect(
    limited.items.filter((d) => d.status === "calculation_limited").length,
  ).toBeGreaterThan(0);
  expect(limited.items.find((d) => d.dishId === db.dishes[3].id)?.status).toBe(
    "insufficient_history",
  );
});
it("joint plan cannot promise the same shared expiring stock twice", () => {
  const db = snapshot(),
    before = JSON.stringify(db);
  const result = jointPlan(
    db.ingredients,
    db.dishes,
    db.batches,
    db.dishes.slice(0, 3).map((d) => d.id),
    now,
    1,
  );
  expect(result.proposals.length).toBeGreaterThan(0);
  const portions = new Map<string, number>();
  for (const p of result.proposals)
    for (const c of p.components)
      portions.set(c.dishId, (portions.get(c.dishId) ?? 0) + p.suggestedUnits);
  expect(
    stockPlan(
      db.ingredients,
      db.dishes,
      db.batches,
      {
        lines: [...portions].map(([dishId, portions]) => ({
          dishId,
          portions,
        })),
      },
      now,
    ).canCreate,
  ).toBe(true);
  expect(result.isReservation).toBe(false);
  expect(JSON.stringify(db)).toBe(before);
});
it("physical/held/expired overlap and 0.001 precision remain exact", () => {
  const db = snapshot(),
    b = {
      ...db.batches[0],
      remainingQuantity: "10.000",
      heldQuantity: "0.000",
      version: 1,
    };
  const q = openQuarantine(
    b,
    {
      batchId: b.id,
      expectedBatchVersion: 1,
      quantity: "4.000",
      reason: "Check",
      note: null,
    },
    {
      id: "q",
      warehouseId: "w",
      actorId: actor,
      asOf: new Date(now).toISOString(),
    },
  );
  expect(free(q.batch)).toBe(6000n);
  const released = decideQuarantine(
    q.batch,
    q.quarantine,
    { expectedVersion: 1, quantity: "1.000", reason: "Checked" },
    {
      action: "release",
      decisionId: "d",
      writeOffId: null,
      actorId: actor,
      asOf: new Date(now).toISOString(),
    },
  );
  expect(free(released.batch)).toBe(7000n);
  const written = decideQuarantine(
    released.batch,
    released.quarantine,
    { expectedVersion: 2, quantity: "3.000", reason: "damaged", note: null },
    {
      action: "write_off",
      decisionId: "d2",
      writeOffId: "w",
      actorId: actor,
      asOf: new Date(now).toISOString(),
    },
  );
  expect(written.batch.remainingQuantity).toBe("7.000");
  expect(written.batch.heldQuantity).toBe("0.000");
  expect(() =>
    decideQuarantine(
      written.batch,
      written.quarantine,
      { expectedVersion: 3, quantity: "0.001", reason: "Checked" },
      {
        action: "release",
        decisionId: "d3",
        writeOffId: null,
        actorId: actor,
        asOf: new Date(now).toISOString(),
      },
    ),
  ).toThrow("QUARANTINE_CLOSED");
  const expiry = Date.parse(q.batch.expiresAt);
  expect(available(q.batch, expiry)).toBe(0n);
  const row = inventory(db.ingredients, [q.batch], expiry)[0];
  expect(row.physicalQuantity).toBe("10.000");
  expect(row.heldQuantity).toBe("4.000");
  expect(row.heldExpiredQuantity).toBe("4.000");
  expect(row.expiredQuantity).toBe("10.000");
  expect(riskSnapshot(q.batch, expiry).phase).toBe("expired");
  expect(
    riskSnapshot(q.batch, expiry - q.batch.shelfLifeHours * 360000).phase,
  ).toBe("expiring");
});
it("cohort conserves risk entry stock and pagination never changes totals", () => {
  const db = snapshot(),
    input = {
      view: "cohort" as const,
      from: new Date(now - 3 * 86400000).toISOString(),
      to: new Date(now).toISOString(),
      page: 1,
      pageSize: 1,
    };
  const result = riskReport(db, input, now),
    all = riskReport(db, { ...input, pageSize: 100 }, now);
  expect(result.totalsByIngredient).toEqual(all.totalsByIngredient);
  expect(all.items.length).toBeGreaterThan(0);
  for (const row of all.items) {
    expect(row.completeness).toBe("complete");
    expect(Number(row.riskAtEntry)).toBeCloseTo(
      Number(row.usedInOrdersAfterEntry) +
        Number(row.writtenOffAfterEntry) +
        Number(row.remainingPhysicalAsOf),
      3,
    );
  }
  expect(result.asOf).toBe(new Date(now).toISOString());
});
it("unknown legacy entry stays outside the dated cohort rather than inventing a baseline", () => {
  const db = snapshot();
  db.batches[0].receiptCommittedAt = null;
  db.openingBalances = [];
  const result = riskReport(
    db,
    {
      view: "cohort",
      cohortEntry: "unknown",
      from: new Date(now - 86400000).toISOString(),
      to: new Date(now).toISOString(),
      page: 1,
      pageSize: 100,
    },
    now,
  );
  const row = result.items.find((r) => r.batchId === db.batches[0].id)!;
  expect(row.cohortAt).toBeNull();
  expect(row.riskAtEntry).toBeNull();
  expect(row.usedFraction).toBeNull();
  expect(result.unknownEntryBatchCount).toBe(1);
});
