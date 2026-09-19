import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/core/store.js";
import type { DeepTask, DeepBrief } from "../src/core/deep.js";
import { DeepBilling } from "../src/server/deep-billing.js";
import { CreditProviderFixture } from "./fixtures/credit-provider.js";

function task(owner = "alice"): DeepTask {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    owner,
    request: {
      reportId: "a".repeat(16),
      directionId: "comments",
      question: "scope",
      context: "",
      requestKey: randomUUID(),
      funding: "pack",
    },
    title: { en: "Review comments", zh: "评审意见" },
    geo: "US",
    model: "qa",
    version: "3",
    created: now,
    updated: now,
    state: "queued",
    stage: "queued",
    attempts: 1,
    funding: "pack",
    credit: "checking",
  };
}
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-paid-"));
  let store = new Store(dir);
  const provider = new CreditProviderFixture();
  let billing = new DeepBilling(store, provider.client());
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const current = () => ({ store, billing });
  const reopen = () => {
    store.close();
    store = new Store(dir);
    store.interruptDeepTasks();
    billing = new DeepBilling(store, provider.client());
    return current();
  };
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    dir,
    provider,
    current,
    reopen,
    advance: (ms = 11000) => {
      now += ms;
    },
  };
}

test("paid intent and private task commit before admission; lost reserve response resumes the same receipt", async (t) => {
  const q = setup(t),
    a = task();
  let { store, billing } = q.current();
  store.createDeepTask(a, "same", true);
  assert.equal(store.deepPayment(a.id)?.phase, "reserve");
  assert.equal(store.claimDeepTask(a.id, a.owner), null);
  assert.equal(store.deepAllowance(a.owner, true).remaining, 1);
  q.provider.loseReserve = true;
  assert.equal(await billing.prepare(a), false);
  assert.equal(q.provider.reservations, 1);
  assert.equal(store.deepPayment(a.id)?.phase, "reserving");
  q.advance();
  ({ store, billing } = q.reopen());
  assert.equal(store.deepTask(a.id, a.owner)?.state, "queued");
  assert.equal(await billing.prepare(store.deepTask(a.id, a.owner)!), true);
  assert.equal(q.provider.reservations, 1);
  assert.ok(store.claimDeepTask(a.id, a.owner));
  assert.equal(
    q.provider.requests[0].body.task_ref,
    q.provider.requests[1].body.task_ref,
  );
});

test("running research interrupted by a new process releases the original purchase before retry", async (t) => {
  const q = setup(t),
    a = task();
  let { store, billing } = q.current();
  store.createDeepTask(a, "a", true);
  await billing.prepare(a);
  store.claimDeepTask(a.id, a.owner);
  const receipt = store.deepPayment(a.id)!.receipt!;
  ({ store, billing } = q.reopen());
  assert.equal(store.deepTask(a.id, a.owner)?.credit, "settling");
  assert.throws(
    () => store.retryDeepTask(a.id, a.owner, true),
    /deep_billing_pending/,
  );
  await billing.reconcile();
  assert.equal(store.deepTask(a.id, a.owner)?.credit, "returned");
  assert.equal(q.provider.balance(), 10);
  assert.equal(
    q.provider.requests.at(-1)!.body.reservation_id,
    receipt.reservation_id,
  );
  const retry = store.retryDeepTask(a.id, a.owner, true);
  assert.equal(retry.attempts, 2);
  await billing.prepare(retry);
  assert.equal(q.provider.receipts.get(a.owner + ":" + a.id)?.attempt, 2);
});

test("result and charge intent survive together; lost settlement ack stays exactly once after restart", async (t) => {
  const q = setup(t),
    a = task();
  let { store, billing } = q.current();
  store.createDeepTask(a, "a", true);
  await billing.prepare(a);
  const running = store.claimDeepTask(a.id, a.owner)!;
  running.result = {
    headline: { en: "Saved decision", zh: "已保存的判断" },
  } as DeepBrief;
  store.finishDeepTask(running, true);
  assert.equal(store.deepPayment(a.id)?.outcome, "used");
  assert.equal(store.deepTask(a.id, a.owner)?.credit, "settling");
  q.provider.loseSettle = true;
  await billing.reconcile();
  assert.equal(q.provider.consumed, 1);
  q.advance();
  ({ store, billing } = q.reopen());
  assert.equal(
    store.deepTask(a.id, a.owner)?.result?.headline.en,
    "Saved decision",
  );
  await billing.reconcile();
  await billing.reconcile();
  assert.equal(q.provider.consumed, 1);
  assert.equal(store.deepTask(a.id, a.owner)?.credit, "used");
  store.finishDeepTask(running, false);
  assert.equal(store.deepPayment(a.id)?.outcome, "used");
});

test("cancel while reserve is in flight completes a release and starts no research", async (t) => {
  const q = setup(t),
    a = task(),
    { store, billing } = q.current();
  let release!: () => void;
  q.provider.waitReserve = new Promise<void>((r) => (release = r));
  store.createDeepTask(a, "a", true);
  const preparing = billing.prepare(a);
  assert.equal(store.deepPayment(a.id)?.phase, "reserving");
  store.finishDeepTask(store.deepTask(a.id, a.owner)!, false);
  release();
  await preparing;
  assert.equal(store.deepPayment(a.id)?.phase, "settle");
  assert.equal(store.claimDeepTask(a.id, a.owner), null);
  await billing.reconcile();
  assert.equal(q.provider.consumed, 0);
  assert.equal(q.provider.balance(), 10);
  assert.equal(store.deepTask(a.id, a.owner)?.credit, "returned");
});

