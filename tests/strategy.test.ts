import { recoverSourceQuote } from "../src/core/opportunities.js";
import { modelSources } from "../src/providers/research.js";
import {
  visibleOpportunities,
  groundOpportunityRatings,
  proseRepairs,
  applyProseRepairs,
} from "../src/core/opportunities.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Research } from "../src/providers/research.js";
import { GitHub } from "../src/providers/github.js";
import { Store } from "../src/core/store.js";
import {
  strategyProblems,
  strategySources,
  visibleStrategy,
  type StrategyResponse,
} from "../src/core/strategy.js";
import { reportIssueSignals } from "../src/core/gaps.js";
import { marketMarkdown } from "../src/core/report.js";
import { renderDocument } from "../src/server/html.js";
import type { Market, ResearchSource } from "../src/core/types.js";
const seed: Market = JSON.parse(
  readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
)[0];
const documents: ResearchSource[] = [
  {
    id: "R1",
    label: "team/editor README",
    url: "https://github.com/team/editor/blob/main/README.md",
    excerpt:
      "Project: team/editor. Export preserves document text and discards review comments.",
  },
];
const sample = (): StrategyResponse => ({
  checks: ["markdown comment anchors"],
  recommendedId: "review-anchors",
  overview: {
    en: {
      verdict:
        "Documentation tools have openings in review continuity and release coordination.",
      demand:
        "Repeated document revisions could create demand for preserving decisions.",
      competition:
        "Editors cover authoring; workflow opportunities depend on existing export behavior.",
      opening:
        "Review handoffs and multilingual release checks offer distinct tasks to investigate.",
      entry:
        "A small team can prototype with public fixtures and documentation reviewers.",
      scope:
        "GitHub excerpts describe tool features; broader adoption is a conditional hypothesis.",
    },
    zh: {
      verdict: "技术文档工具可围绕评审连续性与发布协作探索机会。",
      demand: "重复修订可能带来保留评审决策的需求。",
      competition: "编辑器提供创作能力，流程机会取决于具体导出行为。",
      opening: "评审交接与多语言发布检查分别对应值得探索的任务。",
      entry: "小团队可借助公开样例与文档评审者开展原型验证。",
      scope: "GitHub 摘录描述工具功能，更广泛的采用情况属于条件性假设。",
    },
    evidence: [
      {
        id: "R1",
        quote: "Export preserves document text and discards review comments.",
      },
    ],
  },
  selection: {
    en: "Start with review anchors for a small documentation team; release automation fits a team with CI expertise.",
    zh: "小型团队可优先验证评审锚点；具备持续集成经验的团队可选择发布自动化。",
  },
  opportunities: ["review-anchors", "release-audit", "translation-review"].map(
    (id) => ({
      id,
      query: id.replaceAll("-", " "),
      effort: "medium" as const,
      demand: {
        level: "medium" as const,
        basis: "inferred" as const,
        evidence: [],
      },
      competition: {
        level: "medium" as const,
        basis: "inferred" as const,
        evidence: [],
      },
      en: {
        title: id.replaceAll("-", " "),
        audience: "Small documentation teams during a file revision.",
        need: "Keep review comments attached when a document is split into files.",
        service:
          "Upload two document revisions and receive comments attached to the new locations.",
        demand:
          "Repeat review work could justify a focused adapter; team usage is a hypothesis.",
        competition:
          "Existing editors provide a baseline; compare anchor behavior on real changes.",
        resources:
          "A TypeScript developer, Git fixtures and five documentation reviewers.",
        delivery:
          "Estimate two weeks for a local prototype with three redacted fixtures.",
        upkeep: "Maintain adapters when document and editor formats change.",
        wedge:
          "Export anchor relocation decisions as a reviewable Git artifact.",
        experiment:
          "Proposed threshold: four of five reviewers restore 90% of comments.",
      },
      zh: {
        title: id.replaceAll("-", " "),
        audience: "文档修订期间的小型技术文档团队。",
        need: "文档拆分后需要将评审意见重新对应到段落。",
        service: "提交两版文档，获得带有对应评审意见的新文档。",
        demand:
          "重复评审任务可能支持适配器的采用，团队使用频率属于待检验假设。",
        competition: "现有编辑器提供参照，可通过真实改动比较锚点表现。",
        resources: "一位 TypeScript 开发者、Git 样例和五位文档评审者。",
        delivery: "估算两周交付本地原型，先覆盖三份脱敏样例。",
        upkeep: "编辑器和文档格式变化时持续维护适配器。",
        wedge: "将锚点迁移判断导出为可复核的 Git 文件。",
        experiment: "建议门槛：五位评审者中四位恢复 90% 的评论。",
      },
    }),
  ),
  en: {
    headline: "Preserve review decisions when Markdown changes",
    summary:
      "A comment-preservation adapter could fit the existing review workflow. Test whether stable anchors save reviewers from repeating their work.",
    strategy: {
      angle: "A Markdown review-comment migration adapter",
      audience:
        "Small documentation teams revising compliance guides after a file split, using manual copies of comments today.",
      mechanism:
        "File-relative offsets change during edits; content-derived anchors could preserve a reviewer’s decision across splits.",
      wedge:
        "Ship a command-line adapter that maps comment anchors between two Git revisions and exports an audit file.",
      tradeoff:
        "Prioritize review continuity while leaving the editing interface to the team’s current editor.",
      assumption:
        "Review teams spend enough time relocating comments to install a small adapter in their existing workflow.",
      experiment:
        "Give 5 documentation reviewers a redacted file-split task and measure correct comment relocation within 10 minutes.",
      successSignal:
        "Proposed continue threshold: 4 of 5 reviewers retain at least 90% of comment anchors in the task.",
      pivotSignal:
        "Proposed redirect threshold: at most 1 reviewer repeats the task; focus the tool on release audit exports.",
    },
  },
  zh: {
    headline: "让评审意见跟着文档改动走",
    summary:
      "评审意见迁移工具可以嵌入已有写作流程。先验证内容锚点能否减少团队在文件拆分后的重复整理。",
    strategy: {
      angle: "为 Markdown 团队做评审意见迁移工具",
      audience:
        "拆分合规文档的小型团队，目前通过复制评论保存评审结论，文件重排时需要逐条重新定位。",
      mechanism:
        "文件位置会随改动变化，基于文本内容的锚点可能帮助团队保留评审结论与原文之间的联系。",
      wedge:
        "交付一个对比两次 Git 提交的命令行适配器，将评审意见重新定位并导出可复核记录。",
      tradeoff:
        "优先保障评审连续性，编辑界面继续交给现有工具，团队需要增加一次适配器配置。",
      assumption:
        "团队重新定位评审意见的时间成本，足以支持他们在现有工作流中配置一个适配器。",
      experiment:
        "邀请 5 位文档评审者完成脱敏文件拆分任务，记录 10 分钟内正确恢复的评论锚点。",
      successSignal:
        "建议继续门槛：5 人中有 4 人在任务中保留至少 90% 的评论锚点。",
      pivotSignal:
        "建议转向门槛：至多 1 人主动复用工具时，改为验证发布审计记录的导出需求。",
    },
  },
  evidence: [
    {
      id: "R1",
      quote: "Export preserves document text and discards review comments.",
    },
  ],
});
async function fixture(run: (r: Research, s: Store) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-strategy-"));
  const s = new Store(dir);
  try {
    await run(new Research(s), s);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("strategy review repairs generic advice, verifies quotations, caches and preserves measurements", async () =>
  fixture(async (r) => {
    const before = JSON.stringify(seed),
      ops: string[] = [];
    let reviews = 0;
    r.json = async (_system, input: any, budget, operation, thinking) => {
      ops.push(operation!);
      assert.equal(
        thinking,
        operation === "strategy" || operation === "strategy-evidence-review"
          ? "low"
          : false,
      );
      assert.ok(budget! >= 8000);
      if (ops.length === 1) {
        const bad = sample();
        bad.en.strategy.wedge = "Build an MVP";
        return bad;
      }
      assert.ok(input.requiredCorrections.length);
      return sample();
    };
    const b = await r.insights(seed, documents, () => reviews++);
    assert.equal(b.reviewed, true);
    assert.equal(b.basis, "source-led");
    assert.ok(visibleStrategy(b, "zh"));
    assert.equal(visibleOpportunities(b)?.opportunities.length, 3);
    assert.ok(visibleStrategy({ ...b, strategyVersion: "1" }, "zh"));
    assert.ok(visibleStrategy({ ...b, strategyVersion: "5" }, "zh"));
    assert.equal(
      visibleOpportunities({ ...b, strategyVersion: "5" })?.opportunities
        .length,
      3,
    );
    assert.equal(reviews, 1);
    assert.deepEqual(ops, ["strategy", "strategy-review"]);
    assert.deepEqual(await r.insights(seed, documents), b);
    assert.equal(ops.length, 2);
    assert.equal(JSON.stringify(seed), before);
    const m = { ...seed, brief: b };
    const md = marketMarkdown(m, undefined, "zh");
    assert.match(md, /建议继续门槛/);
    assert.match(md, /细分方向地图/);
    assert.match(md, /首版投入估算/);
    assert.match(md, /策略由 AI 提出/);
    assert.match(md, /github.com\/team\/editor/);
    const html = renderDocument(
      '<html><head></head><body><div id="root"></div></body></html>',
      {
        base: "https://ghtrends.dev/radar",
        path: "/report/" + m.id,
        geo: "",
        market: m,
        markets: [m],
        status: 200,
        locale: "zh",
      },
    );
    assert.match(html, /关键洞察/);
    assert.match(html, /基于文本内容的锚点/);
  }));

test("fabricated source quotes and generic threshold-free strategies fail validation", async () =>
  fixture(async (r) => {
    const bad = sample();
    bad.evidence[0]!.quote = "This feature already has 10000 paying customers.";
    assert.ok(
      strategyProblems(bad, strategySources(seed, documents), seed).some((p) =>
        p.includes("quote"),
      ),
    );
    r.json = async () => bad;
    await assert.rejects(r.insights(seed, documents), /another source pass/);
    const generic = sample();
    generic.en.strategy.mechanism = "Find a niche";
    generic.zh.strategy.successSignal = "收集用户积极反馈后继续投入。";
    assert.ok(
      strategyProblems(generic, strategySources(seed, documents), seed).length,
    );
  }));

test("an invalid second pass preserves the validated first pass; sparse data stays a hypothesis", async () =>
  fixture(async (r) => {
    const m = structuredClone(seed);
    m.supply.repositories = [];
    m.supply.total = 0;
    m.demand.points = [];
    m.demand.error = "Collection pending";
    m.kind = "uncertain";
    m.metrics.growth = null;
    m.metrics.trend = "unknown";
    let n = 0;
    r.json = async (_system, input: any) => {
      assert.equal(input.basis, "hypothesis-led");
      n++;
      const a = sample();
      a.evidence = [];
      a.overview.evidence = [];
      if (n >= 2) a.en.strategy.wedge = "Build an MVP";
      return a;
    };
    const b = await r.insights(m);
    assert.equal(b.basis, "hypothesis-led");
    assert.equal(b.reviewed, false);
    assert.equal(m.kind, "uncertain");
    assert.equal(m.metrics.growth, null);
    assert.equal(b.evidence?.length, 0);
  }));

test("explicit reasoning levels reach the API while ordinary calls stay disabled and private reasoning is discarded", async () =>
  fixture(async (r, s) => {
    const old = globalThis.fetch;
    const requests: any[] = [];
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(String(options?.body)));
      return new Response(
        JSON.stringify({
          model: "deepseek-flash",
          usage: {
            prompt_tokens: 100,
            completion_tokens: 600,
            completion_tokens_details: {
              reasoning_tokens:
                requests.at(-1).thinking.type === "enabled" ? 500 : 0,
            },
          },
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: '{"ok":true}',
                reasoning_content: "private-model-reasoning",
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    try {
      assert.deepEqual(await r.json("JSON", {}, 12000, "strategy", true), {
        ok: true,
      });
      await r.json("JSON", {}, 1800, "plan");
      await r.json("JSON", {}, 8000, "strategy", "low");
      assert.equal(requests[2].thinking.type, "enabled");
      assert.equal(requests[2].reasoning_effort, "low");
      assert.equal(requests[0].thinking.type, "enabled");
      assert.equal(requests[0].reasoning_effort, "high");
      assert.equal(requests[1].thinking.type, "disabled");
      const measured = s
        .adminOverview(7, 0, "")
        .models.find((row) => row.operation === "strategy")!;
      assert.equal(measured.outputTokens, 1200);
      assert.equal(measured.reasoningTokens, 1000);
      assert.equal(measured.reasoningPending, 0);
      assert.ok(
        !JSON.stringify(s.adminOverview(7, 0, "")).includes(
          "private-model-reasoning",
        ),
      );
    } finally {
      globalThis.fetch = old;
    }
  }));

test("document enrichment is bounded, keeps useful partial results and uses verified GitHub paths", async () =>
  fixture(async (_r, s) => {
    const gh = new GitHub(s),
      paths: string[] = [];
    gh.get = async <T>(path: string): Promise<T> => {
      paths.push(path);
      if (path.includes("/missing/")) throw Error("source pending");
      if (path.endsWith("/readme"))
        return {
          encoding: "base64",
          content: Buffer.from(
            "# Workflow\n<script>hidden()</script>Export review comments.",
          ).toString("base64"),
          html_url: path.includes("/unsafe/")
            ? "https://external.example/collect"
            : "https://github.com/team/editor/blob/main/README.md",
        } as T;
      return {
        title: "Preserve comments when splitting a file",
        body: "A concrete review migration request.",
        state: "open",
      } as T;
    };
    const base = seed.supply.repositories[0]!;
    const repos = ["team/editor", "missing/editor", "unsafe/editor"].map(
      (name) => ({
        ...base,
        name,
        relevance: { ...base.relevance!, role: "direct" as const },
      }),
    );
    const gaps = [
      {
        title: "Preserve comments",
        url: "https://github.com/team/editor/issues/12",
        repo: "team/editor",
        excerpt: "Keep comments",
        reactions: 3,
        createdAt: seed.asOf,
        updatedAt: seed.asOf,
        state: "open",
        label: "feature-request" as const,
      },
    ];
    const sources = await gh.researchSources(repos, gaps);
    assert.equal(sources.length, 2);
    assert.ok(sources.every((d) => d.url.startsWith("https://github.com/")));
    assert.ok(!sources[0]!.excerpt!.includes("hidden()"));
    assert.equal(paths.length, 7);
  }));

test("existing implementations reach the critic; corrective editing preserves the improved idea", async () =>
  fixture(async (r) => {
    const ops: string[] = [];
    const alternative: ResearchSource = {
      id: "A1R",
      label: "Existing tool",
      url: "https://github.com/team/existing",
      excerpt:
        "Maintainer documentation: Review anchors already survive file splits.",
    };
    let checks = 0;
    r.json = async (_system, input: any, _budget, op, thinking) => {
      ops.push(op!);
      const result = sample();
      if (op === "strategy") return result;
      assert.ok(input.sources.some((s: ResearchSource) => s.id === "A1R"));
      if (op === "strategy-evidence-review") {
        assert.ok(input.requiredCorrections.length);
        return {
          edits: [
            { path: "en.strategy.wedge", value: sample().en.strategy.wedge },
          ],
        };
      }
      result.evidence = [
        { id: "A1R", quote: "Review anchors already survive file splits." },
      ];
      result.en.strategy.angle =
        "Audit anchor relocation decisions in an existing review tool";
      if (op === "strategy-review") result.en.strategy.wedge = "Build an MVP";
      else {
        assert.equal(thinking, false);
        assert.ok(input.requiredCorrections.length);
      }
      return result;
    };
    const result = await r.insights(
      seed,
      documents,
      undefined,
      async (queries) => {
        checks++;
        assert.deepEqual(queries, ["markdown comment anchors"]);
        return [alternative];
      },
    );
    assert.equal(checks, 1);
    assert.deepEqual(ops, [
      "strategy",
      "strategy-review",
      "strategy-evidence-review",
    ]);
    assert.equal(result.reviewed, true);
    assert.match(result.en.strategy!.angle, /existing review tool/);
    assert.ok(result.sources.some((s) => s.id === "A1R"));
    const words = sample();
    words.en.strategy.successSignal =
      "Proposed continue threshold: three of four teams retain their review anchors.";
    words.zh.strategy.successSignal =
      "建议继续门槛：四个团队中有三个保留评审意见。";
    assert.deepEqual(
      strategyProblems(words, strategySources(seed, documents), seed),
      [],
    );
  }));

test("idea checks reject query operators and bound searches and current document reads", async () =>
  fixture(async (_r, store) => {
    const gh = new GitHub(store),
      paths: string[] = [];
    gh.get = async <T>(path: string): Promise<T> => {
      paths.push(path);
      if (path.includes("/search/"))
        return {
          total_count: 10,
          items: [
            {
              full_name: "team/existing",
              description: "Versioned review comments",
            },
          ],
        } as T;
      return {
        encoding: "base64",
        content: Buffer.from("Supports review comment migration.").toString(
          "base64",
        ),
      } as T;
    };
    const docs = await gh.ideaAlternatives([
      "org:private",
      "obsidian git",
      "markdown comments",
      "extra query",
    ]);
    assert.equal(paths.filter((p) => p.includes("/search/")).length, 2);
    assert.equal(paths.filter((p) => p.endsWith("/readme")).length, 2);
    assert.equal(docs.length, 4);
    assert.ok(docs.every((d) => d.url.startsWith("https://github.com/")));
    assert.ok(
      docs
        .find((d) => d.id === "A1R")
        ?.excerpt?.includes("Supports review comment migration."),
    );
  }));

test("direction ratings keep umbrella trends, project supply and task demand separate", () => {
  const data = sample();
  data.opportunities[0]!.demand = {
    level: "high",
    basis: "observed",
    evidence: [
      { id: "S1", quote: strategySources(seed, [])[0]!.excerpt!.slice(0, 30) },
    ],
  };
  const errors = strategyProblems(data, strategySources(seed, documents), seed);
  assert.ok(errors.some((e) => e.includes("umbrella metrics")));
  assert.ok(errors.some((e) => e.includes("multiple relevant")));
  const other = sample();
  other.opportunities[0]!.demand = {
    level: "low",
    basis: "observed",
    evidence: [
      { id: "D2I1", quote: "A documented request for release audit exports." },
    ],
  };
  assert.ok(
    strategyProblems(
      other,
      [
        ...documents,
        {
          id: "D2I1",
          directionId: "release-audit",
          kind: "request",
          label: "Request",
          url: "https://github.com/team/repo/issues/2",
          excerpt: "A documented request for release audit exports.",
        },
      ],
      seed,
    ).some((e) => e.includes("this direction")),
  );
  other.recommendedId = "invented";
  assert.ok(
    strategyProblems(other, documents, seed).some((e) =>
      e.includes("select one"),
    ),
  );
});

test("every direction receives scoped evidence; one source failure preserves the map", async () =>
  fixture(async (r, s) => {
    const gh = new GitHub(s),
      paths: string[] = [];
    gh.get = async <T>(path: string): Promise<T> => {
      paths.push(path);
      if (path.startsWith("/search/issues"))
        return {
          items: [
            {
              html_url: "https://github.com/team/tool/issues/1",
              title: "Keep the review comments",
              body: "An individual user request to retain review comments across files.",
              created_at: "2026-08-01",
              updated_at: "2026-09-01",
              reactions: { total_count: 2 },
            },
          ],
        } as T;
      if (path.includes("translation")) throw Error("source recovering");
      if (path.startsWith("/search/repositories"))
        return {
          total_count: 4,
          items: [{ full_name: "team/tool", description: "Review adapter" }],
        } as T;
      return {
        encoding: "base64",
        content: Buffer.from(
          "An inspectable review adapter with export support.",
        ).toString("base64"),
      } as T;
    };
    const dirs = sample().opportunities.map(({ id, query }) => ({ id, query }));
    const evidence = await gh.directionEvidence([
      ...dirs,
      { id: "unsafe", query: "org:private" },
    ]);
    assert.equal(
      paths.filter((p) => p.startsWith("/search/repositories")).length,
      3,
    );
    assert.equal(paths.filter((p) => p.startsWith("/search/issues")).length, 3);
    assert.ok(dirs.every((d) => evidence.some((s) => s.directionId === d.id)));
    assert.equal(new Set(evidence.map((s) => s.id)).size, evidence.length);
    r.json = async (_prompt, input: any, _budget, operation) => {
      if (operation === "strategy-review")
        assert.ok(
          input.sources.some(
            (s: ResearchSource) => s.directionId === "translation-review",
          ),
        );
      return sample();
    };
    let calls = 0;
    const b = await r.insights(
      seed,
      documents,
      undefined,
      undefined,
      async (requested) => {
        calls++;
        assert.deepEqual(requested, dirs);
        return evidence;
      },
    );
    assert.equal(calls, 1);
    assert.equal(b.opportunities?.length, 3);
    assert.equal(b.reviewed, true);
  }));

test("source scope corrects overconfident rating labels while preserving all directions", () => {
  const data = sample();
  data.opportunities[0]!.competition = {
    level: "low",
    basis: "observed",
    evidence: [],
  };
  data.opportunities[0]!.demand = {
    level: "high",
    basis: "observed",
    evidence: [],
  };
  const grounded = groundOpportunityRatings(
    data,
    documents,
  ) as StrategyResponse;
  assert.equal(grounded.opportunities[0]!.competition.basis, "inferred");
  assert.equal(grounded.opportunities[0]!.demand.level, "exploratory");
  assert.equal(grounded.opportunities[0]!.demand.basis, "inferred");
  assert.deepEqual(
    grounded.opportunities.map((o) => o.zh),
    data.opportunities.map((o) => o.zh),
  );
  assert.equal(data.opportunities[0]!.demand.level, "high");
  assert.deepEqual(
    strategyProblems(grounded, strategySources(seed, documents), seed),
    [],
  );
});

test("accepted answers and closed requests describe progress rather than current demand strength", () => {
  const data = sample();
  const sources: ResearchSource[] = ["answered", "closed"].map((state, i) => ({
    id: `RES${i}`,
    kind: "request",
    label: "Export request",
    url: `https://github.com/team/editor/discussions/${i + 1}`,
    excerpt: "Please preserve comments during export.",
    request: { state },
  }));
  data.opportunities[0]!.demand = {
    level: "high",
    basis: "observed",
    evidence: sources.map((s) => ({ id: s.id!, quote: s.excerpt! })),
  };
  assert.ok(
    strategyProblems(data, [...documents, ...sources], seed).some((p) =>
      p.includes("multiple relevant"),
    ),
  );
  const grounded = groundOpportunityRatings(data, [
    ...documents,
    ...sources,
  ]) as StrategyResponse;
  assert.equal(grounded.opportunities[0]!.demand.basis, "inferred");
  assert.equal(grounded.opportunities[0]!.demand.level, "exploratory");
  assert.deepEqual(
    grounded.opportunities[0]!.demand.evidence,
    data.opportunities[0]!.demand.evidence,
  );
});

test("targeted copy editing changes requested prose only, preserving evidence and direction ratings", () => {
  const data = sample();
  data.opportunities[0]!.zh.competition =
    "这个方向与现有项目不同，需要通过真实工作流比较。";
  const fields = proseRepairs(data);
  assert.deepEqual(
    fields.map((f) => f.path),
    ["opportunities.0.zh.competition"],
  );
  const edited = applyProseRepairs(
    data,
    {
      edits: [
        {
          path: fields[0]!.path,
          value: "这个方向提供另一种工作流，建议通过实际使用比较采用理由。",
        },
        { path: "opportunities.0.demand.level", value: "high" },
        { path: "__proto__.polluted", value: "value" },
      ],
    },
    fields,
  ) as StrategyResponse;
  assert.equal(edited.opportunities[0]!.demand.level, "medium");
  assert.deepEqual(edited.evidence, data.evidence);
  assert.deepEqual(proseRepairs(edited), []);
  assert.equal(({} as any).polluted, undefined);
});

test("a shared competitor can inform two directions; citations keep only supplied punctuation", () => {
  const data = sample();
  const source: ResearchSource = {
    id: "D2A1",
    directionId: "release-audit",
    kind: "project",
    label: "Tool",
    url: "https://github.com/team/tool",
    excerpt: "An adapter preserving review anchors across file changes",
  };
  data.opportunities[0]!.competition = {
    level: "medium",
    basis: "observed",
    evidence: [{ id: source.id!, quote: source.excerpt! + "." }],
  };
  const grounded = groundOpportunityRatings(data, [
    ...documents,
    source,
  ]) as StrategyResponse;
  assert.equal(
    grounded.opportunities[0]!.competition.evidence[0]!.quote,
    source.excerpt,
  );
  assert.deepEqual(
    strategyProblems(
      grounded,
      strategySources(seed, [...documents, source]),
      seed,
    ),
    [],
  );
});

test("new reports require an overall answer and a readable customer need and offer; old reports remain readable", async () =>
  fixture(async (r) => {
    const missingOverview: any = sample();
    delete missingOverview.overview;
    assert.ok(
      strategyProblems(
        missingOverview,
        strategySources(seed, documents),
        seed,
      ).some((p) => p.includes("overview")),
    );
    const missingOffer: any = sample();
    delete missingOffer.opportunities[0].zh.service;
    assert.ok(
      strategyProblems(
        missingOffer,
        strategySources(seed, documents),
        seed,
      ).some((p) => p.includes("zh.service")),
    );
    r.json = async () => sample();
    const brief = await r.insights(seed, documents);
    assert.equal(brief.strategyVersion, "6");
    const legacy = {
      ...brief,
      strategyVersion: "2",
      overview: undefined,
      opportunities: brief.opportunities!.map((o) => ({
        ...o,
        en: { ...o.en, need: undefined, service: undefined },
        zh: { ...o.zh, need: undefined, service: undefined },
      })),
    };
    assert.equal(visibleOpportunities(legacy)?.opportunities.length, 3);
    assert.ok(visibleStrategy(legacy, "zh"));
    assert.equal(
      visibleOpportunities({ ...legacy, strategyVersion: "3" }),
      undefined,
    );
    for (const locale of ["en", "zh"] as const) {
      const md = marketMarkdown({ ...seed, brief }, undefined, locale);
      assert.ok(
        md.indexOf(brief.overview![locale].verdict) <
          md.indexOf(brief.opportunities![0]![locale].service!),
      );
      assert.ok(md.includes(brief.opportunities![0]![locale].need!));
      const html = renderDocument(
        '<html><head></head><body><div id="root"></div></body></html>',
        {
          base: "https://ghtrends.dev/radar",
          path: "/report/" + seed.id,
          geo: "",
          market: { ...seed, brief },
          markets: [],
          status: 200,
          locale,
        },
      );
      assert.ok(html.includes(brief.overview![locale].verdict));
      assert.ok(html.includes(brief.opportunities![0]![locale].service!));
    }
  }));

test("overall judgments validate quotes and allow only requested affirmative copy repair", () => {
  const data = sample();
  data.overview.zh.competition = "不能用项目数量说明商业竞争。";
  const fields = proseRepairs(data);
  assert.deepEqual(
    fields.map((f) => f.path),
    ["overview.zh.competition"],
  );
  const revised = applyProseRepairs(
    data,
    {
      edits: [
        {
          path: fields[0]!.path,
          value: "项目数量描述开源覆盖，商业竞争需结合具体替代服务核对。",
        },
      ],
    },
    fields,
  ) as StrategyResponse;
  assert.deepEqual(revised.overview.evidence, data.overview.evidence);
  assert.deepEqual(
    strategyProblems(revised, strategySources(seed, documents), seed),
    [],
  );
  revised.overview.evidence[0]!.quote = "Fabricated commercial sales figures";
  assert.ok(
    strategyProblems(revised, strategySources(seed, documents), seed).some(
      (p) => p.startsWith("Overview"),
    ),
  );
});

test("broad topics retain their original scope while relevant project evidence informs the draft", async () =>
  fixture(async (r) => {
    const market = structuredClone(seed);
    market.topic.scope = "field";
    market.topic.plan = {
      input: "小米手机",
      intent: "Research phone opportunities",
      version: "11",
      model: "test",
      trends: ["Xiaomi smartphones"],
      githubTopics: ["xiaomi"],
      githubTerms: [],
      explanation: { en: "Phone scope", zh: "手机相关机会" },
    };
    const calls: string[] = [];
    r.json = async (_system, input: any, _budget, operation) => {
      calls.push(operation!);
      assert.equal(input.input, "小米手机");
      if (operation === "strategy") {
        assert.deepEqual(
          input.sources.map((s: ResearchSource) => s.id),
          strategySources(market, documents).map((s) => s.id),
        );
        assert.equal(input.basis, "hypothesis-led");
        assert.ok(input.projectInventory.some((p: any) => p.id === "R1"));
      } else
        assert.ok(input.sources.some((s: ResearchSource) => s.id === "R1"));
      const result = sample();
      result.evidence = [];
      result.overview.evidence = [];
      return result;
    };
    const before = JSON.stringify(market);
    const result = await r.insights(market, documents);
    assert.equal(result.reviewed, true);
    assert.ok(result.overview);
    assert.deepEqual(calls, ["strategy", "strategy-review"]);
    assert.equal(JSON.stringify(market), before);
  }));

test("parent measurements keep direction ratings inferred instead of becoming observed market demand", () => {
  const data = sample();
  const sources = strategySources(seed, documents);
  const ref = {
    id: "S2",
    quote: sources.find((s) => s.id === "S2")!.excerpt!.slice(0, 60),
  };
  data.opportunities[0]!.competition = {
    level: "high",
    basis: "observed",
    evidence: [ref],
  };
  const grounded = groundOpportunityRatings(data, sources) as StrategyResponse;
  assert.equal(grounded.opportunities[0]!.competition.basis, "inferred");
  assert.deepEqual(strategyProblems(grounded, sources, seed), []);
  assert.equal(data.opportunities[0]!.competition.basis, "observed");
});

test("a compact reasoning blueprint is researched before a separate bilingual evidence editor writes the report", async () =>
  fixture(async (r) => {
    const blueprint = {
      overall: { verdict: "Review continuity is a focused opportunity." },
      opportunities: sample().opportunities.map((o) => ({
        id: o.id,
        query: o.query,
        route: "opensource",
        offer: o.en.service,
      })),
      recommendedId: sample().recommendedId,
    };
    let checked = false;
    r.json = async (_system, input: any, _budget, operation, thinking) => {
      if (operation === "strategy") {
        assert.equal(thinking, "low");
        return blueprint;
      }
      if (operation === "strategy-evidence-review") {
        assert.equal(thinking, "low");
        assert.ok(input.editablePaths.includes("overview.zh.competition"));
        return { edits: [] };
      }
      assert.equal(thinking, false);
      assert.ok(checked);
      if (operation === "strategy-direction") {
        assert.ok(
          input.sources.every(
            (s: ResearchSource) => !["S1", "S2"].includes(s.id!),
          ),
        );
        return sample().opportunities.find((o) => o.id === input.candidate.id);
      }
      assert.ok(["strategy-priority", "strategy-overall"].includes(operation!));
      const { opportunities, ...overall } = sample();
      return overall;
    };
    const brief = await r.insights(
      seed,
      documents,
      undefined,
      undefined,
      async (directions) => {
        checked = true;
        assert.deepEqual(
          directions,
          blueprint.opportunities.map((o) => ({ id: o.id, query: o.query })),
        );
        return [];
      },
    );
    assert.equal(brief.reviewed, true);
    assert.equal(brief.opportunities?.length, 3);
  }));

test("the same issue found through two queries remains a single demand signal", () => {
  const data = sample(),
    o = data.opportunities[0]!;
  o.demand = {
    level: "high",
    basis: "observed",
    evidence: [
      { id: "I1", quote: "Please preserve review comments during export." },
      { id: "D1I1", quote: "Please preserve review comments during export." },
    ],
  };
  const refs: ResearchSource[] = ["I1", "D1I1"].map((id) => ({
    id,
    kind: "request",
    url: "https://github.com/team/editor/issues/1",
    label: "Export comments",
    excerpt: "Please preserve review comments during export.",
  }));
  const result: any = groundOpportunityRatings(data, refs);
  assert.equal(result.opportunities[0].demand.level, "medium");
});

test("researched Issue readings include direct requests with honest optional metadata", () => {
  const m = structuredClone(seed);
  const reading = {
    title: "Keep review comments attached",
    audience: "Documentation reviewers revising exported files.",
    need: "Keep reviewer decisions when a document changes.",
    opportunity: "Explore an export adapter with stable comment anchors.",
    check:
      "Check the latest release and ask the maintainer about export behavior.",
  };
  const source: ResearchSource = {
    id: "D1I1",
    kind: "request",
    label: "Export comments",
    url: "https://github.com/team/editor/issues/4",
    excerpt: "Please preserve review comments during export.",
  };
  m.gaps = [];
  m.brief = {
    model: "test",
    generatedAt: m.asOf,
    en: { summary: "Research summary", nextSteps: [] },
    zh: { summary: "研究总结", nextSteps: [] },
    sources: [source],
    issueInsights: [
      {
        sourceId: source.id!,
        relevance: "direct",
        en: reading,
        zh: reading,
        evidence: { id: source.id!, quote: source.excerpt! },
      },
    ],
  };
  const rows = reportIssueSignals(m);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.url, source.url);
  assert.equal(rows[0]!.reactions, undefined);
  assert.equal(rows[0]!.createdAt, undefined);
  assert.ok(marketMarkdown(m).includes(reading.opportunity));
  const html = renderDocument(
    '<html><head></head><body><div id="root"></div></body></html>',
    {
      base: "https://ghtrends.dev/radar",
      path: "/report/" + m.id,
      geo: "",
      market: m,
      markets: [],
      status: 200,
      locale: "en",
    },
  );
  assert.ok(html.includes(reading.opportunity));
  m.brief.issueInsights![0]!.relevance = "adjacent";
  assert.equal(reportIssueSignals(m).length, 0);
  m.brief.issueInsights![0]!.relevance = "direct";
  m.brief.issueInsights![0]!.evidence.quote = "Fabricated demand assertion";
  assert.equal(reportIssueSignals(m).length, 0);
});

test("semantic review can edit prose and ratings while source quotes and identifiers stay immutable", async () =>
  fixture(async (r) => {
    const data = sample(),
      id = data.opportunities[0]!.id;
    r.json = async (prompt, input: any, _budget, operation, thinking) => {
      assert.equal(operation, "strategy-evidence-review");
      assert.equal(thinking, "low");
      assert.ok(prompt.includes("preserve truth conditions"));
      assert.ok(input.editablePaths.includes("overview.zh.competition"));
      assert.ok(!input.editablePaths.includes("overview.evidence.0.quote"));
      return {
        edits: [
          {
            path: "overview.zh.competition",
            value: "编辑器提供文档创作能力，评审迁移服务需要另行核对导出行为。",
          },
          { path: "opportunities.0.competition.basis", value: "inferred" },
          { path: "opportunities.0.id", value: "tampered-id" },
          { path: "overview.evidence.0.quote", value: "Fabricated claim" },
        ],
      };
    };
    const result = await (r as any).reviewStrategyMeaning(data, {
      input: "Documentation",
      sources: documents,
    });
    assert.equal(result.opportunities[0].id, id);
    assert.deepEqual(result.overview.evidence, data.overview.evidence);
    assert.equal(
      result.overview.zh.competition,
      "编辑器提供文档创作能力，评审迁移服务需要另行核对导出行为。",
    );
  }));

test("Issue interpretation accepts only real request identities and exact quotes", async () =>
  fixture(async (r) => {
    const text = {
      title: "Preserve exported comments",
      audience: "Documentation teams preparing revisions.",
      need: "Keep comments attached to revised files.",
      opportunity: "Explore a comment relocation adapter.",
      check: "Check current export behavior with the maintainer.",
    };
    const source: ResearchSource = {
      id: "I1",
      kind: "request",
      label: "Export comments",
      url: "https://github.com/team/editor/issues/7",
      excerpt: "Please preserve review comments during export.",
    };
    r.json = async (_system, input: any, _budget, operation, thinking) => {
      assert.equal(operation, "issue-reading");
      assert.equal(thinking, "low");
      assert.ok(!_system.includes('Return JSON {"issueInsights":[]}'));
      assert.deepEqual(input.sources, [modelSources([source])[0]]);
      return {
        issueInsights: [
          {
            sourceId: "S1",
            relevance: "direct",
            en: text,
            zh: text,
            evidence: { id: "S1", quote: source.excerpt },
          },
          {
            sourceId: "I1",
            relevance: "direct",
            en: text,
            zh: text,
            evidence: { id: "I1", quote: source.excerpt },
          },
          {
            sourceId: "I1",
            relevance: "direct",
            en: text,
            zh: text,
            evidence: { id: "I1", quote: "Fabricated demand assertion" },
          },
        ],
      };
    };
    const result = await (r as any).interpretIssues({
      input: "Documentation",
      sources: [...strategySources(seed, documents), source],
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].sourceId, "I1");
  }));

test("the selected open-source direction can provide the strategy's documented premise", () => {
  const sources = strategySources(
    seed,
    documents.map((d) => ({ ...d, kind: "project" as const })),
  );
  const data = sample();
  data.evidence = [];
  data.opportunities[0]!.route = "opensource";
  data.opportunities[0]!.basedOn = [
    {
      id: "R1",
      quote: "Export preserves document text and discards review comments.",
    },
  ];
  assert.deepEqual(strategyProblems(data, sources, seed), []);
  data.opportunities[0]!.basedOn = [];
  assert.ok(
    strategyProblems(data, sources, seed).some((p) =>
      p.startsWith("Ground the factual premise"),
    ),
  );
});

test("ordinary direction IDs stay readable in prose while internal slugs request editing", () => {
  const data = sample();
  data.opportunities[0]!.id = "backup";
  data.en.summary = "A backup service helps teams preserve review history.";
  assert.ok(!proseRepairs(data).some((f) => f.path === "en.summary"));
  data.opportunities[0]!.id = "comment-backup";
  data.en.summary =
    "Consider comment-backup for teams preserving review history.";
  assert.ok(proseRepairs(data).some((f) => f.path === "en.summary"));
});

test("local repair separates supply counts from demand and anchors open-source labels", async () =>
  fixture(async (r) => {
    const raw = sample();
    raw.zh.summary = "数千个开源项目表明用户对记忆工具有持续需求。";
    raw.opportunities[0]!.route = "opensource";
    raw.opportunities[0]!.basedOn = [];
    const quotes = structuredClone(raw.evidence);
    (r as any).json = async (
      _p: string,
      input: any,
      _budget: number,
      op: string,
      thinking: unknown,
    ) => {
      assert.equal(op, "strategy-copy");
      assert.equal(thinking, false);
      assert.match(
        input.fields.find((f: any) => f.path === "zh.summary").correction,
        /actual behavior/,
      );
      assert.match(
        input.fields.find((f: any) => f.path === "opportunities.0.route")
          .correction,
        /new tool/,
      );
      return {
        edits: [
          {
            path: "zh.summary",
            value:
              "已有项目覆盖记忆存储；开发者跨会话核对历史决策的需求，可通过实际任务完成情况验证。",
          },
          { path: "opportunities.0.route", value: "product" },
          { path: "evidence.0.quote", value: "an invented quotation" },
        ],
      };
    };
    const result = await (r as any).repairStrategyCopy(
      raw,
      strategySources(seed, documents),
    );
    assert.equal(result.opportunities[0].route, "product");
    assert.match(result.zh.summary, /任务完成情况/);
    assert.deepEqual(result.evidence, quotes);
    assert.equal(raw.opportunities[0]!.route, "opensource");
  }));

test("research reasoning stays bounded and configurable and source compaction keeps the original evidence immutable", async () => {
  const old = process.env.GHTRENDS_RESEARCH_THINKING;
  try {
    delete process.env.GHTRENDS_RESEARCH_THINKING;
    await fixture(async (r) => {
      assert.equal(r.strategyThinking, "low");
      process.env.GHTRENDS_RESEARCH_THINKING = "low";
      assert.equal(r.strategyThinking, "low");
      process.env.GHTRENDS_RESEARCH_THINKING = "off";
      assert.equal(r.strategyThinking, false);
      process.env.GHTRENDS_RESEARCH_THINKING = "high";
      assert.equal(r.strategyThinking, "low");
    });
    const original = strategySources(seed, documents);
    const before = JSON.stringify(original);
    const compact = modelSources(original);
    assert.equal(JSON.stringify(original), before);
    assert.ok(compact.every((s) => !("url" in s)));
    assert.equal(
      compact.find((s) => s.id === "S2")?.excerpt,
      original.find((s) => s.id === "S2")?.excerpt,
    );
    assert.ok(
      original
        .find((s) => s.id === "S2")
        ?.excerpt?.includes("Matching projects:"),
    );
    assert.equal(
      compact.find((s) => s.id === "R1")?.excerpt,
      original.find((s) => s.id === "R1")?.excerpt,
    );
    assert.equal(compact.find((s) => s.id === "R1")?.project, "team/editor");
  } finally {
    if (old === undefined) delete process.env.GHTRENDS_RESEARCH_THINKING;
    else process.env.GHTRENDS_RESEARCH_THINKING = old;
  }
});

test("mixed citation and wording corrections preserve the rest of a complete report", async () =>
  fixture(async (r) => {
    const good = sample();
    const bad = structuredClone(good);
    bad.en.strategy.tradeoff =
      "This prototype does not include dashboard editing.";
    bad.evidence[0]!.quote = "A paraphrase that is absent from the source.";
    const ops: string[] = [];
    r.json = async (_prompt, input: any, _budget, op) => {
      ops.push(op!);
      if (op === "strategy") return good;
      if (op === "strategy-review") return bad;
      assert.equal(op, "strategy-copy");
      assert.ok(input.fields.some((f: any) => f.path === "evidence.0.quote"));
      return {
        edits: [
          { path: "en.strategy.tradeoff", value: good.en.strategy.tradeoff },
          { path: "evidence.0.quote", value: good.evidence[0]!.quote },
        ],
      };
    };
    const result = await r.insights(seed, documents);
    assert.equal(result.reviewed, true);
    assert.deepEqual(result.evidence, good.evidence);
    assert.deepEqual(result.opportunities, good.opportunities);
    assert.deepEqual(ops, ["strategy", "strategy-review", "strategy-copy"]);
  }));

test("near-verbatim quote recovery copies one exact source span and keeps numeric and ambiguous differences invalid", () => {
  const source =
    "联系管理界面：打开云端的通讯录，点击在通讯录页面左下方的更多选项，选择联系人时光机，根据您的需求进行恢复操作。";
  const quoted = source.replace("左下方", "左下角");
  assert.equal(recoverSourceQuote(quoted, source), source);
  assert.equal(recoverSourceQuote(quoted, source + source), undefined);
  const numeric =
    "Maintainer notes: exports preserve the original metadata for 40 documents across the configured workspace.";
  assert.equal(
    recoverSourceQuote(numeric.replace("40", "80"), numeric),
    undefined,
  );
  assert.equal(
    recoverSourceQuote(
      "A fabricated feature unrelated to the observed implementation and its actual scope.",
      source,
    ),
    undefined,
  );
});
