import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  userEvidence,
  DECISION_PROMPT,
  effectiveDecision,
  finalizeDecision,
  legacyReport,
  parseDecisionDraft,
} from "../src/core/decision.js";
import { parseReport, reportCitations } from "../src/core/report-contract.js";
import { finalizeReport } from "../src/providers/report.js";
import type { Market, ResearchSource } from "../src/core/types.js";

const t = (en: string, zh: string) => ({ en, zh });
const text = t("Short English sentence.", "一句简短的中文。");
const market = (): Market =>
  structuredClone(
    JSON.parse(
      readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
    )[0],
  );
const sources: ResearchSource[] = [
  {
    id: "S1",
    label: "Google Trends",
    url: "https://trends.google.com/",
    excerpt: '{"keyword":"sample","trend":"rising"}',
  },
  {
    id: "S2",
    label: "Ask HN: logged-in content",
    url: "https://news.ycombinator.com/item?id=1",
    documentType: "hn-comment",
    excerpt:
      "We keep getting banned every few days and have no way to read logged-in posts.",
  },
  {
    id: "S3",
    label: "Acme pricing",
    url: "https://acme.example/pricing",
    documentType: "page",
    searchIntent: "competition",
    excerpt: "Starter is $49 per month and does not include logged-in content.",
  },
  {
    id: "S4",
    label: "Vendor blog",
    url: "https://vendor.example/blog",
    documentType: "page",
    searchIntent: "competition",
    excerpt: "Teams struggle with scraping at scale, says our marketing team.",
  },
];
const citations = reportCitations(sources);
const draft = () => ({
  verdict: { kind: "reframe", reason: text },
  pains: [
    { title: text, workaround: text, quotes: ["S2Q1"] },
    // Vendor copy is not a user's own words.
    { title: text, workaround: null, quotes: ["S4Q1"] },
  ],
  commercial: [
    {
      name: "Acme",
      audience: text,
      pricing: text,
      gap: text,
      evidence: ["S3Q1"],
    },
  ],
  openSource: [
    { name: "ghost/not-collected", capability: text, evidence: ["S3Q1"] },
  ],
  directions: [
    {
      title: text,
      audience: text,
      pain: "P1",
      supply: ["C1"],
      whyOpen: text,
      uncertainty: text,
    },
    // Points at the vendor-only pain, which the pain gate removes.
    {
      title: text,
      audience: text,
      pain: "P2",
      supply: ["C1"],
      whyOpen: text,
      uncertainty: text,
    },
    // Points at supply that was never listed.
    {
      title: text,
      audience: text,
      pain: "P1",
      supply: ["C9"],
      whyOpen: text,
      uncertainty: text,
    },
  ],
  nextStep: { who: text, ask: text, success: text, fail: text },
  unverified: [text],
});
const withPages = () => {
  const m = market();
  m.web = {
    provider: "multi-search",
    region: "US",
    language: "en",
    fetchedAt: new Date().toISOString(),
    state: "ready",
    queries: [],
  };
  m.documents = { version: "1", sources: [], reads: [] };
  return m;
};

test("the prompt derives directions from pains minus supply and keeps the guard rails", () => {
  for (const rule of [
    /Do not invent three ideas first/,
    /Preserve negation/,
    /never by shared keywords/,
    /Never write, translate or paraphrase a quote/,
    /never dress it as "stop"/,
    /Do not say "interview users" in general/,
  ])
    assert.match(DECISION_PROMPT, rule);
});

test("pain, slice and supply gates decide what may be shown", () => {
  const d = finalizeDecision(
    parseDecisionDraft(draft(), citations),
    withPages(),
    sources,
  );
  assert.deepEqual(
    d.pains.map((p) => p.id),
    ["P1"],
  );
  assert.equal(d.pains[0]!.quotes[0]!.quote, sources[1]!.excerpt);
  assert.deepEqual(d.openSource, [], "uncollected repositories are dropped");
  assert.deepEqual(
    d.directions.map((x) => x.id),
    ["D1"],
  );
  assert.equal(d.verdict.kind, "reframe");
  assert.equal(d.coverage.supply, "full");
  assert.equal(d.directions[0]!.tentative, undefined);
  assert.deepEqual(d.nextStep?.where, [
    { label: sources[1]!.label, url: sources[1]!.url },
  ]);
  assert.match(d.timing.summary.zh, /近 8 周比前 8 周|没采到/);
});

test("no first-hand pain means no directions, no next step and an honest verdict", () => {
  const raw = draft();
  raw.pains = [{ title: text, workaround: null, quotes: ["S4Q1"] }];
  const d = finalizeDecision(
    parseDecisionDraft(raw, citations),
    withPages(),
    sources,
  );
  assert.equal(d.verdict.kind, "insufficient");
  assert.equal(d.verdict.forced, true);
  assert.match(d.verdict.reason.zh, /不代表没人有这个问题/);
  assert.deepEqual(d.directions, []);
  assert.equal(d.nextStep, null);
});

