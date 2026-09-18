import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitorPanel } from "../src/web/landscape.js";
import {
  searchCollectionMessage,
  searchEvidenceIsFresh,
} from "../src/core/evidence.js";
import { marketMarkdown } from "../src/core/report.js";
import { renderDocument } from "../src/server/html.js";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GoogleSearch,
  parseSearchResults,
  parseGooglePage,
  parseDuckDuckGoPage,
  searchProxy,
  publicSearchUrl,
  searchSources,
} from "../src/providers/search.js";
import { Store } from "../src/core/store.js";
import { marketGapSignals } from "../src/core/gaps.js";
import {
  landscapeProblems,
  groundCompetitorFacts,
  researchLandscape,
  type Landscape,
} from "../src/core/landscape.js";
import type { Market, ResearchSource } from "../src/core/types.js";
const seed: Market = JSON.parse(
  readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
)[0];
const mobile = `<html><body><form><input name="q"></form><div class="zMzFAb"><a class="fuLhoc" href="/url?q=https%3A%2F%2Ftools.example%2Fcompare%3Futm_source%3Dgoogle&amp;sa=U"><span class="CVA68e">Compare phones</span></a><div class="taTFJ"><span class="FrIlee">Check <b>model compatibility</b> before purchase.</span></div></div></body></html>`;
const duck = `<html><body><form><input name="q"></form><table><tr><td><a class='result-link' href='//duckduckgo.com/l/?uddg=https%3A%2F%2Ftools.example%2Fpricing%3Futm_source%3Dddg'>Phone transfer pricing</a></td></tr><tr><td class='result-snippet'>Repair shop plans start at <b>$20</b> per month.</td></tr><tr><td class='link-text'>tools.example</td></tr></table></body></html>`;
test("DuckDuckGo lightweight parser retains snippets, rejects challenges and skips ads or unsafe links", () => {
  assert.deepEqual(parseDuckDuckGoPage(duck), [
    {
      title: "Phone transfer pricing",
      url: "https://tools.example/pricing",
      kind: "organic",
      excerpt: "Repair shop plans start at $20 per month.",
    },
  ]);
  for (const html of [
    "<form id='challenge-form'></form>",
    "<form action='/anomaly.js'>verification</form>",
  ])
    assert.throws(() => parseDuckDuckGoPage(html), /search_challenge/);
  assert.throws(
    () => parseDuckDuckGoPage("<html>new layout</html>"),
    /search_format/,
  );
  assert.deepEqual(
    parseDuckDuckGoPage('<form><input name="q"></form>No results found'),
    [],
  );
  for (const target of [
    "javascript:alert(1)",
    "http://127.0.0.1/",
    "https://user:secret@example.org/",
    "https://duckduckgo.com/y.js?ad_provider=test",
    "https://www.bing.com/aclick?a=1",
  ])
    assert.throws(
      () =>
        parseDuckDuckGoPage(
          duck.replace(
            /https%3A%2F%2Ftools.example%2Fpricing%3Futm_source%3Dddg/,
            encodeURIComponent(target),
          ),
        ),
      /search_format/,
    );
  const extra = duck
    .replace("Phone transfer pricing", "Another tool")
    .replace("tools.example", "second.example");
  const rows = parseDuckDuckGoPage(
    duck.replace(
      "</table>",
      extra.match(/<table>(.*)<\/table>/)![1] + "</table>",
    ),
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.excerpt, "Repair shop plans start at $20 per month.");
});
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
    assert.equal((await search.collect(topic, "US")).provider, "multi-search");
    assert.equal(calls, 1);
    await search.collect(topic, "US");
    assert.equal(calls, 1);
    fail = true;
    topic.plan.webQueries[0].query = "another sample";
    assert.equal((await search.collect(topic, "US")).state, "failed");
    assert.equal(calls, 4);
    topic.plan.webQueries[0].query = "third sample";
    await search.collect(topic, "US");
    assert.equal(calls, 4);
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
    assert.equal(failed.state, "failed");
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

