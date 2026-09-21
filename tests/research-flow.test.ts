import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectGapSignals } from "../src/core/gaps.js";
import type { Gap } from "../src/core/types.js";
import { modelSources } from "../src/providers/research.js";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import { createApp } from "../src/server/index.js";

test("issue leads reject observed roadmap and incident noise without letting template words determine intent", () => {
  const gap = (title: string): Gap => ({
    title,
    url: "https://github.com/a/b/issues/" + encodeURIComponent(title),
    repo: "a/b",
    reactions: 12,
    state: "open",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-15",
    label: "alternative",
    excerpt:
      "Is your feature request related to a problem? Describe alternatives considered.",
  });
  const input = [
    "Public Roadmap",
    "ROADMAP 2025",
    "[Agents] Post V1.0 Work",
    "Tracking: 429 / Capacity Issues",
    "Add gemini-3.1-pro-preview",
    "Support latest Vercel AI SDK",
    "Error: table sessions has no column named swarm_name",
    "Support FULLTEXT search",
    "Support local/offline language models",
    "AI Agent doesn't store Tool usages in memory",
    "Alternative to cloud-only indexing",
  ].map(gap);
  const original = JSON.stringify(input);
  const selected = selectGapSignals([...input, input[7]!]);
  assert.equal(selected.length, 4);
  assert.equal(
    selected.find((g) => g.title.includes("FULLTEXT"))?.label,
    "feature-request",
  );
  assert.equal(
    selected.find((g) => g.title.includes("doesn't"))?.label,
    "friction",
  );
  assert.equal(
    selected.find((g) => g.title.startsWith("Alternative"))?.label,
    "alternative",
  );
  assert.equal(
    selectGapSignals([{ ...gap("Support export"), state: "closed" }]).length,
    0,
  );
  assert.equal(JSON.stringify(input), original, "saved evidence is immutable");
});

test("engagement accepts bounded known events from this origin and persists anonymous aggregates only", async () => {
  const env = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-events-"));
  Object.assign(process.env, {
    GHTRENDS_HOSTED: "1",
    PUBLIC_URL: "https://radar.example",
    GHTRENDS_ANALYTICS: "1",
  });
  const engine = new Engine(new Store(dir));
  const server = createApp(engine).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (event: string, origin = "https://radar.example") =>
    fetch(base + "/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        event,
        input: "private input must not be stored",
        user: "unexpected-identifier",
      }),
    });
  try {
    assert.equal(
      (await post("report_view", "https://other.example")).status,
      403,
    );
    assert.equal((await post("arbitrary event")).status, 400);
    assert.equal((await post("report_view")).status, 204);
    assert.equal((await post("share_copy")).status, 204);
    assert.equal((await fetch(base + "/api/admin")).status, 401);
    engine.store.close();
    engine.store = new Store(dir);
    const result = engine.store.adminOverview(1, 0, "").engagement;
    assert.deepEqual(
      result.events.map((e) => ({ ...e })),
      [
        { event: "report_view", count: 1 },
        { event: "share_copy", count: 1 },
      ],
    );
    assert.ok(!JSON.stringify(result).includes("private input"));
    for (let i = 0; i < 58; i++)
      assert.equal((await post("report_view")).status, 204);
    assert.equal((await post("report_view")).status, 429);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
    for (const key of Object.keys(process.env))
      if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});

test("empty search outcomes remain metadata and never become citable model evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-empty-search-"));
  const store = new Store(dir);
  const engine = new Engine(store);
  try {
    (engine.github as any).get = async () => ({ total_count: 0, items: [] });
    const sources = await engine.github.ideaAlternatives(["aisvs checklist"]);
    assert.equal(sources.length, 1);
    assert.equal(sources[0]!.excerpt, "");
    assert.match(sources[0]!.label, /0 returned/);
    assert.deepEqual(modelSources(sources), []);
    assert.match(sources[0]!.url, /github.com\/search/);
  } finally {
    await engine.trends.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
