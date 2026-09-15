import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/index.js";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import { GitHub } from "../src/providers/github.js";
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
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
