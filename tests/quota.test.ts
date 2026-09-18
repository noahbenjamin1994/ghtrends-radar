import { resolveTopic } from "../src/core/topics.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { Store } from "../src/core/store.js";
import { Engine } from "../src/core/engine.js";
import { createApp } from "../src/server/index.js";
import { sessionKey } from "../src/server/auth.js";
import type { Market, Repo } from "../src/core/types.js";

const seed: Market = JSON.parse(
  readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
)[0];

test("credits reserve atomically, refund once against the original day, and recover interrupted work", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-credits-"));
  const store = new Store(dir);
  const db = new DatabaseSync(join(dir, "ghtrends.sqlite"));
  try {
    assert.equal(store.reserveUsage("a", "alice", "scan", 1, 10), "reserved");
    assert.equal(store.reserveUsage("b", "alice", "repo", 1, 10), "daily");
    store.settleUsage("a", false);
    store.settleUsage("a", false);
    assert.equal(store.usage("alice"), 0);
    assert.equal(
      store.reserveUsage("c", "alice", "compare", 1, 10),
      "reserved",
    );
    store.settleUsage("c", true);
    store.settleUsage("c", false);
    assert.equal(store.usage("alice"), 1);
    db.prepare("INSERT INTO usage_daily VALUES('bob','2000-01-01',1)").run();
    db.prepare(
      "INSERT INTO usage_reservations VALUES('old','bob','2000-01-01','scan','reserved','2000-01-01')",
    ).run();
    assert.equal(store.reserveUsage("new", "bob", "scan", 2, 10), "reserved");
    store.settleUsage("old", false);
    assert.equal(store.usage("bob", "2000-01-01"), 0);
    assert.equal(store.usage("bob"), 1);
    store.interruptRuns();
    store.interruptRuns();
    assert.equal(store.usage("bob"), 0);
    assert.equal(store.usage("alice"), 1);
    assert.equal(store.allowance("alice", 10).remaining, 9);
    assert.equal(
      new Date(store.allowance("alice", 10).resetAt).getUTCHours(),
      0,
    );
    for (let i = 0; i < 3; i++) {
      assert.equal(
        store.reserveUsage("retry" + i, "charlie", "scan", 1, 10),
        "reserved",
      );
      store.settleUsage("retry" + i, false);
    }
    assert.equal(
      store.reserveUsage("retry4", "charlie", "scan", 1, 10),
      "attempts",
    );
    assert.equal(
      store.reserveUsage("capacity", "dave", "scan", 10, 1),
      "capacity",
    );
  } finally {
    db.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function hosted(
  run: (ctx: {
    engine: Engine;
    get: (p: string, auth?: boolean) => Promise<Response>;
    post: (
      p: string,
      body: unknown,
      auth?: boolean,
      csrf?: string,
    ) => Promise<Response>;
  }) => Promise<void>,
) {
  const previous = { ...process.env };
  process.env.GHTRENDS_HOSTED = "1";
  process.env.PUBLIC_URL = "https://radar.example";
  process.env.GHTRENDS_DAILY_SCANS = "2";
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.GHTRENDS_AUTO_COLLECT;
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-quota-api-")),
    engine = new Engine(new Store(dir));
  const sid = randomBytes(32).toString("base64url");
  engine.store.set(
    sessionKey(sid),
    { id: "alice", name: "Alice", csrf: "csrf" },
    60000,
  );
  const server = createApp(engine).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = (auth = true, csrf = "csrf") => ({
    "Content-Type": "application/json",
    Origin: "https://radar.example",
    ...(auth
      ? { Cookie: `__Host-ghtrends_session=${sid}`, "X-CSRF-Token": csrf }
      : {}),
  });
  try {
    await run({
      engine,
      get: (p, auth = true) => fetch(base + p, { headers: headers(auth) }),
      post: (p, body, auth = true, csrf = "csrf") =>
        fetch(base + p, {
          method: "POST",
          headers: headers(auth, csrf),
          body: JSON.stringify(body),
        }),
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
    process.env = previous;
  }
}

test("public reads trigger zero collection; explicit research shares one quota across repo and compare", async () =>
  hosted(async ({ engine, get, post }) => {
    let calls = 0;
    engine.github.repo = async (name) => {
      calls++;
      const r = { ...seed.supply.repositories[0]!, name, errors: [] } as Repo;
      engine.store.set("repo:" + name + ":true", r, 60000);
      return r;
    };
    for (const path of [
      "/api/repo?name=a/one",
      "/api/compare?repos=a/one,b/two",
    ]) {
      assert.equal((await get(path, false)).status, 401);
      assert.equal((await get(path)).status, 409);
    }
    assert.equal(
      (await post("/api/repo", { name: "a/one" }, false)).status,
      401,
    );
    assert.equal(
      (await post("/api/repo", { name: "a/one" }, true, "wrong")).status,
      403,
    );
    assert.equal(
      (await post("/api/compare", { repos: ["a/one", "a/one"] })).status,
      400,
    );
    assert.equal(calls, 0);
    assert.equal((await post("/api/repo", { name: "a/one" })).status, 200);
    assert.equal((await get("/api/repo?name=a/one", false)).status, 200);
    assert.equal((await post("/api/repo", { name: "a/one" })).status, 200);
    assert.equal(engine.store.usage("alice"), 1);
    assert.equal(
      (await post("/api/compare", { repos: ["b/two", "c/three"] })).status,
      200,
    );
    assert.equal(engine.store.usage("alice"), 2);
    const limit = await post("/api/repo", { name: "d/four" });
    assert.equal(limit.status, 429);
    assert.ok(limit.headers.get("retry-after"));
    assert.equal(calls, 3);
    const account = await (await get("/api/account")).json();
    assert.equal(account.quota.remaining, 0);
    assert.ok(account.quota.resetAt);
    assert.equal((await get("/api/account", false)).status, 200);
    assert.equal((await (await get("/api/account", false)).json()).quota, null);
  }));

test("failed and partial scans return credits; cooldown blocks costly normalization; success reopens free", async () =>
  hosted(async ({ engine, get, post }) => {
    let calls = 0;
    const fresh = () => {
      const m = structuredClone(seed);
      m.id = "0123456789abcdef";
      m.asOf =
        m.demand.fetchedAt =
        m.supply.fetchedAt =
          new Date().toISOString();
      delete m.demand.error;
      delete m.demand.collectionError;
      delete m.supply.error;
      delete m.aiError;
      return m;
    };
    engine.scan = async () => {
      calls++;
      throw new Error("Source needs a refresh.");
    };
    let r = await (await post("/api/scan", { topic: "mcp-server" })).json();
    let job = await (await get("/api/jobs/" + r.id)).json();
    assert.equal(job.state, "failed");
    assert.equal(job.credit, "returned");
    assert.equal(engine.store.usage("alice"), 0);
    engine.scan = async () => {
      calls++;
      const m = fresh();
      m.demand.error = "Source needs a refresh.";
      return m;
    };
    r = await (await post("/api/scan", { topic: "mcp-server" })).json();
    job = await (await get("/api/jobs/" + r.id)).json();
    assert.equal(job.credit, "returned");
    assert.equal(engine.store.usage("alice"), 0);
    engine.store.set(
      "trends:cooldown:v1",
      { until: Date.now() + 60000 },
      60000,
    );
    assert.equal(
      (await post("/api/scan", { topic: "mcp-server" })).status,
      503,
    );
    assert.equal(calls, 2);
    assert.equal(engine.store.usage("alice"), 0);
    engine.store.take("trends:cooldown:v1");
    engine.scan = async () => {
      calls++;
      const m = fresh();
      engine.store.saveMarket(m, false, "alice");
      return m;
    };
    r = await (await post("/api/scan", { topic: "mcp-server" })).json();
    job = await (await get("/api/jobs/" + r.id)).json();
    assert.equal(job.credit, "used");
    assert.equal(engine.store.usage("alice"), 1);
    r = await (await post("/api/scan", { topic: "mcp-server" })).json();
    assert.equal(r.credit, "free");
    assert.equal(r.state, "complete");
    assert.equal(calls, 3);
    assert.equal(engine.store.usage("alice"), 1);
  }));

test("overlapping fresh research is bounded and a provider exception returns its reservation", async () =>
  hosted(async ({ engine, get, post }) => {
    let release!: () => void;
    const pending = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const started = new Promise<void>((r) => (entered = r));
    engine.github.repo = async () => {
      entered();
      await pending;
      throw new Error("Source needs a refresh.");
    };
    const first = post("/api/repo", { name: "a/one" });
    await started;
    assert.equal((await post("/api/repo", { name: "b/two" })).status, 429);
    assert.equal((await (await get("/api/account")).json()).quota.remaining, 1);
    release();
    assert.equal((await first).status, 502);
    assert.equal(engine.store.usage("alice"), 0);
  }));

test("partial project evidence returns its credit while keeping the useful result", async () =>
  hosted(async ({ engine, post }) => {
    engine.github.repo = async (name) => ({
      ...seed.supply.repositories[0]!,
      name,
      errors: ["GitHub returned HTTP 503."],
    });
    const response = await post("/api/repo", { name: "a/one" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-research-credit"), "returned");
    assert.equal(engine.store.usage("alice"), 0);
    assert.equal((await response.json()).name, "a/one");
  }));

test("AI research remains available during source cooldown within attempt limits and returns partial-evidence credits", async () =>
  hosted(async ({ engine, get, post }) => {
    (engine.research as any).enabled = true;
    engine.research.plan = async (input) => resolveTopic(input);
    engine.store.set(
      "trends:cooldown:v1",
      { until: Date.now() + 60000 },
      60000,
    );
    let calls = 0;
    engine.scan = async () => {
      calls++;
      const m = structuredClone(seed);
      m.id = "fedcba9876543210";
      m.demand.error = "Collection pending";
      m.demand.points = [];
      m.kind = "uncertain";
      engine.store.saveMarket(m, false, "alice");
      return m;
    };
    for (let i = 0; i < 6; i++) {
      const response = await post("/api/scan", { topic: "new idea " + i });
      assert.equal(response.status, 202);
      const run = await response.json();
      const job = await (await get("/api/jobs/" + run.id)).json();
      assert.equal(job.state, "complete");
      assert.equal(job.credit, "returned");
      assert.equal(engine.store.usage("alice"), 0);
    }
    assert.equal(
      (await post("/api/scan", { topic: "another idea" })).status,
      429,
    );
    assert.equal(calls, 6);
    assert.equal(
      (await post("/api/scan", { topic: "guest idea" }, false)).status,
      401,
    );
  }));

test("search failures return credits and a retry never reopens an incomplete cached scan", async () =>
  hosted(async ({ engine, get, post }) => {
    (engine.research as any).enabled = true;
    Object.defineProperty(engine.search, "enabled", { value: true });
    let calls = 0;
    engine.scan = async () => {
      const m = structuredClone(seed);
      m.id = (++calls).toString(16).padStart(16, "0");
      m.asOf =
        m.demand.fetchedAt =
        m.supply.fetchedAt =
          new Date().toISOString();
      delete m.demand.error;
      delete m.demand.collectionError;
      delete m.supply.error;
      delete m.aiError;
      m.web = {
        provider: "google-mobile",
        region: "US",
        language: "en",
        fetchedAt: m.asOf,
        state: calls === 1 ? "failed" : "ready",
        queries: [
          {
            query: "sample pricing",
            intent: "competition",
            state: calls === 1 ? "failed" : "ready",
            results: [],
          },
        ],
      };
      engine.store.saveMarket(m, false, "alice");
      return m;
    };
    let r = await (await post("/api/scan", { topic: "AI4S" })).json();
    let job = await (await get("/api/jobs/" + r.id)).json();
    assert.equal(job.credit, "returned");
    assert.equal(engine.store.usage("alice"), 0);
    r = await (await post("/api/scan", { topic: "AI4S" })).json();
    job = await (await get("/api/jobs/" + r.id)).json();
    assert.equal(job.credit, "used");
    assert.equal(calls, 2);
    assert.equal(engine.store.usage("alice"), 1);
    r = await (await post("/api/scan", { topic: "AI4S" })).json();
    assert.equal(r.credit, "free");
    assert.equal(calls, 2);
  }));
