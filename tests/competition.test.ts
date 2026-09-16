import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessCompetition, repoRelevance } from "../src/core/competition.js";
import { analyze, demandMetrics } from "../src/core/analyze.js";
import { resolveTopic } from "../src/core/topics.js";
import type {
  Repo,
  SupplyEvidence,
  DemandEvidence,
} from "../src/core/types.js";
const asOf = "2026-09-16T12:00:00Z";
const topic = resolveTopic("vector-databases");
const repo = (id: number, override: Partial<Repo> = {}): Repo => ({
  name: `owner${id}/vector-database`,
  description: "A vector database for search",
  url: `https://github.com/owner${id}/vector-database`,
  stars: 30,
  forks: 3,
  language: "Rust",
  license: "MIT",
  archived: false,
  createdAt: "2025-01-01",
  pushedAt: "2026-09-01",
  topics: ["vector-database"],
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
  ...override,
});
const supply = (
  repositories: Repo[],
  extra: Partial<SupplyEvidence> = {},
): SupplyEvidence => ({
  query: topic.query,
  sourceUrl: "https://github.com/search?q=topic:vector-database",
  fetchedAt: asOf,
  total: repositories.length,
  complete: true,
  repositories,
  ...extra,
});
const series = (values: number[]): DemandEvidence => ({
  keyword: topic.keyword,
  geo: "",
  fetchedAt: asOf,
  sourceUrl: "https://trends.google.com",
  related: [],
  resolution: "WEEK",
  points: values.map((value, i) => ({
    value,
    date: new Date(
      Date.parse("2026-09-06") - (values.length - i - 1) * 7 * 86400000,
    ).toISOString(),
  })),
});
const up = series(Array.from({ length: 104 }, (_, i) => (i >= 96 ? 40 : 20)));

