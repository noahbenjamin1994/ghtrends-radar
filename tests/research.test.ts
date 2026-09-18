import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Research, parseModelJson } from "../src/providers/research.js";
import { Trends, parseTimeline } from "../src/providers/trends.js";
import { Store } from "../src/core/store.js";
import { marketAssessment } from "../src/core/assessment.js";
import type { Market } from "../src/core/types.js";
import { hasRecoveryTimeReference } from "../src/core/i18n.js";

test("source observation times remain valid prose while operational recovery timers stay in source status", () => {
  assert.equal(
    hasRecoveryTimeReference("Publisher claims for the shown time and region."),
    false,
  );
  assert.equal(
    hasRecoveryTimeReference("Refresh at the time shown on this page."),
    true,
  );
  assert.equal(hasRecoveryTimeReference("按页面提示的时间刷新。"), true);
});

test("model JSON recovery preserves content and only repairs structural punctuation", () => {
  assert.deepEqual(
    parseModelJson(
      '{"opportunities":[{"en":{"title":"A, B: phones"}}],"count":2,}',
    ),
    { opportunities: [{ en: { title: "A, B: phones" } }], count: 2 },
  );
  assert.deepEqual(
    parseModelJson(
      '{"items":[{"id":"phone","copy":{"title":"原样保留"}}],"ok":true}',
    ),
    { items: [{ id: "phone", copy: { title: "原样保留" } }], ok: true },
  );
  assert.deepEqual(
    parseModelJson(
      '{"items":[{"id":"phone","copy":{"title":"原样保留"}}],"ok":true,}',
    ),
    { items: [{ id: "phone", copy: { title: "原样保留" } }], ok: true },
  );
  assert.throws(() => parseModelJson('{"title":"cut off'));
  assert.throws(() => parseModelJson('{title:"invented key quotes"}'));
  assert.throws(() => parseModelJson('{"rating":None}'));
});

test("repository reviews preserve individually valid evidence and reject conflicting or fabricated rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-roles-"));
  const store = new Store(dir);
  const old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  try {
    const research = new Research(store);
    const m: Market = JSON.parse(
      readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
    )[0];
    const base = m.supply.repositories[0]!;
    const repositories = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      name: `team${i}/product`,
      description: `A database serving task ${i}`,
    }));
    const s = { ...m.supply, repositories, error: undefined };
    let calls = 0;
    research.json = async () => {
      calls++;
      return {
        projects: [
          {
            id: repositories[0]!.name,
            role: "direct",
            quote: repositories[0]!.description,
          },
          {
            id: repositories[1]!.name,
            role: "adjacent",
            quote: "invented source evidence",
          },
          {
            id: repositories[2]!.name,
            role: "direct",
            quote: repositories[2]!.description,
          },
          {
            id: repositories[2]!.name,
            role: "resource",
            quote: repositories[2]!.description,
          },
          {
            id: "external/injection",
            role: "direct",
            quote: "invented source evidence",
          },
          {
            id: repositories[3]!.name,
            role: "invalid",
            quote: repositories[3]!.description,
          },
          null,
        ],
      };
    };
    const reviewed = await research.reviewSupply(m.topic, s);
    assert.equal(reviewed.review?.status, "partial");
    assert.equal(reviewed.review?.reviewed, 1);
    assert.equal(reviewed.repositories[0]!.relevance?.method, "model");
    for (const r of reviewed.repositories.slice(1))
      assert.equal(r.relevance?.method, "rules");
    assert.deepEqual(
      (await research.reviewSupply(m.topic, s)).review,
      reviewed.review,
    );
    assert.equal(calls, 1);
    research.json = async () => ({
      projects: [
        { id: "foreign/product", role: "direct", quote: "foreign/product" },
      ],
    });
    assert.equal(
      (
        await research.reviewSupply(
          { ...m.topic, keyword: "fresh cache key" },
          s,
        )
      ).review?.status,
      "fallback",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});