test("competitor facts require product-linked quotes and preserve quoted prices", () => {
  const offer: ResearchSource = {
    id: "W3",
    kind: "search",
    placement: "organic",
    label: "Transfer Pro",
    url: "https://tools.example/pricing",
    excerpt:
      "Transfer Pro serves repair shops. Plans start at $29 per month, billed yearly.",
  };
  const l = landscape();
  l.leaders = [
    {
      name: "Transfer Pro",
      category: "commercial",
      en: {
        position: "Transfers phone data for repair shops.",
        barrier: "Shops reuse saved device profiles.",
        opening: "Explore a repair-ticket integration.",
      },
      zh: {
        position: "为维修店提供手机数据迁移服务。",
        barrier: "店员可复用已有设备配置。",
        opening: "可探索与维修工单的对接。",
      },
      audience: {
        en: "Repair shops",
        zh: "手机维修店",
        evidence: { id: "W3", quote: "Transfer Pro serves repair shops." },
      },
      pricing: {
        en: "From $29 per month, billed yearly.",
        zh: "每月 29 美元起，按年付费。",
        evidence: {
          id: "W3",
          quote: "Plans start at $29 per month, billed yearly.",
        },
      },
      evidence: [{ id: "W3", quote: offer.excerpt! }],
    },
  ];
  assert.deepEqual(
    landscapeProblems({ landscape: l }, [...sources, offer]),
    [],
  );
  const fabricated = structuredClone(l);
  fabricated.leaders[0]!.pricing!.zh = "每月 19 美元起，按年付费。";
  assert.ok(
    landscapeProblems({ landscape: fabricated }, [...sources, offer]).some(
      (p) => p.includes("amounts"),
    ),
  );
  const unrelated = structuredClone(l);
  unrelated.leaders[0]!.evidence = [{ id: "W2", quote: sources[1]!.excerpt! }];
  assert.ok(
    landscapeProblems({ landscape: unrelated }, [...sources, offer]).some((p) =>
      p.includes("identify this peer"),
    ),
  );
  const missing = structuredClone(l);
  missing.leaders[0]!.pricing!.evidence.quote = "The monthly price is $29.";
  assert.ok(
    landscapeProblems({ landscape: missing }, [...sources, offer]).some((p) =>
      p.includes("exact"),
    ),
  );
});

test("search-only competitor facts remain optional for saved reports", () => {
  assert.deepEqual(landscapeProblems({ landscape: landscape() }, sources), []);
  const l = landscape();
  l.leaders = [
    {
      name: "Transfer Tool",
      en: {
        position: "Transfers photos between phones.",
        barrier: "An established phone workflow.",
        opening: "Explore a local adapter for shops.",
      },
      zh: {
        position: "在手机之间迁移照片。",
        barrier: "已有成熟的手机迁移流程。",
        opening: "可为门店探索本地适配器。",
      },
      evidence: [{ id: "W2", quote: sources[1]!.excerpt! }],
    },
  ];
  assert.deepEqual(landscapeProblems({ landscape: l }, sources), []);
});

test("visible ad cards keep their own budget after a full organic result list", () => {
  const organic = Array.from({ length: 12 }, (_, i) =>
    mobile
      .match(/<div class="zMzFAb">[\s\S]*<\/div>/)![0]
      .replaceAll("tools.example", `tools${i}.example`),
  ).join("");
  const ad = mobile
    .match(/<div class="zMzFAb">[\s\S]*<\/div>/)![0]
    .replace("Check <b>", "<span>Sponsored</span> Check <b>")
    .replaceAll("tools.example", "advertiser.example");
  const rows = parseGooglePage(`<html><body>${organic}${ad}</body></html>`);
  assert.equal(rows.filter((r) => r.kind === "organic").length, 10);
  assert.equal(rows.filter((r) => r.kind === "ad").length, 1);
  assert.equal(
    rows.find((r) => r.kind === "ad")?.url,
    "https://advertiser.example/compare",
  );
});

