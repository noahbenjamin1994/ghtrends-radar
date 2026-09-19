import type { Store } from "../core/store.js";
import type { DeepTask } from "../core/deep.js";
import type { DeepPayment } from "../core/credits.js";
import { CreditAccountClient, CreditServiceError } from "./credits.js";

/** Local intent is committed before every network mutation; retry the same receipt. */
export class DeepBilling {
  private inFlight = new Set<string>();
  constructor(
    private store: Store,
    private client: CreditAccountClient,
  ) {}
  get connected() {
    return this.client.enabled;
  }
  async prepare(task: DeepTask): Promise<boolean> {
    const payment = this.store.deepPayment(task.id);
    if (!payment || payment.nextAt > Date.now()) return false;
    if (payment.phase === "reserved") {
      if (
        !payment.receipt ||
        Date.parse(payment.receipt.lease_expires_at) <= Date.now() + 60000
      ) {
        task.problem = "credits";
        this.store.finishDeepTask(task, false);
        return false;
      }
      return true;
    }
    if (["reserve", "reserving"].includes(payment.phase))
      await this.reserve(payment);
    return this.store.deepPayment(task.id)?.phase === "reserved";
  }
  async reconcile() {
    if (!this.connected) return;
    for (const payment of this.store.deepPaymentPending()) {
      if (payment.phase === "settle") await this.settle(payment);
      else if (payment.phase === "reserving" && payment.outcome === "released")
        await this.reserve(payment);
    }
  }
  private async reserve(payment: DeepPayment) {
    if (this.inFlight.has(payment.taskId) || !this.connected) return;
    this.inFlight.add(payment.taskId);
    try {
      const intent = this.store.beginDeepReservation(payment.taskId);
      if (!intent) return;
      const receipt = await this.client.reserve(
        intent.owner,
        intent.taskId,
        intent.creditAttempt,
      );
      this.store.acceptDeepReceipt(
        intent.taskId,
        intent.creditAttempt,
        receipt,
      );
    } catch (error) {
      this.defer(payment, error);
    } finally {
      this.inFlight.delete(payment.taskId);
    }
  }
  private async settle(payment: DeepPayment) {
    if (this.inFlight.has(payment.taskId)) return;
    this.inFlight.add(payment.taskId);
    try {
      if (!payment.receipt || !payment.outcome)
        throw new CreditServiceError("conflict");
      const receipt = await this.client.settle(
        payment.owner,
        payment.taskId,
        payment.creditAttempt,
        payment.receipt,
        payment.outcome,
      );
      this.store.acceptDeepReceipt(
        payment.taskId,
        payment.creditAttempt,
        receipt,
        true,
      );
    } catch (error) {
      this.defer(payment, error);
    } finally {
      this.inFlight.delete(payment.taskId);
    }
  }
  private defer(payment: DeepPayment, error: unknown) {
    this.store.deferDeepPayment(
      payment.taskId,
      payment.creditAttempt,
      error instanceof CreditServiceError
        ? error.code
        : error instanceof Error && error.message === "deep_credit_binding"
          ? "conflict"
          : "unavailable",
    );
  }
}
