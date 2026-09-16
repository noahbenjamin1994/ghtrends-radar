import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { Trends } from "../src/providers/trends.js";
import { Research } from "../src/providers/research.js";
import { Store } from "../src/core/store.js";
import { analyze } from "../src/core/analyze.js";
import { hasNegativeWording, text } from "../src/core/i18n.js";
import { zh, en } from "../src/core/translations.js";
import { marketAssessment } from "../src/core/assessment.js";
import { marketMarkdown } from "../src/core/report.js";
import { renderDocument } from "../src/server/html.js";
import type { Market } from "../src/core/types.js";
const seed: Market = JSON.parse(
  readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
)[0];

async function fixture(
  run: (store: Store, trends: Trends, mock: MockAgent) => Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-resilience-"));
  const store = new Store(dir),
    old = getGlobalDispatcher(),
    mock = new MockAgent();
  mock.disableNetConnect();
  setGlobalDispatcher(mock);
  const trends = new Trends(store);
  try {
    await run(store, trends, mock);
  } finally {
    await trends.close();
    await mock.close();
    setGlobalDispatcher(old);
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("429 stops synonym requests immediately and the cooldown survives a new collector", async () => {
  await fixture(async (store, trends, mock) => {
    let requests = 0;
    mock
      .get("https://trends.google.com")
      .intercept({ path: "/trends/?geo=US" })
      .reply(() => {
        requests++;
        return {
          statusCode: 429,
          data: "limited",
          responseOptions: { headers: { "retry-after": "120" } },
        };
      });
    const started = Date.now();
    const d = await trends.demand("cat translator", "", undefined, [
      "meow translator",
      "cat language translator",
    ]);
    assert.equal(requests, 1);
    assert.equal(d.points.length, 0);
    assert.ok(Date.parse(d.retryAt!) >= started + 119000);
    assert.equal(d.alternatives?.length, 2);
    assert.ok(d.alternatives!.every((a) => a.retryAt === d.retryAt));
    const next = new Trends(store);
    try {
      assert.equal((await next.demand("different phrase")).retryAt, d.retryAt);
    } finally {
      await next.close();
    }
    assert.equal(requests, 1);
    assert.ok(Date.now() - started < 5000);
    mock.assertNoPendingInterceptors();
  });
});

test("HTTP-date cooldown keeps a dated successful snapshot and fresh cached queries available", async () => {
  await fixture(async (store, trends, mock) => {
    const until = new Date(Date.now() + 180000).toUTCString();
    mock
      .get("https://trends.google.com")
      .intercept({ path: "/trends/?geo=US" })
      .reply(429, "limited", { headers: { "retry-after": until } });
    const previous = {
      ...structuredClone(seed.demand),
      keyword: "cat translator",
    };
    store.set('trends:v3:["cat translator"]:', previous, -1000);
    store.set(
      'trends:v3:["cached phrase"]:',
      { ...previous, keyword: "cached phrase" },
      60000,
    );
    const d = await trends.demand("cat translator");
    assert.equal(d.error, undefined);
    assert.ok(d.collectionError);
    assert.equal(Date.parse(d.retryAt!), Date.parse(until));
    assert.equal(d.fetchedAt, previous.fetchedAt);
    assert.deepEqual(d.points, previous.points);
    const cached = await trends.demand("cached phrase");
    assert.equal(cached.collectionError, undefined);
    assert.equal(cached.points.length, previous.points.length);
    const freshSupply = { ...seed.supply, fetchedAt: new Date().toISOString() };
    const old = { ...d, fetchedAt: "2000-01-01T00:00:00Z" };
    assert.equal(analyze(seed.topic, old, freshSupply).kind, "uncertain");
    mock.assertNoPendingInterceptors();
  });
});

test("concurrent identical queries share one successful collection", async () => {
  await fixture(async (_store, trends, mock) => {
    let timelines = 0;
    const pool = mock.get("https://trends.google.com");
    pool
      .intercept({ path: "/trends/?geo=US" })
      .reply(200, "page", {
        headers: {
          "set-cookie": "NID=anonymous-test; Path=/; Secure; HttpOnly",
        },
      });
    pool
      .intercept({
        path: /^\/trends\/api\/explore/,
        headers: { cookie: "NID=anonymous-test" },
      })
      .reply(
        200,
        JSON.stringify({
          widgets: [
            {
              id: "TIMESERIES",
              token: "test",
              request: {
                resolution: "WEEK",
                comparisonItem: [
                  {
                    complexKeywordsRestriction: {
                      keyword: [{ value: "cat translator" }],
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
    pool
      .intercept({ path: /^\/trends\/api\/widgetdata\/multiline/ })
      .reply(() => {
        timelines++;
        return {
          statusCode: 200,
          data: JSON.stringify({
            default: {
              timelineData: [
                { time: "1788652800", value: [35], hasData: [true] },
              ],
            },
          }),
        };
      });
    const [a, b] = await Promise.all([
      trends.demand("cat translator"),
      trends.demand("cat translator"),
    ]);
    assert.deepEqual(a, b);
    assert.equal(a.error, undefined);
    assert.equal(a.points[0]?.value, 35);
    assert.equal(timelines, 1);
    mock.assertNoPendingInterceptors();
  });
});

test("server errors get one bounded retry; the next scan uses the successful cache", async () => {
  await fixture(async (_store, trends, mock) => {
    const pool = mock.get("https://trends.google.com");
    pool.intercept({ path: "/trends/?geo=US" }).reply(200, "page");
    pool.intercept({ path: /^\/trends\/api\/explore/ }).reply(503, "retry");
    pool.intercept({ path: /^\/trends\/api\/explore/ }).reply(
      200,
      JSON.stringify({
        widgets: [
          {
            id: "TIMESERIES",
            token: "test",
            request: {
              resolution: "WEEK",
              comparisonItem: [
                {
                  complexKeywordsRestriction: {
                    keyword: [{ value: "cat translator" }],
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    pool.intercept({ path: /^\/trends\/api\/widgetdata\/multiline/ }).reply(
      200,
      JSON.stringify({
        default: { timelineData: [{ time: "1788652800", value: [35] }] },
      }),
    );
    const d = await trends.demand("cat translator");
    assert.equal(d.error, undefined);
    assert.deepEqual(await trends.demand("cat translator"), d);
    mock.assertNoPendingInterceptors();
  });
});

test("collection gaps stay pending instead of becoming measured zero baselines", async () => {
  const d = {
    ...seed.demand,
    points: [],
    related: [],
    alternatives: [],
    error: "Google Trends returned 429",
    retryAt: new Date(Date.now() + 60000).toISOString(),
  };
  const m = analyze(seed.topic, d, seed.supply, [], seed.asOf);
  assert.equal(m.kind, "uncertain");
  assert.equal(m.metrics.growth, null);
  assert.ok(
    !m.limitations.some((v) =>
      /baseline|Low volume|weekly values are zero/.test(v),
    ),
  );
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-brief-")),
    store = new Store(dir),
    research = new Research(store);
  research.json = async (_system, input: any) => {
    assert.equal(input.search.baselineObserved, false);
    assert.equal(input.search.collectionStatus, "cooling-down");
    assert.equal(input.search.observedWeeks, 0);
    return {
      en: {
        summary:
          "Google Trends is cooling down. Review the source and refresh at the displayed time.",
        nextSteps: ["Open the source."],
      },
      zh: {
        summary: "Google Trends 正在等待恢复，可查看来源并按提示时间刷新。",
        nextSteps: ["打开来源查看。"],
      },
    };
  };
  try {
    const brief = await research.brief(m);
    assert.equal(hasNegativeWording(brief.zh.summary), false);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("product translations use affirmative prose in both languages", () => {
  for (const key of new Set([...Object.keys(zh), ...Object.keys(en)])) {
    for (const locale of ["en", "zh"] as const)
      assert.equal(
        hasNegativeWording(text(key, locale)),
        false,
        `${locale}: ${key}`,
      );
  }
});

test("saved negative narratives render positive evidence in HTML and exports while retaining original evidence", () => {
  const m = structuredClone(seed);
  m.brief = {
    model: "test",
    generatedAt: m.asOf,
    sources: [],
    en: { summary: "There is no demand.", nextSteps: ["Do not build."] },
    zh: { summary: "没有需求。", nextSteps: ["不要开发。"] },
  };
  const original = JSON.stringify(m);
  const template = readFileSync(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  for (const locale of ["en", "zh"] as const) {
    const assessment = marketAssessment(m, locale);
    assert.equal(assessment.narrative.kind, "evidence");
    assert.equal(hasNegativeWording(assessment.narrative.summary), false);
    const markdown = marketMarkdown(m, undefined, locale);
    const html = renderDocument(template, {
      base: "https://ghtrends.dev/radar",
      path: "/report/" + m.id,
      geo: "",
      market: m,
      markets: [m],
      status: 200,
      locale,
    });
    for (const value of [markdown, html]) {
      assert.ok(!value.includes(m.brief[locale].summary));
      assert.ok(
        value.includes(
          text(
            "This recommendation follows the collected source evidence.",
            locale,
          ),
        ),
      );
    }
  }
  assert.equal(JSON.stringify(m), original);
});

test("source-only empty scans return evidence actions directly and save the report", async () => {
  const { Engine } = await import("../src/core/engine.js");
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-pending-")),
    engine = new Engine(new Store(dir));
  (engine.research as any).enabled = true;
  engine.research.plan = async () => seed.topic;
  engine.trends.demand = async () => ({
    ...seed.demand,
    points: [],
    alternatives: [],
    error:
      "Google Trends is cooling down. Refresh after the scheduled time or open the source.",
    retryAt: new Date(Date.now() + 900000).toISOString(),
  });
  engine.github.supply = async () => ({
    ...seed.supply,
    total: 0,
    repositories: [],
    complete: true,
    fetchedAt: new Date().toISOString(),
  });
  engine.github.gaps = async () => [];
  let briefs = 0;
  engine.research.brief = async () => {
    briefs++;
    throw new Error("unexpected model call");
  };
  try {
    const m = await engine.scan("小猫语言翻译器", { refresh: true });
    assert.equal(briefs, 0);
    assert.equal(m.brief, undefined);
    assert.equal(m.aiError, undefined);
    assert.equal(m.kind, "uncertain");
    assert.ok(engine.store.report(m.id));
    assert.match(
      marketAssessment(m, "zh").nextSteps.join(" "),
      /页面提示的恢复时间/,
    );
  } finally {
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed anonymous session bootstrap stops before protected API requests", async () => {
  await fixture(async (_store, trends, mock) => {
    const pool = mock.get("https://trends.google.com");
    pool.intercept({ path: "/trends/?geo=US" }).reply(503, "retry").times(2);
    const d = await trends.demand("cat translator");
    assert.match(d.error!, /503/);
    assert.equal(d.retryAt, undefined);
    mock.assertNoPendingInterceptors();
  });
});
