import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const stamp = z.string().datetime({ offset: true });
const lot = z.object({
  lot_id: z.string().uuid(),
  transaction_id: z.string().uuid(),
  granted: count,
  available: count,
  reserved: count,
  used: count,
  revoked: count,
  expires_at: stamp,
  expired: z.boolean(),
  expired_unused: count,
});
export const creditAccountSchema = z.object({
  balance: z.object({
    available: count,
    reserved: count,
    used: count,
    lots: z.array(lot).max(10000),
  }),
  activity: z
    .array(
      z.object({
        id: z.string().uuid(),
        created_at: stamp,
        reason: z.enum([
          "pack_grant",
          "pack_reserve",
          "pack_settle",
          "pack_release",
          "pack_expire",
          "pack_timeout",
          "pack_adjust",
        ]),
        delta: z.number().int().safe(),
        balance_after: count,
        task_ref: z.string().max(128).nullable(),
        attempt: z.number().int().min(1).max(3).nullable(),
      }),
    )
    .max(50),
  activity_next: z.string().uuid().nullable(),
  purchases: z
    .array(
      z.object({
        id: z.string().uuid(),
        order_number: z.string().max(64).nullable(),
        name: z.string().max(300),
        created_at: stamp,
        paid_at: stamp.nullable(),
        status: z.enum([
          "pending",
          "paid",
          "confirming",
          "failed",
          "refunded",
          "canceled",
        ]),
        amount_minor: count,
        currency: z.string().regex(/^[A-Z]{3}$/),
        amount_kind: z.enum(["paid_total", "quoted_before_tax"]),
        units: count.nullable(),
        lot: lot.nullable(),
      }),
    )
    .max(50),
  purchase_next: z.string().uuid().nullable(),
});
export type CreditAccount = z.infer<typeof creditAccountSchema>;
export type CreditAccountView = Omit<CreditAccount, "activity"> & {
  activity: (Omit<CreditAccount["activity"][number], "task_ref"> & {
    researchId: string | null;
  })[];
};
export type CreditsResponse =
  | { state: "off" }
  | { state: "unavailable"; retryAfter: number }
  | { state: "ready"; syncedAt: string; data: CreditAccountView };

export const creditHistoryQuery = z
  .object({
    activity_cursor: z.string().uuid().optional(),
    purchase_cursor: z.string().uuid().optional(),
    lang: z.enum(["en", "zh"]).optional(),
  })
  .strict();
