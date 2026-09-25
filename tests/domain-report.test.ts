import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import {
  parseReport,
  REPORT_PROMPT,
  reportSections,
  type ReportContent,
} from "../src/core/report-contract.js";
import {
  singleReport,
  reportPhase,
  finalizeReport,
} from "../src/providers/report.js";
import { operationContext } from "../src/core/operations.js";
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
const source: ResearchSource = {
  id: "S1",
  label: "Example",
  url: "https://example.com/",
  excerpt: "The starter plan does not support searching comments.",
};

test("report follows four perspectives and does not force three directions", () => {
  assert.equal(reportSections.length, 4);
  assert.equal(parseReport(draft(), [source]).directions.length, 0);
  assert.match(REPORT_PROMPT, /Do not invent three ideas first/);
  assert.match(REPORT_PROMPT, /Preserve negation/);
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
    assert.equal(max, 3600);
    assert.equal(thinking, false);
    assert.ok(JSON.stringify(input).length < 20000);
    return draft();
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
    assert.notEqual(report.id, base.id);
    assert.equal(engine.store.canRead(report.id), false);
    assert.equal(engine.store.canRead(report.id, "qa"), true);
    const md = marketMarkdown(report, undefined, "zh");
    for (const [, , heading] of reportSections) assert.ok(md.includes(heading));
    assert.match(md, /本轮证据不足以支持具体方向/);
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
