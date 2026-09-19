// Integration check against an isolated Nexus fixture. Run on home-3090 only.
// The fixture creates a synthetic account with ten credits in a temporary DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../dist/core/store.js";
import { CreditAccountClient } from "../dist/server/credits.js";
import { DeepBilling } from "../dist/server/deep-billing.js";

const origin = "http://nexus.qa.svc:8000";
const fixture = await (await fetch(origin + "/qa-fixture")).json();
assert.match(fixture.project, /^cqa-/);
assert.match(fixture.key, /^synthetic-project-key-/);
const dir = mkdtempSync(join(tmpdir(), "ghtrends-credit-contract-"));
let store = new Store(dir),
  lose = "reserve";
const client = new CreditAccountClient(
  async (url, options) => {
    const response = await fetch(url, options);
    if (String(url).endsWith("/" + lose)) {
      await response.text();
      lose = "";
      throw new Error("Synthetic response lost after server commit");
    }
    return response;
  },
  {
    GHTRENDS_HOSTED: "1",
    GHTRENDS_NEXUS_URL: origin,
    GHTRENDS_NEXUS_PROJECT_ID: fixture.project,
    GHTRENDS_NEXUS_PROJECT_KEY: fixture.key,
  },
);
let billing = new DeepBilling(store, client);
const reopen = () => {
  store.close();
  store = new Store(dir);
  store.interruptDeepTasks();
  billing = new DeepBilling(store, client);
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 11000));
const fresh = () => {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    owner: fixture.subject,
    request: {
      reportId: "a".repeat(16),
      directionId: "example",
      question: "scope",
      context: "",
      requestKey: randomUUID(),
      funding: "pack",
    },
    title: { en: "Synthetic contract", zh: "合成联调" },
    geo: "US",
    model: "synthetic",
    version: "3",
    created: now,
    updated: now,
    state: "queued",
    stage: "queued",
    attempts: 1,
    funding: "pack",
    credit: "checking",
  };
};
try {
  assert.equal(
    (await client.overview(fixture.subject)).data.balance.available,
    10,
  );
  const first = fresh();
  store.createDeepTask(first, "first", true);
  assert.equal(await billing.prepare(first), false);
  assert.equal(store.deepPayment(first.id).phase, "reserving");
  await pause();
  reopen();
  assert.equal(await billing.prepare(first), true);
  const running = store.claimDeepTask(first.id, first.owner);
  assert.ok(running);
  store.finishDeepTask(running, true);
  lose = "settle";
  await billing.reconcile();
  assert.equal(store.deepPayment(first.id).phase, "settle");
  await pause();
  reopen();
  await billing.reconcile();
  assert.equal(store.deepTask(first.id, first.owner).credit, "used");
  const second = fresh();
  store.createDeepTask(second, "second", true);
  await billing.prepare(second);
  assert.ok(store.claimDeepTask(second.id, second.owner));
  reopen();
  await billing.reconcile();
  assert.equal(store.deepTask(second.id, second.owner).credit, "returned");
  const retry = store.retryDeepTask(second.id, second.owner, true);
  await billing.prepare(retry);
  assert.equal(store.deepPayment(second.id).receipt.attempt, 2);
  store.finishDeepTask(store.claimDeepTask(second.id, second.owner), true);
  await billing.reconcile();
  const canceled = fresh();
  store.createDeepTask(canceled, "canceled", true);
  store.finishDeepTask(canceled, false);
  assert.equal(store.deepTask(canceled.id, canceled.owner).credit, "uncharged");
  client.invalidate(fixture.subject);
  const account = (await client.overview(fixture.subject)).data;
  assert.equal(account.balance.available, 8);
  assert.equal(account.balance.reserved, 0);
  assert.equal(account.balance.used, 2);
  assert.equal(
    account.activity.filter((e) => e.reason === "pack_reserve").length,
    3,
  );
  assert.equal(
    account.activity.filter((e) => e.reason === "pack_settle").length,
    2,
  );
  assert.equal(
    account.activity.filter((e) => e.reason === "pack_release").length,
    1,
  );
  assert.deepEqual(store.deepPaymentOverview(), {
    pending: 0,
    attention: 0,
    items: [],
  });
  console.log(
    JSON.stringify({
      passed: true,
      available: 8,
      used: 2,
      reservations: 3,
      releases: 1,
      recoveredLostResponses: 2,
      recoveredInterruptedResearch: 1,
      unstartedCancellation: 1,
    }),
  );
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
