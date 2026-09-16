import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Research } from "../src/providers/research.js";
import { Trends, parseTimeline } from "../src/providers/trends.js";
import { Store } from "../src/core/store.js";
import type { Market } from "../src/core/types.js";

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
      /Could not identify/,
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
      (e: any) => e.status === 422 && e.choices.length === 2,
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
