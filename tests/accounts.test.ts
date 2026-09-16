import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/server/index.js";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import { sessionKey, safeReturnPath } from "../src/server/auth.js";
import type { Market } from "../src/core/types.js";

test("hosted accounts isolate history, watchlists, jobs and every private report representation", async () => {
  const env = { ...process.env },
    directory = mkdtempSync(join(tmpdir(), "ghtrends-accounts-"));
  process.env.GHTRENDS_HOSTED = "1";
  process.env.PUBLIC_URL = "https://radar.example";
  delete process.env.DEEPSEEK_API_KEY;
  const engine = new Engine(new Store(directory));
  const m: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  m.id = "abc123abc123abc1";
  m.asOf = new Date().toISOString();
  const publicCopy = structuredClone(m);
  publicCopy.id = "abc123abc123abc2";
  publicCopy.asOf = "2026-01-01T00:00:00Z";
  engine.store.saveMarket(publicCopy, true);
  engine.store.saveMarket(m, false, "alice");
  engine.store.addHistory("alice", m.id, "private research");
  const sidA = randomBytes(32).toString("base64url"),
    sidB = randomBytes(32).toString("base64url");
  const headers = (sid: string, csrf: string) => ({
    Cookie: `__Host-ghtrends_session=${sid}`,
    "X-CSRF-Token": csrf,
    "Content-Type": "application/json",
    Origin: "https://radar.example",
  });
  const alice = headers(sidA, "csrf-a"),
    bob = headers(sidB, "csrf-b");
  engine.store.set(
    sessionKey(sidA),
    { id: "alice", name: "Alice", csrf: "csrf-a" },
    60000,
  );
  engine.store.set(
    sessionKey(sidB),
    { id: "bob", name: "Bob", csrf: "csrf-b" },
    60000,
  );
  engine.store.set(
    "job:private-job",
    { id: "private-job", owner: "alice", state: "complete", market: m },
    60000,
  );
  const server = createApp(engine).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (path: string, h?: typeof alice) =>
    fetch(base + path, { headers: h });
  const post = (path: string, body: unknown, h?: typeof alice) =>
    fetch(base + path, {
      method: "POST",
      headers: h || { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    for (const path of ["/api/history", "/api/watch"])
      assert.equal((await get(path)).status, 401);
    assert.equal((await post("/api/scan", { topic: "ai4s" })).status, 401);
    for (const path of [
      `/api/reports/${m.id}`,
      `/api/reports/${m.id}?format=md`,
      `/api/reports/${m.id}/access`,
      `/api/cards/${m.id}.svg`,
      `/api/cards/${m.id}.png`,
      `/report/${m.id}`,
      "/api/jobs/private-job",
    ]) {
      const anonymous = await get(path);
      assert.equal(anonymous.status, 404, path);
      assert.match(
        anonymous.headers.get("cache-control") || "",
        /no-store|private/,
      );
      assert.equal((await get(path, bob)).status, 404, path + " other account");
      const own = await get(path, alice);
      assert.equal(own.status, 200, path + " owner");
      assert.match(own.headers.get("cache-control") || "", /private|no-store/);
    }
    const html = await (await get(`/report/${m.id}`, alice)).text();
    assert.match(html, /noindex/);
    const publicLatest = await (
      await get("/api/markets/" + m.topic.slug)
    ).json();
    assert.notEqual(publicLatest.id, m.id);
    assert.ok(
      !JSON.stringify(await (await get("/api/markets")).json()).includes(m.id),
    );
    assert.equal((await (await get("/api/history", alice)).json()).length, 1);
    assert.equal(
      (await (await get(`/api/reports/${m.id}/access`, alice)).json()).saved,
      true,
    );
    assert.equal(
      (await (await get(`/api/reports/${publicCopy.id}/access`, alice)).json())
        .saved,
      false,
    );
    assert.equal((await (await get("/api/history", bob)).json()).length, 0);
    assert.equal(
      (await post("/api/watch", { repo: "facebook/react", added: true }, alice))
        .status,
      200,
    );
    assert.deepEqual(await (await get("/api/watch", bob)).json(), []);
    for (const bad of [
      { ...alice, "X-CSRF-Token": "wrong" },
      { ...alice, Origin: "https://attacker.example" },
    ])
      assert.equal(
        (await post("/api/watch", { repo: "vuejs/core", added: true }, bad))
          .status,
        403,
      );
    assert.equal(
      (await post(`/api/reports/${m.id}/share`, { shared: true }, bob)).status,
      404,
    );
    assert.equal(
      (await post(`/api/reports/${m.id}/share`, { shared: true }, alice))
        .status,
      200,
    );
    const shared = await get(`/api/reports/${m.id}`);
    assert.equal(shared.status, 200);
    assert.match(
      shared.headers.get("cache-control")!,
      /max-age=0,must-revalidate/,
    );
    assert.equal((await post("/api/history", { id: m.id }, bob)).status, 200);
    assert.equal(
      (await post(`/api/reports/${m.id}/share`, { shared: false }, bob)).status,
      404,
      "bookmark is not ownership",
    );
    assert.equal(
      (await post(`/api/reports/${m.id}/share`, { shared: false }, alice))
        .status,
      200,
    );
    assert.equal(
      (await get(`/api/reports/${m.id}`, bob)).status,
      404,
      "revocation is immediate",
    );
    assert.deepEqual(
      await (await get("/api/history", bob)).json(),
      [],
      "revoked bookmarks cannot disclose metadata",
    );
    assert.equal(
      (await get("/auth/callback?code=forged&state=forged")).status,
      400,
    );
    const account = await (await get("/api/account", alice)).json();
    assert.equal(account.user.name, "Alice");
    assert.ok(!JSON.stringify(account).includes(sidA));
    assert.equal((await post("/auth/logout", {}, alice)).status, 200);
    assert.equal((await get("/api/history", alice)).status, 401);
    engine.store.close();
    engine.store = new Store(directory);
    assert.equal(engine.store.history("alice").length, 1);
    assert.deepEqual(engine.store.userWatch("alice"), ["facebook/react"]);
    assert.equal(engine.store.canRead(m.id, "bob"), false);
    assert.equal(engine.store.consumeUsage("alice", 2), true);
    assert.equal(engine.store.consumeUsage("alice", 2), true);
    assert.equal(engine.store.consumeUsage("alice", 2), false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(directory, { recursive: true, force: true });
    for (const k of Object.keys(process.env))
      if (!(k in env)) delete process.env[k];
    Object.assign(process.env, env);
  }
});

test("login return paths stay on the application origin", () => {
  for (const path of [
    "https://attacker.example",
    "//attacker.example",
    "/\\attacker.example",
    "/\nLocation: evil",
    undefined,
  ])
    assert.equal(safeReturnPath(path), "/history");
  assert.equal(safeReturnPath("/report/abc?lang=zh"), "/report/abc?lang=zh");
});
