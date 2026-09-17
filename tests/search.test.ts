import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GoogleSearch,
  parseSearchResults,
  parseGooglePage,
  searchProxy,
  publicSearchUrl,
  searchSources,
} from "../src/providers/search.js";
import { Store } from "../src/core/store.js";
import { marketGapSignals } from "../src/core/gaps.js";
import {
  landscapeProblems,
  researchLandscape,
  type Landscape,
} from "../src/core/landscape.js";
import type { Market, ResearchSource } from "../src/core/types.js";
const seed: Market = JSON.parse(
  readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
)[0];
const mobile = `<html><body><form><input name="q"></form><div class="zMzFAb"><a class="fuLhoc" href="/url?q=https%3A%2F%2Ftools.example%2Fcompare%3Futm_source%3Dgoogle&amp;sa=U"><span class="CVA68e">Compare phones</span></a><div class="taTFJ"><span class="FrIlee">Check <b>model compatibility</b> before purchase.</span></div></div></body></html>`;
test("mobile Google parsing keeps snippets, unwraps links and recognizes actual sponsored labels", () => {
  const rows = parseGooglePage(mobile);
  assert.deepEqual(rows, [
    {
      title: "Compare phones",
      url: "https://tools.example/compare",
      kind: "organic",
      excerpt: "Check model compatibility before purchase.",
    },
  ]);
  assert.equal(
    parseGooglePage(
      mobile
        .replace('class="taTFJ"', 'class="taTFJ"')
        .replace("Check <b>", "<span>Sponsored</span> Check <b>"),
    )[0]?.kind,
    "ad",
  );
  assert.throws(
    () =>
      parseGooglePage(
        "<html><body>Our systems detected unusual traffic</body></html>",
      ),
    /search_challenge/,
  );
  assert.throws(
    () => parseGooglePage("<html><body>A redesigned search page</body></html>"),
    /search_format/,
  );
  assert.deepEqual(
    parseGooglePage(
      '<html><body><form><input name="q"></form>No results found</body></html>',
    ),
    [],
  );
  assert.throws(
    () =>
      parseGooglePage(
        mobile.replace(
          /https%3A%2F%2Ftools.example%2Fcompare%3Futm_source%3Dgoogle/,
          "javascript%3Aalert(1)",
        ),
      ),
    /search_format/,
  );
});
test("single-page Google requests use the purchased rotating gateway while preserving country and credentials", () => {
  const p = new URL(
    searchProxy(
      "http://user-name-country-us-session-abc-sessionduration-30:p%3Da%40ss@gate.decodo.com:7000",
    ),
  );
  assert.equal(decodeURIComponent(p.username), "user-name-country-us");
  assert.equal(decodeURIComponent(p.password), "p=a@ss");
  assert.equal(
    searchProxy("http://someone-session-one:secret@proxy.example:7000"),
    "http://someone-session-one:secret@proxy.example:7000/",
  );
  assert.throws(
    () => searchProxy("socks5://proxy.example:7000"),
    /search_proxy/,
  );
});
test("direct search reuses residential routes, caches results, records traffic and cools challenged routes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-direct-")),
    store = new Store(dir);
  const saved = Object.fromEntries(
    [
      "GHTRENDS_SEARCH_MODE",
      "GOOGLE_SEARCH_PROXY",
      "GOOGLE_SEARCH_PROXY_FALLBACK",
    ].map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, {
    GHTRENDS_SEARCH_MODE: "direct",
    GOOGLE_SEARCH_PROXY: "http://user:secret@proxy.example:7000",
    GOOGLE_SEARCH_PROXY_FALLBACK: "http://user:secret@backup.example:7000",
  });
  let calls = 0,
    fail = false;
  const search = new GoogleSearch(store, async () => {
    calls++;
    return fail
      ? { status: 302, bytes: 500, html: "" }
      : {
          status: 200,
          bytes: 21000,
          html: mobile,
          cookies: { NID: "server-cookie" },
        };
  });
  const topic = {
    ...seed.topic,
    plan: {
      ...seed.topic.plan,
      input: "phone sample",
      webQueries: [{ query: "phone compatibility", intent: "competition" }],
    },
  } as any;
  try {
    assert.equal((await search.collect(topic, "US")).provider, "google-mobile");
    assert.equal(calls, 1);
    await search.collect(topic, "US");
    assert.equal(calls, 1);
    fail = true;
    topic.plan.webQueries[0].query = "another sample";
    assert.equal((await search.collect(topic, "US")).state, "pending");
    assert.equal(calls, 3);
    topic.plan.webQueries[0].query = "third sample";
    await search.collect(topic, "US");
    assert.equal(calls, 3);
    assert.ok(!JSON.stringify(search.status()).includes("secret"));
  } finally {
    for (const [k, v] of Object.entries(saved))
      v === undefined ? delete process.env[k] : (process.env[k] = v);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
const response = {
  results: [
    {
      status_code: 200,
      content: {
        results: {
          results: {
            organic: [
              {
                title: "Phone transfer tool",
                url: "https://example.org/tool?utm_source=google",
                desc: "Transfer photos with a local cable.",
              },
            ],
            paid: [
              {
                title: "Phone transfer service",
                url: "https://vendor.example/transfer",
                desc: "Book a phone migration.",
              },
            ],
          },
        },
      },
    },
  ],
};
test("Google response parsing keeps ads separate and rejects challenges and unsafe links", () => {
  const rows = parseSearchResults(response);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.url, "https://example.org/tool");
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["organic", "ad"],
  );
  assert.throws(() =>
    parseSearchResults({
      results: [{ content: "<html>enable JavaScript</html>" }],
    }),
  );
  assert.throws(() => parseSearchResults({ results: [{ status_code: 429 }] }));
  for (const url of [
    "javascript:alert(1)",
    "https://user:secret@example.org/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://service.internal/",
    "https://example.org:8080/",
  ])
    assert.equal(publicSearchUrl(url), undefined);
});
test("search caches successful queries and caps attempts after a provider failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-search-")),
    store = new Store(dir),
    old = global.fetch,
    token = process.env.DECODO_SCRAPER_TOKEN;
  process.env.DECODO_SCRAPER_TOKEN = "test-protected-token";
  let calls = 0;
  global.fetch = async (_url, opts) => {
    calls++;
    const body = JSON.parse(String(opts?.body));
    assert.equal(body.page_count, 1);
    assert.equal(body.target, "google_search");
    return new Response(JSON.stringify(response));
  };
  try {
    const search = new GoogleSearch(store),
      topic = { ...seed.topic, plan: undefined };
    const first = await search.collect(topic, "");
    assert.equal(first.state, "ready");
    assert.equal(calls, 3);
    const second = await search.collect(topic, "");
    assert.equal(calls, 3);
    assert.equal(second.queries.length, 3);
    const sources = searchSources(first);
    assert.ok(sources.some((s) => s.placement === "ad"));
    global.fetch = async () => {
      calls++;
      return new Response("rate limited", { status: 429 });
    };
    const failed = await search.collect(
      { ...topic, keyword: "fresh topic", name: "fresh topic" },
      "US",
    );
    assert.equal(calls, 4);
    assert.equal(failed.state, "pending");
    assert.ok(failed.queries.every((q) => !q.results.length));
    assert.ok(!JSON.stringify(failed).includes("test-protected-token"));
  } finally {
    global.fetch = old;
    if (token === undefined) delete process.env.DECODO_SCRAPER_TOKEN;
    else process.env.DECODO_SCRAPER_TOKEN = token;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("historic phone reports filter vacuum requests while retaining relevant raw evidence", () => {
  const m = structuredClone(seed);
  m.supply.repositories = [
    {
      ...seed.supply.repositories[0]!,
      name: "owner/vacuum",
      relevance: { role: "adjacent", method: "model", reason: "vacuum map" },
    },
    {
      ...seed.supply.repositories[0]!,
      name: "owner/phone",
      relevance: { role: "direct", method: "model", reason: "phone transfer" },
    },
  ];
  m.gaps = ["vacuum", "phone"].map((name) => ({
    title: "Support local export",
    repo: `owner/${name}`,
    url: `https://github.com/owner/${name}/issues/1`,
    reactions: 3,
    createdAt: "2024-01-01",
    updatedAt: "2026-09-01",
    state: "open",
    label: "feature-request",
    excerpt: "Export photos to a local folder.",
  }));
  const before = JSON.stringify(m);
  assert.deepEqual(
    marketGapSignals(m).map((g) => g.repo),
    ["owner/phone"],
  );
  assert.equal(JSON.stringify(m), before);
});
const copy = {
  summary: "A focused service could fit this recurring task.",
  demand: "Users describe recurring file transfers between their phones.",
  competition: "Established tools already provide transfer workflows.",
  entry: "A local adapter could complement an existing project.",
};
const landscape = (): Landscape => ({
  demand: { level: "medium", evidence: [] },
  competition: { level: "low", evidence: [] },
  barrier: "low",
  en: copy,
  zh: {
    summary: "可围绕反复发生的文件迁移任务探索服务。",
    demand: "用户描述了手机间反复迁移文件的需求。",
    competition: "现有工具已提供文件传输流程。",
    entry: "本地适配工具可作为现有项目的补充。",
  },
  leaders: [],
});
const sources: ResearchSource[] = [
  {
    id: "W1",
    kind: "search",
    placement: "organic",
    searchIntent: "demand",
    label: "Request",
    url: "https://users.example/request",
    excerpt: "Transfer photos to another phone.",
  },
  {
    id: "W2",
    kind: "search",
    placement: "organic",
    searchIntent: "competition",
    label: "Tool",
    url: "https://tools.example/tool",
    excerpt: "Local photo transfer software.",
  },
];
function report(l: Landscape): Market {
  return {
    ...seed,
    asOf: "2026-09-17T00:00:00Z",
    demand: {
      ...seed.demand,
      error: undefined,
      fetchedAt: "2026-09-17T00:00:00Z",
    },
    metrics: { ...seed.metrics, trend: "rising" },
    brief: {
      model: "test",
      generatedAt: "2026-09-17",
      en: { summary: "Example", nextSteps: [] },
      zh: { summary: "示例", nextSteps: [] },
      sources,
      landscape: l,
    },
  };
}
test("research oceans preserve measured data and treat ads, sparse coverage and barriers distinctly", () => {
  const l = landscape();
  assert.equal(
    researchLandscape(report(l))?.kind,
    "uncertain",
    "empty search supplies zero blue-ocean evidence",
  );
  l.demand.evidence = [{ id: "W1", quote: sources[0]!.excerpt! }];
  l.competition.evidence = [{ id: "W2", quote: sources[1]!.excerpt! }];
  const m = report(l),
    before = JSON.stringify(m);
  assert.equal(researchLandscape(m)?.kind, "blue");
  assert.equal(JSON.stringify(m), before);
  m.brief!.sources = m.brief!.sources.map((s) => ({ ...s, placement: "ad" }));
  assert.equal(
    researchLandscape(m)?.kind,
    "uncertain",
    "advertising alone supplies zero demand votes",
  );
  l.barrier = "high";
  l.leaders = [
    {
      name: "Transfer Tools",
      en: { position: copy.summary, barrier: copy.entry, opening: copy.entry },
      zh: { position: l.zh.summary, barrier: l.zh.entry, opening: l.zh.entry },
      evidence: [{ id: "W2", quote: sources[1]!.excerpt! }],
    },
  ];
  assert.equal(
    researchLandscape(report(l))?.kind,
    "expanding",
    "hard incumbent barriers override a low-competition guess",
  );
  const falling = report({
    ...l,
    barrier: "low",
    demand: { level: "low", evidence: [] },
  });
  falling.metrics.trend = "falling";
  assert.equal(researchLandscape(falling)?.kind, "quiet");
  l.leaders = [
    {
      name: "Imaginary leader",
      en: { position: copy.summary, barrier: copy.entry, opening: copy.entry },
      zh: { position: l.zh.summary, barrier: l.zh.entry, opening: l.zh.entry },
      evidence: [],
    },
  ];
  assert.ok(landscapeProblems({ landscape: l }, sources).length > 0);
});
