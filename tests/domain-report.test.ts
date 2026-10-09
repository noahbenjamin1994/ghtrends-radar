import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import {
  parseReport,
  reportSections,
  type ReportContent,
} from "../src/core/report-contract.js";
import {
  singleReport,
  reportPhase,
  finalizeReport,
} from "../src/providers/report.js";
import { DECISION_PROMPT } from "../src/core/decision.js";
import { operationContext } from "../src/core/operations.js";
import { researchWarnings } from "../src/core/evidence.js";
import { marketMarkdown } from "../src/core/report.js";
import { renderDocument } from "../src/server/html.js";
import type { Market, ResearchSource } from "../src/core/types.js";

const text = {
  en: "The evidence is limited; no purchase demand is established.",
  zh: "证据有限，尚不能确认付费需求。",
};
function draft(): ReportContent {
  return {
    headline: text,
    overview: text,
    demandTrend: { status: "missing", summary: text, evidence: [] },
    commercialSupply: { status: "limited", summary: text, evidence: [] },
    openSourceSupply: { status: "limited", summary: text, evidence: [] },
    userNeeds: { status: "missing", summary: text, evidence: [] },
    directions: [],
    nextStep: text,
    limitations: [text],
  };
}
/** What the model returns: the decision draft, citations by ID only. */
const decisionDraft = () => ({
  verdict: { kind: "insufficient", reason: text },
  pains: [] as unknown[],
  commercial: [] as unknown[],
  openSource: [] as unknown[],
  directions: [] as unknown[],
  nextStep: null,
  unverified: [text],
});
const source: ResearchSource = {
  id: "S1",
  label: "Example",
  url: "https://example.com/",
  excerpt: "The starter plan does not support searching comments.",
};

test("report follows four perspectives and does not force three directions", () => {
  assert.equal(reportSections.length, 4);
  assert.equal(parseReport(draft(), [source]).directions.length, 0);
  assert.match(DECISION_PROMPT, /Do not invent three ideas first/);
  assert.match(DECISION_PROMPT, /Preserve negation/);
});
test("observations require references and quotes retain original negation", () => {
  const raw = draft();
  raw.commercialSupply.status = "observed";
  assert.throws(() => parseReport(raw, [source]), /requires source/);
  raw.commercialSupply.evidence = [
    { id: "S1", quote: "does not support searching comments" },
  ];
  assert.ok(parseReport(raw, [source]));
  raw.commercialSupply.evidence[0]!.quote = "does support searching comments";
  assert.throws(() => parseReport(raw, [source]), /does not match/);
  raw.commercialSupply.evidence = [
    { id: "missing", quote: "does not support" },
  ];
  assert.throws(() => parseReport(raw, [source]), /does not match/);
});

