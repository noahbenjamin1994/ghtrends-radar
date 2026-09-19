import { randomUUID } from "node:crypto";
import type { CreditReceipt } from "../../src/core/credits.js";
import { CreditAccountClient } from "../../src/server/credits.js";

/** Synthetic atomic provider. Faults occur AFTER commit, like a lost response. */
export class CreditProviderFixture {
  balances = new Map<string, number>();
  receipts = new Map<string, CreditReceipt>();
  requests: { operation: string; body: any }[] = [];
  reservations = 0;
  consumed = 0;
  releases = 0;
  loseReserve = false;
  loseSettle = false;
  wrongReceipt = false;
  waitReserve?: Promise<void>;
  client() {
    return new CreditAccountClient(this.fetch, {
      GHTRENDS_HOSTED: "1",
      GHTRENDS_NEXUS_URL: "https://billing.example",
      GHTRENDS_NEXUS_PROJECT_KEY: "synthetic-key-only",
    });
  }
  balance(owner = "alice") {
    return this.balances.get(owner) ?? 10;
  }
  fetch = (async (url, options) => {
    const operation = String(url).split("/").at(-1)!;
    const body = JSON.parse(options!.body as string);
    this.requests.push({ operation, body });
    const key = body.user_id + ":" + body.task_ref;
    let receipt = this.receipts.get(key);
    if (
      receipt?.state === "reserved" &&
      Date.parse(receipt.lease_expires_at) <= Date.now()
    ) {
      receipt.state = "expired";
      this.balances.set(body.user_id, this.balance(body.user_id) + 1);
    }
    const fail = (code: string, status = 409) =>
      Response.json({ detail: { code } }, { status });
    if (operation === "reserve") {
      if (receipt && receipt.attempt === body.attempt)
        return Response.json(receipt);
      if (
        receipt
          ? body.attempt !== receipt.attempt + 1 ||
            !["released", "expired"].includes(receipt.state)
          : body.attempt !== 1
      )
        return fail(receipt ? "attempt_conflict" : "first_attempt_required");
      if (!this.balance(body.user_id)) return fail("credits_exhausted", 402);
      this.balances.set(body.user_id, this.balance(body.user_id) - 1);
      receipt = {
        reservation_id: receipt?.reservation_id || randomUUID(),
        task_ref: body.task_ref,
        attempt: body.attempt,
        state: "reserved",
        lot_id: randomUUID(),
        lease_expires_at: new Date(Date.now() + 3600000).toISOString(),
        settled_at: null,
        available: this.balance(body.user_id),
      };
      this.receipts.set(key, receipt);
      this.reservations++;
      if (this.waitReserve) await this.waitReserve;
      if (this.loseReserve) {
        this.loseReserve = false;
        throw new Error("connection lost after reserve commit");
      }
      return Response.json(
        this.wrongReceipt ? { ...receipt, task_ref: randomUUID() } : receipt,
      );
    }
    if (operation === "settle") {
      if (!receipt || receipt.reservation_id !== body.reservation_id)
        return fail("reservation_not_found", 404);
      if (receipt.attempt !== body.attempt) return fail("stale_attempt");
      if (receipt.state !== "expired" && receipt.state !== body.outcome) {
        if (receipt.state !== "reserved") return fail("outcome_conflict");
        receipt.state = body.outcome;
        receipt.settled_at = new Date().toISOString();
        if (body.outcome === "used") this.consumed++;
        else {
          this.releases++;
          this.balances.set(body.user_id, this.balance(body.user_id) + 1);
        }
      }
      if (this.loseSettle) {
        this.loseSettle = false;
        throw new Error("connection lost after settlement commit");
      }
      return Response.json({
        ...receipt,
        available: this.balance(body.user_id),
        settled: receipt.state !== "expired",
      });
    }
    if (operation === "account")
      return Response.json({
        balance: {
          available: this.balance(body.user_id),
          reserved: 0,
          used: this.consumed,
          lots: [],
        },
        activity: [],
        activity_next: null,
        purchases: [],
        purchase_next: null,
      });
    return fail("not_found", 404);
  }) as typeof fetch;
}
