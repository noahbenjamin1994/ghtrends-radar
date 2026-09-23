import { test } from "node:test";
import assert from "node:assert/strict";
import { preparePortfolio, revisePortfolio } from "../src/core/portfolio.js";
import { opportunityEvidence } from "../src/providers/opportunity-evidence.js";
import { resolveTopic } from "../src/core/topics.js";
const raw = () => ({
  overall: {
    verdict: "Test verdict",
    demand: "Test demand",
    competition: "Test competition",
    barriers: "Test barriers",
    assumptions: "Test assumptions",
  },
  candidates: Array.from({ length: 6 }, (_, i) => ({
    id: "job-" + i,
    query: "test task",
    route: "service",
    title: "Test task",
    audience: "Test buyer",
    offer: "Test offer",
    mechanism: "Test mechanism",
    adoption: "Test adoption",
    uncertainty: "Test uncertainty",
    channel: "web",
    evidence: [],
  })),
  selectedIds: ["job-0", "job-1", "job-2"],
});
test("portfolio preserves reserve jobs and accepts a justified single replacement", () => {
  const p = preparePortfolio(raw(), 3);
  const r = revisePortfolio(p, {
    replacement: {
      removeId: "job-0",
      addId: "job-4",
      reason: "Different buyer",
    },
    reason: "Compare buyer value",
  });
  assert.deepEqual(
    r.opportunities.map((c) => c.id),
    ["job-4", "job-1", "job-2"],
  );
  assert.equal(p.opportunities[0]?.id, "job-0");
  assert.equal("recommendedId" in r, false);
  assert.deepEqual(
    revisePortfolio(p, { replacement: null, reason: "Keep diverse jobs" })
      .selectedIds,
    p.selectedIds,
  );
});
test("portfolio rejects duplicate, invented and non-shortlisted replacement IDs", () => {
  const p = preparePortfolio(raw(), 3);
  for (const [removeId, addId] of [
    ["job-0", "job-1"],
    ["job-0", "invented"],
    ["job-4", "job-5"],
  ])
    assert.throws(() =>
      revisePortfolio(p, {
        replacement: { removeId, addId, reason: "Test reason" },
        reason: "Evidence comparison",
      }),
    );
  assert.throws(() =>
    preparePortfolio({ ...raw(), selectedIds: ["job-0", "job-1", "bad"] }, 3),
  );
  assert.throws(() =>
    preparePortfolio({ ...raw(), selectedIds: ["job-0", "job-0", "job-1"] }, 3),
  );
});
test("direction probes share budgets across replacement, bound page reads and never reuse source IDs", async () => {
  let searches = 0,
    pages = 0,
    githubCalls = 0;
  const collect = opportunityEvidence(
    resolveTopic("rag"),
    "",
    {
      async directionEvidence(ds) {
        githubCalls++;
        return [
          {
            id: "D1A1R",
            directionId: ds[0]!.id,
            label: "project",
            url: "https://github.com/test/repo",
            excerpt: "Observed project",
          },
        ];
      },
    },
    {
      enabled: true,
      async collect(_t, _g, qs) {
        searches++;
        assert.equal(qs?.length, 1);
        return {
          provider: "multi-search",
          region: "US",
          language: "en",
          fetchedAt: "2026-09-23",
          state: "ready",
          queries: [
            {
              ...qs![0]!,
              state: "ready",
              results: [
                {
                  title: "Offer",
                  url: "https://example.com/pricing",
                  excerpt: "Publisher offer",
                  kind: "organic",
                },
              ],
            },
          ],
        };
      },
    },
    {
      async collect(candidates) {
        pages++;
        assert.equal(candidates.length, 1);
        return {
          version: "1",
          sources: [
            {
              id: "WP1",
              label: "Page",
              url: "https://example.com/pricing",
              excerpt: "Publisher offer",
            },
          ],
          reads: [],
        };
      },
    },
  );
  const first = await collect([
    { id: "job-a", query: "task", channel: "web" },
    { id: "job-a", query: "task", channel: "web" },
    { id: "job-b", query: "task", channel: "web" },
    { id: "job-c", query: "task", channel: "github" },
  ]);
  const replacement = await collect([
    { id: "job-d", query: "task", channel: "github" },
  ]);
  const denied = await collect([
    { id: "job-e", query: "task", channel: "web" },
  ]);
  assert.equal(searches, 2);
  assert.equal(pages, 2);
  assert.equal(githubCalls, 2);
  const ids = [...first, ...replacement, ...denied].map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(replacement.every((s) => s.directionId === "job-d"));
  assert.ok(denied.every((s) => !s.excerpt));
  assert.deepEqual(
    await collect([{ id: "job-a", query: "task", channel: "web" }]),
    [],
  );
});
test("failed commercial lookup remains missing evidence, not a fabricated source", async () => {
  const collect = opportunityEvidence(
    resolveTopic("rag"),
    "",
    {
      async directionEvidence() {
        throw Error("unexpected");
      },
    },
    {
      enabled: true,
      async collect() {
        throw Error("offline");
      },
    },
    {
      async collect() {
        throw Error("unexpected");
      },
    },
  );
  const rows = await collect([
    { id: "commercial", query: "buyer service", channel: "web" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.excerpt, undefined);
  assert.match(rows[0]!.label, /failed/);
});

test("a failed page read retains indexed evidence and reports its missing original", async () => {
  const collect = opportunityEvidence(
    resolveTopic("rag"),
    "",
    {
      async directionEvidence() {
        return [];
      },
    },
    {
      enabled: true,
      async collect() {
        return {
          provider: "multi-search",
          region: "US",
          language: "en",
          state: "ready",
          fetchedAt: "2026-09-23",
          queries: [
            {
              query: "RAG buyer",
              intent: "competition",
              state: "ready",
              results: [
                {
                  title: "Existing offer",
                  url: "https://example.com/offer",
                  excerpt: "Publisher offers hosted retrieval",
                  kind: "organic",
                },
              ],
            },
          ],
        };
      },
    },
    {
      async collect() {
        throw Error("page timeout");
      },
    },
  );
  const rows = await collect([
    { id: "hosted-rag", query: "hosted retrieval", channel: "web" },
  ]);
  assert.equal(rows.length, 2);
  assert.match(rows[0]!.excerpt!, /Publisher offers hosted retrieval/);
  assert.match(rows[1]!.label, /original reads: failed/);
  assert.equal(rows[1]!.excerpt, undefined);
  assert.equal(new Set(rows.map((s) => s.id)).size, 2);
});

test("empty GitHub probes remain explicit coverage gaps and stop at the shared cap", async () => {
  let calls = 0;
  const collect = opportunityEvidence(
    resolveTopic("rag"),
    "",
    {
      async directionEvidence() {
        calls++;
        return [];
      },
    },
    {
      enabled: false,
      async collect() {
        throw Error("unexpected");
      },
    },
    {
      async collect() {
        throw Error("unexpected");
      },
    },
  );
  const rows = await collect(
    Array.from({ length: 7 }, (_, i) => ({
      id: `job-${i}`,
      query: "retrieval",
      channel: "github" as const,
    })),
  );
  assert.equal(calls, 6);
  assert.equal(rows.length, 7);
  assert.ok(rows.every((s) => !s.excerpt && s.directionId));
  assert.match(rows[0]!.label, /returned 0 source excerpts/);
  assert.match(rows[6]!.label, /budget/);
});
