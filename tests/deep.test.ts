import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import { Engine } from "../src/core/engine.js";
import { createApp } from "../src/server/index.js";
import { sessionKey } from "../src/server/auth.js";
import {
  deepBriefSchema,
  deepProblems,
  deepDeliveryReady,
  deepMarkdown,
  deepEffortText,
  deepEditableFields,
  applyDeepEdits,
  type DeepTask,
  type DeepBrief,
} from "../src/core/deep.js";
import { runDeepResearch } from "../src/providers/deep.js";
import { CreditProviderFixture } from "./fixtures/credit-provider.js";
import { CreditAccountClient } from "../src/server/credits.js";
import type { Market, ResearchSource } from "../src/core/types.js";

const copy = (
  en = "Compare three examples with a working editor.",
  zh = "与一位编辑核对三个实际样例。",
) => ({ en, zh });
const source: ResearchSource = {
  id: "E1",
  kind: "project",
  documentType: "page",
  label: "Draft tools",
  url: "https://example.com/docs",
  excerpt: "The tool maps comments between document revisions.",
  fetchedAt: new Date().toISOString(),
};
const request: ResearchSource = {
  id: "E2",
  kind: "request",
  label: "Keep my comments",
  url: "https://github.com/example/drafts/issues/12",
  excerpt: "I need my comments to follow the edited paragraphs.",
  fetchedAt: new Date().toISOString(),
  request: { state: "open" },
};
function brief(): DeepBrief {
  return deepBriefSchema.parse({
    headline: copy(),
    answer: copy(),
    findings: ["audience", "competitors", "opensource", "scope"].map(
      (area, i) => ({
        area,
        subject: copy("Draft comments", "草稿评审意见"),
        statement: copy(),
        implication: copy(
          "Offer a paragraph-mapping prototype to test with the editor.",
          "给编辑试用段落映射原型，观察评审意见的保留情况。",
        ),
        basis: i < 2 ? "observed" : "inferred",
        evidence:
          i < 2
            ? [
                {
                  id: i ? source.id : request.id,
                  quote: i ? source.excerpt : request.excerpt,
                },
              ]
            : [],
      }),
    ),
    plan: Object.fromEntries(
      [
        "deliverable",
        "resources",
        "effort",
        "maintenance",
        "experiment",
        "continueIf",
        "changeIf",
      ].map((k) => [
        k,
        k === "effort"
          ? {
              hoursMin: 12,
              hoursMax: 20,
              assumption: copy(
                "Assume one developer and three existing document examples.",
                "假设一名开发者已有三个文档样例。",
              ),
            }
          : copy(),
      ]),
    ),
    checks: [],
  });
}
function sample(): Market {
  const m: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  m.id = "abcdef1234567890";
  const text = {
    title: "Keep review comments",
    audience: "Editors managing several document versions.",
    need: "Keep review comments near the right paragraph.",
    service: "Map comments between document revisions.",
    demand: "Test repeated review work with an editor.",
    competition: "Compare the current document export tools.",
    resources: "One developer with document samples.",
    delivery: "One prototype over two weeks.",
    upkeep: "Check supported document formats.",
    wedge: "Export an explicit paragraph mapping.",
    experiment: "Compare three actual document edits.",
  };
  m.brief = {
    model: "test",
    generatedAt: m.asOf,
    strategyVersion: "2",
    en: { summary: "Compare document tools.", nextSteps: [] },
    zh: { summary: "比较文档工具。", nextSteps: [] },
    sources: [],
    recommendedId: "comments",
    selection: copy(),
    opportunities: ["comments", "drafts", "exports"].map((id) => ({
      id,
      query: "document comments",
      effort: "medium",
      demand: { level: "medium", basis: "inferred", evidence: [] },
      competition: { level: "medium", basis: "inferred", evidence: [] },
      en: { ...text, title: `Keep review ${id}` },
      zh: { ...text, title: `保留草稿${id}意见` },
    })),
  };
  return m;
}
function task(owner = "alice"): DeepTask {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    owner,
    request: {
      requestKey: randomUUID(),
      reportId: sample().id,
      directionId: "comments",
      question: "scope",
      context: "",
    },
    title: copy("Keep draft comments", "保留草稿评审意见"),
    geo: "US",
    version: "1",
    model: "test",
    state: "queued",
    stage: "queued",
    attempts: 1,
    credit: "reserved",
    created: now,
    updated: now,
  };
}
async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (!check() && Date.now() < end)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(check());
}