test("model evidence includes independent competitors instead of repeating one brand's pages", () => {
  const result = (url: string) => ({
    title: url,
    url,
    excerpt: "A phone repair service.",
    kind: "organic" as const,
  });
  const web = {
    provider: "google-mobile" as const,
    region: "US",
    language: "en",
    fetchedAt: "2026-09-18",
    state: "ready" as const,
    queries: [
      {
        query: "phone services",
        intent: "competition" as const,
        state: "ready" as const,
        results: [
          result("https://www.brand.example/one"),
          result("https://m.brand.example/two"),
          result("https://support.brand.example/three"),
          result("https://www.brand.example/four"),
          result("https://shop.example/offer"),
          result("https://repair.example/prices"),
          result("https://another.example/offer"),
          { ...result("https://ad.example/buy"), kind: "ad" as const },
        ],
      },
    ],
  };
  const before = JSON.stringify(web);
  const rows = searchSources(web);
  assert.deepEqual(
    rows.map((r) => r.url),
    [
      "https://www.brand.example/one",
      "https://shop.example/offer",
      "https://repair.example/prices",
      "https://another.example/offer",
      "https://ad.example/buy",
    ],
  );
  assert.equal(rows.at(-1)?.placement, "ad");
  assert.equal(JSON.stringify(web), before);
  web.queries[0]!.results = [
    result("https://github.com/one/tool"),
    result("https://github.com/two/tool"),
  ];
  assert.equal(searchSources(web).length, 2);
});

test("independent fallback recovers challenges within a three-request budget and keeps engine cooldowns", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-search-retry-")),
    store = new Store(dir);
  const keys = [
    "GHTRENDS_SEARCH_MODE",
    "GOOGLE_SEARCH_PROXY",
    "GOOGLE_SEARCH_PROXY_FALLBACK",
  ];
  const env = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    GHTRENDS_SEARCH_MODE: "direct",
    GOOGLE_SEARCH_PROXY:
      "http://user-country-us-session-one:secret@gate.decodo.com:7000",
    GOOGLE_SEARCH_PROXY_FALLBACK:
      "http://user-country-us-session-two:secret@gate.decodo.com:7000",
  });
  let calls = 0;
  const topic = {
    ...seed.topic,
    keyword: "AI for Science",
    plan: { input: "AI4S", model: "curated" },
  } as any;
  const search = new GoogleSearch(store, async (request) => {
    calls++;
    assert.ok(request.query.startsWith("AI for Science"));
    assert.ok(!request.proxy.includes("session-"));
    if (request.engine === "google") return { status: 302 };
    return calls === 2 ? { status: 202 } : { status: 200, html: duck };
  });
  try {
    const recovered = await search.collect(topic, "US");
    assert.equal(recovered.state, "ready");
    assert.equal(calls, 5); // Google paused; DDG retries once, then serves later queries.
    assert.ok(
      recovered.queries.every(
        (q) =>
          q.engine === "duckduckgo" &&
          q.adCoverage === "organic-only" &&
          q.fallbackReason === "search_challenge",
      ),
    );
    const at = recovered.queries[0]!.fetchedAt;
    assert.equal((await search.collect(topic, "US")).queries[0]!.fetchedAt, at);
    assert.equal(calls, 5);
    let failures = 0;
    const blocked = new GoogleSearch(store, async () => {
      failures++;
      return { status: 302 };
    });
    const result = await blocked.collect(
      { ...topic, keyword: "Other research category" },
      "US",
    );
    assert.equal(result.state, "failed");
    assert.equal(
      failures,
      2,
      "Google is cooling; two DDG attempts exhaust the remaining pool",
    );
    assert.ok(
      result.queries.every((q) => q.error === "search_challenge" && q.retryAt),
    );
    assert.ok(!JSON.stringify(result).includes("secret"));
  } finally {
    keys.forEach((k, i) =>
      env[i] === undefined ? delete process.env[k] : (process.env[k] = env[i]),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saved failed searches render stopped states instead of pending work or an empty market", () => {
  const m = structuredClone(seed);
  m.web = {
    provider: "google-mobile",
    region: "US",
    language: "en",
    fetchedAt: "2026-09-18",
    state: "failed",
    queries: [
      {
        query: "AI for Science services",
        intent: "competition",
        state: "failed",
        error: "search_challenge",
        results: [],
      },
    ],
  };
  m.aiError = "AI review needs a retry.";
  const html = renderToStaticMarkup(
    createElement(CompetitorPanel, { market: m, locale: "zh" }),
  );
  assert.ok(html.includes("Google 要求访问验证"));
  assert.ok(html.includes("AI 解读需要重新生成"));
  assert.ok(html.includes("0/1"));
  assert.ok(!html.includes("0 条结果"));
  assert.ok(!html.includes("采集准备中"));
  m.web.state = "pending"; // old snapshots have lost the provider error
  delete m.web.queries[0]!.error;
  assert.ok(searchCollectionMessage(m.web, "zh").includes("已结束"));
  m.web.state = "ready";
  m.web.queries[0]!.state = "ready";
  assert.equal(searchCollectionMessage(m.web, "en"), "");
});