test("named-entity planning separates synonyms from buyer intent and preserves the original supply scope", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-query-scope-"));
  const store = new Store(dir),
    old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  try {
    const research = new Research(store);
    const base = {
      slug: "tmux",
      name: "tmux",
      scope: "category",
      intent: "Opportunities around tmux",
      entity: { name: "tmux", aliases: [] },
      trends: ["tmux", "terminal multiplexer", "tmux alternatives"],
      githubTopics: ["tmux", "terminal-multiplexer"],
      githubTopicGroups: [],
      githubTerms: ["tmux", "terminal multiplexer"],
      explanation: {
        en: "Research the named product and its ecosystem.",
        zh: "研究指定产品及其生态。",
      },
      ambiguity: null,
      choices: null,
    };
    let result: any = base;
    research.json = async () => result;
    const plan = await research.plan("tmux");
    assert.deepEqual(plan.plan?.trends, ["tmux"]);
    assert.deepEqual(plan.queries, [
      "topic:tmux",
      '"tmux" in:name,description',
    ]);
    assert.deepEqual(plan.plan?.entity, { name: "tmux", aliases: [] });
    result = {
      ...base,
      entity: { name: "7-Zip", aliases: ["7zip"] },
      trends: ["7zip", "file archiver"],
      githubTopics: ["file-archiver"],
      githubTerms: ["compression utility"],
    };
    assert.deepEqual((await research.plan("7-Zip")).queries, [
      '"7zip" in:name,description',
    ]);
    result = {
      ...base,
      entity: { name: "Bun", aliases: [] },
      trends: ["Bun", "Bunny"],
      githubTopics: ["bun", "bunny"],
      githubTerms: [],
    };
    assert.deepEqual((await research.plan("Bun")).queries, ["topic:bun"]);
    result = {
      ...base,
      entity: { name: "123apps", aliases: [] },
      trends: ["online file converter"],
      githubTopics: ["file-converter"],
    };
    await assert.rejects(research.plan("123apps"), /original search phrase/);
    // An explicit demand override can differ from the original supply object.
    const overridden = await research.plan("123apps", "online file converter");
    assert.deepEqual(overridden.plan?.trends, ["online file converter"]);
    assert.deepEqual(overridden.queries, ['"123apps" in:name,description']);
    result = {
      ...base,
      trends: ["tmux alternatives"],
      githubTerms: ["tmux alternatives"],
    };
    assert.deepEqual((await research.plan("tmux alternatives")).plan?.trends, [
      "tmux alternatives",
    ]);
    result = { ...base, entity: { name: 'tmux" OR stars:0', aliases: [] } };
    await assert.rejects(
      research.plan("entity injection"),
      /could not be validated/,
    );
    result = { ...base, entity: { name: "___", aliases: [] } };
    await assert.rejects(
      research.plan("entity punctuation"),
      /could not be validated/,
    );
    result = {
      ...base,
      entity: {
        name: "12306",
        aliases: ["中国铁路12306", "铁路12306", "China Railway 12306"],
      },
      trends: ["12306"],
      githubTopics: ["12306"],
      githubTerms: ["12306"],
    };
    assert.equal((await research.plan("12306")).keyword, "12306");
    result = {
      ...base,
      entity: null,
      trends: ["apple juice", "100% apple juice"],
      githubTopics: ["apple-juice"],
      githubTerms: ["apple juice"],
    };
    assert.deepEqual((await research.plan("Apple fruit juice")).plan?.trends, [
      "apple juice",
      "100% apple juice",
    ]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});

test("AI plans are bounded, validated, cached, and distinguish ambiguous inputs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-research-")),
    store = new Store(dir),
    old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const research = new Research(store);
  const plan = {
    slug: "ai-for-science",
    name: "AI for Science",
    intent: "Scientific research tools",
    trends: ["AI for Science", "AI for scientific research"],
    githubTopics: ["ai4science", "ai-for-science"],
    githubTerms: ["AI for Science"],
    explanation: { en: "Expanded acronym", zh: "展开缩写" },
    needsClarification: false,
    choices: [],
  };
  let result: any = plan,
    calls = 0;
  research.json = async () => {
    calls++;
    return result;
  };
  try {
    const p = await research.plan("ai4s");
    assert.equal(p.keyword, "AI for Science");
    assert.deepEqual(p.queries, [
      "topic:ai4science",
      "topic:ai-for-science",
      "topic:ai4s",
    ]);
    assert.equal((await research.plan("ai4s")).plan?.input, "ai4s");
    assert.equal(calls, 0);
    assert.equal(p.plan?.model, "curated");
    assert.deepEqual(p.plan?.trends, ["AI for Science"]);
    const override = await research.plan("AI4S", "scientific machine learning");
    assert.equal(override.keyword, "scientific machine learning");
    result = {
      ...plan,
      slug: "browser-automation",
      trends: ["browser automation"],
      githubTopics: ["browser-automation"],
    };
    const canonical = await research.plan("browser-agents");
    assert.equal(canonical.slug, "browser-agents");
    assert.equal(canonical.keyword, "browser agent");
    assert.deepEqual(canonical.queries, [
      "topic:browser-agent",
      '"browser agent" in:name,description',
      "topic:browser-automation topic:ai-agents",
      "topic:browser-automation topic:ai-agent",
    ]);
    assert.deepEqual(canonical.plan?.trends, ["browser agent"]);
    assert.equal(calls, 0);
    result = {
      ...plan,
      slug: "password-managers",
      githubTopics: ["self-hosted"],
      githubTopicGroups: [["password-manager", "self-hosted"]],
      githubTerms: ["self-hosted password manager"],
    };
    const compound = await research.plan("self hosted password manager");
    assert.deepEqual(compound.queries, [
      "topic:password-manager topic:self-hosted",
      '"self-hosted password manager" in:name,description',
    ]);
    const overridden = await research.plan("custom input", "exact phrase");
    assert.deepEqual(overridden.plan?.trends, ["exact phrase"]);
    result = { unrecognized: true };
    await assert.rejects(
      research.plan("unrecognizable token"),
      /Add a product/,
    );
    result = { ...plan, githubTopics: ["ai4s OR stars:0"] };
    await assert.rejects(
      research.plan("query injection"),
      /could not be validated/,
    );
    result = { ...plan, trends: ["https://evil.example/steal?key=x"] };
    await assert.rejects(
      research.plan("invalid query"),
      /could not be validated/,
    );
    result = {
      ...plan,
      needsClarification: true,
      ambiguity: { en: "Which meaning?", zh: "哪种含义？" },
      choices: [
        { label: "Science", query: "AI for Science" },
        { label: "Accessibility", query: "AI accessibility" },
      ],
    };
    await assert.rejects(
      research.plan("unclear acronym"),
      (e: any) => e.status === 422 && e.choices.length === 2,
    );
    const { ambiguity, ...withoutQuestion } = result;
    result = withoutQuestion;
    await assert.rejects(
      research.plan("harness engineering"),
      (e: any) => e.status === 422 && e.choices.length === 3,
    );
    await assert.rejects(
      research.plan("rsi"),
      (e: any) => e.status === 422 && e.choices.length === 3,
    );
    const callsBeforeKnown = calls;
    assert.deepEqual((await research.plan("vibe coding")).plan?.trends, [
      "vibe coding",
    ]);
    assert.deepEqual((await research.plan("agent skills")).plan?.trends, [
      "agent skills",
    ]);
    assert.equal(calls, callsBeforeKnown);
    result = { ...result, choices: [] };
    await assert.rejects(
      research.plan("empty ambiguity"),
      /could not be validated/,
    );
    result = {
      en: {
        summary: "Evidence is mixed.",
        nextSteps: ["Compare a narrower use case."],
      },
      zh: { summary: "证据存在分歧。", nextSteps: ["比较更具体的场景。"] },
    };
    const m = JSON.parse(
      readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
    )[0];
    const brief = await research.brief(m);
    assert.equal(brief.model, "deepseek-flash");
    assert.equal(brief.sources[0]?.url, m.demand.sourceUrl);
    result = {
      en: { summary: "There is no demand.", nextSteps: ["Do not build."] },
      zh: { summary: "没有需求。", nextSteps: ["不要开发。"] },
    };
    await assert.rejects(research.brief(m), /Review the collected evidence/);
    result = {
      en: {
        summary: "Refresh after retryAt.",
        nextSteps: ["Open the source."],
      },
      zh: { summary: "按页面提示时间刷新。", nextSteps: ["打开来源。"] },
    };
    await assert.rejects(research.brief(m), /Review the collected evidence/);
    result = {
      en: {
        summary: "Review the sources.",
        nextSteps: ["Refresh at the time shown on this page."],
      },
      zh: { summary: "查看来源证据。", nextSteps: ["按页面提示的时间刷新。"] },
    };
    delete m.demand.retryAt;
    m.demand.alternatives = [];
    await assert.rejects(research.brief(m), /Review the collected evidence/);
    m.brief = { ...result, model: "test", generatedAt: m.asOf, sources: [] };
    assert.equal(marketAssessment(m).narrative.kind, "evidence");
    m.demand.retryAt = new Date(Date.now() + 60000).toISOString();
    assert.equal(
      (await research.brief(m)).en.nextSteps[0],
      result.en.nextSteps[0],
    );
    result = { en: { summary: "fabricated" } };
    await assert.rejects(research.brief(m), /could not be validated/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});

