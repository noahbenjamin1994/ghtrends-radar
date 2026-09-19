import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../src/core/store.js";
import { Engine } from "../src/core/engine.js";
import { createApp } from "../src/server/index.js";
import { sessionKey } from "../src/server/auth.js";
import { operationContext, estimatedCost } from "../src/core/operations.js";
import { Research } from "../src/providers/research.js";

function restore(env: NodeJS.ProcessEnv) {
  for (const k of Object.keys(process.env))
    if (!(k in env)) delete process.env[k];
  Object.assign(process.env, env);
}
test("administrator access uses server-configured subject IDs; names, session role flags and private ownership do not grant privileges", async () => {
  const env = { ...process.env },
    dir = mkdtempSync(join(tmpdir(), "ghtrends-admin-"));
  Object.assign(process.env, {
    GHTRENDS_HOSTED: "1",
    PUBLIC_URL: "https://radar.example",
    GHTRENDS_ADMIN_USER_IDS: " admin-sub , another-sub ",
    DEEPSEEK_API_KEY: "must-not-disclose-test-key",
  });
  const engine = new Engine(new Store(dir)),
    sid = randomBytes(32).toString("base64url"),
    other = randomBytes(32).toString("base64url");
  engine.store.set(
    sessionKey(sid),
    { id: "admin-sub", name: "Admin", csrf: "secret-csrf" },
    60000,
  );
  engine.store.set(
    sessionKey(other),
    { id: "attacker", name: "Admin", isAdmin: true, csrf: "x" },
    60000,
  );
  const server = createApp(engine).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (path: string, token?: string) =>
    fetch(base + path, {
      headers: token ? { cookie: `__Host-ghtrends_session=${token}` } : {},
    });
  try {
    assert.equal((await get("/api/admin")).status, 401);
    assert.equal((await get("/api/admin", other)).status, 403);
    assert.equal(
      (await (await get("/api/account", other)).json()).user.isAdmin,
      false,
    );
    const response = await get("/api/admin", sid),
      text = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.match(response.headers.get("vary")!, /Cookie/);
    assert.ok(
      !text.includes("must-not-disclose-test-key") &&
        !text.includes("secret-csrf") &&
        !text.includes(sid),
    );
    const data = JSON.parse(text);
    assert.deepEqual(data.researchPayments, {
      pending: 0,
      attention: 0,
      items: [],
    });
    assert.deepEqual(data.models, []);
    assert.deepEqual(data.configuration.adminUserIds, [
      "admin-sub",
      "another-sub",
    ]);
    assert.equal((await get("/api/admin?state=invalid", sid)).status, 400);
    assert.match(await (await get("/admin", sid)).text(), /noindex/);
    // Existing sessions lose permission when the server allowlist is changed.
    process.env.GHTRENDS_ADMIN_USER_IDS = "another-sub";
    assert.equal((await get("/api/admin", sid)).status, 403);
    assert.equal(
      (await (await get("/api/account", sid)).json()).user.isAdmin,
      false,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
    restore(env);
  }
});

test("operational history survives reopen, distinguishes unknown usage and records interrupted work", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-ops-"));
  let store = new Store(dir);
  try {
    const created = new Date().toISOString();
    store.startRun({
      id: "run1",
      input: "science",
      userId: "alice",
      geo: "",
      background: false,
      created,
    });
    store.updateRun("run1", "running");
    operationContext.run({ runId: "run1", userId: "alice" }, () =>
      store.recordCall({
        provider: "deepseek",
        operation: "plan",
        started: created,
        durationMs: 25,
        model: "test",
        status: 504,
        error: "http_504",
      }),
    );
    store.close();
    store = new Store(dir);
    store.interruptRuns();
    const data = store.adminOverview(1, 0, "");
    assert.equal(data.runs[0]!.state, "interrupted");
    assert.equal(data.runs[0]!.estimated_usd, null);
    assert.equal(data.models[0]!.inputTokens, null);
    assert.equal(data.models[0]!.unknownUsage, 1);
    assert.equal(data.models[0]!.unpriced, 1);
    assert.equal(data.recentErrors[0]!.run_id, "run1");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("provider-reported tokens are counted even when JSON validation fails; costs keep cache and off-peak rates separate", async () => {
  const env = { ...process.env },
    dir = mkdtempSync(join(tmpdir(), "ghtrends-usage-")),
    store = new Store(dir),
    oldFetch = globalThis.fetch;
  Object.assign(process.env, {
    DEEPSEEK_API_KEY: "test",
    DEEPSEEK_MODEL: "deepseek-flash",
    GHTRENDS_LLM_PRICING_JSON: JSON.stringify({
      "deepseek-flash": {
        input: 0.3,
        cachedInput: 0.006,
        output: 1.2,
        offPeakMultiplier: 0.5,
      },
    }),
  });
  const usage = {
    prompt_tokens: 1000,
    completion_tokens: 100,
    prompt_cache_hit_tokens: 400,
  };
  try {
    assert.equal(
      estimatedCost("deepseek-flash", usage, "2026-09-15T02:00:00Z"),
      0.0003024,
    );
    assert.equal(
      estimatedCost("deepseek-flash", usage, "2026-09-15T05:00:00Z"),
      0.0001512,
    );
    assert.equal(
      estimatedCost("other", usage, "2026-09-15T02:00:00Z"),
      undefined,
    );
    assert.equal(
      estimatedCost(
        "deepseek-flash",
        { ...usage, prompt_cache_hit_tokens: 2000 },
        "2026-09-15T02:00:00Z",
      ),
      undefined,
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          model: "deepseek-flash",
          usage,
          choices: [
            { finish_reason: "stop", message: { content: "invalid JSON" } },
          ],
        }),
        { status: 200 },
      );
    await assert.rejects(
      new Research(store).json("test", {}),
      /could not be validated/,
    );
    const row = store.adminOverview(1, 0, "").models[0]!;
    assert.equal(row.inputTokens, 1000);
    assert.equal(row.outputTokens, 100);
    assert.equal(row.reasoningTokens, 0);
    assert.equal(row.reasoningPending, 0);
    assert.equal(row.cachedTokens, 400);
    assert.equal(row.unknownUsage, 0);
    assert.ok(Number(row.estimatedUsd) > 0);
    assert.equal(
      store.adminOverview(1, 0, "").recentErrors[0]!.error,
      "invalid_response",
    );
  } finally {
    globalThis.fetch = oldFetch;
    store.close();
    rmSync(dir, { recursive: true, force: true });
    restore(env);
  }
});