test("optional competitor facts recover singleton references and isolate unsupported prices", () => {
  const l = landscape();
  l.leaders = [
    {
      name: "Tool",
      category: "opensource",
      en: { position: copy.summary, barrier: copy.entry, opening: copy.entry },
      zh: { position: l.zh.summary, barrier: l.zh.entry, opening: l.zh.entry },
      evidence: [{ id: "W2", quote: sources[1]!.excerpt! }],
    },
  ];
  const raw: any = { landscape: l };
  raw.landscape.leaders[0].audience = {
    en: "Photo transfer users",
    zh: "迁移照片的手机用户",
    evidence: [{ id: "W2", quote: sources[1]!.excerpt! }],
  };
  raw.landscape.leaders[0].pricing = {
    en: "Free to use",
    zh: "免费使用",
    evidence: [{ id: "W2", quote: sources[1]!.excerpt! }],
  };
  const nullable = structuredClone(raw);
  nullable.landscape.leaders[0].pricing = null;
  assert.equal(
    groundCompetitorFacts(nullable, sources).landscape.leaders[0].pricing,
    undefined,
  );
  const before = JSON.stringify(raw);
  const grounded = groundCompetitorFacts(raw, sources);
  assert.equal(grounded.landscape.leaders[0].audience.evidence.id, "W2");
  assert.equal(grounded.landscape.leaders[0].pricing, undefined);
  assert.deepEqual(landscapeProblems(grounded, sources), []);
  assert.equal(JSON.stringify(raw), before);
  raw.landscape.leaders[0].audience.evidence.push({
    id: "W1",
    quote: sources[0]!.excerpt!,
  });
  assert.equal(
    groundCompetitorFacts(raw, sources).landscape.leaders[0].audience,
    undefined,
    "ambiguous arrays stay out",
  );
});

test("competition evidence retains billing pages after four independent news sources", () => {
  const web = {
    provider: "google-mobile" as const,
    region: "US",
    language: "en",
    fetchedAt: "2026-09-18",
    state: "ready" as const,
    queries: [
      {
        query: "scientific research services pricing",
        intent: "competition" as const,
        state: "ready" as const,
        results: [
          ...Array.from({ length: 5 }, (_, i) => ({
            title: "Research news",
            url: `https://news${i}.example/article`,
            excerpt: "Research news.",
            kind: "organic" as const,
          })),
          {
            title: "Research plans",
            url: "https://tool.example/pricing",
            excerpt: "Plans from $10 per month.",
            kind: "organic" as const,
          },
        ],
      },
    ],
  };
  const sources = searchSources(web);
  assert.equal(sources.length, 5);
  assert.ok(sources.some((s) => s.url === "https://tool.example/pricing"));
});