test("a few established alternatives can form a red ocean; resources never inflate pressure", () => {
  const mature = [1, 2, 3].map((i) =>
    repo(i, { stars: 25000, forks: 900, createdAt: "2020-01-01" }),
  );
  const crowded = analyze(topic, up, supply(mature), [], asOf);
  assert.equal(crowded.kind, "expanding");
  assert.equal(crowded.competition?.establishedTeams, 3);
  const small = [repo(1), repo(2), repo(3)];
  const resources = Array.from({ length: 100 }, (_, i) =>
    repo(i + 10, {
      name: `resource${i}/awesome-vectors`,
      description: "A curated list of vector databases",
      stars: 100000,
      forks: 3000,
    }),
  );
  const limited = analyze(
    topic,
    up,
    supply([...small, ...resources]),
    [],
    asOf,
  );
  assert.equal(limited.kind, "blue");
  assert.equal(limited.competition?.resources, 100);
  assert.equal(
    limited.competition?.score,
    analyze(topic, up, supply(small), [], asOf).competition?.score,
  );
});
test("deduplication and owner grouping preserve independent competitor counts", () => {
  const first = repo(1, { name: "one/product" });
  const r = [
    ...Array.from({ length: 100 }, (_, i) =>
      repo(i, { name: `one/module${i}` }),
    ),
    first,
    first,
  ];
  const measured = assessCompetition(topic, supply(r), asOf);
  assert.equal(measured.direct, 101);
  assert.equal(
    measured.effectiveTeams,
    assessCompetition(topic, supply([first]), asOf).effectiveTeams,
  );
  assert.equal(
    measured.score,
    assessCompetition(topic, supply([first]), asOf).score,
  );
});
test("a stars-ranked partial sample and ambiguous project roles keep competition bounded", () => {
  const small = [repo(1)];
  const incomplete = analyze(
    topic,
    up,
    supply(small, { total: 2000, complete: false }),
    [],
    asOf,
  );
  assert.equal(incomplete.kind, "uncertain");
  assert.equal(incomplete.competition?.upper, 100);
  const possible = [1, 2, 3].map((i) =>
    repo(i + 10, {
      stars: 50000,
      forks: 3000,
      description: "An integration powered by a vector database",
      name: `integration${i}/plugin`,
    }),
  );
  const ambiguous = assessCompetition(
    topic,
    supply([...small, ...possible]),
    asOf,
  );
  assert.equal(ambiguous.unclear, 3);
  assert.equal(ambiguous.level, "pending");
  const lower = assessCompetition(
    topic,
    supply(
      possible.map((r) => ({
        ...r,
        relevance: { role: "direct", method: "model", reason: r.description },
      })),
      { complete: false, total: 10000 },
    ),
    asOf,
  );
  assert.equal(lower.level, "established");
  assert.ok(lower.score >= 45);
});
test("zero matches, resources alone and archived or old evidence stay qualified", () => {
  assert.equal(analyze(topic, up, supply([]), [], asOf).kind, "uncertain");
  assert.equal(
    analyze(
      topic,
      up,
      supply([repo(1, { name: "a/awesome-vectors" })]),
      [],
      asOf,
    ).kind,
    "uncertain",
  );
  const c = assessCompetition(
    topic,
    supply([
      repo(1, { archived: true }),
      repo(2, { pushedAt: "2020-01-01" }),
      repo(3, { pushedAt: "2030-01-01" }),
    ]),
    asOf,
  );
  assert.equal(c.sampled, 0);
  assert.equal(c.level, "pending");
});
test("a shared tag on an integration requires closer review", () => {
  assert.equal(
    repoRelevance(
      repo(1, {
        description: "A chatbot powered by a vector database",
        name: "a/chatbot",
      }),
      topic,
    ).role,
    "unclear",
  );
  assert.equal(repoRelevance(repo(2), topic).role, "direct");
});
test("gradual sustained growth is recognized at the quarterly horizon", () => {
  const d = series(Array.from({ length: 104 }, (_, i) => 10 + i * 0.5));
  const m = demandMetrics(d, asOf);
  assert.ok(m.growth! < 0.1);
  assert.equal(m.trend, "rising");
  assert.equal(m.directionBasis, "sustained-quarter");
});
test("a repeating seasonal upswing is stable year over year; growing seasons remain rising", () => {
  const values = Array.from(
    { length: 104 },
    (_, i) => 40 + 25 * Math.sin(((i - 44) * Math.PI * 2) / 52),
  );
  const m = demandMetrics(series(values), asOf);
  assert.equal(m.seasonal, true);
  assert.equal(m.trend, "stable");
  assert.equal(m.directionBasis, "seasonal-year");
  assert.ok(Math.abs(m.yearOverYear!) < 0.001);
  const growing = values.map((v, i) => (i >= 52 ? v * 1.3 : v));
  const g = demandMetrics(series(growing), asOf);
  assert.equal(g.seasonal, true);
  assert.equal(g.trend, "rising");
});
test("rounding-sensitive small index changes retain a qualified direction", () => {
  const d = series(Array.from({ length: 104 }, (_, i) => (i >= 96 ? 4 : 3)));
  assert.equal(demandMetrics(d, asOf).trend, "mixed");
});
test("short recurring holiday peaks qualify as seasonal; a single launch spike stays separate", () => {
  const values = Array.from({ length: 104 }, (_, i) =>
    i % 52 >= 10 && i % 52 < 16 ? 90 : 10,
  );
  assert.equal(demandMetrics(series(values), asOf).seasonal, true);
  assert.equal(demandMetrics(series(values), asOf).trend, "stable");
  assert.equal(
    demandMetrics(series(values.map((v, i) => (i < 52 ? 10 : v))), asOf)
      .seasonal,
    false,
  );
  assert.equal(
    demandMetrics(series(values.map((_, i) => (i % 52 === 12 ? 90 : 10))), asOf)
      .seasonal,
    false,
  );
});
test("established alternatives support competition guidance during mixed or pending search collection", () => {
  const s = supply([1, 2, 3].map((i) => repo(i, { stars: 25000, forks: 900 })));
  const mixed = series(
    Array.from({ length: 104 }, (_, i) => (i >= 96 ? 4 : 3)),
  );
  const m = analyze(topic, mixed, s, [], asOf);
  assert.equal(m.kind, "contested");
  assert.equal(m.metrics.trend, "mixed");
  assert.equal(m.confidence, "low");
  const pending = analyze(
    topic,
    { ...up, error: "Collection cooling down", points: [] },
    s,
    [],
    asOf,
  );
  assert.equal(pending.kind, "contested");
  assert.equal(pending.metrics.trend, "unknown");
  assert.equal(pending.confidence, "low");
  assert.match(pending.headline, /history pending/);
});
test("broad disciplines produce workflow research rather than a category quadrant", () => {
  const m = analyze(resolveTopic("ai4s"), up, supply([repo(1)]), [], asOf);
  assert.equal(m.kind, "uncertain");
  assert.equal(m.metrics.trend, "rising");
  assert.equal(m.topic.scope, "field");
});
test("recorded holiday evidence uses recurring annual shape and preserves the recent percentage", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/christmas-search-20260916.json", import.meta.url),
      "utf8",
    ),
  );
  const m = demandMetrics(fixture.demand, fixture.asOf);
  assert.equal(m.seasonal, true);
  assert.ok(m.seasonalCorrelation! > 0.95);
  assert.equal(m.directionBasis, "seasonal-year");
  assert.equal(m.trend, "rising");
  assert.ok(Math.abs(m.growth! - 1 / 3) < 0.001);
  assert.ok(Math.abs(m.yearOverYear! - 2 / 3) < 0.001);
});
