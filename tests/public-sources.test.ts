import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import type { Topic } from "../src/core/types.js";
import {
  discoveryProfile,
  discoveryQueries,
  hackerNewsQuery,
  collectHackerNews,
  capDiscoveryResults,
} from "../src/providers/public-sources.js";
import {
  scopedWebQueries,
  searchSources,
  searchQuerySchema,
  type WebEvidence,
} from "../src/providers/search.js";
import { searchEngineLabel, searchQueryUrl } from "../src/core/evidence.js";
const topic = (input: string, description = ""): Topic => ({
  slug: "test",
  name: input,
  keyword: input,
  query: input,
  description,
  color: "",
  aliases: [],
});

test("public discovery reuses three searches, preserves the object, and routes goods without dropping software intent", () => {
  for (const input of [
    "mechanical keyboard",
    "开心锤锤周边",
    "handmade jewelry",
  ]) {
    const t = topic(input),
      qs = discoveryQueries(t, scopedWebQueries(t));
    assert.equal(discoveryProfile(t), "goods");
    assert.equal(qs.length, 3);
    assert.ok(
      qs.every(
        (q) =>
          q.query.startsWith(input) && searchQuerySchema.safeParse(q).success,
      ),
    );
    assert.ok(
      qs.some(
        (q) =>
          q.intent === "competition" && q.query.includes("site:amazon.com"),
      ),
    );
    assert.ok(
      qs.some(
        (q) => q.intent === "demand" && q.query.includes("site:reddit.com"),
      ),
    );
    assert.equal(hackerNewsQuery(t), undefined);
  }
  const t = topic("ecommerce analytics software", "analyze toy merchandise"),
    qs = discoveryQueries(t, scopedWebQueries(t));
  assert.equal(discoveryProfile(t), "software");
  assert.ok(qs.some((q) => q.intent === "opensource"));
  assert.equal(hackerNewsQuery(t), t.keyword);
  assert.equal(hackerNewsQuery(topic("智能体记忆")), undefined);
});

test("focused research preserves four distinct source jobs", () => {
  const planned = [
    { query: "workflow official pricing", intent: "competition" as const },
    { query: "workflow buyer problems", intent: "demand" as const },
    { query: "workflow community reviews", intent: "demand" as const },
    { query: "workflow open source", intent: "opensource" as const },
  ];
  const value: Topic = {
    ...topic("workflow"),
    plan: {
      input: "workflow",
      model: "test",
      version: "deep-1",
      intent: "focused research",
      trends: [],
      githubTopics: [],
      githubTerms: [],
      explanation: { en: "", zh: "" },
      webQueries: planned,
    },
  };
  assert.deepEqual(scopedWebQueries(value), planned);
  assert.deepEqual(discoveryQueries(value, planned), planned);
  value.plan!.input = "AI software";
  value.plan!.githubTerms = ["document review"];
  assert.equal(hackerNewsQuery(value), "document review");
});

test("HN uses an anonymous fixed endpoint, bounds results, caches successes and exposes honest source identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-public-")),
    store = new Store(dir);
  let calls = 0;
  try {
    const transport = async (url: any, options: any) => {
      calls++;
      assert.equal(url.origin, "https://hn.algolia.com");
      assert.equal(url.searchParams.get("hitsPerPage"), "4");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, "error");
      assert.ok(options.signal);
      return new Response(
        JSON.stringify({
          hits: [
            {
              objectID: "42",
              title: "Ask HN: Agent memory",
              story_text: "<p>Specific <b>problem</b> with persistence.</p>",
              created_at: "2026-09-01T00:00:00Z",
            },
            { objectID: "../bad", title: "unsafe" },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    };
    const first = await collectHackerNews(
      store,
      "agent memory",
      transport as typeof fetch,
    );
    assert.equal(first.results.length, 1);
    assert.equal(
      first.results[0]!.url,
      "https://news.ycombinator.com/item?id=42",
    );
    assert.ok(!first.results[0]!.excerpt.includes("<b>"));
    const next = await collectHackerNews(
      store,
      "agent memory",
      transport as typeof fetch,
    );
    assert.deepEqual(next, first);
    assert.equal(calls, 1);
    const web = {
      provider: "multi-search",
      region: "US",
      language: "en",
      fetchedAt: first.fetchedAt,
      state: "ready",
      queries: [first],
    } as WebEvidence;
    assert.equal(searchEngineLabel(first), "Hacker News / Algolia");
    assert.match(searchQueryUrl(first, web), /hn\.algolia\.com/);
    assert.match(
      searchSources(web)[0]!.excerpt!,
      /Hacker News \/ Algolia search excerpt/,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HN failure is short-cached as missing coverage, never an empty successful search", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-public-fail-")),
    store = new Store(dir);
  let calls = 0;
  try {
    const fail = async () => {
      calls++;
      throw new Error("secret upstream detail");
    };
    const result = await collectHackerNews(
      store,
      "agent memory",
      fail as typeof fetch,
    );
    assert.equal(result.state, "failed");
    assert.ok(result.retryAt);
    assert.ok(!JSON.stringify(result).includes("secret"));
    await collectHackerNews(store, "agent memory", fail as typeof fetch);
    assert.equal(calls, 1);
    const oversized = await collectHackerNews(
      store,
      "different",
      (async () => new Response("x".repeat(260000))) as typeof fetch,
    );
    assert.equal(oversized.state, "failed");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fixed evidence budget retains each channel and removes cross-query tracking duplicates", () => {
  const web: WebEvidence = {
    provider: "multi-search",
    region: "US",
    language: "en",
    fetchedAt: new Date().toISOString(),
    state: "ready",
    queries: Array.from({ length: 4 }, (_, i) => ({
      query: `query ${i}`,
      intent: i === 0 ? "competition" : "demand",
      state: "ready",
      engine: i === 3 ? "hackernews" : "google",
      results: Array.from({ length: 12 }, (_, j) => ({
        title: `source ${i}-${j}`,
        url:
          j === 0
            ? `https://same.example/page?utm_source=${i}`
            : `https://source-${i}-${j}.example/page`,
        excerpt: "A concrete source excerpt.",
        kind: "organic",
      })),
    })),
  };
  capDiscoveryResults(web);
  assert.equal(
    web.queries.reduce((n, q) => n + q.results.length, 0),
    30,
  );
  assert.ok(web.queries.every((q) => q.results.length > 0));
  assert.equal(
    web.queries
      .flatMap((q) => q.results)
      .filter((r) => r.url.includes("same.example")).length,
    1,
  );
  const delivered = searchSources(web);
  assert.equal(delivered.length, 16);
  assert.ok(delivered.some((s) => s.id?.startsWith("W4")));
});
