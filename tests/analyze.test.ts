import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, demandMetrics } from "../src/core/analyze.js";
import { TOPICS, validateRepo, resolveTopic } from "../src/core/topics.js";
import type {
  DemandEvidence,
  SupplyEvidence,
  Repo,
} from "../src/core/types.js";
const asOf = "2026-09-15T12:00:00.000Z";
function demand(
  mode: "growing" | "flat" | "spike" | "zero" | "seasonal" = "flat",
): DemandEvidence {
  const values = Array.from({ length: 104 }, () => 20);
  if (mode === "growing" || mode === "seasonal")
    for (let i = 96; i < 104; i++) values[i] = 40;
  if (mode === "seasonal") for (let i = 44; i < 52; i++) values[i] = 40;
  if (mode === "spike") values[103] = 100;
  if (mode === "zero") values.fill(0);
  return {
    keyword: "test",
    geo: "",
    fetchedAt: asOf,
    sourceUrl: "https://trends.google.com",
    related: [],
    points: values.map((value, i) => ({
      date: new Date(
        Date.parse("2026-09-06T00:00:00Z") - (103 - i) * 7 * 86400000,
      ).toISOString(),
      value,
      anchor: 10,
    })),
  };
}
function supply(n: number): SupplyEvidence {
  return {
    query: "topic:test",
    sourceUrl: "https://github.com/search",
    fetchedAt: asOf,
    total: n,
    complete: true,
    repositories: Array.from({ length: Math.min(n, 150) }, (_, i): Repo => ({
      name: `team-${i}/mcp-server`,
      description: "A usable MCP server",
      url: `https://github.com/team-${i}/mcp-server`,
      stars: 250,
      forks: 20,
      language: "TypeScript",
      license: "MIT",
      archived: false,
      createdAt: "2024-01-01T00:00:00Z",
      pushedAt: "2026-09-10T00:00:00Z",
      topics: ["mcp-server"],
      starHistory: [],
      growth7d: null,
      growth30d: null,
      growthWindowEnd: null,
      openIssues: 0,
      issueResponseHours: null,
      issueSampleSize: 0,
      unansweredIssues: 0,
      contributors: null,
      topContributorShare: null,
      fetchedAt: asOf,
      errors: [],
      relevance: {
        role: "direct",
        method: "rules",
        reason: "Matches researched category",
      },
    })),
  };
}
for (const [kind, n, mode] of [
  ["blue", 12, "growing"],
  ["expanding", 150, "growing"],
  ["contested", 150, "flat"],
  ["quiet", 12, "flat"],
] as const) {
  test(`classifies ${kind} from independent supply and demand`, () =>
    assert.equal(
      analyze(TOPICS[0]!, demand(mode), supply(n), [], asOf).kind,
      kind,
    ));
}
test("one viral search spike cannot manufacture a blue ocean", () =>
  assert.equal(
    analyze(TOPICS[0]!, demand("spike"), supply(10), [], asOf).kind,
    "quiet",
  ));
test("a rebound to last year's level does not prove seasonality", () => {
  const m = analyze(TOPICS[0]!, demand("seasonal"), supply(10), [], asOf);
  assert.equal(m.metrics.seasonal, false);
  assert.equal(m.metrics.trend, "rising");
  assert.equal(m.metrics.yearOverYear, 0);
  assert.equal(m.confidence, "moderate");
  assert.equal(m.score, null);
});
test("zero search values mean insufficient evidence, never a dead market", () => {
  const m = analyze(TOPICS[0]!, demand("zero"), supply(0), [], asOf);
  assert.equal(m.kind, "uncertain");
  assert.equal(m.score, null);
  assert.equal(m.metrics.growth, null);
});
test("missing and stale sources cannot earn confident classifications", () => {
  const d = demand("growing");
  d.fetchedAt = "2026-08-01";
  assert.equal(analyze(TOPICS[0]!, d, supply(10), [], asOf).kind, "uncertain");
  const s = supply(5);
  s.complete = false;
  assert.equal(
    analyze(TOPICS[0]!, demand("growing"), s, [], asOf).kind,
    "uncertain",
  );
});
test("partial, duplicate and future observations do not inflate evidence", () => {
  const d = demand();
  d.points = [
    ...d.points,
    ...d.points,
    { date: "2027-01-01", value: 100 },
    { date: "2026-09-13", value: 100, partial: true },
  ];
  assert.equal(demandMetrics(d, asOf).points, 104);
});
test("result identity includes evidence and is deterministic", () => {
  const a = analyze(TOPICS[0]!, demand(), supply(10), [], asOf),
    b = analyze(TOPICS[0]!, demand(), supply(10), [], asOf),
    c = analyze(TOPICS[0]!, demand(), supply(11), [], asOf);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
});
test("repo and keyword boundaries reject unsafe input", () => {
  for (const n of [
    "../../etc/passwd",
    "owner/repo?token=secret",
    "https://evil.test/o/r",
    "owner/..",
  ])
    assert.throws(() => validateRepo(n));
  assert.equal(
    validateRepo("https://github.com/facebook/react"),
    "facebook/react",
  );
  assert.throws(() => resolveTopic("<script>"));
});
test("daily or missing-week data cannot be mistaken for weekly demand", () => {
  const d = demand("growing");
  d.points.splice(95, 1);
  assert.equal(analyze(TOPICS[0]!, d, supply(10), [], asOf).kind, "uncertain");
  const daily = demand("growing");
  daily.points = daily.points.map((p, i) => ({
    ...p,
    date: new Date(Date.parse(asOf) - (104 - i) * 86400000).toISOString(),
  }));
  assert.equal(demandMetrics(daily, asOf).fast, null);
});
test("keyword overrides are validated for curated categories too", () =>
  assert.throws(() => resolveTopic("mcp", "<script>")));

