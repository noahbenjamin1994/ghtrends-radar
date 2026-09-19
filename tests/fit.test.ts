import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import { Engine } from "../src/core/engine.js";
import { createApp } from "../src/server/index.js";
import { sessionKey } from "../src/server/auth.js";
import {
  FIT_VERSION,
  fitProblems,
  fitMarkdown,
  normalizeFit,
  type ResourceProfile,
  type SavedFit,
} from "../src/core/fit.js";
import { visibleOpportunities } from "../src/core/opportunities.js";
import type { Market } from "../src/core/types.js";

const profile: ResourceProfile = {
  skill: "frontend",
  time: "weekend",
  goal: "personal",
  context: "",
};
const copy = (
  en = "Use your current skills on a single local example.",
  zh = "先用现有经验完成一个本地样例。",
) => ({ en, zh });
async function waitUntil(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(check(), "the request should reach the model within the deadline");
}
function sample(): Market {
  const m: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  m.id = "abcdef1234567890";
  const opportunities = ["review", "migration", "exports"].map((id, i) => ({
    id,
    query: `document ${id}`,
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
      title: [
        "Keep review comments",
        "Move draft history",
        "Export draft bundles",
      ][i]!,
      audience: "Editors managing team drafts.",
      need: "Keep each review comment beside its paragraph.",
      service: "Map a review comment between two draft revisions.",
      demand: "Test the frequency of repeated review work.",
      competition: "Compare current document export behavior.",
      resources: "A TypeScript developer and sample documents.",
      delivery: "Two weeks for a focused local prototype.",
      upkeep: "Keep adapters aligned with current document formats.",
      wedge: "Export a reviewable mapping between two drafts.",
      experiment: "Try three draft changes with a working editor.",
    },
    zh: {
      title: ["保留评审意见", "迁移草稿历史", "导出草稿资料"][i]!,
      audience: "维护团队草稿的编辑。",
      need: "将评审意见保留在对应段落。",
      service: "比较两版草稿并迁移评审意见。",
      demand: "核对团队重复评审的实际频率。",
      competition: "比较现有文档的导出行为。",
      resources: "一位开发者和文档样例。",
      delivery: "估算两周完成一个本地原型。",
      upkeep: "结合当前文档格式维护适配器。",
      wedge: "导出可供核对的段落对应结果。",
      experiment: "与一位编辑测试三次草稿变动。",
    },
  }));
  m.brief = {
    model: "test",
    generatedAt: m.asOf,
    strategyVersion: "2",
    en: { summary: "Compare focused document tools.", nextSteps: [] },
    zh: { summary: "比较具体的文档处理工具。", nextSteps: [] },
    sources: [],
    opportunities,
    recommendedId: "review",
    selection: copy(
      "Start with a focused document tool.",
      "先验证一个具体的文档工具。",
    ),
  };
  assert.ok(visibleOpportunities(m.brief));
  return m;
}
function result(m: Market, p = profile): SavedFit {
  return {
    version: FIT_VERSION,
    reportId: m.id,
    profile: p,
    generatedAt: new Date().toISOString(),
    model: "test",
    summary: copy(),
    directions: ["exports", "review", "migration"].map((id) => ({
      id,
      fit: "possible",
      reasons: {
        skill: copy(),
        time: copy(
          "Scope the weekend to a single-file export prototype.",
          "周末先交付一个单文件导出原型。",
        ),
        goal: copy(),
      },
      firstStep: copy(),
    })),
  };
}

