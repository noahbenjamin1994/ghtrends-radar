import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/index.js";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import { GitHub } from "../src/providers/github.js";
import { ALGORITHM_VERSION } from "../src/core/analyze.js";
test("API validates inputs and keeps protocol errors structured", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ghtrends-api-"));
  const engine = new Engine(new Store(directory)),
    app = createApp(engine),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port,
    base = `http://127.0.0.1:${port}`;
  try {
    for (const [path, status] of [
      ["/api/health", 200],
      ["/api/markets?geo=INVALID", 400],
      ["/api/repo?name=../../etc", 400],
      ["/api/reports/bad", 400],
      ["/api/reports/1234567890abcdef", 404],
      ["/api/unknown", 404],
    ] as const) {
      const r = await fetch(base + path);
      assert.equal(r.status, status, path);
      await r.json();
    }
    const r = await fetch(base + "/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "mcp", keyword: "<script>" }),
    });
    assert.equal(r.status, 400);
    assert.throws(
      () => new GitHub(engine.store).base({ private: true }),
      /Only public/,
    );
    const fixture = JSON.parse(
      readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
    )[0];
    engine.store.saveMarket(fixture);
    const report = await fetch(`${base}/api/reports/${fixture.id}?format=md`);
    assert.equal(report.status, 200);
    assert.ok(
      (await report.text()).includes(`${base}/report/${fixture.id}`),
      "local exports link to the local report",
    );
    const old = structuredClone(fixture);
    old.id = "abcde12345abcde1";
    old.version = "0.0.0";
    old.asOf = new Date().toISOString();
    old.topic.keyword = old.demand.keyword = "method migration test";
    engine.store.saveMarket(old);
    let collections = 0;
    engine.trends.demand = async () => old.demand;
    engine.github.supply = async () => {
      collections++;
      return old.supply;
    };
    engine.github.gaps = async () => [];
    const refresh = await fetch(base + "/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: old.topic.slug,
        keyword: old.topic.keyword,
      }),
    });
    assert.equal(
      refresh.status,
      202,
      "old-method keyword variants are not served from the public cache",
    );
    const job = await refresh.json();
    const completed = await (await fetch(base + "/api/jobs/" + job.id)).json();
    assert.equal(completed.state, "complete");
    assert.equal(completed.market.version, ALGORITHM_VERSION);
    assert.equal(
      collections,
      1,
      "the engine also invalidates its old-method cache",
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recent calculations cannot keep expired source evidence cached", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ghtrends-freshness-"));
  const engine = new Engine(new Store(directory));
  const old = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  old.id = "abcde12345abcde2";
  old.version = ALGORITHM_VERSION;
  old.asOf = new Date().toISOString();
  old.topic.keyword = old.demand.keyword = "source freshness test";
  old.demand.fetchedAt = old.supply.fetchedAt = new Date(
    Date.now() - 48 * 3600000,
  ).toISOString();
  engine.store.saveMarket(old);
  let collections = 0;
  engine.trends.demand = async () => ({
    ...old.demand,
    fetchedAt: new Date().toISOString(),
  });
  engine.github.supply = async () => {
    collections++;
    return { ...old.supply, fetchedAt: new Date().toISOString() };
  };
  engine.github.gaps = async () => [];
  const server = createApp(engine).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(base + "/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: old.topic.slug,
        keyword: old.topic.keyword,
      }),
    });
    assert.equal(response.status, 202);
    const job = await response.json();
    const completed = await (await fetch(base + "/api/jobs/" + job.id)).json();
    assert.equal(completed.state, "complete");
    assert.equal(collections, 1);
    assert.notEqual(completed.market.supply.fetchedAt, old.supply.fetchedAt);

    const failure = structuredClone(old);
    failure.id = "abcde12345abcde3";
    failure.kind = "uncertain";
    failure.topic.keyword = failure.demand.keyword = "cached failure test";
    failure.asOf = new Date().toISOString();
    engine.store.saveMarket(failure);
    const retry = await fetch(base + "/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: failure.topic.slug,
        keyword: failure.topic.keyword,
      }),
    });
    assert.equal(
      retry.status,
      200,
      "recent failures keep their brief retry cooldown",
    );
    assert.equal(
      (
        await engine.scan(failure.topic.slug, {
          keyword: failure.topic.keyword,
        })
      ).id,
      failure.id,
    );
    assert.equal(collections, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