test("a go verdict without any surviving direction is not delivered as go", () => {
  const raw = draft();
  raw.verdict.kind = "go";
  raw.directions = raw.directions.slice(2);
  const d = finalizeDecision(
    parseDecisionDraft(raw, citations),
    withPages(),
    sources,
  );
  assert.equal(d.verdict.kind, "insufficient");
  assert.equal(d.nextStep, null);
});

test("failed collection is reported as a gap and makes directions tentative, never zero supply", () => {
  const m = withPages();
  m.web!.queries = [
    {
      query: "sample alternatives pricing",
      intent: "competition",
      state: "failed",
      error: "search_timeout",
      results: [],
    },
  ];
  m.documents!.reads = [
    {
      url: "https://www.reddit.com/r/sample",
      status: "access",
      observedAt: new Date().toISOString(),
    },
  ];
  const d = finalizeDecision(
    parseDecisionDraft(draft(), citations),
    m,
    sources,
  );
  assert.equal(d.coverage.supply, "partial");
  assert.equal(d.directions[0]!.tentative, true);
  assert.deepEqual(
    d.coverage.gaps.map((g) => [g.lane, g.label, g.reason]),
    [
      ["supply", "sample alternatives pricing", "timeout"],
      ["supply", "reddit.com", "unread"],
    ],
  );
});

test("invalid entries are dropped whole, unknown citations reject the draft", () => {
  const raw: any = draft();
  raw.commercial.push({ name: "Broken", audience: { en: "", zh: "" } });
  raw.nextStep = { who: text };
  let incomplete: string[] = [];
  const parsed = parseDecisionDraft(raw, citations, (s) => (incomplete = s));
  assert.equal(parsed.commercial.length, 1);
  assert.equal(parsed.nextStep, null);
  assert.deepEqual(incomplete, ["commercial", "nextStep"]);
  raw.pains[0].quotes = ["S99Q1"];
  assert.throws(() => parseDecisionDraft(raw, citations), /citation ID/);
  assert.throws(() =>
    parseDecisionDraft({ ...draft(), verdict: null }, citations),
  );
});

test("the previous report shape is derived and passes its own citation check", () => {
  const m = withPages();
  const d = finalizeDecision(
    parseDecisionDraft(draft(), citations),
    m,
    sources,
  );
  const legacy = parseReport(
    finalizeReport(legacyReport(d), m, sources),
    sources,
  );
  assert.equal(legacy.headline.zh, "换个切法");
  assert.equal(legacy.directions.length, 1);
  assert.equal(legacy.userNeeds.status, "observed");
  assert.match(legacy.commercialSupply.summary.en, /^Acme:/);
});

test("dismissing the last quote of a pain collapses what depends on it and can be undone", () => {
  const d = finalizeDecision(
    parseDecisionDraft(draft(), citations),
    withPages(),
    sources,
  );
  const untouched = effectiveDecision(d);
  assert.deepEqual(untouched.invalidated, []);
  assert.equal(untouched.revised, false);
  const after = effectiveDecision(d, { dismissed: ["P1:S2Q1"], stale: true });
  assert.deepEqual(after.emptied, ["P1"]);
  assert.deepEqual(after.invalidated, ["D1"]);
  assert.equal(after.nextStep, null);
  assert.equal(after.stale, true);
  assert.equal(after.pains[0]!.quotes.length, 1, "kept so it can be restored");
  assert.ok(d.nextStep, "the delivered report is never mutated");
});

test("a forum snippet and a forum comment count as a user's own words", () => {
  assert.equal(
    userEvidence({
      label: "thread",
      url: "https://www.reddit.com/r/x/comments/1",
      kind: "search",
      documentType: "forum-snippet",
    }),
    true,
  );
  assert.equal(
    userEvidence({
      label: "vendor",
      url: "https://vendor.example/blog",
      kind: "search",
      searchIntent: "demand",
    }),
    false,
  );
});

test("sections nested inside verdict by a misplaced brace are still read", () => {
  const draft = parseDecisionDraft(
    {
      verdict: {
        kind: "insufficient",
        reason: { en: "Not enough to judge.", zh: "证据不够判断。" },
        pains: [],
        commercial: [
          {
            name: "Acme",
            audience: { en: "Small teams.", zh: "小团队。" },
            evidence: ["S1Q1"],
          },
        ],
        openSource: [],
        directions: [],
        nextStep: null,
        unverified: [{ en: "Whether anyone pays.", zh: "有没有人付钱。" }],
      },
    },
    { S1Q1: { id: "S1", quote: "Acme serves small teams." } },
  );
  assert.equal(draft.commercial[0]!.name, "Acme");
  assert.equal(draft.unverified[0]!.zh, "有没有人付钱。");
});
