import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Store } from "../src/core/store.js";
import { Engine } from "../src/core/engine.js";
import { GitHub } from "../src/providers/github.js";
import { resolveTopic } from "../src/core/topics.js";
import { marketAssessment } from "../src/core/assessment.js";
import { requestLocale, localeUrl } from "../src/core/i18n.js";
import { marketMarkdown } from "../src/core/report.js";
import { marketCard } from "../src/core/card.js";
import { renderDocument } from "../src/server/html.js";
import { createApp } from "../src/server/index.js";
import type { Market, Repo } from "../src/core/types.js";
const seed: Market = JSON.parse(
  readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
)[0];
const template = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8",
);
function abbreviationReport(): Market {
  const m = structuredClone(seed);
  m.topic = {
    slug: "ai4s",
    name: "ai4s",
    keyword: "ai4s",
    query: "topic:ai4s",
    description: "A custom GitHub topic, paired with Google search interest.",
    color: "#79c9ff",
    aliases: [],
  };
  m.kind = "uncertain";
  m.confidence = "low";
  m.score = null;
  m.supply.total = 11;
  m.supplyDensity = "sparse";
  m.demand.keyword = "ai4s";
  m.metrics.fast = null;
  m.metrics.points = 104;
  m.metrics.nonzeroShare = 53 / 104;
  m.metrics.growth = -1 / 6;
  return m;
}
test("ai4s is resolved before collection and old snapshots receive an actionable, qualified recommendation", () => {
  const topic = resolveTopic("ai4s");
  assert.equal(topic.slug, "ai-for-science");
  assert.equal(topic.keyword, "AI for Science");
  assert.equal(topic.queries?.length, 3);
  assert.equal(resolveTopic("科学智能").slug, topic.slug);
  assert.equal(resolveTopic("ai4science").slug, topic.slug);
  assert.equal(
    resolveTopic("ai4s", "molecule design").keyword,
    "molecule design",
  );
  const m = abbreviationReport(),
    original = JSON.stringify(m),
    a = marketAssessment(m, "zh");
  assert.equal(a.level, "provisional");
  assert.equal(a.suggestedScan?.keyword, "AI for Science");
  assert.match(a.title, /完整领域/);
  assert.ok(a.facts.some((f) => f.includes("11")));
  assert.ok(a.facts.some((f) => f.includes("49%")));
  assert.equal(a.nextSteps.length, 3);
  assert.equal(
    JSON.stringify(m),
    original,
    "interpretation must not rewrite source evidence or assign a quadrant",
  );
  const stale = structuredClone(m);
  stale.topic = resolveTopic("unfamiliar-category");
  stale.demand.keyword = stale.topic.keyword;
  stale.supply.fetchedAt = "2000-01-01T00:00:00Z";
  assert.ok(
    !marketAssessment(stale).facts.some((f) => f.includes("11 active")),
    "stale supply must not justify a current competitive verdict",
  );
});
test("Chinese reports, metadata and exports agree while preserving identity and escaped external content", () => {
  const m = abbreviationReport();
  m.topic.name = '<img src=x onerror="alert(1)">';
  const html = renderDocument(template, {
    base: "https://radar.ghtrends.dev",
    path: `/report/${m.id}`,
    geo: "US",
    market: m,
    markets: [m],
    status: 200,
    locale: "zh",
  });
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /初步建议/);
  assert.match(html, /先按完整领域重查/);
  assert.ok(!html.includes("<img src=x"));
  assert.match(
    html,
    new RegExp(
      `rel="canonical" href="https://radar.ghtrends.dev/report/${m.id}\\?lang=zh"`,
    ),
  );
  assert.match(html, /hreflang="en"/);
  assert.match(html, /hreflang="zh-CN"/);
  assert.match(html, /初步建议/);
  assert.match(marketMarkdown(m, undefined, "zh"), /## 接下来怎么做/);
  const card = marketCard(m, "https://radar.ghtrends.dev/report/" + m.id, "zh");
  assert.match(card, /尚未确认/);
  assert.ok(!card.includes("-17%"));
  m.supply.complete = false;
  assert.ok(marketAssessment(m, "zh").facts.some((f) => f.includes("≥11")));
  assert.match(
    marketCard(m, "https://radar.ghtrends.dev/report/" + m.id, "zh"),
    /≥11/,
  );
  assert.equal(
    localeUrl("/compare?repos=a%2Fb%2Cc%2Fd", "zh"),
    "/compare?repos=a%2Fb%2Cc%2Fd&lang=zh",
  );
  assert.equal(requestLocale("en", "ghtrends_lang=zh", "zh-CN"), "en");
  assert.equal(requestLocale(undefined, "ghtrends_lang=en", "zh-CN"), "en");
  assert.equal(requestLocale(undefined, "", "en;q=0.2,zh-CN;q=0.9"), "zh");
});
test("multi-topic supply is deduplicated, marks incomplete unions and exposes base facts before enrichment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-union-")),
    store = new Store(dir),
    github = new GitHub(store);
  let active = 0,
    maxActive = 0,
    seenBase = false;
  const repos = Array.from({ length: 12 }, (_, i) => ({
    ...seed.supply.repositories[0]!,
    name: `owner/repo${i}`,
    stars: 100 - i,
  }));
  github.get = async <T>(path: string) => {
    const q = new URL("https://api.github.com" + path).searchParams.get("q")!;
    const start = q.startsWith("topic:ai4science")
      ? 0
      : q.startsWith("topic:ai-for-science")
        ? 4
        : 8;
    const items = repos.slice(start, start + 6);
    return {
      total_count: start === 0 ? 150 : items.length,
      incomplete_results: false,
      items: items.map((r) => ({
        full_name: r.name,
        stargazers_count: r.stars,
        private: false,
        archived: false,
        fork: false,
      })),
    } as T;
  };
  github.repo = async (name: string) => {
    assert.ok(seenBase);
    active++;
    maxActive = Math.max(active, maxActive);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return repos.find((r) => r.name === name)!;
  };
  try {
    const supply = await github.supply(resolveTopic("ai4s"), (base) => {
      seenBase = true;
      assert.equal(base.total, 12);
      assert.equal(base.complete, false);
    });
    assert.equal(supply.total, 12);
    assert.equal(supply.searches?.length, 3);
    assert.equal(supply.complete, false);
    assert.equal(maxActive, 3);
    assert.equal(
      new Set(supply.repositories.map((r) => r.name)).size,
      supply.repositories.length,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("a running scan exposes received evidence before details finish and language preference survives navigation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-progress-")),
    engine = new Engine(new Store(dir));
  let release!: () => void;
  const details = new Promise<void>((resolve) => {
    release = resolve;
  });
  engine.trends.demand = async (keyword, geo, onTimeline) => {
    const demand = {
      ...structuredClone(seed.demand),
      keyword,
      geo: geo || "",
      fetchedAt: new Date().toISOString(),
    };
    onTimeline?.(demand);
    return demand;
  };
  engine.github.supply = async (_topic, onBase) => {
    const supply = {
      ...structuredClone(seed.supply),
      fetchedAt: new Date().toISOString(),
    };
    onBase?.(supply);
    await details;
    return supply;
  };
  engine.github.gaps = async () => [];
  const app = createApp(engine),
    server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const res = await fetch(base + "/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "ai4s" }),
    });
    assert.equal(res.status, 202);
    const job = await res.json();
    const progress = await (await fetch(base + "/api/jobs/" + job.id)).json();
    assert.equal(progress.state, "running");
    assert.ok(progress.progress.supplyCount > 0);
    assert.ok(progress.progress.preview);
    assert.equal(progress.progress.preview.topic.keyword, "AI for Science");
    release();
    const zh = await fetch(base + "/?lang=zh");
    assert.match(zh.headers.get("set-cookie") || "", /ghtrends_lang=zh/);
    assert.match(await zh.text(), /<html lang="zh-CN">/);
    const saved = await fetch(base + "/docs", {
      headers: { cookie: "ghtrends_lang=zh" },
    });
    assert.match(await saved.text(), /读懂机会信号/);
    const en = await fetch(base + "/docs?lang=en", {
      headers: { cookie: "ghtrends_lang=zh" },
    });
    assert.match(await en.text(), /<html lang="en">/);
  } finally {
    release();
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
