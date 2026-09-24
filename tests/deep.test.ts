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
  normalizeDeepBrief,
  deepCopyRepairs,
  deepGenerationSchema,
  deepProjectUseConditions,
  type DeepTask,
  type DeepBrief,
} from "../src/core/deep.js";
import { runDeepResearch, deepOfferQueries } from "../src/providers/deep.js";
import { deepView } from "../src/server/deep.js";
import { CreditProviderFixture } from "./fixtures/credit-provider.js";
import { CreditAccountClient } from "../src/server/credits.js";
import type { Market, ResearchSource } from "../src/core/types.js";

const copy = (
  en = "Compare three examples with a working editor.",
  zh = "与一位编辑核对三个实际样例。",
) => ({ en, zh });

for (const outcome of ["repair", "unresolved", "unavailable"] as const)
  test(`combined factual and decision review gates delivery (${outcome})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghtrends-decision-gate-"));
    const env = { ...process.env };
    process.env.DEEPSEEK_API_KEY = "unit-test-only";
    const e = new Engine(new Store(dir)),
      t = task();
    e.store.saveMarket(sample(), false, t.owner);
    t.evidence = {
      collectionFinished: true,
      collectedAt: t.created,
      queries: [],
      githubQuery: "comments",
      sources: [source, request],
      reads: [],
    };
    let decisions = 0,
      repairs = 0;
    e.research.json = async (prompt, input, _tokens, operation, thinking) => {
      if (operation === "strategy-deep-write") return brief();
      if (operation === "strategy-deep-review") {
        decisions++;
        assert.equal(thinking, false);
        assert.match(prompt, /same market/);
        assert.ok((input as any).sources.length);
        if (outcome === "unavailable")
          throw new Error("decision reviewer unavailable");
        return outcome === "repair" && decisions > 1
          ? { ready: true, corrections: [] }
          : {
              ready: false,
              corrections: [
                {
                  paths: ["answer"],
                  source: "E1",
                  repair:
                    "Label the proposed advantage as a hypothesis, not an established result.",
                },
              ],
            };
      }
      if (operation === "strategy-deep-correction-check")
        return {
          decisions: [
            {
              index: 0,
              action: "apply_correction",
              reason: "The comparison has not been tested.",
            },
          ],
        };
      if (operation === "strategy-deep-repair") {
        repairs++;
        assert.deepEqual(
          (input as any).requestedFields.map((f: any) => f.path),
          ["answer"],
        );
        return {
          edits: [
            {
              path: "answer",
              value: copy(
                `Test the proposed advantage with ${repairs + 2} editor examples.`,
                `用 ${repairs + 2} 个编辑实例检验假设中的优势。`,
              ),
            },
          ],
        };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    };
    try {
      if (outcome === "unavailable") {
        await assert.rejects(
          runDeepResearch(e, t, () => {}),
          /decision reviewer unavailable/,
        );
        assert.equal(t.result, undefined);
      } else {
        assert.equal(
          await runDeepResearch(e, t, () => {}),
          outcome === "repair",
        );
        assert.equal(decisions, outcome === "repair" ? 2 : 3);
        assert.equal(repairs, outcome === "repair" ? 1 : 2);
        if (outcome === "repair")
          assert.match(t.result!.answer.en, /proposed advantage/);
        else {
          assert.equal(t.result, undefined);
          assert.equal(t.problem, "model");
        }
      }
    } finally {
      await e.close();
      process.env = env;
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("deep offer searches follow at most two direct substitutes, never generic advice or private addresses", () => {
  const lead = (
    url: string,
    searchRole: ResearchSource["searchRole"] = "direct",
  ): ResearchSource => ({
    url,
    kind: "search",
    label: "Product",
    excerpt: "Official offer",
    searchIntent: "competition",
    searchRole,
    placement: "organic",
  });
  assert.deepEqual(
    deepOfferQueries([
      lead("https://one.example/product"),
      lead("https://one.example/features"),
      lead("https://advice.example/post", "resource"),
      lead("http://127.0.0.1/internal"),
      lead("https://github.com/search?q=trend"),
      lead("https://apps.apple.com/us/app/a-specific-tool/id123"),
      lead("https://two.example/"),
      lead("https://three.example/"),
    ]).map((q) => q.query),
    [
      "site:one.example pricing plans subscription features",
      "site:two.example pricing plans subscription features",
    ],
  );
  assert.deepEqual(
    deepOfferQueries([
      lead("https://one.example/product"),
      lead("https://one.example/pricing"),
    ]),
    [],
  );
});

// Combined review replaces the removed review-of-review.
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
  return deepBriefSchema.parse(
    normalizeDeepBrief({
      experimentPlan: {
        directionId: "comments",
        counts: {
          participants: 5,
          tasksPerParticipant: 3,
          successfulTasksPerParticipant: 2,
          continueAt: 4,
          redirectAtMost: 2,
        },
        en: {
          participants:
            "Editors with permission to use their document examples.",
          task: "Map review comments across one document revision and compare with the current editor.",
          timebox: "A proposed one-week pilot.",
          measurement:
            "All comments remain next to the intended paragraphs in the saved revision.",
          redirectAction:
            "Test a simpler paragraph matcher with the same editors.",
        },
        zh: {
          participants: "拥有文档样例使用授权的编辑。",
          task: "对一次文档修订映射评审意见，并与当前编辑器对照。",
          timebox: "建议用一周开展试验。",
          measurement: "保存后每条意见均位于预期段落旁。",
          redirectAction: "与同一组编辑测试简化的段落映射器。",
        },
      },
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
    }),
  );
}
test("focused pilots share counts, protect rendered decisions and retain legacy readability", () => {
  const b = brief();
  assert.deepEqual(deepProblems(b, [source, request], "comments"), []);
  assert.match(b.plan.experiment.en, /3 tasks \(15 total\)/);
  assert.match(b.plan.experiment.zh, /共 15 次/);
  assert.match(b.plan.continueIf.zh, /至少 4 人/);
  assert.match(b.plan.continueIf.zh, /达标人数为 3 人/);
  assert.match(b.plan.changeIf.zh, /至多 2 人/);
  assert.ok(deepProblems(b, [source, request], "another-direction").length);
  const forged = structuredClone(b);
  forged.plan.continueIf.en = "Continue after at least one person succeeds.";
  assert.ok(deepProblems(forged, [source, request], "comments").length);
  assert.deepEqual(normalizeDeepBrief(forged), b);
  assert.deepEqual(
    applyDeepEdits(b, { edits: [{ path: "plan.continueIf", value: copy() }] }, [
      "plan.continueIf",
    ]),
    b,
  );
  const bad = structuredClone(b);
  bad.experimentPlan!.counts!.redirectAtMost = 4;
  assert.ok(
    deepProblems(normalizeDeepBrief(bad), [source, request], "comments").length,
  );
  const long = structuredClone(b);
  long.experimentPlan!.en.participants = "A".repeat(201);
  assert.ok(
    deepProblems(
      normalizeDeepBrief(long),
      [source, request],
      "comments",
    )[0]?.startsWith("experimentPlan.en.participants:"),
  );
  const legacy = structuredClone(b);
  delete legacy.experimentPlan;
  legacy.plan.experiment = copy();
  legacy.plan.continueIf = copy();
  legacy.plan.changeIf = copy();
  assert.deepEqual(deepProblems(legacy, [source, request]), []);
  assert.ok(deepProblems(legacy, [source, request], "comments").length);
  const authored = structuredClone(b) as any;
  delete authored.plan.experiment;
  delete authored.plan.continueIf;
  delete authored.plan.changeIf;
  assert.ok(deepGenerationSchema.safeParse(authored).success);
  assert.deepEqual(normalizeDeepBrief(authored), b);
});

test("pilot copy repairs edit paired authored text and preserve shared outcome counts", () => {
  const b = brief();
  b.experimentPlan!.zh.measurement = "不是随便记录，而是完整记录评审意见。";
  const edits = deepCopyRepairs(b);
  assert.deepEqual(
    edits.map((e) => e.path),
    ["experimentPlan.zh.measurement"],
  );
  assert.equal(edits[0]!.maxCharacters, 200);
  assert.deepEqual(edits[0]!.counterpart, {
    language: "en",
    value: b.experimentPlan!.en.measurement,
  });
  b.experimentPlan!.zh.measurement = "全部评审意见均完整记录。";
  const result = normalizeDeepBrief(b) as DeepBrief;
  assert.match(result.plan.experiment.zh, /全部评审意见均完整记录/);
  assert.deepEqual(result.experimentPlan!.counts, b.experimentPlan!.counts);
  assert.deepEqual(deepCopyRepairs(result), []);
});

test("decision prose preserves absence, uncertainty and technical terms without cosmetic model edits", () => {
  const b = brief();
  b.answer = {
    en: "Teams collect signals without a way to organize them; willingness to pay is unknown.",
    zh: "团队收集信号却没有整理方法；付费意愿尚未得到验证。",
  };
  b.plan.resources = {
    en: "Use a model-agnostic interface and immutable artifacts; no server is required.",
    zh: "使用模型无关接口和不可变产物，无需服务器。",
  };
  b.experimentPlan!.zh.measurement = "记录完整且没有遗漏评审意见。";
  const normalized = normalizeDeepBrief(b, [source, request]) as DeepBrief;
  assert.deepEqual(normalized.answer, b.answer);
  assert.deepEqual(normalized.plan.resources, b.plan.resources);
  assert.deepEqual(deepCopyRepairs(normalized), []);
  assert.deepEqual(deepProblems(normalized, [source, request]), []);
});

test("focused resources show only cited projects' original use conditions in both exports", () => {
  const b = brief();
  const license: ResearchSource = {
    id: "L1",
    label: "Project license",
    url: "https://github.com/team/tool/blob/main/LICENSE",
    documentType: "license",
    excerpt: "Copyright 2026 Tool contributors.",
  };
  const readme: ResearchSource = {
    id: "R1",
    label: "Project README",
    url: "https://github.com/team/tool/blob/main/README.md",
    documentType: "github-readme",
    excerpt: "Useful project.\nCopyright 2026 Tool. All rights reserved.",
  };
  const other: ResearchSource = {
    ...readme,
    id: "R2",
    url: "https://github.com/other/tool/blob/main/README.md",
  };
  const page: ResearchSource = {
    ...readme,
    id: "P1",
    url: "https://example.com",
    documentType: "page",
  };
  b.findings[0]!.evidence = [{ id: license.id!, quote: license.excerpt! }];
  const sources = [license, readme, other, page];
  const notices = deepProjectUseConditions(b, sources);
  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.project, "team/tool");
  assert.equal(notices[0]!.quote, "Copyright 2026 Tool. All rights reserved.");
  const t = task();
  t.result = b;
  t.evidence = {
    collectedAt: t.created,
    queries: [],
    githubQuery: "tool",
    sources,
    reads: [],
  };
  for (const lang of ["en", "zh"] as const) {
    const text = deepMarkdown(deepView(t), lang);
    assert.ok(text.includes(notices[0]!.quote));
    assert.ok(
      text.indexOf(notices[0]!.quote) <
        text.indexOf(lang === "zh" ? "投入估算" : "Effort estimate"),
    );
  }
});

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
  assert.deepEqual(deepProblems(badCopy, evidence.sources), []);
  assert.deepEqual(deepCopyRepairs(badCopy), []);
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
  const experiment = structuredClone(brief().experimentPlan!);
  experiment.en.task = "Try three edited paragraphs with their editor.";
  experiment.zh.task = "请编辑试用三个修改过的段落。";
  e.research.json = async (_system, _input, _tokens, operation, thinking) => {
    if (operation === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    assert.equal(thinking, false);
    calls++;
    if (operation === "strategy-deep-correction-check")
      return {
        decisions: [
          {
            index: 0,
            action: "apply_correction",
            reason:
              "The proposed field correction matches the supplied QA source.",
          },
        ],
      };
    if (operation === "strategy-deep-repair") {
      assert.ok(
        (_input as any).schema,
        "targeted repairs retain the generation limits",
      );
      assert.deepEqual(
        (_input as any).requestedFields.map((f: any) => f.path),
        ["experimentPlan"],
      );
      return {
        edits: [
          { path: "experimentPlan", value: experiment },
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
            path: "experimentPlan",
            before: brief().experimentPlan,
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
    assert.deepEqual(
      t.result,
      normalizeDeepBrief({
        ...brief(),
        experimentPlan: experiment,
      }),
    );
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
    if (operation === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
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

test("a rejected child patch gets format feedback before the remaining repair attempt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-noop-")),
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
  let repairs = 0;
  e.research.json = async (_system, input, _tokens, operation) => {
    if (operation === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    operations.push(operation!);
    if (operation === "strategy-deep-review")
      return { ready: true, corrections: [] };
    if (operation === "strategy-deep-repair") {
      repairs++;
      const data = input as any;
      assert.deepEqual(
        data.requestedFields.map((f: any) => f.path),
        ["findings.0.evidence"],
      );
      if (repairs === 1)
        return {
          edits: [
            {
              path: "findings.0.evidence.0.quote",
              value: brief().findings[0].evidence[0].quote,
            },
          ],
        };
      assert.ok(
        data.corrections.some((c: string) =>
          c.includes("changed zero requested fields"),
        ),
      );
      assert.ok(
        data.corrections.some((c: string) =>
          c.includes("exact, contiguous span"),
        ),
      );
      assert.equal(
        data.priorDraft.findings[0].evidence[0].quote,
        "A wholly fabricated statement about paying customers.",
      );
      return {
        edits: [
          { path: "findings.0.evidence", value: brief().findings[0].evidence },
        ],
      };
    }
    assert.equal(operation, "strategy-deep-write");
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
      "strategy-deep-repair",
      "strategy-deep-review",
    ]);
  } finally {
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed semantic repair preserves factual corrections through rollback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-rollback-")),
    env = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const e = new Engine(new Store(dir)),
    t = task();
  e.store.saveMarket(sample(), false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: t.created,
    queries: [],
    githubQuery: "comments",
    sources: [source, request],
    reads: [],
  };
  const factualCorrection =
    "Describe the manual route as an alternative considered; confirm the user's current workflow.";
  const corrected = copy(
    "The author considered the manual route; confirm their current workflow.",
    "作者考虑过手动方案；核实其当前工作流。",
  );
  let repairs = 0,
    reviews = 0,
    copies = 0;
  const checkpoints: string[][] = [];
  e.research.json = async (_s, input, _n, operation) => {
    if (operation === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    const data = input as any;
    if (operation === "strategy-deep-review") {
      reviews++;
      if (reviews === 1)
        return {
          ready: false,
          corrections: [
            {
              paths: ["answer", "experimentPlan"],
              source: "E2",
              repair: factualCorrection,
            },
          ],
        };
      assert.deepEqual(data.result.answer, corrected);
      return { ready: true, corrections: [] };
    }
    if (operation === "strategy-deep-correction-check")
      return {
        decisions: [
          {
            index: 0,
            action: "apply_correction",
            reason: "The quoted source describes an alternative considered.",
          },
        ],
      };
    if (operation === "strategy-deep-copy") {
      copies++;
      return { edits: [] };
    }
    if (operation === "strategy-deep-repair") {
      repairs++;
      assert.ok(
        data.corrections.some((c: string) => c.includes(factualCorrection)),
      );
      if (repairs === 2) {
        assert.ok(
          data.corrections.some((c: string) =>
            c.includes("experimentPlan.en.participants"),
          ),
        );
        assert.deepEqual(data.priorDraft.answer, brief().answer);
      }
      const pilot = structuredClone(brief().experimentPlan!);
      if (repairs === 1)
        pilot.en.participants =
          "Editors evaluating the proposed workflow. ".repeat(8);
      return {
        edits: [
          { path: "answer", value: corrected },
          { path: "experimentPlan", value: pilot },
        ],
      };
    }
    assert.equal(operation, "strategy-deep-write");
    return brief();
  };
  try {
    assert.equal(
      await runDeepResearch(e, t, () => {
        if (t.work) checkpoints.push([...t.work.corrections]);
      }),
      true,
    );
    assert.deepEqual(t.result!.answer, corrected);
    assert.deepEqual(t.result!.experimentPlan, brief().experimentPlan);
    assert.equal(repairs, 2);
    assert.equal(reviews, 2);
    assert.equal(copies, 2);
    assert.ok(
      checkpoints.some(
        (cs) =>
          cs.some((c) => c.includes(factualCorrection)) &&
          cs.some((c) => c.includes("experimentPlan.en.participants")),
      ),
    );
  } finally {
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const mode of [
  "unlocated-correction",
  "broken-patch",
  "unrequested-patch",
  "unchanged-patch",
] as const) {
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
      if (operation === "strategy-deep-decision-check")
        return { ready: true, corrections: [] };
      operations.push(operation!);
      if (operation === "strategy-deep-correction-check")
        return {
          decisions: [
            {
              index: 0,
              action: "apply_correction",
              reason: "The proposed correction matches the supplied QA source.",
            },
          ],
        };
      if (operation === "strategy-deep-review")
        return {
          ready: false,
          corrections: [
            {
              paths:
                mode === "unlocated-correction" ? ["wholeReport"] : ["answer"],
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
        if (mode === "unrequested-patch")
          return {
            edits: [{ path: "answer.en", value: "A narrow child patch." }],
          };
        if (mode === "unchanged-patch")
          return { edits: [{ path: "answer", value: brief().answer }] };
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
        mode !== "unlocated-correction"
          ? [
              "strategy-deep-write",
              "strategy-deep-review",
              "strategy-deep-repair",
              "strategy-deep-repair",
            ]
          : ["strategy-deep-write", "strategy-deep-review"],
      );
      if (mode === "unrequested-patch" || mode === "unchanged-patch") {
        assert.deepEqual(t.work?.draft, brief());
        assert.equal(
          t.work?.corrections.filter((c) =>
            c.includes("changed zero requested fields"),
          ).length,
          1,
        );
      }
    } finally {
      await e.close();
      process.env = env;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const outcome of ["accept", "reject", "provider-error"] as const) {
  test(`review failure without automatic recovery retains quality checks: ${outcome}`, async () => {
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
      if (operation === "strategy-deep-decision-check")
        return { ready: true, corrections: [] };
      operations.push(operation!);
      if (operation === "strategy-deep-correction-check")
        return {
          decisions: [
            {
              index: 0,
              action: "apply_correction",
              reason: "The proposed correction matches the supplied QA source.",
            },
          ],
        };
      if (operation === "strategy-deep-review") {
        assert.equal(thinking, false);
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
      await assert.rejects(
        runDeepResearch(e, t, () => {}),
        outcome === "provider-error" ? /429/ : /incomplete/,
      );
      assert.equal(
        operations.filter((o) => o === "strategy-deep-review-recovery").length,
        0,
      );
      assert.equal(Boolean(t.result), false);
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
    if (operation === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    if (operation === "deep-plan") {
      entered = true;
      await new Promise<void>((r) => {
        release = r;
      });
      return {
        queries: [
          { intent: "competition", query: "document comments competition" },
          { intent: "demand", query: "document comments demand" },
          { intent: "demand", query: "document comments community" },
          { intent: "opensource", query: "document comments opensource" },
        ],
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
  e.github.issueThreadSources = async () => [];
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
    "建议采用模型无关接口与不可变产物，无锁机的实际兼容范围仍待核对。",
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
    {
      path: "answer.zh",
      value: verbose.answer.zh,
      maxCharacters: 240,
      counterpart: { language: "en", value: verbose.answer.en },
    },
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
    if (op === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
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
    b.plan.resources.en = "Use not a server but a static frontend.";
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
    excerpt:
      "Introduction. ".repeat(180) +
      "The current release supports draft approval.",
  };
  const projectRoot: ResearchSource = {
    ...project,
    id: "E6",
    url: "https://github.com/example/drafts?tab=readme-ov-file",
    excerpt: "The project root identifies the selected draft tool.",
  };
  const similarName: ResearchSource = {
    ...project,
    id: "E7",
    url: "https://github.com/example/drafts-extra/blob/main/README.md",
  };
  const longPage: ResearchSource = {
    ...source,
    id: "E8",
    kind: "search",
    excerpt: "Vendor documentation. ".repeat(150),
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
    { id: "E3", quote: project.excerpt!.slice(-44) },
    { id: "E4", quote: unrelated.excerpt! },
  ];
  e.store.saveMarket(m, false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: new Date().toISOString(),
    queries: [],
    githubQuery: "document comments",
    sources: [
      source,
      request,
      project,
      unrelated,
      otherLicense,
      projectRoot,
      similarName,
      longPage,
      {
        ...source,
        id: "E9",
        kind: "search",
        url: "https://github.com/search?q=monitoring&type=repositories",
        excerpt: "Hardware monitoring and ML metric drift repositories.",
      },
    ],
    reads: [],
  };
  let checked = false;
  e.research.json = async (_s, input, _n, op) => {
    if (op === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    if (op === "strategy-deep-review") return { ready: true, corrections: [] };
    const payload = input as any;
    assert.deepEqual(payload.knownProjects, ["Example/Drafts"]);
    assert.equal(payload.direction.en.delivery, undefined);
    assert.equal(payload.direction.en.resources, undefined);
    assert.equal(payload.direction.en.experiment, undefined);
    assert.match(payload.direction.status, /proposed direction/);
    assert.ok(payload.sources.some((s: any) => s.id === "E2"));
    assert.equal(
      payload.sources.find((s: any) => s.id === "E2").url,
      request.url,
    );
    const compactProject = payload.sources.find(
      (s: any) => s.id === "E3",
    ).excerpt;
    assert.ok(compactProject.length <= 2000);
    assert.ok(
      compactProject.includes("The current release supports draft approval."),
    );
    assert.equal(
      payload.sources.find((s: any) => s.id === "E3").excerptTruncated,
      true,
    );
    assert.equal(
      payload.sources.find((s: any) => s.id === "E6").project,
      "example/drafts",
    );
    assert.equal(
      payload.sources.find((s: any) => s.id === "E8").excerpt.length,
      1400,
    );
    assert.equal(
      payload.sources.find((s: any) => s.id === "E8").excerptTruncated,
      true,
    );
    assert.ok(
      payload.sources.every(
        (s: any) => !["E4", "E5", "E7", "E9"].includes(s.id),
      ),
    );
    checked = true;
    return brief();
  };
  try {
    assert.equal(await runDeepResearch(e, t, () => {}), true);
    assert.equal(checked, true);
    assert.equal(t.evidence.sources.length, 9);
  } finally {
    await e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const originalFirst of [false, true]) {
  test(`focused evidence merges issue variants and preserves originals (original first: ${originalFirst})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-identities-"));
    const e = new Engine(new Store(dir)),
      m = sample(),
      t = task();
    e.store.saveMarket(m, false, t.owner);
    const original: ResearchSource = {
      ...request,
      url: request.url.replace("/example/", "/Example/"),
      documentType: "github-issue",
      request: { state: "closed", comments: 3 },
    };
    const snippet: ResearchSource = {
      ...request,
      excerpt: "A shorter search snippet.",
    };
    e.search.collect = async () => ({
      state: "ready",
      provider: "multi-search",
      region: "US",
      language: "en",
      fetchedAt: t.created,
      queries: [],
    });
    e.github.directionEvidence = async () => [
      source,
      originalFirst
        ? original
        : {
            ...snippet,
            url: original.url + "/?ref=search#top",
          },
      snippet,
      ...[42, 43].map((id) => ({
        ...request,
        documentType: "github-comment" as const,
        url: original.url + `#issuecomment-${id}`,
      })),
      { ...request, url: request.url + "?ref=search#issuecomment-42" },
      ...["README.md", "readme.md"].map((name) => ({
        ...source,
        documentType: "github-readme" as const,
        url: `https://github.com/example/drafts/blob/main/${name}`,
      })),
      ...["Example", "example"].map((owner) => ({
        ...request,
        url: `https://github.com/${owner}/drafts/discussions/12`,
      })),
    ];
    e.github.gaps = async () => [];
    e.github.researchSources = async () => [];
    e.github.licenseSources = async () => [];
    e.github.discussionSources = async () => [];
    e.github.issueThreadSources = async () => [];
    e.documents.collect = async () => {
      // Deduplicate before original reading and before the bounded model selection.
      assert.equal(t.evidence!.sources.length, 7);
      return {
        version: "2",
        sources: [originalFirst ? snippet : original],
        reads: [],
      };
    };
    let checked = false;
    e.research.json = async (_s, input, _n, op) => {
      if (op === "strategy-deep-decision-check")
        return { ready: true, corrections: [] };
      if (op === "deep-plan") throw new Error("Use fallback queries");
      const sources = (input as any).sources as ResearchSource[];
      const issue = sources.find((s) => s.id === "E2")!;
      assert.equal(issue.documentType, "github-issue");
      assert.equal(issue.excerpt, request.excerpt);
      assert.equal(issue.request!.state, "closed");
      assert.equal(
        sources.filter((s) => s.documentType === "github-comment").length,
        2,
      );
      assert.equal(
        sources.filter((s) => s.documentType === "github-readme").length,
        2,
      );
      checked = true;
      return op === "strategy-deep-review"
        ? { ready: true, corrections: [] }
        : brief();
    };
    try {
      assert.equal(await runDeepResearch(e, t, () => {}), true);
      assert.equal(checked, true);
      assert.equal(t.evidence!.sources.length, 7);
      assert.equal(t.evidence!.sources[1]!.request!.comments, 3);
    } finally {
      await e.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("an interrupted source stage is collected again and retains collection truncation", async () => {
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
    assert.equal(topic.plan!.webQueries!.length, 4);
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
  e.github.directionEvidence = async () => [
    source,
    request,
    {
      ...source,
      url: "https://example.com/long-document",
      excerpt: "Original documentation. ".repeat(300),
    },
  ];
  e.github.researchSources = async () => [];
  e.github.gaps = async () => [];
  e.github.researchSources = async () => [];
  e.github.licenseSources = async () => [];
  e.github.discussionSources = async () => [];
  const comment = {
    ...request,
    documentType: "github-comment" as const,
    url: request.url + "#issuecomment-42",
    parentUrl: request.url,
    request: { authorKey: "account-1", authorAssociation: "MEMBER" },
  };
  let threadsRead = 0;
  e.github.issueThreadSources = async (candidates, onRead) => {
    threadsRead++;
    assert.ok(candidates.some((s) => s.url === request.url));
    onRead?.({ url: comment.url, status: "read", observedAt: t.created });
    return [
      {
        ...request,
        url: request.url.replace("/example/", "/Example/"),
        documentType: "github-issue",
        request: { state: "open", comments: 5 },
      },
      comment,
    ];
  };
  e.documents.collect = async () => ({ version: "1", sources: [], reads: [] });
  e.research.json = async (_s, _i, _n, op) => {
    if (op === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    if (op === "deep-plan") throw new Error("timeout");
    if (op === "strategy-deep-write" || op === "strategy-deep-review") {
      const cited = (_i as any).sources.find((s: any) => s.url === comment.url);
      assert.equal(cited.documentType, "github-comment");
      assert.equal(cited.request.authorAssociation, "MEMBER");
      assert.equal(cited.parentUrl, request.url);
      const original = (_i as any).sources.find((s: any) => s.id === "E2");
      assert.equal(original.request.comments, undefined);
    }
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
    assert.equal(threadsRead, 1);
    const refreshed = t.evidence.sources.filter(
      (s) => s.url.toLowerCase() === request.url,
    );
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0]!.id, "E2");
    assert.equal(refreshed[0]!.request!.comments, 5);
    assert.ok(t.evidence.reads.some((r) => r.url === comment.url));
    assert.ok(t.evidence.sources.some((s) => s.url === comment.url));
    assert.equal(t.evidence.collectionFinished, true);
    const shortened = t.evidence.sources.find((s) =>
      s.url.endsWith("/long-document"),
    )!;
    assert.equal(shortened.excerpt!.length, 6000);
    assert.equal(shortened.excerptTruncated, true);
    assert.ok(checkpoints >= 5);
  } finally {
    await e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const planning of ["model", "fallback"] as const) {
  test(`named-project research checks current workflow docs within its existing search budget (${planning})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-current-docs-"));
    const e = new Engine(new Store(dir)),
      m = sample(),
      t = task();
    const projectSource = {
      ...source,
      id: "P1",
      documentType: "github-readme" as const,
      url: "https://github.com/PostHog/posthog/blob/main/README.md",
    };
    const projectRequest = {
      ...request,
      url: "https://github.com/PostHog/posthog/issues/12",
    };
    m.brief!.sources = [projectSource];
    const direction = m.brief!.opportunities![0]!;
    direction.basedOn = [{ id: "P1", quote: source.excerpt! }];
    direction.en.title = "Google Ads source for PostHog";
    e.store.saveMarket(m, false, t.owner);
    let searches = 0;
    e.search.collect = async (topic) => {
      searches++;
      const queries = topic.plan!.webQueries!;
      assert.equal(queries.length, 4);
      assert.equal(new Set(queries.map((q) => q.intent)).size, 3);
      assert.equal(
        queries.find((q) => q.intent === "opensource")!.query,
        '"PostHog/posthog" documentation',
      );
      for (const intent of ["competition", "demand"]) {
        assert.ok(
          queries
            .find((q) => q.intent === intent)!
            .query.startsWith(
              planning === "model" ? "planned " : "document comments",
            ),
        );
      }
      return {
        state: "ready",
        provider: "multi-search",
        region: "US",
        language: "en",
        fetchedAt: t.created,
        queries: [],
      };
    };
    e.github.directionEvidence = async () => [projectSource, projectRequest];
    e.github.researchSources = async () => [];
    e.github.gaps = async () => [];
    e.github.licenseSources = async () => [];
    e.github.discussionSources = async () => [];
    e.github.issueThreadSources = async () => [];
    e.documents.collect = async () => ({
      version: "3",
      sources: [],
      reads: [],
    });
    e.research.json = async (_prompt, _input, _max, op) => {
      if (op === "strategy-deep-decision-check")
        return { ready: true, corrections: [] };
      if (op === "deep-plan") {
        if (planning === "fallback") throw new Error("planning timeout");
        return {
          queries: [
            { intent: "competition", query: "planned competition" },
            { intent: "demand", query: "planned demand" },
            { intent: "demand", query: "planned community" },
            { intent: "opensource", query: "planned opensource" },
          ],
          githubQuery: "analytics connector",
        };
      }
      if (op === "strategy-deep-review")
        return { ready: true, corrections: [] };
      return brief();
    };
    try {
      assert.equal(await runDeepResearch(e, t, () => {}), true, t.problem);
      assert.equal(searches, 1);
      assert.equal(t.evidence!.queries.length, 4);
      assert.equal(
        t.evidence!.queries.find((q) => q.intent === "opensource")!.query,
        '"PostHog/posthog" documentation',
      );
    } finally {
      await e.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("deep model routing leaves lightweight research unchanged and records the model actually requested", async () => {
  const env = { ...process.env },
    originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  process.env.DEEPSEEK_MODEL = "deepseek-flash";
  process.env.GHTRENDS_DEEP_MODEL = "deepseek-v4-pro";
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-model-"));
  const e = new Engine(new Store(dir));
  const requested: string[] = [],
    recorded: string[] = [];
  e.store.recordCall = (call) => {
    recorded.push(call.model!);
  };
  globalThis.fetch = async (_url, init) => {
    requested.push(JSON.parse(String(init?.body)).model);
    return new Response(
      JSON.stringify({
        choices: [
          { finish_reason: "stop", message: { content: '{"ok":true}' } },
        ],
      }),
      { status: 200 },
    );
  };
  try {
    for (const op of [
      "strategy-write",
      "deep-plan",
      "strategy-deep-write",
      "strategy-deep-review",
      "web-relevance",
    ])
      await e.research.json("Return JSON", {}, 100, op, false);
    assert.deepEqual(requested, [
      "deepseek-flash",
      "deepseek-v4-pro",
      "deepseek-v4-pro",
      "deepseek-v4-pro",
      "deepseek-flash",
    ]);
    assert.deepEqual(recorded, requested);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = env;
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
    if (operation === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    if (operation === "deep-plan")
      return {
        queries: [
          { intent: "competition", query: "document comments competition" },
          { intent: "demand", query: "document comments demand" },
          { intent: "demand", query: "document comments community" },
          { intent: "opensource", query: "document comments opensource" },
        ],
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
  e.github.issueThreadSources = async () => [];
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

test("an interrupted repair retains its draft without falsely approving delivery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-dispute-"));
  const env = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const e = new Engine(new Store(dir)),
    t = task();
  e.store.saveMarket(sample(), false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: t.created,
    queries: [],
    githubQuery: "comments",
    sources: [source, request],
    reads: [],
  };
  const calls: string[] = [];
  e.research.json = async (_s, _i, _n, op) => {
    if (op === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    calls.push(op!);
    if (op === "strategy-deep-review")
      return {
        ready: false,
        corrections: [
          {
            paths: ["answer"],
            repair: "Replace an already source-supported claim.",
          },
        ],
      };
    if (op === "strategy-deep-correction-check")
      return {
        decisions: [
          {
            index: 0,
            action: "keep_draft",
            reason: "The original source supports the draft claim exactly.",
          },
        ],
      };
    if (op === "strategy-deep-repair")
      throw new Error("An accurate draft must stay intact");
    return brief();
  };
  try {
    await assert.rejects(
      runDeepResearch(e, t, () => {}),
      /accurate draft/,
    );
    assert.equal(t.result, undefined);
    assert.deepEqual(t.work?.draft, brief());
    assert.equal(calls.length, 3);
  } finally {
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const changed of [false, true])
  test(`saved draft resumes review across process restart; source changed=${changed}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-draft-"));
    const env = { ...process.env };
    process.env.DEEPSEEK_API_KEY = "unit-test-only";
    let e = new Engine(new Store(dir));
    const t = task();
    e.store.saveMarket(sample(), false, t.owner);
    t.evidence = {
      collectionFinished: true,
      collectedAt: t.created,
      queries: [],
      githubQuery: "comments",
      sources: [source, request],
      reads: [],
    };
    e.store.createDeepTask(t, "draft-test", true);
    const running = e.store.claimDeepTask(t.id, t.owner)!;
    e.research.json = async (_s, _i, _n, op) => {
      if (op === "strategy-deep-decision-check")
        return { ready: true, corrections: [] };
      if (op === "strategy-deep-review") throw new Error("429 transient");
      return brief();
    };
    try {
      await assert.rejects(
        runDeepResearch(e, running, () => e.store.checkpointDeepTask(running)),
        /429/,
      );
      assert.ok(e.store.deepTask(t.id, t.owner)?.work?.draft);
      assert.equal("work" in deepView(running), false);
      assert.equal("owner" in deepView(running), false);
      await e.close();
      e = new Engine(new Store(dir));
      e.store.interruptDeepTasks();
      assert.equal(e.store.deepAllowance(t.owner, true).remaining, 1);
      e.store.retryDeepTask(t.id, t.owner, true);
      const resumed = e.store.claimDeepTask(t.id, t.owner)!;
      if (changed)
        resumed.evidence!.sources[0] = {
          ...source,
          excerpt: source.excerpt + " Added new evidence.",
        };
      const calls: string[] = [];
      e.research.json = async (_s, _i, _n, op) => {
        if (op === "strategy-deep-decision-check")
          return { ready: true, corrections: [] };
        calls.push(op!);
        return op === "strategy-deep-review"
          ? { ready: true, corrections: [] }
          : brief();
      };
      assert.equal(
        await runDeepResearch(e, resumed, () =>
          e.store.checkpointDeepTask(resumed),
        ),
        true,
      );
      e.store.finishDeepTask(resumed, true);
      assert.deepEqual(
        calls,
        changed
          ? ["strategy-deep-write", "strategy-deep-review"]
          : ["strategy-deep-review"],
      );
      assert.equal(e.store.deepTask(t.id, t.owner)?.work, undefined);
      assert.equal(e.store.deepAllowance(t.owner, true).used, 1);
    } finally {
      await e.close();
      process.env = env;
      rmSync(dir, { recursive: true, force: true });
    }
  });

for (const use of ["compare", "reuse", "checked"] as const)
  test(`project permission checks follow planned reuse without duplicating an existing check (${use})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-terms-"));
    const env = { ...process.env };
    process.env.DEEPSEEK_API_KEY = "unit-test-only";
    const e = new Engine(new Store(dir)),
      t = task(),
      m = sample();
    const doc = {
      ...source,
      url: "https://github.com/team/drafts/blob/main/README.md",
      kind: "project" as const,
    };
    m.brief!.sources = [doc];
    m.brief!.opportunities![0]!.basedOn = [
      { id: doc.id!, quote: doc.excerpt! },
    ];
    e.store.saveMarket(m, false, t.owner);
    t.evidence = {
      collectionFinished: true,
      collectedAt: t.created,
      queries: [],
      githubQuery: "comments",
      sources: [
        doc,
        { ...request, url: "https://github.com/team/drafts/issues/12" },
      ],
      reads: [],
    };
    e.research.json = async (_s, input, _n, op) => {
      if (op === "strategy-deep-decision-check")
        return { ready: true, corrections: [] };
      assert.deepEqual((input as any).assetTerms[0].licenseSources, []);
      const candidate = brief();
      if (use !== "compare")
        candidate.plan.resources = copy(
          "Reuse team/drafts after checking its permissions.",
          "核对权限后复用 team/drafts。",
        );
      if (use === "checked")
        candidate.checks = [
          copy(
            "Confirm the drafts code license and separate data terms before reuse.",
            "复用前核对 drafts 的源码许可与数据条款。",
          ),
        ];
      return op === "strategy-deep-review"
        ? { ready: true, corrections: [] }
        : candidate;
    };
    try {
      assert.equal(await runDeepResearch(e, t, () => {}), true);
      assert.equal(t.result!.checks.length, use === "compare" ? 0 : 1);
      if (use === "reuse") {
        assert.match(
          t.result!.checks[0]!.en,
          /team\/drafts.*code license.*data/,
        );
        assert.match(t.result!.checks[0]!.zh, /源码许可、数据/);
      }
    } finally {
      await e.close();
      process.env = env;
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("an overlong copy edit gets its second bounded shortening pass before delivery", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-copy-limit-"));
  const env = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const e = new Engine(new Store(dir)),
    t = task();
  e.store.saveMarket(sample(), false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: t.created,
    queries: [],
    githubQuery: "comments",
    sources: [source, request],
    reads: [],
  };
  let edits = 0;
  e.research.json = async (_s, _i, _n, op) => {
    if (op === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    if (op === "strategy-deep-copy") {
      edits++;
      return {
        edits: [
          {
            path: "answer.en",
            value:
              edits === 1
                ? "Long repeated suggestion. ".repeat(23)
                : brief().answer.en,
          },
        ],
      };
    }
    if (op === "strategy-deep-review") return { ready: true, corrections: [] };
    const candidate = brief();
    candidate.answer.en = "An overlong draft. ".repeat(30);
    return candidate;
  };
  try {
    assert.equal(await runDeepResearch(e, t, () => {}), true);
    assert.equal(edits, 2);
    assert.deepEqual(t.result, brief());
  } finally {
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review keeps the writer's bounded source set, including assets outside finding quotes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-review-sources-"));
  const env = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const e = new Engine(new Store(dir)),
    t = task();
  e.store.saveMarket(sample(), false, t.owner);
  const extra = {
    ...source,
    id: "E3",
    url: "https://example.com/extra",
    excerpt: "Additional asset documentation supplied to the writer.",
  };
  t.evidence = {
    collectionFinished: true,
    collectedAt: t.created,
    queries: [],
    githubQuery: "comments",
    sources: [source, request, extra],
    reads: [],
  };
  let writerSources: unknown;
  e.research.json = async (_s, input, _n, op) => {
    if (op === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    if (op === "strategy-deep-write") writerSources = (input as any).sources;
    if (op === "strategy-deep-review") {
      assert.deepEqual((input as any).sources, writerSources);
      assert.ok((input as any).sources.some((s: any) => s.id === "E3"));
      return { ready: true, corrections: [] };
    }
    return brief();
  };
  try {
    assert.equal(await runDeepResearch(e, t, () => {}), true);
  } finally {
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wording edits receive the paired meaning and preserve unrequested text and quotes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-deep-paired-copy-"));
  const env = { ...process.env };
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const e = new Engine(new Store(dir)),
    t = task(),
    candidate = brief();
  candidate.plan.maintenance = {
    en: "If zero testers use the queue, test the simpler composer with the same group.",
    zh: "若无人使用队列，不是继续开发，而是请同一组试用者测试简化的编辑器。",
  };
  e.store.saveMarket(sample(), false, t.owner);
  t.evidence = {
    collectionFinished: true,
    collectedAt: t.created,
    queries: [],
    githubQuery: "comments",
    sources: [source, request],
    reads: [],
  };
  let copyCalls = 0;
  e.research.json = async (_s, input, _n, operation) => {
    if (operation === "strategy-deep-decision-check")
      return { ready: true, corrections: [] };
    if (operation === "strategy-deep-copy") {
      copyCalls++;
      assert.deepEqual((input as any).fields, [
        {
          path: "plan.maintenance.zh",
          value: candidate.plan.maintenance.zh,
          maxCharacters: 240,
          counterpart: { language: "en", value: candidate.plan.maintenance.en },
        },
      ]);
      return {
        edits: [
          {
            path: "plan.maintenance.zh",
            value: "若队列使用人数为0，则请同一组试用者测试简化的编辑器。",
          },
          {
            path: "plan.maintenance.en",
            value: "Change the original meaning.",
          },
          {
            path: "findings.0.evidence.0.quote",
            value: "Invent a different source quote.",
          },
        ],
      };
    }
    if (operation === "strategy-deep-review")
      return { ready: true, corrections: [] };
    return structuredClone(candidate);
  };
  try {
    assert.equal(await runDeepResearch(e, t, () => {}), true);
    assert.equal(copyCalls, 1);
    const expected = structuredClone(candidate);
    expected.plan.maintenance.zh =
      "若队列使用人数为0，则请同一组试用者测试简化的编辑器。";
    assert.deepEqual(t.result, expected);
  } finally {
    await e.close();
    process.env = env;
    rmSync(dir, { recursive: true, force: true });
  }
});
