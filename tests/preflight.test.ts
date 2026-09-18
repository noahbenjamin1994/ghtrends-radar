import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import { Engine } from "../src/core/engine.js";
import { resolveTopic } from "../src/core/topics.js";
import { inspectInput } from "../src/core/preflight.js";
import { createApp } from "../src/server/index.js";
import { sessionKey } from "../src/server/auth.js";
import type { Market } from "../src/core/types.js";

test("entity aliases preserve unusual identifiers and isolate dictionary prototype keys", () => {
  assert.equal(resolveTopic("__proto__").keyword, "JavaScript __proto__");
  assert.equal(resolveTopic("constructor").name, "constructor");
  assert.equal(resolveTopic("vvvv").keyword, "vvvv visual programming");
});

test("100 reviewed input cases preserve numeric brands and niche ideas while guiding greetings and ambiguity", () => {
  const cases: { input: string; expected: string }[] = JSON.parse(
    readFileSync(
      new URL("./fixtures/research-inputs.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(cases.length, 100);
  for (const c of cases)
    assert.equal(inspectInput(c.input)?.status || "ready", c.expected, c.input);
});

async function setup(
  run: (ctx: {
    engine: Engine;
    post: (
      path: string,
      body: unknown,
      user?: string,
      csrf?: string,
    ) => Promise<Response>;
    get: (path: string, user?: string) => Promise<Response>;
  }) => Promise<void>,
) {
  const env = { ...process.env };
  process.env.GHTRENDS_HOSTED = "1";
  process.env.PUBLIC_URL = "https://radar.example";
  process.env.GHTRENDS_DAILY_SCANS = "2";
  delete process.env.GHTRENDS_AUTO_COLLECT;
  delete process.env.DEEPSEEK_API_KEY;
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-preflight-"));
  const engine = new Engine(new Store(dir));
  const sessions = new Map<string, string>();
  for (const id of ["alice", "bob"]) {
    const sid = randomBytes(32).toString("base64url");
    sessions.set(id, sid);
    engine.store.set(sessionKey(sid), { id, name: id, csrf: "csrf" }, 60000);
  }
  const server = createApp(engine).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = (user: string, csrf = "csrf") => ({
    "Content-Type": "application/json",
    Origin: "https://radar.example",
    Cookie: `__Host-ghtrends_session=${sessions.get(user) || ""}`,
    "X-CSRF-Token": csrf,
  });
  try {
    await run({
      engine,
      post: (path, body, user = "alice", csrf = "csrf") =>
        fetch(base + path, {
          method: "POST",
          headers: headers(user, csrf),
          body: JSON.stringify(body),
        }),
      get: (path, user = "alice") =>
        fetch(base + path, { headers: headers(user) }),
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
    process.env = env;
  }
}

test("preflight protects authentication and CSRF; guidance spends zero source calls and credits", async () =>
  setup(async ({ engine, post }) => {
    let plans = 0;
    engine.research.plan = async () => {
      plans++;
      return resolveTopic("mcp");
    };
    assert.equal(
      (await post("/api/preflight", { topic: "mcp" }, "guest")).status,
      401,
    );
    assert.equal(
      (await post("/api/preflight", { topic: "mcp" }, "alice", "wrong")).status,
      403,
    );
    for (const body of [
      { topic: "mcp", keyword: {} },
      { topic: "mcp", geo: "usa" },
      { topic: "<script>" },
      { topic: "x".repeat(301) },
    ])
      assert.equal((await post("/api/preflight", body)).status, 400);
    for (const topic of ["你好", "123", "RSI"]) {
      const response = await post("/api/preflight", { topic });
      assert.equal(response.status, 200);
      assert.ok(["guide", "clarify"].includes((await response.json()).status));
      assert.equal((await post("/api/scan", { topic })).status, 422);
    }
    assert.equal(plans, 0);
    assert.equal(engine.store.usage("alice"), 0);
    assert.equal(engine.store.adminOverview(1, 0, "").runCount, 0);
  }));

test("identical preparations share one plan, preserve owner/region/keyword, and reuse the confirmed plan", async () =>
  setup(async ({ engine, post, get }) => {
    let plans = 0,
      scans = 0;
    let release!: () => void;
    const waiting = new Promise<void>((r) => {
      release = r;
    });
    const topic = resolveTopic("mcp", "MCP tools");
    engine.research.plan = async () => {
      plans++;
      await waiting;
      return topic;
    };
    const payload = { topic: "MCP tools", keyword: "MCP tools", geo: "US" };
    const a = post("/api/preflight", payload),
      b = post("/api/preflight", payload);
    await new Promise((r) => setTimeout(r, 20));
    release();
    const [first, second] = await Promise.all([a, b]);
    const scope = await first.json();
    assert.equal(scope.id, (await second.json()).id);
    assert.equal(plans, 1);
    assert.equal(engine.store.usage("alice"), 0);
    assert.equal(
      (await post("/api/scan", { ...payload, preflightId: scope.id }, "bob"))
        .status,
      409,
    );
    assert.equal(
      (
        await post("/api/scan", {
          ...payload,
          geo: "JP",
          preflightId: scope.id,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post("/api/scan", {
          ...payload,
          keyword: "changed",
          preflightId: scope.id,
        })
      ).status,
      409,
    );
    engine.scan = async (input, options) => {
      scans++;
      assert.equal(input, payload.topic);
      assert.deepEqual(options?.preparedTopic, topic);
      const market: Market = JSON.parse(
        readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
      )[0];
      market.id = "1234567890abcdef";
      market.demand.error = "Source refresh needed";
      return market;
    };
    const result = await post("/api/scan", {
      ...payload,
      preflightId: scope.id,
      preparedTopic: { keyword: "injected" },
    });
    assert.equal(result.status, 202);
    const job = await result.json();
    const completed = await (await get("/api/jobs/" + job.id)).json();
    assert.equal(completed.credit, "returned");
    assert.equal(plans, 1);
    assert.equal(scans, 1);
    assert.equal(engine.store.usage("alice"), 0);
    const overview = engine.store.adminOverview(1, 0, "");
    assert.equal(overview.runCount, 2);
    assert.equal(
      (overview.engagement.scans as { count: number }[]).reduce(
        (n, row) => n + row.count,
        0,
      ),
      1,
    );
  }));

test("semantic clarification stays before reservation and keeps actionable choices", async () =>
  setup(async ({ engine, post }) => {
    engine.research.plan = async () => {
      throw Object.assign(new Error("Choose a meaning"), {
        status: 422,
        choices: [
          { label: "Game", query: "game tools" },
          { label: "Music", query: "music tools" },
        ],
        clarification: { en: "Which meaning?", zh: "你想研究哪个含义？" },
      });
    };
    const response = await post("/api/scan", {
      topic: "a new ambiguous phrase",
    });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.guidance.status, "clarify");
    assert.equal(body.choices.length, 2);
    assert.equal(engine.store.usage("alice"), 0);
  }));

test("model outages return an original-phrase scope for explicit confirmation, including Chinese and safe quoted queries", async () =>
  setup(async ({ engine, post }) => {
    engine.research.plan = async () => {
      throw new Error("upstream timeout");
    };
    let scans = 0;
    engine.scan = async () => {
      scans++;
      throw new Error("source refresh needed");
    };
    const payload = { topic: '猫语工具 "OR" stars:0' };
    const scope = await (await post("/api/preflight", payload)).json();
    assert.equal(scope.status, "ready");
    assert.equal(scope.fallback, true);
    assert.equal(scope.topic.scope, "field");
    assert.equal(
      scope.topic.query,
      '"猫语工具 OR stars 0" in:name,description',
    );
    assert.equal((await post("/api/scan", payload)).status, 409);
    assert.equal(scans, 0);
    assert.equal(
      (await post("/api/scan", { ...payload, preflightId: scope.id })).status,
      202,
    );
    assert.equal(scans, 1);
    assert.equal(engine.store.usage("alice"), 0);
    engine.store.set(
      "prepared-scope:" + scope.id,
      { owner: "alice", result: scope },
      -1,
    );
    assert.equal(
      (await post("/api/scan", { ...payload, preflightId: scope.id })).status,
      409,
    );
  }));

test("preparation budget is persistent and independent of research quota", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-preparation-budget-"));
  let store = new Store(dir);
  try {
    for (let i = 0; i < 10; i++)
      assert.equal(store.consumePreparationBudget("alice").allowed, true);
    assert.equal(store.consumePreparationBudget("alice").allowed, false);
    assert.equal(store.usage("alice"), 0);
    store.close();
    store = new Store(dir);
    assert.equal(store.consumePreparationBudget("alice").allowed, false);
    assert.equal(store.consumePreparationBudget("bob").allowed, true);
    assert.equal(
      store.reserveUsage("research", "alice", "scan", 1, 10),
      "reserved",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
