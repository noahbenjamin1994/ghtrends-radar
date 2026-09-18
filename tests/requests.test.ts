import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import { GitHub } from "../src/providers/github.js";
import {
  selectGapSignals,
  mergeRequestEvidence,
  marketGapSignals,
  reportIssueSignals,
  issueReading,
} from "../src/core/gaps.js";
import { marketMarkdown } from "../src/core/report.js";
import { renderDocument } from "../src/server/html.js";
import type { Gap, Market, ResearchSource } from "../src/core/types.js";

const gap = (values: Partial<Gap> = {}): Gap => ({
  title: "Support exporting review comments",
  url: "https://github.com/team/editor/issues/1",
  repo: "team/editor",
  reactions: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-09-15T00:00:00.000Z",
  observedAt: "2026-09-18T00:00:00.000Z",
  state: "open",
  label: "feature-request",
  excerpt:
    "We copy each review comment into a separate document. Please preserve these comments when exporting the draft.",
  ...values,
});

test("request selection keeps recent low-interaction needs, merges links and separates authors", () => {
  const recent = gap({ reactions: 0, authorKey: "one" });
  const old = gap({
    url: recent.url + "2",
    reactions: 0,
    updatedAt: "2024-01-01",
  });
  const repost = { ...recent, url: recent.url + "3" };
  const independent = { ...recent, authorKey: "two", url: recent.url + "4" };
  const rows = selectGapSignals([
    recent,
    { ...recent, url: recent.url + "?ref=search#issuecomment-1" },
    old,
    repost,
    independent,
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    new Set(rows.map((r) => r.authorKey)),
    new Set(["one", "two"]),
  );
  assert.equal(selectGapSignals([gap({ state: "closed" })]).length, 0);
  const popular = [1, 2, 3, 4].map((id) =>
    gap({
      url: `https://github.com/team/editor/issues/${id + 100}`,
      reactions: 100 - id,
      updatedAt: "2025-01-01T00:00:00.000Z",
    }),
  );
  const balanced = selectGapSignals([...popular, recent]);
  assert.equal(balanced[0]!.url, popular[0]!.url);
  assert.equal(balanced[1]!.url, recent.url);
  assert.equal(new Set(balanced.map((r) => r.url)).size, balanced.length);
});

test("fresh issue state supersedes old search results and appears consistently in reports", () => {
  const m: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  m.supply.repositories = [
    {
      ...m.supply.repositories[0]!,
      name: "team/editor",
      relevance: {
        role: "direct",
        method: "rules",
        reason: "Direct project",
      },
    },
  ];
  const original = gap(),
    before = JSON.stringify(original);
  m.gaps = [original];
  const source: ResearchSource = {
    id: "I1",
    kind: "request",
    url: original.url,
    label: original.title,
    excerpt: original.excerpt,
    fetchedAt: "2026-09-19T00:00:00.000Z",
    request: {
      state: "closed",
      stateReason: "completed",
      closedAt: "2026-09-18T12:00:00.000Z",
      updatedAt: "2026-09-18T12:00:00.000Z",
      observedAt: "2026-09-19T00:00:00.000Z",
      reactions: 4,
      comments: 2,
      authorKey: "author-one",
    },
  };
  const copy = {
    title: "Keep the review comments",
    audience: "Editors preparing shared drafts.",
    need: "Preserve comments while exporting documents.",
    currentSolution: "Copy comments into a separate document.",
    desiredOutcome: "Keep comments attached to the exported draft.",
    opportunity: "Build a brand-new export adapter.",
    check: "Compare the export behavior against the current release.",
  };
  m.brief = {
    model: "test",
    generatedAt: source.fetchedAt!,
    en: { summary: "Research summary", nextSteps: [] },
    zh: { summary: "研究总结", nextSteps: [] },
    sources: [source],
    issueInsights: [
      {
        sourceId: "I1",
        relevance: "direct",
        kind: "feature-request",
        en: copy,
        zh: copy,
        evidence: { id: "I1", quote: original.excerpt },
      },
    ],
  };
  assert.equal(marketGapSignals(m).length, 0);
  const rows = reportIssueSignals(m);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.stateReason, "completed");
  assert.equal(rows[0]!.observedAt, source.fetchedAt);
  assert.equal(JSON.stringify(original), before);
  assert.equal(
    mergeRequestEvidence(
      [rows[0] as Gap],
      [
        {
          ...source,
          request: { state: "open", observedAt: "2026-09-17T00:00:00.000Z" },
        },
      ],
    )[0]!.state,
    "closed",
  );
  const md = marketMarkdown(m, "https://radar.example", "en");
  const html = renderDocument(
    '<html><head></head><body><div id="root"></div></body></html>',
    {
      base: "https://radar.example",
      path: "/report/" + m.id,
      geo: "",
      market: m,
      markets: [],
      status: 200,
      locale: "en",
    },
  );
  for (const output of [md, html]) {
    assert.ok(output.includes("Marked complete"));
    assert.ok(output.includes("Collected: 2026-09-19"));
    assert.ok(output.includes(copy.currentSolution));
    assert.ok(output.includes(original.excerpt));
    assert.ok(!output.includes(copy.opportunity));
  }
  m.brief.issueInsights![0]!.kind = "promotion";
  assert.equal(reportIssueSignals(m).length, 0);
  m.brief.issueInsights![0]!.kind = "feature-request";
  m.brief.issueInsights![0]!.evidence.quote =
    "This fabricated quote is absent from the source.";
  assert.equal(issueReading(m.brief, original.url), undefined);
});