test("fallback provenance reaches model sources and UI while ad coverage remains explicit", () => {
  const m = structuredClone(seed);
  m.web = {
    provider: "multi-search",
    version: "3",
    region: "US",
    language: "en",
    fetchedAt: "2026-09-18T13:00:00Z",
    state: "ready",
    queries: [
      {
        query: "phone transfer pricing",
        intent: "competition",
        state: "ready",
        engine: "duckduckgo",
        adCoverage: "organic-only",
        fetchedAt: "2026-09-18T12:00:00Z",
        fallbackReason: "search_challenge",
        results: parseDuckDuckGoPage(duck),
      },
    ],
  };
  const sources = searchSources(m.web);
  assert.ok(sources[0]!.excerpt!.startsWith("DuckDuckGo search excerpt"));
  assert.equal(sources[0]!.fetchedAt, "2026-09-18T12:00:00Z");
  for (const locale of ["zh", "en"] as const) {
    const html = renderToStaticMarkup(
      createElement(CompetitorPanel, { market: m, locale }),
    );
    assert.ok(html.includes("DuckDuckGo"));
    assert.ok(html.includes("2026-09-18 12:00 UTC"));
    assert.ok(html.includes("https://duckduckgo.com/?q="));
    assert.ok(!html.includes("0 条广告"));
    assert.ok(!html.includes("0 ads"));
    assert.ok(!html.includes("Inspect Google search evidence"));
    assert.ok(searchCollectionMessage(m.web, locale).includes("DuckDuckGo"));
    const markdown = marketMarkdown(m, "https://ghtrends.dev/radar", locale);
    assert.ok(markdown.includes("DuckDuckGo · 2026-09-18T12:00:00Z"));
    const document = renderDocument(
      '<html><head></head><body><div id="root"></div></body></html>',
      {
        base: "https://ghtrends.dev/radar",
        path: `/report/${m.id}`,
        geo: "US",
        market: m,
        markets: [],
        status: 200,
        locale,
      },
    );
    assert.ok(document.includes("DuckDuckGo · 2026-09-18T12:00:00Z"));
  }
});