test("personal ranking keeps every original direction and leaves market evidence immutable", async () => {
  const env = { ...process.env },
    dir = mkdtempSync(join(tmpdir(), "ghtrends-fit-model-"));
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  const engine = new Engine(new Store(dir)),
    m = sample(),
    before = JSON.stringify(m);
  try {
    let calls = 0;
    engine.research.json = async (
      _system,
      input,
      tokens,
      operation,
      thinking,
    ) => {
      calls++;
      assert.ok(tokens! <= 4200);
      assert.equal(thinking, undefined);
      assert.match(operation!, /^direction-fit/);
      assert.deepEqual((input as any).profile, profile);
      if (operation === "direction-fit-review")
        return {
          edits: [
            {
              path: "directions.0.reasons.skill.en",
              value:
                "Use your frontend skills and confirm document-format experience.",
            },
            {
              path: "directions.0.reasons.skill.zh",
              value: "运用前端经验，并确认文档格式处理经验。",
            },
            { path: "directions.0.id", value: "invented" },
          ],
        };
      const response = result(m);
      if (calls === 1) response.directions[0]!.id = "invented";
      return response;
    };
    const saved = await engine.research.fit(m, profile);
    assert.equal(calls, 3);
    assert.equal(saved.directions[0]!.id, "exports");
    assert.equal(
      saved.directions[0]!.reasons.skill.zh,
      "运用前端经验，并确认文档格式处理经验。",
    );
    assert.deepEqual(fitProblems(saved, m), []);
    assert.equal(JSON.stringify(m), before);
    const duplicate = structuredClone(saved);
    duplicate.directions[1]!.id = duplicate.directions[0]!.id;
    assert.ok(fitProblems(duplicate, m).length);
    const nested = structuredClone(saved) as any;
    nested.directions[0].reasons.firstStep = nested.directions[0].firstStep;
    delete nested.directions[0].firstStep;
    const normalized = normalizeFit(nested) as SavedFit;
    assert.deepEqual(fitProblems(normalized, m), []);
    assert.deepEqual(
      normalized.directions[0]!.firstStep,
      saved.directions[0]!.firstStep,
    );
    assert.equal(
      nested.directions[0].firstStep,
      undefined,
      "normalization preserves the original response",
    );
    const labels = structuredClone(saved);
    labels.summary = {
      en: "Your month-plus window can cover the trial.",
      zh: "按 two-weeks 的时间先做样例。",
    };
    const readable = normalizeFit(labels, m) as SavedFit;
    assert.equal(
      readable.summary.en,
      "Your month or more window can cover the trial.",
    );
    assert.equal(readable.summary.zh, "按 两周 的时间先做样例。");
    normalized.directions[0]!.reasons.skill.zh = "不能使用";
    assert.ok(
      fitProblems(normalized, m).some((p) =>
        p.includes("directions.0.reasons.skill.zh"),
      ),
    );
    const md = fitMarkdown(
      saved,
      m,
      "zh",
      "https://ghtrends.dev/radar/report/" + m.id,
    );
    assert.ok(md.includes("前端 · 一个周末 · 自己使用"));
    assert.ok(md.includes("## 1. 导出草稿资料"));
    assert.ok(md.includes("周末先交付一个单文件导出原型。"));
    const operations: string[] = [];
    engine.research.json = async (_system, input: any, _tokens, operation) => {
      operations.push(operation!);
      if (operation === "direction-fit-review") return { edits: [] };
      if (operation === "direction-fit-copy") {
        assert.deepEqual(
          input.fields.find((f: any) => f.path === "summary.zh").counterpart,
          { language: "en", value: result(m).summary.en },
        );
        return {
          edits: [
            { path: "summary.zh", value: "按现有经验优先做导出工具。" },
            { path: "directions.0.id", value: "invented" },
          ],
        };
      }
      const response = result(m);
      response.summary.zh = "这个方向与原先不同。";
      return response;
    };
    const repaired = await engine.research.fit(m, profile);
    assert.deepEqual(operations, [
      "direction-fit",
      "direction-fit-review",
      "direction-fit-copy",
    ]);
    assert.equal(repaired.summary.zh, "按现有经验优先做导出工具。");
    assert.deepEqual(
      repaired.directions,
      result(m).directions,
      "copy repair edits requested prose only",
    );
    let attempts = 0;
    engine.research.json = async (_system, _input, _tokens, operation) => {
      if (operation === "direction-fit-review") return { edits: [] };
      if (++attempts === 1)
        throw new Error(
          "The AI response could not be validated. Please try again.",
        );
      return result(m);
    };
    assert.deepEqual(
      (await engine.research.fit(m, profile)).directions,
      result(m).directions,
    );
    assert.equal(
      attempts,
      2,
      "malformed JSON shares the bounded repair budget",
    );
  } finally {
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
    process.env = env;
  }
});

