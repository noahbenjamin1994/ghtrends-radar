import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { marketAssessment } from "../src/core/assessment.js";
import { marketCard } from "../src/core/card.js";
import { marketMarkdown } from "../src/core/report.js";
import { CompetitorPanel } from "../src/web/landscape.js";
import type { Market } from "../src/core/types.js";
const seed: Market = JSON.parse(
  readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
)[0];

test("broad-topic fallback retains a scoped red-ocean verdict, input and facts across exports", () => {
  const m = structuredClone(seed);
  delete m.brief;
  m.topic = {
    ...m.topic,
    name: "Auto Research",
    scope: "field",
    plan: undefined,
  };
  m.kind = "uncertain";
  m.supplyDensity = "dense";
  m.supply.error = undefined;
  m.supply.fetchedAt = m.asOf;
  m.competition = { ...m.competition!, level: "established", direct: 59 };
  const before = JSON.stringify(m);
  const a = marketAssessment(m, "zh");
  assert.equal(a.kind, "contested");
  assert.equal(a.landscape, "红海");
  assert.match(a.title, /Auto Research/);
  assert.match(a.summary, /59 个同类开源项目/);
  assert.match(a.basisLabel, /开源竞争/);
  for (const output of [
    a.title,
    a.summary,
    marketMarkdown(m, undefined, "zh"),
    marketCard(m, "https://example.com", "zh"),
  ]) {
    assert.doesNotMatch(
      output,
      /选择领域中的具体工作流|领域概览|看清问题，让下一步更笃定/,
    );
    assert.match(output, /红海|59/);
  }
  assert.equal(JSON.stringify(m), before);
  m.supply.fetchedAt = "2000-01-01";
  assert.equal(
    marketAssessment(m).kind,
    "uncertain",
    "stale evidence cannot establish the current verdict",
  );
  m.supply.fetchedAt = m.asOf;
  m.competition.level = "limited";
  assert.equal(
    marketAssessment(m).kind,
    "uncertain",
    "sparse broad-topic retrieval does not establish a blue ocean",
  );
});

test("organic pages remain useful discovery leads while ads appear only for captured placements", () => {
  const m = structuredClone(seed);
  delete m.brief;
  m.web = {
    provider: "multi-search",
    region: "US",
    language: "en",
    fetchedAt: "2026-09-20",
    state: "ready",
    version: "4",
    queries: [
      {
        query: "research product pricing",
        intent: "competition",
        state: "ready",
        adCoverage: "limited",
        results: [
          {
            title: "Research tool pricing",
            excerpt: "Plans for research teams.",
            url: "https://tool.example/pricing",
            kind: "organic",
          },
          {
            title: "Research tool duplicate",
            excerpt: "Another page.",
            url: "https://tool.example/plans",
            kind: "organic",
          },
        ],
      },
    ],
  };
  let html = renderToStaticMarkup(
    createElement(CompetitorPanel, { market: m, locale: "zh" }),
  );
  assert.match(html, /Research tool pricing/);
  assert.match(html, /保留网页原文/);
  assert.doesNotMatch(html, /广告里的同行|CRM 实测示例|完整广告位覆盖待补充/);
  assert.equal((html.match(/class="peer-card"/g) || []).length, 1);
  assert.match(html, /广告采样范围/);
  m.web.queries[0]!.results.push({
    title: "Actual sponsored offer",
    excerpt: "A captured ad.",
    url: "https://advertiser.example/offer",
    kind: "ad",
  });
  html = renderToStaticMarkup(
    createElement(CompetitorPanel, { market: m, locale: "zh" }),
  );
  assert.match(html, /广告里的同行/);
  assert.match(html, /Actual sponsored offer/);
  assert.match(html, /research product pricing/);
});