test("fallback cache expires early, shared cooldowns survive instances and primary recovery keeps its own TTL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-search-recovery-")),
    store = new Store(dir);
  const keys = [
    "GHTRENDS_SEARCH_MODE",
    "GOOGLE_SEARCH_PROXY",
    "GOOGLE_SEARCH_PROXY_FALLBACK",
  ];
  const env = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    GHTRENDS_SEARCH_MODE: "direct",
    GOOGLE_SEARCH_PROXY: "http://user:secret@proxy.example:7000",
    GOOGLE_SEARCH_PROXY_FALLBACK: "",
  });
  const db = new DatabaseSync(join(dir, "ghtrends.sqlite"));
  const topic = {
    ...seed.topic,
    plan: {
      input: "tools",
      webQueries: [{ query: "tools pricing", intent: "competition" }],
    },
  } as any;
  let calls: string[] = [],
    primaryReady = false;
  const transport = async (input: any) => {
    calls.push(input.engine);
    return input.engine === "google"
      ? primaryReady
        ? { status: 200, html: mobile, bytes: 1000 }
        : { status: 302, bytes: 500 }
      : { status: 200, html: duck, bytes: 600 };
  };
  try {
    const search = new GoogleSearch(store, transport);
    const [a, b] = await Promise.all([
      search.collect(topic, "US"),
      search.collect(topic, "US"),
    ]);
    assert.deepEqual(calls, ["google", "duckduckgo"]);
    assert.equal(a.queries[0]!.fetchedAt, b.queries[0]!.fetchedAt);
    const cache = db
      .prepare("select expires from cache where key like 'web-search:v3:%'")
      .get() as any;
    assert.ok(
      cache.expires - Date.now() > 29 * 60000 &&
        cache.expires - Date.now() <= 30 * 60000,
    );
    assert.equal(
      db
        .prepare(
          "select count(*) n from provider_calls where operation='google-serp' and status=302",
        )
        .get()!.n,
      1,
    );
    await new GoogleSearch(store, transport).collect(
      {
        ...topic,
        plan: {
          ...topic.plan,
          webQueries: [{ query: "tools reviews", intent: "demand" }],
        },
      },
      "US",
    );
    assert.deepEqual(calls, ["google", "duckduckgo", "duckduckgo"]);
    db.prepare(
      "update cache set expires=0 where key like 'web-search:%'",
    ).run();
    primaryReady = true;
    const recovered = await search.collect(topic, "US");
    assert.equal(recovered.queries[0]!.engine, "google");
    assert.equal(recovered.queries[0]!.fallbackReason, undefined);
    assert.equal(recovered.queries[0]!.adCoverage, "visible-placements");
    const refreshed = db
      .prepare(
        "select expires from cache where expires>0 and key like 'web-search:v3:%'",
      )
      .get() as any;
    assert.ok(
      refreshed.expires - Date.now() > 359 * 60000 &&
        refreshed.expires - Date.now() <= 360 * 60000,
    );
  } finally {
    keys.forEach((k, i) =>
      env[i] === undefined ? delete process.env[k] : (process.env[k] = env[i]),
    );
    db.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("proxy authentication failure pauses both engines on that route and can use a configured backup", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-search-auth-")),
    store = new Store(dir);
  const keys = [
    "GHTRENDS_SEARCH_MODE",
    "GOOGLE_SEARCH_PROXY",
    "GOOGLE_SEARCH_PROXY_FALLBACK",
  ];
  const env = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    GHTRENDS_SEARCH_MODE: "direct",
    GOOGLE_SEARCH_PROXY: "http://user:secret@proxy.example:7000",
    GOOGLE_SEARCH_PROXY_FALLBACK: "http://backup:secret@backup.example:7000",
  });
  let calls = 0;
  try {
    const search = new GoogleSearch(store, async (input) => {
      calls++;
      return input.proxy.includes("backup.example")
        ? { status: 200, html: duck }
        : { status: 407 };
    });
    const web = await search.collect(
      {
        ...seed.topic,
        plan: {
          input: "sample",
          webQueries: [{ query: "sample pricing", intent: "competition" }],
        },
      } as any,
      "US",
    );
    assert.equal(web.state, "ready");
    assert.equal(calls, 2);
    assert.equal(web.queries[0]!.engine, "duckduckgo");
    assert.equal(web.queries[0]!.fallbackReason, "search_http_407");
    assert.ok(!JSON.stringify(web).includes("secret"));
  } finally {
    keys.forEach((k, i) =>
      env[i] === undefined ? delete process.env[k] : (process.env[k] = env[i]),
    );
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report reuse follows per-query freshness and resumes primary collection after fallback expiry", () => {
  const now = Date.parse("2026-09-18T13:00:00Z");
  const web = {
    provider: "multi-search" as const,
    region: "US",
    language: "en",
    fetchedAt: new Date(now).toISOString(),
    state: "ready" as const,
    queries: [
      {
        query: "tools pricing",
        intent: "competition" as const,
        state: "ready" as const,
        engine: "duckduckgo" as const,
        fetchedAt: new Date(now - 29 * 60000).toISOString(),
        results: [],
      },
    ],
  };
  assert.equal(searchEvidenceIsFresh(web, now), true);
  assert.equal(searchEvidenceIsFresh(web, now + 60000), false);
  assert.equal(
    searchEvidenceIsFresh(
      { ...web, queries: [{ ...web.queries[0]!, engine: "google" }] },
      now + 60000,
    ),
    true,
  );
  assert.equal(
    searchEvidenceIsFresh(
      { ...web, queries: [{ ...web.queries[0]!, fetchedAt: "invalid" }] },
      now,
    ),
    false,
  );
  assert.equal(
    searchEvidenceIsFresh(
      {
        ...web,
        queries: [
          {
            ...web.queries[0]!,
            fetchedAt: new Date(now + 120000).toISOString(),
          },
        ],
      },
      now,
    ),
    false,
  );
  assert.equal(searchEvidenceIsFresh({ ...web, queries: [] }, now), false);
});
