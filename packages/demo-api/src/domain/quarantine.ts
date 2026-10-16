import type { Batch } from "../shared/api/types";
import type {
  Quarantine,
  QuarantineInput,
  QuarantineReleaseInput,
  QuarantineWriteOffInput,
} from "../shared/api/extensions";
import { thousandths } from "../shared/lib/decimal";
import { decimal, free, held } from "./stock";

export function openQuarantine(
  batch: Batch,
  input: QuarantineInput,
  context: { id: string; warehouseId: string; actorId: string; asOf: string },
): { batch: Batch; quarantine: Quarantine } {
  if ((batch.version ?? 1) !== input.expectedBatchVersion)
    throw new Error("BATCH_VERSION_CHANGED");
  const q = thousandths(input.quantity);
  if (q > free(batch)) throw new Error("INSUFFICIENT_FREE_BATCH_STOCK");
  if (q <= 0n) throw new Error("VALIDATION_ERROR");
  return {
    batch: { ...batch, heldQuantity: decimal(held(batch) + q) },
    quarantine: {
      id: context.id,
      warehouseId: context.warehouseId,
      batchId: batch.id,
      version: 1,
      openedQuantity: decimal(q),
      remainingHeldQuantity: decimal(q),
      releasedQuantity: "0.000",
      writtenOffQuantity: "0.000",
      reason: input.reason.trim(),
      note: input.note,
      createdAt: context.asOf,
      createdByUserId: context.actorId,
      status: "open",
      closedAt: null,
      decisions: [],
    },
  };
}
export function decideQuarantine(
  batch: Batch,
  record: Quarantine,
  input: QuarantineReleaseInput | QuarantineWriteOffInput,
  context: {
    action: "release" | "write_off";
    decisionId: string;
    writeOffId: string | null;
    actorId: string;
    asOf: string;
  },
) {
  if (record.version !== input.expectedVersion)
    throw new Error("QUARANTINE_VERSION_CHANGED");
  if (record.status === "closed") throw new Error("QUARANTINE_CLOSED");
  const q = thousandths(input.quantity);
  if (q <= 0n) throw new Error("VALIDATION_ERROR");
  if (q > thousandths(record.remainingHeldQuantity))
    throw new Error("INSUFFICIENT_HELD_STOCK");
  if (
    context.action === "write_off" &&
    input.reason === "expired" &&
    Date.parse(batch.expiresAt) > Date.parse(context.asOf)
  )
    throw new Error("BATCH_NOT_EXPIRED");
  const remaining = thousandths(record.remainingHeldQuantity) - q;
  return {
    batch: {
      ...batch,
      heldQuantity: decimal(held(batch) - q),
      remainingQuantity:
        context.action === "write_off"
          ? decimal(thousandths(batch.remainingQuantity) - q)
          : batch.remainingQuantity,
    },
    quarantine: {
      ...record,
      version: record.version + 1,
      remainingHeldQuantity: decimal(remaining),
      releasedQuantity: decimal(
        thousandths(record.releasedQuantity) +
          (context.action === "release" ? q : 0n),
      ),
      writtenOffQuantity: decimal(
        thousandths(record.writtenOffQuantity) +
          (context.action === "write_off" ? q : 0n),
      ),
      status: remaining === 0n ? ("closed" as const) : ("open" as const),
      closedAt: remaining === 0n ? context.asOf : null,
      decisions: [
        ...record.decisions,
        {
          id: context.decisionId,
          action: context.action,
          quantity: decimal(q),
          reason: input.reason,
          at: context.asOf,
          actorUserId: context.actorId,
          writeOffId: context.writeOffId,
        },
      ],
    },
  };
}