test("cancelling an unsent request spends zero; retry starts financial attempt one", async (t) => {
  const q = setup(t),
    a = task(),
    { store, billing } = q.current();
  store.createDeepTask(a, "a", true);
  store.finishDeepTask(a, false);
  await billing.reconcile();
  assert.equal(q.provider.requests.length, 0);
  assert.equal(store.deepTask(a.id, a.owner)?.credit, "uncharged");
  const next = store.retryDeepTask(a.id, a.owner, true);
  await billing.prepare(next);
  assert.equal(store.deepPayment(a.id)?.creditAttempt, 1);
  assert.equal(next.attempts, 2);
});

test("an empty balance admits no generation and retains the next valid financial attempt", async (t) => {
  const q = setup(t),
    a = task(),
    { store, billing } = q.current();
  q.provider.balances.set(a.owner, 0);
  store.createDeepTask(a, "a", true);
  assert.equal(await billing.prepare(a), false);
  assert.equal(store.deepTask(a.id, a.owner)?.credit, "uncharged");
  assert.equal(store.deepPayment(a.id)?.phase, "done");
  q.provider.balances.set(a.owner, 10);
  const next = store.retryDeepTask(a.id, a.owner, true);
  await billing.prepare(next);
  assert.equal(q.provider.reservations, 1);
  assert.equal(q.provider.requests.at(-1)!.body.attempt, 1);
});

test("deleting content retains pending settlement and never resurrects a private report", async (t) => {
  const q = setup(t),
    a = task();
  let { store, billing } = q.current();
  store.createDeepTask(a, "a", true);
  await billing.prepare(a);
  store.finishDeepTask(store.claimDeepTask(a.id, a.owner)!, true);
  store.removeDeepTask(a.id, a.owner);
  ({ store, billing } = q.reopen());
  await billing.reconcile();
  assert.equal(store.deepTask(a.id, a.owner), null);
  assert.equal(store.deepPayment(a.id)?.phase, "done");
  assert.equal(q.provider.consumed, 1);
});

test("an expired reservation returns its credit while keeping the already saved result", async (t) => {
  const q = setup(t),
    a = task(),
    { store, billing } = q.current();
  store.createDeepTask(a, "a", true);
  await billing.prepare(a);
  store.finishDeepTask(store.claimDeepTask(a.id, a.owner)!, true);
  q.advance(3601000);
  await billing.reconcile();
  assert.equal(store.deepTask(a.id, a.owner)?.state, "complete");
  assert.equal(store.deepTask(a.id, a.owner)?.credit, "returned");
  assert.equal(q.provider.consumed, 0);
  assert.equal(q.provider.balance(), 10);
});

test("a mismatched receipt stays flagged and never admits generation or another charge", async (t) => {
  const q = setup(t),
    a = task(),
    { store, billing } = q.current();
  q.provider.wrongReceipt = true;
  store.createDeepTask(a, "a", true);
  assert.equal(await billing.prepare(a), false);
  assert.equal(store.deepPayment(a.id)?.phase, "attention");
  assert.equal(store.deepTask(a.id, a.owner)?.problem, "billing");
  const overview = store.deepPaymentOverview();
  assert.equal(overview.attention, 1);
  assert.equal(overview.items[0]?.taskId, a.id);
  assert.equal(overview.items[0]?.nextAt, null);
  assert.ok(!JSON.stringify(overview).includes(a.owner));
  assert.ok(!JSON.stringify(overview).includes("receipt"));
  assert.throws(
    () => store.retryDeepTask(a.id, a.owner, true),
    /deep_billing_pending/,
  );
  assert.throws(
    () => store.createDeepTask(task(), "another", true),
    /deep_billing_pending/,
  );
});

test("a result write rollback also rolls back the settlement intent", async (t) => {
  const q = setup(t),
    a = task(),
    { store, billing } = q.current();
  store.createDeepTask(a, "a", true);
  await billing.prepare(a);
  const running = store.claimDeepTask(a.id, a.owner)!;
  const db = new DatabaseSync(join(q.dir, "ghtrends.sqlite"));
  try {
    db.exec(
      "CREATE TRIGGER qa_result_failure BEFORE UPDATE ON deep_tasks WHEN NEW.state='complete' BEGIN SELECT RAISE(ABORT,'qa_disk_failure'); END;",
    );
    assert.throws(() => store.finishDeepTask(running, true), /qa_disk_failure/);
    assert.equal(store.deepPayment(a.id)?.phase, "reserved");
    assert.equal(store.deepPayment(a.id)?.outcome, undefined);
    assert.equal(store.deepTask(a.id, a.owner)?.state, "running");
    db.exec("DROP TRIGGER qa_result_failure");
    store.finishDeepTask(running, true);
    await billing.reconcile();
    assert.equal(q.provider.consumed, 1);
  } finally {
    db.close();
  }
});

test("administrator settlement overview is bounded and prioritizes records needing review", async (t) => {
  const q = setup(t),
    { store } = q.current();
  for (let i = 0; i < 55; i++) {
    const a = task("account-" + i);
    store.createDeepTask(a, "request-" + i, true, 200);
    if (i === 54) store.deferDeepPayment(a.id, 1, "conflict");
    else {
      store.beginDeepReservation(a.id);
      store.finishDeepTask(a, false);
    }
  }
  const overview = store.deepPaymentOverview();
  assert.equal(overview.pending, 54);
  assert.equal(overview.attention, 1);
  assert.equal(overview.items.length, 50);
  assert.equal(overview.items[0]?.phase, "attention");
  assert.ok(overview.items.slice(1).every((p) => p.phase === "reserving"));
});