test("focused task, lifetime trial and request identity commit atomically; other owners cannot read or settle", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-ledger-"));
  let s = new Store(dir);
  try {
    const a = task();
    assert.equal(s.createDeepTask(a, "fp", true).created, true);
    assert.equal(s.deepAllowance("alice", true).reserved, 1);
    assert.equal(s.deepTask(a.id, "bob"), null);
    assert.deepEqual(s.deepHistory("bob"), []);
    assert.equal(
      s.createDeepTask({ ...a, id: randomUUID() }, "fp", true).task.id,
      a.id,
    );
    assert.throws(
      () => s.createDeepTask(a, "changed", true),
      /deep_request_changed/,
    );
    assert.throws(() => s.createDeepTask(task(), "new", true), /deep_active/);
    assert.equal(s.deepHistory("alice").length, 1);
    const claimed = s.claimDeepTask(a.id, "alice")!;
    s.finishDeepTask({ ...claimed, owner: "bob" }, true);
    assert.equal(s.deepAllowance("alice", true).reserved, 1);
    claimed.evidence = {
      collectedAt: a.created,
      queries: [],
      githubQuery: "comments",
      sources: [source, request],
      reads: [],
    };
    s.checkpointDeepTask(claimed);
    s.close();
    s = new Store(dir);
    s.interruptDeepTasks();
    assert.equal(s.deepTask(a.id, "alice")?.state, "partial");
    assert.equal(s.deepTask(a.id, "alice")?.evidence?.sources.length, 2);
    assert.equal(s.deepAllowance("alice", true).remaining, 1);
    s.retryDeepTask(a.id, "alice", true);
    const resumed = s.claimDeepTask(a.id, "alice")!;
    resumed.result = brief();
    s.finishDeepTask(resumed, true);
    s.finishDeepTask(resumed, false);
    assert.equal(s.deepAllowance("alice", true).used, 1);
    assert.equal(s.deepTask(a.id, "alice")?.credit, "used");
    assert.throws(
      () => s.createDeepTask(task(), "new", true),
      /deep_trial_used/,
    );
    s.pruneOperations();
    s.close();
    s = new Store(dir);
    assert.equal(s.deepAllowance("alice", true).remaining, 0);
    assert.equal(
      s.usage("alice"),
      0,
      "introductory credit stays separate from daily scans",
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("partial tasks return the reservation, retries stay on the same task, and the attempt cap survives restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-retry-"));
  const s = new Store(dir);
  try {
    const t = task();
    s.createDeepTask(t, "fp", true);
    for (let i = 1; i <= 3; i++) {
      const current = s.claimDeepTask(t.id, "alice")!;
      assert.equal(current.attempts, i);
      current.problem = "sources";
      s.finishDeepTask(current, false);
      assert.equal(s.deepAllowance("alice", true).remaining, 1);
      if (i < 3) {
        s.retryDeepTask(t.id, "alice", true);
        s.retryDeepTask(t.id, "alice", true);
      }
    }
    assert.throws(() => s.retryDeepTask(t.id, "alice", true), /deep_attempts/);
    assert.throws(
      () => s.createDeepTask(task(), "fresh", true),
      /deep_capacity/,
    );
    assert.equal(s.deepHistory("alice").length, 1);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("delivery requires exact source support, original material and question-specific evidence", () => {
  const b = brief(),
    evidence = {
      collectedAt: new Date().toISOString(),
      sources: [source, request],
      queries: [],
      githubQuery: "draft",
      reads: [],
    };
  assert.deepEqual(deepProblems(b, evidence.sources), []);
  assert.equal(deepDeliveryReady(b, evidence, "scope"), true);
  assert.equal(deepDeliveryReady(b, evidence, "audience"), true);
  assert.equal(deepDeliveryReady(b, evidence, "opensource"), false);
  const focusedAudience = { ...b, findings: b.findings.slice(0, 2) };
  assert.deepEqual(deepProblems(focusedAudience, evidence.sources), []);
  assert.equal(deepDeliveryReady(focusedAudience, evidence, "audience"), true);
  assert.equal(
    deepDeliveryReady(focusedAudience, evidence, "opensource"),
    false,
  );
  const proposedScope = structuredClone(b);
  proposedScope.findings[3]!.evidence = [{ id: "E3", quote: source.excerpt! }];
  const snippetEvidence = {
    ...evidence,
    sources: [
      { ...source, kind: "search" as const, documentType: undefined },
      { ...request, kind: "search" as const, documentType: undefined },
      { ...source, id: "E3", url: "https://example.com/release" },
    ],
  };
  assert.equal(deepDeliveryReady(b, snippetEvidence, "scope"), false);
  assert.equal(
    deepDeliveryReady(proposedScope, snippetEvidence, "scope"),
    true,
  );
  assert.equal(
    deepDeliveryReady(proposedScope, snippetEvidence, "competitors"),
    false,
  );
  const fabricated = structuredClone(b);
  fabricated.findings[0]!.evidence[0]!.quote =
    "Hundreds of users pay every month.";
  assert.ok(
    deepProblems(fabricated, evidence.sources).some((p) => p.includes("exact")),
  );
  const badCopy = structuredClone(b);
  badCopy.answer.zh = "这个方向不能投入。";
  assert.ok(
    deepProblems(badCopy, evidence.sources).some((p) =>
      p.includes("affirmatively"),
    ),
  );
  const t = task();
  const effort = structuredClone(b);
  effort.plan.effort.hoursMin = 21;
  assert.ok(
    deepProblems(effort, evidence.sources).some((p) =>
      p.startsWith("plan.effort: hoursMax"),
    ),
  );
  effort.plan.effort.hoursMin = 12;
  assert.deepEqual(deepProblems(effort, evidence.sources), []);
  assert.match(deepEffortText(effort.plan.effort, "en"), /^12–20 person-hours/);
  assert.match(deepEffortText(effort.plan.effort, "zh"), /^12–20 人时/);
  t.evidence = evidence;
  t.result = b;
  const md = deepMarkdown(t, "zh");
  assert.match(md, /来源证据/);
  assert.match(md, /继续投入的条件/);
  assert.match(md, /对你的意义/);
  assert.match(md, /12–20 人时/);
  assert.match(md, /https:\/\/example.com\/docs/);
});

test("daily attempts count their execution day and admitted tasks can recover when new-task capacity is full", (t) => {
  const firstDay = Date.parse("2026-09-18T12:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: firstDay });
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-days-"));
  const s = new Store(dir);
  try {
    const a = task();
    s.createDeepTask(a, "first", true, 1);
    s.finishDeepTask(s.claimDeepTask(a.id, a.owner)!, false);
    s.retryDeepTask(a.id, a.owner, true, 1);
    s.finishDeepTask(s.claimDeepTask(a.id, a.owner)!, false);
    assert.throws(
      () => s.createDeepTask(task("bob"), "capacity", true, 1),
      /deep_capacity/,
    );
    t.mock.timers.setTime(firstDay + 86400000);
    s.retryDeepTask(a.id, a.owner, true, 1);
    s.finishDeepTask(s.claimDeepTask(a.id, a.owner)!, false);
    assert.deepEqual(s.deepTask(a.id, a.owner)!.attemptDays, [
      "2026-09-18",
      "2026-09-18",
      "2026-09-19",
    ]);
    s.removeDeepTask(a.id, a.owner);
    for (let i = 0; i < 2; i++) {
      const next = task();
      s.createDeepTask(next, "today-" + i, true);
      s.finishDeepTask(s.claimDeepTask(next.id, next.owner)!, false);
    }
    assert.throws(
      () => s.createDeepTask(task(), "fourth-today", true),
      /deep_capacity/,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
    t.mock.timers.reset();
  }
});

test("targeted research edits preserve unrequested facts, quotes and bilingual boundaries", () => {
  const original = brief(),
    replacement = copy(
      "Test the actual editor workflow.",
      "测试编辑的实际工作流程。",
    );
  const changed = applyDeepEdits(
    original,
    {
      edits: [
        { path: "answer", value: replacement },
        {
          path: "answer",
          value: copy("A duplicate replacement.", "另一份重复的替换。"),
        },
        { path: "findings.0.evidence", value: [] },
        { path: "plan.effort.hoursMin", value: 999 },
        { path: "__proto__.polluted", value: true },
      ],
    },
    ["answer", "plan.effort.hoursMin", "__proto__.polluted"],
  );
  assert.deepEqual(changed, { ...original, answer: replacement });
  assert.deepEqual(original, brief());
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  assert.equal(
    deepEditableFields(original).some((f) => f.path.endsWith(".en")),
    false,
  );
  assert.deepEqual(
    applyDeepEdits(original, { answer: replacement }, ["answer"]),
    original,
  );
});

test("source checkpoints support bounded recovery with direct writing and light semantic review", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-provider-")),
    env = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const e = new Engine(new Store(dir)),
    m = sample(),
    t = task();
  e.store.saveMarket(m, false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: new Date().toISOString(),
    queries: [],
    githubQuery: "comments",
    sources: [source, request],
    reads: [],
  };
  let calls = 0,
    reads = 0,
    checkpoints = 0;
  e.search.collect = async () => {
    reads++;
    throw new Error("a model retry should reuse evidence");
  };
  const experiment = copy(
    "Try three edited paragraphs with their editor.",
    "请编辑试用三个修改过的段落。",
  );
  e.research.json = async (_system, _input, _tokens, operation, thinking) => {
    assert.equal(
      thinking,
      operation === "strategy-deep-review" ? "low" : false,
    );
    calls++;
    if (operation === "strategy-deep-repair") {
      assert.deepEqual(
        (_input as any).requestedFields.map((f: any) => f.path),
        ["plan.experiment"],
      );
      return {
        edits: [
          { path: "plan.experiment", value: experiment },
          {
            path: "answer",
            value: copy("Unexpected factual drift.", "模型擅自更改了结论。"),
          },
        ],
      };
    }
    if (operation === "strategy-deep-review") {
      if (calls > 2) {
        assert.deepEqual((_input as any).changedFields, [
          {
            path: "plan.experiment",
            before: brief().plan.experiment,
            after: experiment,
          },
        ]);
        assert.equal((_input as any).previousCorrections.length, 1);
      }
      return {
        ready: calls > 2,
        corrections:
          calls > 2
            ? []
            : [
                {
                  field: "plan.experiment.zh",
                  basis: "E2",
                  repair:
                    "Tie the proposed sample to the editor workflow. " +
                    "Verify the cited source and the proposed action. ".repeat(
                      9,
                    ),
                },
              ],
      };
    }
    return brief();
  };
  try {
    assert.equal(
      await runDeepResearch(e, t, () => {
        checkpoints++;
      }),
      true,
    );
    assert.equal(reads, 0);
    assert.equal(calls, 4);
    assert.ok(checkpoints >= 4);
    assert.ok(t.result);
    assert.deepEqual(t.result, {
      ...brief(),
      plan: { ...brief().plan, experiment },
    });
    assert.equal(t.problem, undefined);
  } finally {
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a quote repair edits its evidence field while preserving the rest of the draft", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-quote-")),
    env = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const e = new Engine(new Store(dir)),
    t = task();
  e.store.saveMarket(sample(), false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: new Date().toISOString(),
    queries: [],
    githubQuery: "comments",
    sources: [source, request],
    reads: [],
  };
  const operations: string[] = [];
  e.research.json = async (_system, input, _tokens, operation) => {
    operations.push(operation!);
    if (operation === "strategy-deep-review")
      return { ready: true, corrections: [] };
    if (operation === "strategy-deep-repair") {
      assert.deepEqual(
        (input as any).requestedFields.map((f: any) => f.path),
        ["findings.0.evidence"],
      );
      return {
        edits: [
          { path: "findings.0.evidence", value: brief().findings[0].evidence },
        ],
      };
    }
    const draft = brief();
    draft.findings[0].evidence[0].quote =
      "A wholly fabricated statement about paying customers.";
    return draft;
  };
  try {
    assert.equal(await runDeepResearch(e, t, () => {}), true);
    assert.deepEqual(t.result, brief());
    assert.deepEqual(operations, [
      "strategy-deep-write",
      "strategy-deep-repair",
      "strategy-deep-review",
    ]);
  } finally {
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const mode of ["unlocated-correction", "broken-patch"] as const) {
  test(`semantic recovery stays bounded for ${mode}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-repair-")),
      env = { ...process.env };
    process.env.DEEPSEEK_API_KEY = "unit-test-only";
    const e = new Engine(new Store(dir)),
      t = task();
    e.store.saveMarket(sample(), false, t.owner);
    t.evidence = {
      collectionFinished: true,
      collectedAt: new Date().toISOString(),
      queries: [],
      githubQuery: "comments",
      sources: [source, request],
      reads: [],
    };
    const operations: string[] = [];
    e.research.json = async (_system, input, _tokens, operation) => {
      operations.push(operation!);
      if (operation === "strategy-deep-review")
        return {
          ready: false,
          corrections: [
            {
              paths: mode === "broken-patch" ? ["answer"] : ["wholeReport"],
              repair: "Tie the answer to the editor's actual request.",
            },
          ],
        };
      if (operation === "strategy-deep-repair") {
        assert.deepEqual((input as any).priorDraft, brief());
        assert.deepEqual(
          (input as any).requestedFields.map((f: any) => f.path),
          ["answer"],
        );
        return {
          edits: [
            { path: "answer", value: { en: "Incomplete bilingual value." } },
          ],
        };
      }
      return brief();
    };
    try {
      assert.equal(await runDeepResearch(e, t, () => {}), false);
      assert.equal(t.problem, "model");
      assert.equal(t.result, undefined);
      assert.deepEqual(
        operations,
        mode === "broken-patch"
          ? [
              "strategy-deep-write",
              "strategy-deep-review",
              "strategy-deep-repair",
              "strategy-deep-repair",
            ]
          : ["strategy-deep-write", "strategy-deep-review"],
      );
    } finally {
      await e.close();
      process.env = env;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const outcome of ["accept", "reject", "provider-error"] as const) {
  test(`bounded review recovery retains quality checks: ${outcome}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-review-")),
      env = { ...process.env };
    process.env.DEEPSEEK_API_KEY = "unit-test-only";
    delete process.env.GHTRENDS_DEEP_REVIEW_THINKING;
    const e = new Engine(new Store(dir)),
      t = task();
    e.store.saveMarket(sample(), false, t.owner);
    t.evidence = {
      collectionFinished: true,
      collectedAt: new Date().toISOString(),
      queries: [],
      githubQuery: "comments",
      sources: [source, request],
      reads: [],
    };
    const operations: string[] = [];
    let firstReview: unknown;
    e.research.json = async (_system, input, tokens, operation, thinking) => {
      operations.push(operation!);
      if (operation === "strategy-deep-review") {
        assert.equal(thinking, "low");
        firstReview = input;
        throw new Error(
          outcome === "provider-error"
            ? "AI research is temporarily unavailable (429)."
            : "The AI response was incomplete. Please try again.",
        );
      }
      if (operation === "strategy-deep-review-recovery") {
        assert.equal(thinking, false);
        assert.equal(tokens, 2400);
        assert.deepEqual(input, firstReview);
        return {
          ready: outcome === "accept",
          corrections:
            outcome === "accept"
              ? []
              : ["A factual premise still needs verification."],
        };
      }
      return brief();
    };
    try {
      if (outcome === "provider-error")
        await assert.rejects(
          runDeepResearch(e, t, () => {}),
          /429/,
        );
      else
        assert.equal(
          await runDeepResearch(e, t, () => {}),
          outcome === "accept",
        );
      assert.equal(
        operations.filter((o) => o === "strategy-deep-review-recovery").length,
        outcome === "provider-error" ? 0 : 1,
      );
      assert.equal(Boolean(t.result), outcome === "accept");
    } finally {
      await e.close();
      process.env = env;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("private research API protects HTML, exports, CSRF, duplicate admission, daily quota and history", async () => {
  const env = { ...process.env },
    dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-api-"));
  process.env.GHTRENDS_HOSTED = "1";
  process.env.PUBLIC_URL = "https://radar.example/radar";
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  process.env.GHTRENDS_DEEP_RESEARCH = "1";
  delete process.env.GHTRENDS_AUTO_COLLECT;
  const e = new Engine(new Store(dir)),
    m = sample();
  e.store.saveMarket(m, false, "alice");
  const sessions = new Map<string, string>();
  for (const id of ["alice", "bob"]) {
    const sid = randomBytes(32).toString("base64url");
    sessions.set(id, sid);
    e.store.set(sessionKey(sid), { id, name: id, csrf: "csrf" }, 60000);
  }
  let release: () => void = () => {},
    entered = false;
  e.research.json = async (_s, _i, _n, operation) => {
    if (operation === "deep-plan") {
      entered = true;
      await new Promise<void>((r) => {
        release = r;
      });
      return {
        queries: ["competition", "demand", "opensource"].map((intent) => ({
          intent,
          query: "document comments " + intent,
        })),
        githubQuery: "document comments",
      };
    }
    if (operation === "strategy-deep-review")
      return { ready: true, corrections: [] };
    return brief();
  };
  e.search.collect = async () => ({
    state: "ready",
    provider: "multi-search",
    region: "US",
    language: "en",
    fetchedAt: new Date().toISOString(),
    queries: [],
  });
  e.github.directionEvidence = async () => [source, request];
  e.documents.collect = async () => ({ version: "1", sources: [], reads: [] });
  e.github.gaps = async () => [];
  e.github.researchSources = async () => [];
  e.github.licenseSources = async () => [];
  e.github.discussionSources = async () => [];
  const app = createApp(e),
    server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/radar`;
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    user = "alice",
    csrf = "csrf",
  ) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://radar.example",
        Cookie: `__Host-ghtrends_session=${sessions.get(user) || ""}`,
        "X-CSRF-Token": csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const body = task().request;
  try {
    assert.equal(
      (await call("/api/research", "GET", undefined, "guest")).status,
      401,
    );
    assert.equal(
      (await call("/api/research", "POST", body, "alice", "bad")).status,
      403,
    );
    assert.equal(
      (await call("/api/research", "POST", body, "bob")).status,
      404,
    );
    assert.equal(
      (await call("/api/research", "POST", { ...body, context: "<script>" }))
        .status,
      400,
    );
    const start = await call("/api/research", "POST", body);
    assert.equal(start.status, 202);
    const t = await start.json();
    assert.equal(t.owner, undefined);
    await until(() => entered);
    const duplicate = await call("/api/research", "POST", body);
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).id, t.id);
    assert.equal(
      (await call("/api/research", "POST", { ...body, question: "audience" }))
        .status,
      409,
    );
    assert.equal(
      (
        await call("/api/research", "POST", {
          ...body,
          requestKey: randomUUID(),
        })
      ).status,
      409,
    );
    for (const path of [
      `/api/research/${t.id}`,
      `/api/research/${t.id}/export`,
      `/api/research/${t.id}/export?format=json`,
      `/research/${t.id}`,
    ])
      assert.equal((await call(path, "GET", undefined, "bob")).status, 404);
    assert.equal((await call(`/research/${t.id}`)).status, 200);
    const html = await (await call(`/research/${t.id}`)).text();
    assert.match(html, /noindex/);
    assert.equal(
      (await call(`/api/research/${t.id}/retry`, "POST", undefined, "bob"))
        .status,
      404,
    );
    release();
    await until(() => e.store.deepTask(t.id, "alice")?.state === "complete");
    const result = await (await call(`/api/research/${t.id}`)).json();
    assert.equal(result.credit, "used");
    assert.ok(result.result);
    assert.equal(e.store.usage("alice"), 0);
    const account = await (await call("/api/account")).json();
    assert.equal(account.deep.allowance.used, 1);
    assert.equal(account.deep.allowance.remaining, 0);
    const list = await (await call("/api/research")).json();
    assert.equal(list.tasks.length, 1);
    assert.equal(list.tasks[0].owner, undefined);
    const md = await call(`/api/research/${t.id}/export?lang=zh`);
    assert.equal(md.status, 200);
    assert.match(await md.text(), /保留草稿comments意见/);
    assert.equal(
      (
        await call("/api/research", "POST", {
          ...body,
          requestKey: randomUUID(),
        })
      ).status,
      409,
    );
  } finally {
    release();
    app.locals.stopDeepResearch();
    server.close();
    await once(server, "close");
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prose-only repair preserves source IDs and quotes, while structural and near-verbatim repairs preserve meaning", async () => {
  const { normalizeDeepBrief, deepCopyRepairs } =
    await import("../src/core/deep.js");
  const original = brief() as any;
  original.plan.checks = original.checks;
  delete original.checks;
  const moved = normalizeDeepBrief(original) as DeepBrief;
  assert.ok(deepBriefSchema.safeParse(moved).success);
  assert.equal(original.checks, undefined);
  const terminology = brief();
  terminology.answer.zh =
    "建议采用模型无关接口与不可变产物（E2），无锁机的实际兼容范围仍待核对。";
  terminology.findings[0]!.evidence[0]!.quote = "不可变产物与模型无关接口";
  const readable = normalizeDeepBrief(terminology, [
    source,
    request,
  ]) as DeepBrief;
  assert.equal(
    readable.answer.zh,
    "建议采用模型可替换接口与写入后保持原样的产物，SIM unlocked 机型的实际兼容范围仍待核对。",
  );
  assert.equal(
    readable.findings[0]!.evidence[0]!.quote,
    "不可变产物与模型无关接口",
  );
  assert.equal(terminology.answer.zh.includes("模型无关"), true);
  const verbose = brief() as any;
  verbose.answer.zh = "研究方向".repeat(70);
  verbose.extra = { zh: "不应影响内容校验" };
  const repairs = deepCopyRepairs(verbose);
  assert.deepEqual(repairs, [
    { path: "answer.zh", value: verbose.answer.zh, maxCharacters: 240 },
  ]);
  const numbered = brief();
  numbered.answer.zh = "先邀请 E2 中提出请求的作者体验段落映射原型。";
  assert.deepEqual(
    deepCopyRepairs(numbered, [source, request]).map((f) => f.path),
    ["answer.zh"],
  );
  assert.equal(numbered.findings[0]!.evidence[0]!.id, "E2");
  const legalSource = {
    ...source,
    id: "license",
    excerpt:
      "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION. Keep original notices.",
  };
  const quoted = brief();
  quoted.findings[0]!.evidence = [
    {
      id: "license",
      quote: "TERMS AND CONDITIONS FOR USE, REPRODUCTION AND DISTRIBUTION",
    },
  ];
  assert.equal(
    (normalizeDeepBrief(quoted, [legalSource]) as DeepBrief).findings[0]!
      .evidence[0]!.quote,
    "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
  );
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-copy-"));
  const e = new Engine(new Store(dir)),
    m = sample(),
    t = task();
  e.store.saveMarket(m, false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: new Date().toISOString(),
    queries: [],
    githubQuery: "comments",
    sources: [source, request],
    reads: [],
  };
  let writes = 0,
    copies = 0;
  e.research.json = async (_system, input, _tokens, op) => {
    if (op === "strategy-deep-copy") {
      copies++;
      assert.equal((input as any).fields.length, 1);
      return {
        edits: [
          {
            path: "plan.resources.en",
            value: "Use a static frontend and a local document example.",
            maxCharacters: 500,
          },
          { path: "findings.0.evidence.0.id", value: "invented" },
        ],
      };
    }
    if (op === "strategy-deep-review") return { ready: true, corrections: [] };
    writes++;
    const b = brief();
    b.plan.resources.en = "Use the frontend without a server.";
    return b;
  };
  try {
    assert.equal(await runDeepResearch(e, t, () => {}), true);
    assert.equal(writes, 1);
    assert.equal(copies, 1);
    assert.equal(t.result!.findings[0]!.evidence[0]!.id, "E2");
    assert.deepEqual(deepProblems(t.result, t.evidence.sources), []);
  } finally {
    await e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a broad issue match stays outside selected-project research and license evidence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-relevance-"));
  const e = new Engine(new Store(dir)),
    m = sample(),
    t = task();
  const project: ResearchSource = {
    ...source,
    id: "E3",
    url: "https://github.com/Example/Drafts/blob/main/README.md",
    kind: "project",
  };
  const unrelated: ResearchSource = {
    ...request,
    id: "E4",
    url: "https://github.com/other/directory/issues/1",
    label: "Submit your tools",
  };
  const otherLicense: ResearchSource = {
    ...source,
    id: "E5",
    url: "https://github.com/other/directory/blob/main/LICENSE",
    documentType: "license",
  };
  m.brief!.sources = [project, unrelated];
  m.brief!.opportunities![0]!.basedOn = [
    { id: "E3", quote: project.excerpt! },
    { id: "E4", quote: unrelated.excerpt! },
  ];
  e.store.saveMarket(m, false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: new Date().toISOString(),
    queries: [],
    githubQuery: "document comments",
    sources: [source, request, project, unrelated, otherLicense],
    reads: [],
  };
  let checked = false;
  e.research.json = async (_s, input, _n, op) => {
    if (op === "strategy-deep-review") return { ready: true, corrections: [] };
    const payload = input as any;
    assert.deepEqual(payload.knownProjects, ["Example/Drafts"]);
    assert.equal(payload.direction.en.delivery, undefined);
    assert.equal(payload.direction.en.resources, undefined);
    assert.equal(payload.direction.en.experiment, undefined);
    assert.match(payload.direction.status, /proposed direction/);
    assert.ok(payload.sources.some((s: any) => s.id === "E2"));
    assert.ok(
      payload.sources.every((s: any) => s.id !== "E4" && s.id !== "E5"),
    );
    checked = true;
    return brief();
  };
  try {
    assert.equal(await runDeepResearch(e, t, () => {}), true);
    assert.equal(checked, true);
    assert.equal(t.evidence.sources.length, 5);
  } finally {
    await e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an interrupted source stage is collected again; a planning timeout falls back to the selected direction", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-sources-"));
  const e = new Engine(new Store(dir)),
    m = sample(),
    t = task();
  e.store.saveMarket(m, false, t.owner);
  t.evidence = {
    collectedAt: new Date().toISOString(),
    queries: [],
    githubQuery: "old",
    sources: [source, request],
    reads: [],
  };
  let searches = 0,
    checkpoints = 0;
  e.search.collect = async (topic) => {
    searches++;
    assert.equal(topic.plan!.webQueries!.length, 3);
    assert.ok(
      topic.plan!.webQueries!.every((q) =>
        q.query.startsWith("document comments"),
      ),
    );
    return {
      state: "ready",
      provider: "multi-search",
      region: "US",
      language: "en",
      fetchedAt: new Date().toISOString(),
      queries: [],
    };
  };
  e.github.directionEvidence = async () => [source, request];
  e.github.researchSources = async () => [];
  e.github.gaps = async () => [];
  e.github.researchSources = async () => [];
  e.github.licenseSources = async () => [];
  e.github.discussionSources = async () => [];
  e.documents.collect = async () => ({ version: "1", sources: [], reads: [] });
  e.research.json = async (_s, _i, _n, op) => {
    if (op === "deep-plan") throw new Error("timeout");
    if (op === "strategy-deep-review") return { ready: true, corrections: [] };
    return brief();
  };
  try {
    assert.equal(
      await runDeepResearch(e, t, () => {
        checkpoints++;
      }),
      true,
    );
    assert.equal(searches, 1);
    assert.equal(t.evidence.collectionFinished, true);
    assert.ok(checkpoints >= 5);
  } finally {
    await e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the model transport always includes the JSON-mode instruction, including short prose-repair prompts", async () => {
  const env = { ...process.env },
    originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-json-contract-"));
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const e = new Engine(new Store(dir));
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, "json_object");
    assert.match(body.messages[0].content, /\bJSON\b/);
    assert.deepEqual(body.thinking, { type: "disabled" });
    return new Response(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: '{"edits":[]}' } },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          prompt_cache_hit_tokens: 0,
        },
      }),
      { status: 200 },
    );
  };
  try {
    assert.deepEqual(
      await e.research.json(
        "Rewrite the listed prose fields.",
        { fields: [] },
        100,
        "strategy-deep-copy",
        false,
      ),
      { edits: [] },
    );
  } finally {
    globalThis.fetch = originalFetch;
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deleting private research removes its contents while preserving used trial and abuse limits", () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-delete-"));
  const s = new Store(dir);
  try {
    const t = task();
    s.createDeepTask(t, "fp", true);
    assert.throws(() => s.removeDeepTask(t.id, "bob"), /deep_missing/);
    assert.throws(() => s.removeDeepTask(t.id, "alice"), /deep_active/);
    const running = s.claimDeepTask(t.id, "alice")!;
    running.result = brief();
    s.finishDeepTask(running, true);
    s.removeDeepTask(t.id, "alice");
    assert.equal(s.deepTask(t.id, "alice"), null);
    assert.equal(s.deepRequest("alice", t.request.requestKey), null);
    assert.deepEqual(s.deepHistory("alice"), []);
    assert.equal(s.deepAllowance("alice", true).used, 1);
    assert.throws(() => s.createDeepTask(t, "fp", true), /deep_removed/);
    const b = task("bob");
    s.createDeepTask(b, "b", true);
    s.finishDeepTask(s.claimDeepTask(b.id, "bob")!, false);
    s.removeDeepTask(b.id, "bob");
    for (let i = 0; i < 2; i++) {
      const next = task("bob");
      s.createDeepTask(next, "b" + i, true);
      s.finishDeepTask(s.claimDeepTask(next.id, "bob")!, false);
      s.removeDeepTask(next.id, "bob");
    }
    assert.equal(s.deepAllowance("bob", true).remaining, 1);
    assert.throws(
      () => s.createDeepTask(task("bob"), "overflow", true),
      /deep_capacity/,
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("paid research API keeps retry consent, repeated attempts, private output and actual completion aligned", async () => {
  const env = { ...process.env };
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-paid-api-"));
  process.env.GHTRENDS_HOSTED = "1";
  process.env.PUBLIC_URL = "https://radar.example/radar";
  process.env.DEEPSEEK_API_KEY = "synthetic-key-only";
  process.env.GHTRENDS_DEEP_RESEARCH = "1";
  process.env.GHTRENDS_PAID_RESEARCH = "1";
  delete process.env.GHTRENDS_AUTO_COLLECT;
  const e = new Engine(new Store(dir));
  e.store.saveMarket(sample(), false, "alice");
  const sid = randomBytes(32).toString("base64url");
  e.store.set(
    sessionKey(sid),
    { id: "alice", name: "Alice", csrf: "csrf" },
    60000,
  );
  const provider = new CreditProviderFixture();
  let writes = 0;
  let succeed = false;
  e.research.json = async (_s, _i, _n, operation) => {
    if (operation === "deep-plan")
      return {
        queries: ["competition", "demand", "opensource"].map((intent) => ({
          intent,
          query: "document comments " + intent,
        })),
        githubQuery: "document comments",
      };
    if (operation === "strategy-deep-review")
      return { ready: true, corrections: [] };
    writes++;
    if (!succeed) throw new Error("synthetic model interruption");
    return brief();
  };
  e.search.collect = async () => ({
    state: "ready",
    provider: "multi-search",
    region: "US",
    language: "en",
    fetchedAt: new Date().toISOString(),
    queries: [],
  });
  e.github.directionEvidence = async () => [source, request];
  e.documents.collect = async () => ({ version: "1", sources: [], reads: [] });
  e.github.gaps = async () => [];
  e.github.researchSources = async () => [];
  e.github.licenseSources = async () => [];
  e.github.discussionSources = async () => [];
  const app = createApp(e, provider.client());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/radar`;
  const call = (path: string, body?: unknown, cookie = true) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://radar.example",
        Cookie: cookie ? `__Host-ghtrends_session=${sid}` : "",
        "X-CSRF-Token": "csrf",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    const input = { ...task().request, funding: "pack" };
    assert.equal((await call("/api/research", input, false)).status, 401);
    const start = await call("/api/research", input);
    assert.equal(start.status, 202);
    const saved = await start.json();
    await until(
      () => e.store.deepTask(saved.id, "alice")?.credit === "returned",
    );
    assert.equal(provider.reservations, 1);
    assert.equal(provider.consumed, 0);
    assert.equal(e.store.deepAllowance("alice", true).remaining, 1);
    const duplicate = await call("/api/research", input);
    assert.equal((await duplicate.json()).id, saved.id);
    assert.equal(provider.reservations, 1);
    assert.equal(
      (await call(`/api/research/${saved.id}/retry`, {})).status,
      400,
    );
    assert.equal(
      (
        await call(`/api/research/${saved.id}/retry`, {
          funding: "pack",
          fromAttempt: 1,
        })
      ).status,
      202,
    );
    await until(
      () => e.store.deepTask(saved.id, "alice")?.credit === "returned",
    );
    assert.equal(e.store.deepTask(saved.id, "alice")?.attempts, 2);
    assert.equal(provider.reservations, 2);
    // A delayed duplicate from attempt one must not start attempt three.
    const repeated = await call(`/api/research/${saved.id}/retry`, {
      funding: "pack",
      fromAttempt: 1,
    });
    assert.equal((await repeated.json()).attempts, 2);
    assert.equal(provider.reservations, 2);
    succeed = true;
    await call(`/api/research/${saved.id}/retry`, {
      funding: "pack",
      fromAttempt: 2,
    });
    await until(() => e.store.deepTask(saved.id, "alice")?.credit === "used");
    const final = await (await call(`/api/research/${saved.id}`)).json();
    assert.equal(final.state, "complete");
    assert.equal(final.funding, "pack");
    assert.equal(final.attempts, 3);
    assert.ok(final.result);
    assert.equal(provider.consumed, 1);
    assert.equal(provider.releases, 2);
    assert.equal(provider.balance(), 9);
    assert.equal(writes, 3);
    const receipt = e.store.deepPayment(saved.id)!.receipt!;
    const exported = await (
      await call(`/api/research/${saved.id}/export?format=json`)
    ).text();
    assert.ok(!exported.includes(receipt.reservation_id));
    assert.ok(!exported.includes(receipt.lot_id));
    assert.equal(
      (await call(`/api/research/${saved.id}`, undefined, false)).status,
      401,
    );
    const balance = await (await call("/api/account/credits")).json();
    assert.equal(balance.data.balance.available, 9);
  } finally {
    app.locals.stopDeepResearch?.();
    app.locals.stopCollector?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const mode of ["disconnected", "backoff"] as const) {
  test(`a ${mode} paid queue preserves saved work and yields to standard research`, async () => {
    const env = { ...process.env },
      dir = mkdtempSync(join(tmpdir(), "ghtrends-paid-lane-"));
    Object.assign(process.env, {
      GHTRENDS_HOSTED: "1",
      PUBLIC_URL: "https://radar.example",
      DEEPSEEK_API_KEY: "synthetic-only",
      GHTRENDS_DEEP_RESEARCH: "1",
      GHTRENDS_PAID_RESEARCH: "1",
    });
    delete process.env.GHTRENDS_AUTO_COLLECT;
    const e = new Engine(new Store(dir)),
      sid = randomBytes(32).toString("base64url");
    e.store.set(
      sessionKey(sid),
      { id: "alice", name: "Alice", csrf: "csrf" },
      60000,
    );
    e.store.saveMarket(sample(), false, "alice");
    const waiting = task("another-owner");
    waiting.funding = "pack";
    e.store.createDeepTask(waiting, "waiting", true);
    if (mode === "backoff")
      e.store.deferDeepPayment(waiting.id, 1, "unavailable");
    let scans = 0;
    e.research.plan = async () => sample().topic;
    e.scan = async () => {
      scans++;
      return sample();
    };
    const provider = new CreditProviderFixture();
    const app = createApp(
      e,
      mode === "disconnected"
        ? new CreditAccountClient(fetch, {})
        : provider.client(),
    );
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const post = (path: string, body: unknown) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://radar.example",
          Cookie: `__Host-ghtrends_session=${sid}`,
          "X-CSRF-Token": "csrf",
        },
        body: JSON.stringify(body),
      });
    try {
      if (mode === "disconnected")
        assert.equal(
          (await post("/api/research", { ...task().request, funding: "pack" }))
            .status,
          503,
        );
      const response = await post("/api/scan", { topic: "document comments" });
      assert.equal(response.status, 202, await response.clone().text());
      const job = await response.json();
      await until(() => scans === 1);
      assert.equal(e.store.get<any>("job:" + job.id)?.state, "complete");
      assert.equal(
        e.store.deepTask(waiting.id, waiting.owner)?.state,
        "queued",
      );
      assert.equal(provider.reservations, 0);
    } finally {
      app.locals.stopDeepResearch?.();
      app.locals.stopCollector?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await e.close();
      process.env = env;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