test("GitHub request evidence preserves collection timestamps, source state and bounded release context", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-request-source-")),
    store = new Store(dir),
    github = new GitHub(store);
  const originalFetch = globalThis.fetch,
    env = { ...process.env },
    paths: string[] = [];
  process.env.GITHUB_TOKEN = "unit-test-only";
  let fetches = 0;
  const issue = {
    title: gap().title,
    html_url: gap().url,
    body: gap().excerpt,
    state: "open",
    created_at: "2026-01-01",
    updated_at: new Date().toISOString(),
    reactions: { total_count: 0 },
    comments: 2,
    user: { id: 42, type: "User" },
  };
  globalThis.fetch = async (input) => {
    fetches++;
    const url = new URL(String(input));
    paths.push(url.pathname);
    const data =
      url.pathname === "/search/issues"
        ? { items: [issue] }
        : url.pathname.endsWith("/readme")
          ? {
              encoding: "base64",
              content: Buffer.from("Exports drafts and comments.").toString(
                "base64",
              ),
              html_url: "https://github.com/team/editor/blob/main/README.md",
            }
          : url.pathname.endsWith("/releases/latest")
            ? {
                tag_name: "v2.1",
                html_url: "https://github.com/team/editor/releases/tag/v2.1",
                published_at: "2026-09-18",
                body: "Add comment anchors to exported drafts.",
              }
            : {
                ...issue,
                state: "closed",
                state_reason: "completed",
                closed_at: new Date().toISOString(),
              };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const repo: Market["supply"]["repositories"][number] = JSON.parse(
      readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
    )[0].supply.repositories[0];
    repo.name = "team/editor";
    repo.relevance = undefined;
    const first = await github.gaps([repo]);
    assert.equal(first.length, 1);
    assert.equal(first[0]!.reactions, 0);
    assert.ok(first[0]!.authorKey && first[0]!.authorKey !== "42");
    const count = fetches,
      second = await github.gaps([repo]);
    assert.equal(fetches, count);
    assert.equal(second[0]!.observedAt, first[0]!.observedAt);
    const sources = await github.researchSources([repo], first);
    assert.equal(sources.length, 3);
    const request = sources.find((s) => s.kind === "request")!;
    assert.equal(request.request?.state, "closed");
    assert.equal(request.request?.stateReason, "completed");
    assert.equal(request.request?.authorKey, first[0]!.authorKey);
    assert.ok(request.fetchedAt);
    assert.ok(
      sources.some(
        (s) =>
          s.url.endsWith("/releases/tag/v2.1") &&
          s.excerpt?.includes("comment anchors"),
      ),
    );
    assert.equal(paths.filter((p) => p === "/search/issues").length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = env;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
