import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Store } from "../src/core/store.js";
import { Engine } from "../src/core/engine.js";
import { createApp } from "../src/server/index.js";
import { sessionKey } from "../src/server/auth.js";
import { feedbackInputSchema } from "../src/core/feedback.js";
import type { DeepTask } from "../src/core/deep.js";
import type { Market } from "../src/core/types.js";

test("the browser API accepts an empty saved record and preserves HTTP errors with a null body", async () => {
  const originalFetch = globalThis.fetch;
  const documentProperty = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { documentElement: { lang: "en" }, querySelector: () => null },
  });
  try {
    const { api } = await import("../src/web/api.js");
    globalThis.fetch = async () => new Response("null", { status: 200 });
    assert.equal(await api("/api/feedback/report/0000000000000001"), null);
    globalThis.fetch = async () => new Response("null", { status: 403 });
    await assert.rejects(
      api("/api/feedback/report/0000000000000001"),
      (error: any) => error.status === 403,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (documentProperty)
      Object.defineProperty(globalThis, "document", documentProperty);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("saved feedback deduplicates people, survives reopen and preserves decision time when notes change", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-feedback-"));
  let store = new Store(dir);
  const now = Date.parse("2026-09-19T12:00:00Z"),
    old = "2026-09-01T12:00:00Z",
    recent = new Date(now).toISOString();
  try {
    const first = store.saveFeedback(
      "alice",
      "report",
      "0000000000000001",
      { status: "chosen", note: "Original choice" },
      "17",
      false,
      old,
    );
    store.saveFeedback(
      "alice",
      "report",
      "0000000000000001",
      { status: "chosen", note: "Added detail" },
      "17",
      false,
      recent,
    );
    assert.equal(
      store.feedback("alice", "report", "0000000000000001")!.statusAt,
      first.statusAt,
    );
    assert.equal(store.feedbackOverview(7, now).decisionUsers, 0);
    store.saveFeedback(
      "alice",
      "report",
      "0000000000000001",
      { status: "tested", note: "Ran the pilot" },
      "17",
      false,
      recent,
    );
    store.saveFeedback(
      "alice",
      "deep",
      "0000000000000002",
      { status: "adjusted", note: "Cut the scope" },
      "7",
      false,
      recent,
    );
    store.saveFeedback(
      "bob",
      "report",
      "0000000000000001",
      { status: "helpful", note: "Helpful" },
      "17",
      false,
      recent,
    );
    store.saveFeedback(
      "admin",
      "report",
      "0000000000000001",
      { status: "tested", note: "Internal fixture" },
      "17",
      true,
      recent,
    );
    const identical = store.saveFeedback(
      "alice",
      "report",
      "0000000000000001",
      { status: "tested", note: "Ran the pilot" },
      "17",
      false,
      "2026-09-20T12:00:00Z",
    );
    assert.equal(identical.updated, recent);
    store.close();
    store = new Store(dir);
    const overview = store.feedbackOverview(7, now);
    assert.equal(overview.users, 2);
    assert.equal(overview.responses, 3);
    assert.equal(overview.decisionUsers, 1);
    assert.equal(overview.internalResponses, 1);
    assert.ok(
      overview.recent.every(
        (r) => r.note !== "Internal fixture" && !("owner" in r),
      ),
    );
    assert.equal(store.feedbackHistory("alice").length, 2);
    store.removeHistory("alice", "0000000000000001");
    assert.equal(store.feedback("alice", "report", "0000000000000001"), null);
    assert.equal(store.feedbackHistory("bob").length, 1);
    assert.equal(store.feedbackOverview(7, now).decisionUsers, 1);
    store.removeFeedback("alice", "deep", "0000000000000002");
    assert.equal(store.feedbackOverview(7, now).decisionUsers, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("feedback validates the authored note and rejects identity or metric overrides", () => {
  assert.deepEqual(
    feedbackInputSchema.parse({
      status: "specific",
      note: "  原文链接\n请补充投入范围。  ",
    }),
    { status: "specific", note: "原文链接\n请补充投入范围。" },
  );
  for (const body of [
    { status: "fake" },
    { status: "helpful", owner: "another" },
    { status: "tested", internal: false },
    { status: "chosen", statusAt: "2020-01-01" },
    { status: "helpful", note: "x".repeat(501) },
    { status: "specific", note: "bad\0control" },
  ])
    assert.equal(feedbackInputSchema.safeParse(body).success, false);
});

test("feedback APIs enforce ownership, CSRF and private exports; public report sharing keeps notes private", async () => {
  const env = { ...process.env },
    dir = mkdtempSync(join(tmpdir(), "ghtrends-feedback-api-"));
  Object.assign(process.env, {
    GHTRENDS_HOSTED: "1",
    PUBLIC_URL: "https://radar.example",
    GHTRENDS_ADMIN_USER_IDS: "admin",
  });
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DECODO_API_KEY;
  const engine = new Engine(new Store(dir));
  const market: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  market.id = "ab00000000000001";
  engine.store.saveMarket(market, false, "alice");
  engine.store.addHistory("alice", market.id, "Private idea");
  const headers = Object.fromEntries(
    ["alice", "bob", "admin"].map((owner) => {
      const token = randomBytes(32).toString("base64url");
      engine.store.set(
        sessionKey(token),
        { id: owner, name: owner, csrf: owner },
        60000,
      );
      return [
        owner,
        {
          cookie: `__Host-ghtrends_session=${token}`,
          "X-CSRF-Token": owner,
          Origin: "https://radar.example",
          "Content-Type": "application/json",
        },
      ];
    }),
  );
  const app = createApp(engine),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = (
    path: string,
    owner = "alice",
    method = "GET",
    body?: unknown,
    extra = {},
  ) =>
    fetch(base + path, {
      method,
      headers: { ...headers[owner], ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const path = `/api/feedback/report/${market.id}`,
    body = {
      status: "chosen",
      note: "private-feedback-only: I chose a plugin",
    };
  try {
    for (const url of [path, "/api/account/feedback"])
      assert.equal((await fetch(base + url)).status, 401);
    assert.equal((await call(path, "bob", "POST", body)).status, 404);
    assert.equal(
      (await call(path, "alice", "POST", body, { "X-CSRF-Token": "bad" }))
        .status,
      403,
    );
    assert.equal(
      (
        await call(path, "alice", "POST", body, {
          Origin: "https://elsewhere.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await call(path, "alice", "POST", { ...body, owner: "bob" })).status,
      400,
    );
    const response = await call(path, "alice", "POST", body),
      saved = await response.json();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(saved.note, body.note);
    assert.equal(saved.owner, undefined);
    assert.deepEqual(
      await (await call(path, "alice", "POST", body)).json(),
      saved,
    );
    assert.deepEqual(
      await (await call("/api/account/feedback", "bob")).json(),
      [],
    );
    const download = await call("/api/account/feedback?format=json");
    assert.match(download.headers.get("content-disposition")!, /attachment/);
    assert.equal((await download.json()).length, 1);
    engine.store.shareReport("alice", market.id, true);
    for (const suffix of [
      `/api/reports/${market.id}`,
      `/api/reports/${market.id}?format=md`,
      `/report/${market.id}`,
    ]) {
      const text = await (await fetch(base + suffix)).text();
      assert.ok(!text.includes("private-feedback-only"));
    }
    assert.equal(await (await call(path, "bob")).json(), null);
    await call(path, "bob", "POST", {
      status: "helpful",
      note: "Bob's response",
    });
    await call(path, "admin", "POST", { status: "tested", note: "Test only" });
    assert.equal((await call("/api/admin", "bob")).status, 403);
    const overview = (await (await call("/api/admin", "admin")).json())
      .feedback;
    assert.equal(overview.decisionUsers, 1);
    assert.equal(overview.internalResponses, 1);
    assert.ok(overview.recent.some((r: any) => r.note === body.note));
    await call(path, "bob", "DELETE");
    assert.equal((await (await call(path)).json()).note, body.note);
    engine.store.shareReport("alice", market.id, false);
    await call(path, "bob", "DELETE"); // Idempotent own deletion even after visibility changed.
    const usage = engine.store.usage("alice");
    for (let i = 0; i < 31; i++) await call(path, "alice", "POST", body);
    assert.equal((await call(path, "alice", "POST", body)).status, 429);
    assert.equal(engine.store.usage("alice"), usage);
    assert.equal((await call(path, "alice", "DELETE")).status, 200);
    assert.equal(await (await call(path)).json(), null);
    assert.equal(
      (await call("/api/feedback/report/invalid", "alice", "POST", body))
        .status,
      400,
    );
    const task: DeepTask = {
      id: "ab00000000000002",
      owner: "alice",
      title: { en: "Focused task", zh: "专项任务" },
      request: {
        reportId: market.id,
        directionId: "plugin",
        question: "scope",
        context: "",
        requestKey: randomUUID(),
      },
      model: "fixture",
      geo: "US",
      version: "7",
      state: "complete",
      stage: "complete",
      attempts: 1,
      credit: "used",
      funding: "trial",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    engine.store.createDeepTask(task, "fixture", false);
    const deepPath = `/api/feedback/deep/${task.id}`;
    assert.equal((await call(deepPath, "bob", "POST", body)).status, 404);
    engine.store.set(
      "feedback-writes:alice",
      { count: 0, until: Date.now() + 60000 },
      60000,
    );
    const deepResponse = await call(deepPath, "alice", "POST", {
      status: "tested",
      note: "Completed a test",
    });
    assert.equal(deepResponse.status, 200);
    const deepFeedback = await deepResponse.json();
    assert.equal(deepFeedback.method, "7");
    assert.equal(deepFeedback.status, "tested");
    assert.equal(engine.store.usage("alice"), usage);
    engine.store.removeDeepTask(task.id, "alice");
    assert.equal(engine.store.feedback("alice", "deep", task.id), null);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
    process.env = env;
  }
});
