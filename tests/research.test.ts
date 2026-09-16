import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Research } from "../src/providers/research.js";
import { Trends, parseTimeline } from "../src/providers/trends.js";
import { Store } from "../src/core/store.js";

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
      '"AI for Science" in:name,description',
    ]);
    assert.equal((await research.plan("ai4s")).plan?.input, "ai4s");
    assert.equal(calls, 1);
    const override = await research.plan("AI4S", "scientific machine learning");
    assert.equal(override.keyword, "scientific machine learning");
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
    assert.match(result.selectionReason!, /never growth direction/);
    const original = await trends.demand("usable", "", undefined, ["rising"]);
    assert.equal(original.keyword, "usable");
    assert.equal(original.requestedKeyword, undefined);
  } finally {
    await trends.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