test("an unfinished week without a partial flag cannot complete a breakout", () => {
  const d = demand();
  [20, 40, 20, 40, 20, 40, 40, 40].forEach((value, i) => {
    d.points[96 + i]!.value = value;
  });
  const before = analyze(TOPICS[0]!, d, supply(12), [], asOf);
  d.points.push({ date: "2026-09-13T00:00:00Z", value: 40 });
  const after = analyze(TOPICS[0]!, d, supply(12), [], asOf);
  assert.equal(before.metrics.fast, false);
  assert.equal(after.kind, before.kind);
  assert.deepEqual(after.metrics, before.metrics);
  assert.equal(after.metrics.persistence, 5 / 8);
});

test("invalid fresh rows cannot revive stale historical growth", () => {
  const d = demand("growing");
  d.points = d.points.map((p) => ({
    ...p,
    date: new Date(Date.parse(p.date) - 56 * 86400000).toISOString(),
  }));
  assert.equal(analyze(TOPICS[0]!, d, supply(12), [], asOf).kind, "uncertain");
  d.points.push({ date: "2026-09-06T00:00:00Z", value: NaN });
  const m = analyze(TOPICS[0]!, d, supply(12), [], asOf);
  assert.equal(m.kind, "uncertain");
  assert.equal(m.score, null);
  assert.match(m.limitations.join(" "), /stale or missing/);
});

test("conflicting duplicate weeks cannot classify differently by input order", () => {
  const d = demand("growing");
  d.points.push(...d.points.slice(-8).map((p) => ({ ...p, value: 20 })));
  const first = analyze(TOPICS[0]!, d, supply(12), [], asOf);
  d.points.reverse();
  const second = analyze(TOPICS[0]!, d, supply(12), [], asOf);
  assert.equal(first.kind, "uncertain");
  assert.equal(second.kind, "uncertain");
  assert.deepEqual(first.metrics, second.metrics);
  assert.match(first.limitations.join(" "), /conflicting/);
});

test("time passing cannot complete an observation collected midweek", () => {
  const d = demand("growing");
  d.points.push({ date: "2026-09-13T00:00:00Z", value: 40 });
  const weekEnd = "2026-09-20T00:00:00Z";
  assert.equal(demandMetrics(d, weekEnd).points, 104);
  d.fetchedAt = weekEnd;
  assert.equal(demandMetrics(d, weekEnd).points, 105);
});

test("rejected future rows do not override a valid recent series", () => {
  const d = demand("growing");
  d.points.push({ date: "2027-01-01T00:00:00Z", value: 100 });
  assert.equal(analyze(TOPICS[0]!, d, supply(12), [], asOf).kind, "blue");
});

test("missing reference values are not interpreted as zero search interest", () => {
  const d = demand("growing");
  assert.equal(demandMetrics(d, asOf).anchorRatio, 4);
  delete d.points.at(-1)!.anchor;
  assert.equal(demandMetrics(d, asOf).anchorRatio, null);
  d.points.at(-1)!.anchor = NaN;
  const m = analyze(TOPICS[0]!, d, supply(12), [], asOf);
  assert.equal(m.metrics.anchorRatio, null);
  assert.equal(m.metrics.points, 104);
  assert.equal(m.kind, "blue");
});

test("moderate growth, stable interest and falling interest have distinct conclusions", () => {
  const up = demand();
  up.points.slice(-8).forEach((p) => (p.value = 24));
  const rising = analyze(TOPICS[0]!, up, supply(150), [], asOf);
  assert.equal(rising.metrics.fast, false);
  assert.equal(rising.metrics.trend, "rising");
  assert.equal(rising.kind, "expanding");
  const flat = analyze(TOPICS[0]!, demand(), supply(150), [], asOf);
  assert.equal(flat.metrics.trend, "stable");
  assert.match(flat.headline, /stable/);
  const down = demand();
  down.points.slice(-8).forEach((p) => (p.value = 15));
  const falling = analyze(TOPICS[0]!, down, supply(150), [], asOf);
  assert.equal(falling.metrics.trend, "falling");
  assert.match(falling.headline, /falling/);
  assert.ok(
    !/red ocean/i.test(
      [rising.headline, flat.headline, falling.headline].join(" "),
    ),
  );
});