test("private profile ranking checks ownership, CSRF, caching and duplicate requests while preserving credits", async () => {
  const env = { ...process.env },
    dir = mkdtempSync(join(tmpdir(), "ghtrends-fit-api-"));
  process.env.GHTRENDS_HOSTED = "1";
  process.env.PUBLIC_URL = "https://radar.example";
  process.env.DEEPSEEK_API_KEY = "unit-test-only";
  delete process.env.GHTRENDS_AUTO_COLLECT;
  const engine = new Engine(new Store(dir)),
    m = sample();
  engine.store.saveMarket(m, false, "alice");
  const sids = new Map<string, string>();
  for (const id of ["alice", "bob"]) {
    const sid = randomBytes(32).toString("base64url");
    sids.set(id, sid);
    engine.store.set(sessionKey(sid), { id, name: id, csrf: "csrf" }, 60000);
  }
  let calls = 0,
    release: () => void = () => {};
  engine.research.fit = async (_m, p) => {
    calls++;
    await new Promise<void>((done) => {
      release = done;
    });
    return result(m, p);
  };
  const server = createApp(engine).listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/reports/${m.id}/fit`;
  const request = (
    method = "GET",
    body?: unknown,
    user = "alice",
    csrf = "csrf",
  ) =>
    fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://radar.example",
        Cookie: `__Host-ghtrends_session=${sids.get(user) || ""}`,
        "X-CSRF-Token": csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    assert.equal((await request("GET", undefined, "guest")).status, 401);
    assert.equal((await request("GET", undefined, "bob")).status, 404);
    assert.equal(
      (await request("POST", profile, "alice", "wrong")).status,
      403,
    );
    assert.equal(
      (await request("POST", { ...profile, time: "ten-years" })).status,
      400,
    );
    assert.equal(
      (await request("POST", { ...profile, context: "<script>" })).status,
      400,
    );
    const legacy = { ...result(m), version: "1" };
    engine.store.set(`direction-fit:last:alice:${m.id}`, legacy, 60000);
    assert.deepEqual(await (await request()).json(), legacy);
    assert.equal(
      calls,
      0,
      "reading a saved older selection consumes no model call",
    );
    const first = request("POST", profile);
    await waitUntil(() => calls > 0);
    const second = request("POST", profile);
    assert.equal(
      (await request("POST", { ...profile, goal: "customers" })).status,
      429,
    );
    release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    assert.equal(calls, 1);
    assert.equal(engine.store.usage("alice"), 0);
    assert.equal((await request("POST", profile)).status, 200);
    assert.equal(calls, 1);
    const saved = await (await request()).json();
    assert.deepEqual(saved.profile, profile);
    assert.equal(engine.store.report(m.id)?.brief?.recommendedId, "review");
    engine.store.shareReport("alice", m.id, true);
    assert.equal(await (await request("GET", undefined, "bob")).json(), null);
    const next = request("POST", { ...profile, goal: "customers" });
    await waitUntil(() => calls >= 2);
    assert.equal((await request("DELETE")).status, 200);
    release();
    await next;
    assert.equal(
      await (await request()).json(),
      null,
      "restoring the original order survives an older in-flight result",
    );
    engine.research.fit = async () => {
      throw new Error("model test failure");
    };
    assert.equal(
      (await request("POST", { ...profile, skill: "backend" })).status,
      502,
    );
    assert.equal(engine.store.usage("alice"), 0);
    const runs = engine.store.adminOverview(1, 0, "").runs as {
      kind: string;
      state: string;
    }[];
    assert.deepEqual(
      runs
        .filter((r) => r.kind === "fit")
        .map((r) => r.state)
        .sort(),
      ["complete", "complete", "failed"],
    );
  } finally {
    release();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
    process.env = env;
  }
});
