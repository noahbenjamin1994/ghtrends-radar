import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CreditAccountClient,
  installCreditAccountRoutes,
} from "../src/server/credits.js";
import { Store } from "../src/core/store.js";
import type { installAuth } from "../src/server/auth.js";
import type { CreditAccount } from "../src/core/credits.js";
import type { DeepTask } from "../src/core/deep.js";

const env = {
  GHTRENDS_HOSTED: "1",
  GHTRENDS_NEXUS_URL: "https://billing.example/v1",
  GHTRENDS_NEXUS_PROJECT_KEY: "synthetic-server-only-key",
  GHTRENDS_NEXUS_PROJECT_ID: "ghtrends",
};
const empty = (): CreditAccount => ({
  balance: { available: 0, reserved: 0, used: 0, lots: [] },
  activity: [],
  activity_next: null,
  purchases: [],
  purchase_next: null,
});

test("billing connection is server-configured and hosted only", () => {
  const transport = (async () => {
    throw new Error("never called");
  }) as typeof fetch;
  assert.equal(new CreditAccountClient(transport, {}).enabled, false);
  assert.equal(
    new CreditAccountClient(transport, { ...env, GHTRENDS_HOSTED: "0" })
      .enabled,
    false,
  );
  for (const url of [
    "http://public.example",
    "https://user:password@billing.example",
    "https://billing.example/?key=a",
    "https://billing.example/wrong",
    "ftp://billing.example",
  ])
    assert.throws(
      () =>
        new CreditAccountClient(transport, { ...env, GHTRENDS_NEXUS_URL: url }),
    );
  for (const url of [
    "https://billing.example",
    "http://nexus-app.nexus.svc:18081",
    "http://127.0.0.1:18081",
  ])
    assert.equal(
      new CreditAccountClient(transport, { ...env, GHTRENDS_NEXUS_URL: url })
        .enabled,
      true,
    );
});

test("account reads coalesce by subject and page and send only a server-selected identity", async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const client = new CreditAccountClient(
    (async (url, options) => {
      calls.push({ url: String(url), options: options! });
      return Response.json(empty());
    }) as typeof fetch,
    env,
  );
  const [a, b] = await Promise.all([
    client.overview("alice"),
    client.overview("alice"),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://billing.example/v1/internal/credit-packs/account",
  );
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body as string), {
    project_id: "ghtrends",
    user_id: "alice",
    quota_type: "deep_research",
    limit: 20,
  });
  await client.overview("bob");
  await client.overview("alice", { activity_cursor: randomUUID() });
  assert.equal(calls.length, 3);
});

test("billing failures, invalid balances and large bodies remain unknown, with private errors sanitized", async () => {
  for (const transport of [
    async () => new Response("secret-provider-detail", { status: 403 }),
    async () => {
      throw new Error("secret-provider-detail");
    },
    async () =>
      Response.json({
        ...empty(),
        balance: { available: -10, used: 0, reserved: 0, lots: [] },
      }),
    async () => new Response("a".repeat(1024 * 1024 + 1)),
  ]) {
    const client = new CreditAccountClient(transport as typeof fetch, env);
    await assert.rejects(
      client.overview("alice"),
      (error) => (error as Error).message === "credits_unavailable",
    );
  }
});

test("private account route rejects guests and identity overrides; research links remain owner checked", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ghtrends-credit-account-"));
  const store = new Store(directory);
  const ownId = randomUUID(),
    otherId = randomUUID(),
    deletedId = randomUUID();
  for (const [id, owner] of [
    [ownId, "alice"],
    [otherId, "bob"],
    [deletedId, "alice"],
  ]) {
    const task = {
      id,
      owner,
      request: { requestKey: randomUUID(), reportId: "a".repeat(16) },
      title: { en: "Private topic", zh: "私有主题" },
      geo: "US",
      version: "3",
      model: "qa",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      state: "queued",
      stage: "queued",
      attempts: 1,
      credit: "own-keys",
    } as DeepTask;
    store.createDeepTask(task, id, false);
    store.finishDeepTask(task, true);
  }
  store.removeDeepTask(deletedId, "alice");
  const payload = empty();
  payload.activity = [ownId, otherId, deletedId].map((id) => ({
    id: randomUUID(),
    task_ref: id,
    created_at: new Date().toISOString(),
    reason: "pack_settle",
    delta: 0,
    balance_after: 7,
    attempt: 1,
  }));
  let reads = 0,
    unavailable = false;
  const client = new CreditAccountClient(
    (async (_url, options) => {
      reads++;
      assert.equal(JSON.parse(options!.body as string).user_id, "alice");
      if (unavailable) throw new Error("private-provider-token");
      return Response.json({ ...payload, server_secret: "strip-me" });
    }) as typeof fetch,
    env,
  );
  const app = express();
  app.use((_q, r, next) => {
    r.set("Cache-Control", "no-store").vary("Cookie");
    next();
  });
  const auth = {
    hosted: true,
    requireUser: (q: express.Request) => {
      if (q.get("cookie") !== "qa=session")
        throw Object.assign(new Error("Sign in to view your account."), {
          status: 401,
        });
      return { id: "alice", name: "Alice", csrf: "qa" };
    },
  } as ReturnType<typeof installAuth>;
  installCreditAccountRoutes(app, store, auth, client);
  app.use(
    (
      error: Error & { status?: number },
      _q: express.Request,
      r: express.Response,
      _n: express.NextFunction,
    ) => r.status(error.status || 500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/account/credits`;
  const headers = { Cookie: "qa=session" };
  try {
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal(reads, 0);
    for (const query of [
      "?user_id=bob",
      "?activity_cursor=wrong",
      "?project_id=other",
    ])
      assert.equal((await fetch(endpoint + query, { headers })).status, 400);
    assert.equal(reads, 0);
    const response = await fetch(endpoint, { headers });
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.match(response.headers.get("Vary")!, /Cookie/);
    const body = await response.json();
    assert.deepEqual(
      body.data.activity.map((row: any) => row.researchId),
      [ownId, null, null],
    );
    assert.ok(
      !JSON.stringify(body).match(
        /strip-me|task_ref|private-provider-token|bob/,
      ),
    );
    unavailable = true;
    const failure = await fetch(endpoint + "?activity_cursor=" + randomUUID(), {
      headers,
    });
    assert.equal(failure.status, 503);
    const result = await failure.json();
    assert.equal(result.state, "unavailable");
    assert.equal(result.data, undefined);
    assert.ok(!JSON.stringify(result).includes("private-provider-token"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