test("Trends selects the returned keyword column and excludes missing observations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-series-")),
    store = new Store(dir),
    trends = new Trends(store);
  const rows = [
    { time: "1788652800", value: [80, 20], hasData: [true, true] },
    { time: "1789257600", value: [90, null], hasData: [true, false] },
  ];
  (trends as any).read = async (path: string) =>
    path.includes("multiline")
      ? { default: { timelineData: rows } }
      : path.includes("api/explore")
        ? {
            widgets: [
              {
                id: "TIMESERIES",
                token: "mock",
                request: {
                  resolution: "WEEK",
                  comparisonItem: [
                    {
                      complexKeywordsRestriction: {
                        keyword: [{ value: "variant" }],
                      },
                    },
                    {
                      complexKeywordsRestriction: {
                        keyword: [{ value: "primary" }],
                      },
                    },
                  ],
                },
              },
            ],
          }
        : null;
  try {
    const d = await trends.demand("primary", "", undefined, ["variant"]);
    assert.equal(d.error, undefined);
    assert.equal(d.seriesIndex, 1);
    assert.deepEqual(
      d.points.map((p) => p.value),
      [20],
    );
    assert.deepEqual(
      d.alternatives?.[0]?.points.map((p) => p.value),
      [80, 90],
    );
    assert.deepEqual(
      parseTimeline({
        default: {
          timelineData: [
            { time: "1", value: [null] },
            { time: "2", value: [0] },
            { time: "3", value: [NaN] },
            { time: "4", value: [200] },
          ],
        },
      }).map((p) => p.value),
      [0],
    );
  } finally {
    await trends.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synonyms use separate normalization and choose usable coverage, never the best growth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-fallback-")),
    store = new Store(dir),
    trends = new Trends(store);
  const now = new Date(),
    end = Date.now() - 8 * 86400000;
  const series = (keyword: string, base: number, recent: number) => ({
    keyword,
    geo: "",
    sourceUrl: "https://trends.google.com",
    fetchedAt: now.toISOString(),
    related: [],
    points: Array.from({ length: 104 }, (_, i) => ({
      date: new Date(end - (103 - i) * 7 * 86400000).toISOString(),
      value: i >= 96 ? recent : base,
    })),
    resolution: "WEEK",
  });
  // A weak primary, a falling usable synonym, and a faster-growing synonym.
  for (const [keyword, base, recent] of [
    ["weak", 0, 0],
    ["usable", 30, 15],
    ["rising", 20, 40],
  ] as const)
    store.set(
      `trends:v3:${JSON.stringify([keyword])}:`,
      series(keyword, base, recent),
      60000,
    );
  try {
    const result = await trends.demand("weak", "", undefined, [
      "usable",
      "rising",
    ]);
    assert.equal(result.keyword, "usable");
    assert.equal(result.requestedKeyword, "weak");
    assert.equal(result.alternatives?.length, 2);
    assert.match(result.selectionReason!, /planned order/);
    const original = await trends.demand("usable", "", undefined, ["rising"]);
    assert.equal(original.keyword, "usable");
    assert.equal(original.requestedKeyword, undefined);
  } finally {
    await trends.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sparse query recovery preserves scope, escapes query construction, deduplicates and caches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-repair-")),
    store = new Store(dir),
    old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "unit";
  try {
    const research = new Research(store),
      m: Market = JSON.parse(
        readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
      )[0];
    const topic = {
      ...m.topic,
      scope: "category" as const,
      keyword: "cat translator app",
      description: "A cat vocalization translator app",
      queries: ['"cat translator app" in:name,description'],
    };
    let calls = 0;
    research.json = async () => {
      calls++;
      return {
        terms: ["cat translator", "meow translator"],
        explanation: {
          en: "Retrieve equivalent names for cat translation apps.",
          zh: "补充猫语翻译应用的常见名称。",
        },
      };
    };
    const repaired = await research.repairQueries(topic, {
      ...m.supply,
      total: 0,
      repositories: [],
      error: undefined,
    });
    assert.equal(repaired?.topic.keyword, "cat translator app");
    assert.equal(repaired?.topic.description, topic.description);
    assert.equal(repaired?.topic.queries?.length, 3);
    await research.repairQueries(topic, m.supply);
    assert.equal(calls, 1);
    research.json = async () => ({
      terms: ['cat" OR stars:>1'],
      explanation: { en: "x", zh: "x" },
    });
    assert.equal(
      await research.repairQueries(
        { ...topic, description: "new scope" },
        m.supply,
      ),
      null,
    );
    assert.equal(
      await research.repairQueries({ ...topic, scope: "field" }, m.supply),
      null,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});
test("one failed relevance batch preserves source-quoted reviews from the other batches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-batches-")),
    store = new Store(dir),
    old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "unit";
  try {
    const research = new Research(store),
      m: Market = JSON.parse(
        readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
      )[0];
    const repos = Array.from({ length: 45 }, (_, i) => ({
      ...m.supply.repositories[0]!,
      name: `team${i}/project`,
      description: `Usable software for task ${i}`,
    }));
    let sizes: number[] = [];
    research.json = async (_s, input: any) => {
      sizes.push(input.projects.length);
      if (input.projects[0].id === "team20/project") throw new Error("timeout");
      return {
        projects: input.projects.map((p: any) => ({
          id: p.id,
          role: "direct",
          quote: p.description,
        })),
      };
    };
    const result = await research.reviewSupply(m.topic, {
      ...m.supply,
      repositories: repos,
      error: undefined,
    });
    assert.deepEqual(sizes, [20, 20, 5]);
    assert.equal(result.review?.reviewed, 25);
    assert.equal(result.review?.status, "partial");
    assert.equal(
      result.repositories.filter((r) => r.relevance?.method === "model").length,
      25,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});

test("pipeline retries sparse supply once, preserves successful evidence on repair failure, and saves to its owner", async () => {
  const { Engine } = await import("../src/core/engine.js");
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-repair-flow-")),
    old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "unit";
  const engine = new Engine(new Store(dir));
  try {
    const m: Market = JSON.parse(
      readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
    )[0];
    const topic = {
      ...m.topic,
      scope: "category" as const,
      keyword: "cat translator app",
      query: '"cat translator app" in:name,description',
      queries: ['"cat translator app" in:name,description'],
    };
    engine.research.plan = async () => topic;
    engine.trends.demand = async () => m.demand;
    engine.github.gaps = async () => [];
    engine.github.researchSources = async () => [];
    engine.github.licenseSources = async () => [];
    engine.research.insights = async () => {
      throw new Error("optional brief");
    };
    engine.research.reviewSupply = async (_topic, s) => s;
    engine.research.repairQueries = async () => ({
      topic: {
        ...topic,
        queries: [...topic.queries, '"cat translator" in:name,description'],
      },
      explanation: { en: "Equivalent product naming.", zh: "补充同用途名称。" },
    });
    let calls = 0,
      fail = false;
    engine.github.supply = async (t) => {
      calls++;
      if (t.queries!.length === 1)
        return {
          ...m.supply,
          total: 0,
          repositories: [],
          complete: true,
          error: undefined,
        };
      return {
        ...m.supply,
        total: 1,
        repositories: [m.supply.repositories[0]!],
        complete: true,
        error: fail ? "upstream" : undefined,
      };
    };
    const result = await engine.scan("小猫语言翻译app", {
      private: true,
      owner: "alice",
    });
    assert.equal(calls, 2);
    assert.equal(result.supply.total, 1);
    assert.deepEqual(result.supply.recovery?.addedQueries, [
      '"cat translator" in:name,description',
    ]);
    assert.equal(engine.store.canRead(result.id, "alice"), true);
    assert.equal(engine.store.canRead(result.id, "other"), false);
    fail = true;
    const failed = await engine.scan("小猫语言翻译app", {
      private: true,
      owner: "alice",
      refresh: true,
    });
    assert.equal(failed.supply.total, 0);
    assert.equal(failed.supply.error, undefined);
    assert.equal(calls, 4);
  } finally {
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});