test("trend windows are deterministic and vendor-only evidence cannot create demand directions", () => {
  const market: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  market.demand.error = undefined;
  market.demand.collectionError = undefined;
  market.metrics.growth = -0.73;
  const raw = draft();
  raw.demandTrend.summary = { en: "fell over 104 weeks", zh: "104周下降" };
  raw.directions = [
    {
      title: text,
      task: text,
      existingSupply: text,
      entry: text,
      uncertainty: text,
      evidence: [{ id: "S1", quote: "does not support" }],
    },
  ];
  const result = finalizeReport(raw, market, [source]);
  assert.match(
    result.demandTrend.summary.zh,
    /最近8个完整周较此前8周下降73.0%/,
  );
  assert.equal(result.directions.length, 0);
  assert.equal(result.userNeeds.status, "missing");
  assert.match(result.overview.zh, /尚不能确认市场缺口/);
});
test("report phase aborts in-flight work at deadline and never starts expired work", async () => {
  let aborted = false;
  const start = Date.now();
  await assert.rejects(
    reportPhase(
      20,
      () =>
        new Promise(() => {
          operationContext.getStore()!.signal!.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    ),
    /report_deadline/,
  );
  assert.equal(aborted, true);
  assert.ok(Date.now() - start < 1000);
  let calls = 0;
  await operationContext.run(
    { runId: "expired", signal: AbortSignal.abort() },
    async () => {
      await assert.rejects(
        reportPhase(50, async () => {
          calls++;
        }),
      );
    },
  );
  assert.equal(calls, 0);
});

test("one report write, short input, private snapshot, bilingual exports and no deep start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "domain-report-"));
  const engine = new Engine(new Store(dir));
  const base: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  engine.trends.demand = async () => base.demand;
  engine.github.supply = async (_topic, _onBase, baseOnly) => {
    assert.equal(baseOnly, true);
    return base.supply;
  };
  engine.search.collect = async () => ({
    provider: "multi-search",
    region: "US",
    language: "en",
    state: "failed",
    fetchedAt: new Date().toISOString(),
    queries: [],
  });
  let calls = 0;
  engine.research.json = async (_prompt, input, max, operation, thinking) => {
    calls++;
    assert.equal(operation, "report-write");
    assert.equal(max, 6500);
    assert.equal(thinking, false);
    assert.ok(JSON.stringify(input).length < 20000);
    assert.doesNotMatch(JSON.stringify((input as any).outputSchema), /"\$ref"/);
    return decisionDraft();
  };
  try {
    const report = await singleReport(
      engine,
      "social media search API",
      base.topic,
      { geo: "US", owner: "qa", private: true },
    );
    assert.equal(calls, 1);
    assert.equal(report.aiError, undefined);
    assert.ok(report.brief?.report);
    assert.equal(report.brief?.decision?.verdict.kind, "insufficient");
    assert.deepEqual(report.brief?.decision?.directions, []);
    assert.equal(report.brief?.decision?.nextStep, null);
    assert.notEqual(report.id, base.id);
    assert.equal(engine.store.canRead(report.id), false);
    assert.equal(engine.store.canRead(report.id, "qa"), true);
    const md = marketMarkdown(report, undefined, "zh");
    for (const heading of [
      "结论",
      "需求分析",
      "竞品分析",
      "市场趋势",
      "机会方向",
    ])
      assert.ok(md.includes("## " + heading), heading);
    assert.match(md, /待验证/);
    assert.match(md, /暂无机会方向/);
    assert.doesNotMatch(md, /## 下一步/);
    const html = renderDocument(
      readFileSync(new URL("../index.html", import.meta.url), "utf8"),
      {
        base: "https://ghtrends.dev/radar",
        path: `/report/${report.id}`,
        geo: "US",
        market: report,
        markets: [],
        status: 200,
        locale: "zh",
      },
    );
    assert.match(html, /商业供给/);
    assert.match(html, /用户需求/);
    engine.research.json = async () => {
      calls++;
      throw Error("bad output");
    };
    const failed = await singleReport(
      engine,
      "social media search API",
      base.topic,
      { geo: "US", owner: "qa", private: true },
    );
    assert.ok(failed.aiError);
    assert.equal(calls, 2);
    assert.equal(failed.brief, undefined);
    assert.notEqual(failed.id, report.id);
    assert.ok(engine.store.report(report.id)?.brief?.report);
  } finally {
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interrupted queries and a blank model section retain valid material without charging", async () => {
  const dir = mkdtempSync(join(tmpdir(), "report-partial-search-"));
  const engine = new Engine(new Store(dir));
  const base: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  engine.trends.demand = async () => base.demand;
  engine.github.supply = async () => base.supply;
  engine.search.collect = async (
    _topic,
    _geo,
    _queries,
    _budget,
    _proxy,
    onProgress,
  ) => {
    onProgress?.({
      provider: "multi-search",
      region: "US",
      language: "en",
      fetchedAt: new Date().toISOString(),
      state: "partial",
      queries: [
        {
          query: "sample pricing",
          intent: "competition",
          state: "ready",
          engine: "brave",
          results: [
            {
              title: "Sample plans",
              url: "https://sample.example/plans",
              excerpt: "Plans for sample customers.",
              kind: "organic",
            },
          ],
        },
        {
          query: "sample problems",
          intent: "demand",
          state: "pending",
          results: [],
        },
      ],
    });
    throw new Error("search_timeout");
  };
  engine.documents.readWeb = async (url) => ({
    sources: [],
    read: { url, status: "unavailable", observedAt: new Date().toISOString() },
    cached: false,
  });
  engine.research.json = async () => ({
    ...decisionDraft(),
    openSource: [{ name: "broken", capability: { en: "", zh: "" } }],
  });
  try {
    const out = await singleReport(engine, "sample topic", base.topic, {
      geo: "US",
      private: true,
    });
    assert.ok(out.brief?.report);
    assert.ok(out.aiError);
    assert.equal(out.brief.report.openSourceSupply.status, "missing");
    assert.deepEqual(out.brief.decision?.openSource, []);
    assert.deepEqual(out.brief.report.directions, []);
    assert.equal(out.brief.decision?.coverage.supply, "partial");
    assert.ok(
      out.brief.decision?.coverage.gaps.some(
        (g) => g.lane === "pains" && g.label === "sample problems",
      ),
    );
    assert.ok(researchWarnings(out, true).includes(out.aiError));
    assert.equal(out.web?.state, "partial");
    assert.equal(out.web?.queries[0]?.results.length, 1);
    assert.equal(out.web?.queries[1]?.state, "failed");
    assert.equal(out.web?.queries[1]?.error, "search_timeout");
    assert.ok(
      out.brief?.sources.some((s) => s.url === "https://sample.example/plans"),
    );
  } finally {
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