test("recent evidence, window disagreement and synonyms cannot be cherry-picked", () => {
  const fresh = demand("growing");
  fresh.points.slice(0, -26).forEach((p) => (p.value = 0));
  assert.equal(
    analyze(TOPICS[0]!, fresh, supply(10), [], asOf).metrics.trend,
    "rising",
  );
  const conflict = demand("growing");
  conflict.points.slice(-4).forEach((p) => (p.value = 10));
  assert.equal(
    analyze(TOPICS[0]!, conflict, supply(10), [], asOf).metrics.trend,
    "mixed",
  );
  const up = demand("growing"),
    down = demand();
  down.keyword = "genuine synonym";
  down.points.slice(-8).forEach((p) => (p.value = 10));
  up.alternatives = [down];
  const m = analyze(TOPICS[0]!, up, supply(10), [], asOf);
  assert.equal(m.metrics.growth, 1);
  assert.equal(m.metrics.trend, "mixed");
  assert.equal(m.score, null);
  assert.match(m.limitations.join(" "), /opposite directions/);
});

// These examples deliberately separate short-term attention from category growth.
test("old missing weeks do not invalidate recent data or shift last year's window", () => {
  const d = demand("growing");
  const before = demandMetrics(d, asOf);
  d.points.splice(70, 1);
  const after = demandMetrics(d, asOf);
  assert.equal(after.trend, "rising");
  assert.equal(after.yearOverYear, before.yearOverYear);
  d.points.splice(46, 1);
  assert.equal(demandMetrics(d, asOf).yearOverYear, null);
  assert.equal(demandMetrics(d, asOf).trend, "rising");
});
test("cooling above last year and recovery below last year preserve both horizons", () => {
  const d = demand();
  d.points.slice(-26).forEach((p) => (p.value = 80));
  d.points.slice(-8).forEach((p) => (p.value = 40));
  const cooling = demandMetrics(d, asOf);
  assert.equal(cooling.trend, "falling");
  assert.equal(cooling.growth, -0.5);
  assert.equal(cooling.yearOverYear, 1);
  assert.equal(cooling.horizon, "cooling-above-year");
  const rebound = demand();
  rebound.points.slice(44, 52).forEach((p) => (p.value = 80));
  rebound.points.slice(-8).forEach((p) => (p.value = 40));
  const recovering = demandMetrics(rebound, asOf);
  assert.equal(recovering.trend, "rising");
  assert.equal(recovering.horizon, "rebounding-below-year");
  assert.equal(recovering.seasonal, false);
});
test("stale opposite synonyms cannot overturn current primary evidence", () => {
  const d = demand("growing"),
    alt = demand();
  alt.points.slice(-8).forEach((p) => (p.value = 10));
  alt.fetchedAt = "2026-07-01";
  d.alternatives = [alt];
  assert.equal(
    analyze(TOPICS[0]!, d, supply(10), [], asOf).metrics.trend,
    "rising",
  );
});
test("conflicting latest week cannot silently shift the comparison window", () => {
  const d = demand("growing");
  d.points.push({ ...d.points.at(-1)!, value: 0 });
  assert.equal(demandMetrics(d, asOf).trend, "unknown");
});

test("sustained emergence from zero is an early signal without invented percentage growth", () => {
  const d = demand("zero");
  d.points
    .slice(-8)
    .forEach((p, i) => (p.value = [0, 0, 25, 30, 35, 35, 40, 40][i]!));
  const m = analyze(TOPICS[0]!, d, supply(12), [], asOf);
  assert.equal(m.metrics.emerging, true);
  assert.equal(m.metrics.growth, null);
  assert.equal(m.metrics.fast, null);
  assert.equal(m.metrics.trend, "rising");
  assert.equal(m.kind, "blue");
  assert.equal(m.confidence, "low");
  assert.ok(
    m.reasons.some((r) => r.includes("percentage would be misleading")),
  );
  const falling = structuredClone(d);
  falling.points.slice(-4).forEach((p) => (p.value = 0));
  assert.equal(
    analyze(TOPICS[0]!, falling, supply(12), [], asOf).kind,
    "uncertain",
  );
  const spike = demand("zero");
  spike.points.at(-1)!.value = 100;
  assert.equal(
    analyze(TOPICS[0]!, spike, supply(12), [], asOf).kind,
    "uncertain",
  );
});

test("a trustworthy supply lower bound remains dense without enumerating every result", () => {
  const s = supply(6000);
  s.complete = false;
  assert.equal(
    analyze(TOPICS[0]!, demand("growing"), s, [], asOf).kind,
    "expanding",
  );
  s.total = 12;
  s.repositories = s.repositories.slice(0, 12);
  assert.equal(
    analyze(TOPICS[0]!, demand("growing"), s, [], asOf).kind,
    "uncertain",
  );
});

test("short and year-on-year windows do not depend on the eight-week denominator", () => {
  const d = demand();
  d.points.slice(-16, -8).forEach((p) => (p.value = 0));
  d.points.slice(-8).forEach((p) => (p.value = 40));
  const m = demandMetrics(d, asOf);
  assert.equal(m.growth, null);
  assert.equal(m.yearOverYear, 1);
  assert.equal(m.shortGrowth, 0);
});
