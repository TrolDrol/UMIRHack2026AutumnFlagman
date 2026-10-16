import type { Batch, Movement, WriteOff } from "../shared/api/types";
import type {
  LedgerOpeningBalance,
  RiskReport,
  RiskReportRow,
} from "../shared/api/extensions";
import { thousandths } from "../shared/lib/decimal";
import { decimal, held, riskStartsAt } from "./stock";

export type ReportInput = {
  view: "period" | "cohort";
  cohortEntry?: "dated" | "unknown";
  from: string;
  to: string;
  ingredientId?: string;
  batchId?: string;
  page: number;
  pageSize: number;
};
export function riskReport(
  snapshot: {
    batches: Batch[];
    movements: Movement[];
    writeOffs: WriteOff[];
    openingBalances: LedgerOpeningBalance[];
    trackingStartedAt: string;
  },
  input: ReportInput,
  asOf: number,
): RiskReport {
  const from = Date.parse(input.from),
    to = Date.parse(input.to),
    tracking = Date.parse(snapshot.trackingStartedAt);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to > asOf ||
    to - from > 90 * 86400000
  )
    throw new Error("INVALID_REPORT_PERIOD");
  const filtered = snapshot.batches.filter(
    (b) =>
      (!input.ingredientId || b.ingredientId === input.ingredientId) &&
      (!input.batchId || b.id === input.batchId),
  );
  let unknownCount = 0;
  const rows: RiskReportRow[] = [];
  for (const batch of filtered) {
    const own = snapshot.movements
      .filter((m) => m.batchId === batch.id)
      .sort(
        (a, b) =>
          Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
          (a.eventSequence ?? 0) - (b.eventSequence ?? 0),
      );
    const threshold = riskStartsAt(batch),
      receipt = batch.receiptCommittedAt
        ? Date.parse(batch.receiptCommittedAt)
        : null;
    const opening = snapshot.openingBalances.find(
      (b) => b.batchId === batch.id,
    );
    const provenOpening =
      opening &&
      thousandths(opening.physicalQuantity) > 0n &&
      Date.parse(opening.recordedAt) <= threshold;
    const cohortAt =
      receipt !== null
        ? Math.max(receipt, threshold)
        : provenOpening
          ? threshold
          : null;
    if (cohortAt === null && threshold <= asOf) unknownCount++;
    const periodFlows = own.filter(
      (m) =>
        Date.parse(m.createdAt) >= from &&
        Date.parse(m.createdAt) < to &&
        ["order", "write_off"].includes(m.type),
    );
    if (
      input.view === "period" &&
      !periodFlows.length &&
      !(thousandths(batch.remainingQuantity) > 0n && threshold <= asOf)
    )
      continue;
    if (input.view === "cohort") {
      if ((input.cohortEntry ?? "dated") === "unknown") {
        if (cohortAt !== null || threshold > asOf) continue;
      } else if (cohortAt === null || cohortAt < from || cohortAt >= to)
        continue;
    }
    let baseline: bigint | null = null,
      entrySequence = -1;
    if (input.view === "cohort" && cohortAt !== null) {
      if (opening && Date.parse(opening.recordedAt) <= cohortAt) {
        baseline = thousandths(opening.physicalQuantity);
        for (const m of own)
          if (
            (m.eventSequence ?? 0) > opening.eventSequence &&
            Date.parse(m.createdAt) < cohortAt
          )
            baseline += signed(m.quantityDelta);
        entrySequence = opening.eventSequence;
      } else if (receipt !== null && receipt >= tracking) {
        const event = own.find(
          (m) => m.type === "receipt" && Date.parse(m.createdAt) === receipt,
        );
        if (event) {
          baseline = thousandths(event.remainingAfter);
          entrySequence = event.eventSequence ?? -1;
          if (cohortAt > receipt)
            for (const m of own)
              if (
                (m.eventSequence ?? 0) > entrySequence &&
                Date.parse(m.createdAt) < cohortAt
              )
                baseline += signed(m.quantityDelta);
        }
      }
      if (baseline === 0n) continue;
    }
    const flows =
      input.view === "period"
        ? periodFlows
        : own.filter(
            (m) =>
              ["order", "write_off"].includes(m.type) &&
              Date.parse(m.createdAt) >= (cohortAt ?? tracking) &&
              Date.parse(m.createdAt) <= asOf &&
              (baseline === null || (m.eventSequence ?? 0) > entrySequence),
          );
    let expiring = 0n,
      fresh = 0n,
      unknown = 0n,
      expired = 0n,
      damaged = 0n,
      used = 0n,
      written = 0n;
    for (const m of flows) {
      const q = -signed(m.quantityDelta);
      if (m.type === "order") {
        used += q;
        if (!m.riskSnapshot) unknown += q;
        else if (m.riskSnapshot.phase === "expiring") expiring += q;
        else fresh += q;
      } else {
        written += q;
        const reason = snapshot.writeOffs.find(
          (w) => w.id === m.referenceId,
        )?.reason;
        if (reason === "expired") expired += q;
        if (reason === "damaged") damaged += q;
      }
    }
    const balanced =
      baseline !== null &&
      baseline === used + written + thousandths(batch.remainingQuantity);
    const complete =
      input.view === "cohort"
        ? balanced
        : flows.every(
            (m) => m.riskSnapshot !== null && m.riskSnapshot !== undefined,
          ) && from >= tracking;
    const limitations: string[] = [];
    if (!complete)
      limitations.push(
        "Неполная история: показаны только доказанные движения и текущий остаток.",
      );
    if (input.view === "cohort" && cohortAt === null)
      limitations.push(
        "Дата входа неизвестна; потоки показаны с начала надёжного журнала.",
      );
    rows.push({
      batchId: batch.id,
      ingredientId: batch.ingredientId,
      ingredientName: batch.ingredientName,
      unit: batch.unit,
      deliveryId: batch.deliveryId,
      deliveryNumber: batch.deliveryNumber,
      completeness: complete ? "complete" : "partial",
      limitations,
      usedExpiringQuantity: decimal(expiring),
      usedFreshQuantity: decimal(fresh),
      unknownRiskOrderQuantity: decimal(unknown),
      writtenOffExpiredQuantity: decimal(expired),
      writtenOffDamagedQuantity: decimal(damaged),
      remainingPhysicalAsOf: batch.remainingQuantity,
      heldAsOf: decimal(held(batch)),
      expiredAsOf:
        Date.parse(batch.expiresAt) <= asOf ? batch.remainingQuantity : "0.000",
      cohortAt:
        input.view === "cohort" && cohortAt !== null
          ? new Date(cohortAt).toISOString()
          : null,
      riskAtEntry: balanced && baseline !== null ? decimal(baseline) : null,
      usedInOrdersAfterEntry:
        input.view === "cohort" && cohortAt !== null ? decimal(used) : null,
      writtenOffAfterEntry:
        input.view === "cohort" && cohortAt !== null ? decimal(written) : null,
      usedFraction:
        balanced && baseline !== null && baseline > 0n
          ? Number(used) / Number(baseline)
          : null,
    });
  }
  rows.sort(
    (a, b) =>
      a.ingredientName.localeCompare(b.ingredientName, "ru") ||
      a.batchId.localeCompare(b.batchId),
  );
  const totals: RiskReport["totalsByIngredient"] = [];
  for (const row of rows) {
    let total = totals.find(
      (t) => t.ingredientId === row.ingredientId && t.unit === row.unit,
    );
    if (!total) {
      total = {
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        unit: row.unit,
        usedExpiringQuantity: "0.000",
        usedFreshQuantity: "0.000",
        unknownRiskOrderQuantity: "0.000",
        writtenOffExpiredQuantity: "0.000",
        writtenOffDamagedQuantity: "0.000",
        knownCohortEntryQuantity: "0.000",
        unknownCohortCount: 0,
      };
      totals.push(total);
    }
    for (const key of [
      "usedExpiringQuantity",
      "usedFreshQuantity",
      "unknownRiskOrderQuantity",
      "writtenOffExpiredQuantity",
      "writtenOffDamagedQuantity",
    ] as const)
      total[key] = decimal(thousandths(total[key]) + thousandths(row[key]));
    if (row.riskAtEntry !== null)
      total.knownCohortEntryQuantity = decimal(
        thousandths(total.knownCohortEntryQuantity) +
          thousandths(row.riskAtEntry),
      );
    else if (input.view === "cohort") total.unknownCohortCount++;
  }
  return {
    view: input.view,
    from: input.from,
    to: input.to,
    asOf: new Date(asOf).toISOString(),
    cohortEntry:
      input.view === "cohort" ? (input.cohortEntry ?? "dated") : null,
    unknownEntryBatchCount: unknownCount,
    trackingStartedAt: snapshot.trackingStartedAt,
    policyVersion: "expiry-10pct-v1",
    completeness: rows.every((r) => r.completeness === "complete")
      ? "complete"
      : "partial",
    page: input.page,
    pageSize: input.pageSize,
    total: rows.length,
    items: rows.slice(
      (input.page - 1) * input.pageSize,
      input.page * input.pageSize,
    ),
    totalsByIngredient: totals,
  };
}
function signed(value: string) {
  return value.startsWith("-")
    ? -thousandths(value.slice(1))
    : thousandths(value.replace(/^\+/, ""));
}
