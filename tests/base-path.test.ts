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
import { appPath, routePath, basePathFromUrl } from "../src/core/paths.js";
import type { Market } from "../src/core/types.js";

test("directory paths preserve queries, root hosting and safe login destinations", () => {
  assert.equal(basePathFromUrl("https://example.com/radar/"), "/radar");
  assert.equal(basePathFromUrl("http://localhost:3721/"), "");
  assert.throws(() => basePathFromUrl("https://example.com/a%22b"));
  const target = "/compare?repos=a%2Fb%2Cc%2Fd&lang=zh";
  assert.equal(appPath(target, "/radar"), "/radar" + target);
  assert.equal(appPath("/radar" + target, "/radar"), "/radar" + target);
  assert.equal(routePath("/radar" + target, "/radar"), target);
  assert.equal(appPath(target, ""), target);
  assert.equal(safeReturnPath("/radar" + target, "/radar"), "/radar" + target);
  for (const unsafe of [
    "//evil.com",
    "/other",
    "/radar-other",
    "/radar\\evil",
    "https://evil.com",
  ])
    assert.equal(safeReturnPath(unsafe, "/radar"), "/radar/history");
});

test("directory hosting keeps assets, evidence links, sessions and private exports inside the mount", async () => {
  const env = { ...process.env };
  const directory = mkdtempSync(join(tmpdir(), "ghtrends-prefix-"));
  process.env.GHTRENDS_HOSTED = "1";
  process.env.PUBLIC_URL = "https://ghtrends.example/radar/";
  delete process.env.GHTRENDS_AUTO_COLLECT;
  const engine = new Engine(new Store(directory));
  const fixture: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  const privateReport = structuredClone(fixture);
  privateReport.id = "0000000000000001";
  engine.store.saveMarket(fixture, true);
  engine.store.saveMarket(privateReport, false, "alice");
  engine.store.addHistory("alice", privateReport.id, "saved before migration");
  const sid = randomBytes(32).toString("base64url");
  engine.store.set(
    sessionKey(sid),
    { id: "alice", name: "Alice", csrf: "csrf-a" },
    60000,
  );
  const app = createApp(engine),
    server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const cookie = { Cookie: `__Host-ghtrends_session=${sid}` };
  try {
    const redirect = await fetch(base + "/radar?q=ai4s&lang=zh", {
      redirect: "manual",
    });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get("location"), "/radar/?q=ai4s&lang=zh");
    assert.equal((await fetch(base + "/api/health")).status, 404);
    assert.equal((await fetch(base + "/radar/api/health")).status, 200);
    const report = await fetch(base + `/radar/report/${fixture.id}?lang=zh`);
    const html = await report.text();
    assert.equal(report.status, 200);
    assert.match(html, /name="ghtrends-base-path" content="\/radar"/);
    assert.ok(
      html.includes(
        `href="https://ghtrends.example/radar/report/${fixture.id}?lang=zh"`,
      ),
    );
    assert.ok(html.includes(`href="/radar/api/reports/${fixture.id}?lang=zh"`));
    const assets = [
      ...html.matchAll(
        /(?:src|href)="(\/radar\/(?:assets\/[^"?]+|favicon\.svg))"/g,
      ),
    ].map((m) => m[1]!);
    assert.ok(assets.length >= 3, "JS, CSS and favicon use the prefix");
    for (const asset of assets)
      assert.equal((await fetch(base + asset)).status, 200, asset);
    assert.ok(!html.includes('href="/market/'));
    const trailing = await fetch(base + "/radar/docs/?lang=zh", {
      redirect: "manual",
    });
    assert.equal(trailing.headers.get("location"), "/radar/docs?lang=zh");
    const sitemap = await (await fetch(base + "/radar/sitemap.xml")).text();
    assert.ok(sitemap.includes("https://ghtrends.example/radar/market/"));
    for (const path of [
      `/report/${privateReport.id}`,
      `/api/reports/${privateReport.id}`,
      `/api/reports/${privateReport.id}?format=md`,
      `/api/cards/${privateReport.id}.svg`,
    ]) {
      assert.equal((await fetch(base + "/radar" + path)).status, 404, path);
      assert.equal(
        (await fetch(base + "/radar" + path, { headers: cookie })).status,
        200,
        path,
      );
    }
    assert.equal(
      (
        await (
          await fetch(base + "/radar/api/history", { headers: cookie })
        ).json()
      )[0].id,
      privateReport.id,
    );
    const mutation = (origin: string) =>
      fetch(base + "/radar/api/watch", {
        method: "POST",
        headers: {
          ...cookie,
          Origin: origin,
          "X-CSRF-Token": "csrf-a",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ repo: "facebook/react", added: true }),
      });
    assert.equal((await mutation("https://evil.example")).status, 403);
    assert.equal((await mutation("https://ghtrends.example")).status, 200);
    const events = await fetch(base + "/radar/api/events", {
      method: "POST",
      headers: {
        Origin: "https://ghtrends.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: "report_view" }),
    });
    assert.equal(events.status, 204);
    const md = await (
      await fetch(base + `/radar/api/reports/${fixture.id}?format=md`)
    ).text();
    assert.ok(
      md.includes(`https://ghtrends.example/radar/report/${fixture.id}`),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    process.env = env;
    rmSync(directory, { recursive: true, force: true });
  }
});
