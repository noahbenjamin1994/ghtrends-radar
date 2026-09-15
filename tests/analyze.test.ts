import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, demandMetrics } from "../src/core/analyze.js";
import { TOPICS, validateRepo, resolveTopic } from "../src/core/topics.js";
import type { DemandEvidence, SupplyEvidence } from "../src/core/types.js";
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
    repositories: [],
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
test("annual seasonal rebound is not a breakout", () => {
  const m = analyze(TOPICS[0]!, demand("seasonal"), supply(10), [], asOf);
  assert.equal(m.metrics.seasonal, true);
  assert.equal(m.kind, "quiet");
  const boundary = demand("seasonal");
  for (const p of boundary.points) if (p.value === 40) p.value = 25;
  const exact = analyze(TOPICS[0]!, boundary, supply(10), [], asOf);
  assert.equal(exact.metrics.growth, 0.25);
  assert.equal(exact.metrics.seasonal, true);
  assert.equal(exact.kind, "quiet");
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
  d.points.splice(60, 1);
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
  assert.equal(before.kind, "quiet");
  assert.equal(after.kind, before.kind);
  assert.deepEqual(after.metrics, before.metrics);
  assert.match(
    after.reasons.join(" "),
    /Only 5 of the last eight complete weeks/,
  );
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
