import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import { operationContext } from "../src/core/operations.js";
import { singleReport } from "../src/providers/report.js";
import { researchWarnings } from "../src/core/evidence.js";
import type { Market } from "../src/core/types.js";

const text = { en: "Available evidence is limited.", zh: "现有证据有限。" };
const draft = () => ({
  verdict: { kind: "insufficient", reason: text },
  pains: [] as unknown[],
  commercial: [] as unknown[],
  openSource: [] as unknown[],
  directions: [] as unknown[],
  nextStep: null,
  unverified: [text],
});
const reply = (content: string, finish = "stop") =>
  Response.json({
    model: "deepseek-flash",
    choices: [{ finish_reason: finish, message: { content } }],
    usage: { prompt_tokens: 500, completion_tokens: 200 },
  });
async function harness(
  work: (x: {
    run: (deadlineAt?: number) => Promise<Market>;
    engine: Engine;
    db: DatabaseSync;
    collections: () => number;
  }) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "report-recovery-"));
  const engine = new Engine(new Store(dir));
  const db = new DatabaseSync(join(dir, "ghtrends.sqlite"));
  const base: Market = JSON.parse(
    readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"),
  )[0];
  let collections = 0;
  engine.trends.demand = async () => {
    collections++;
    return base.demand;
  };
  engine.github.supply = async () => base.supply;
  engine.github.gaps = async () => [];
  engine.search.collect = async () => ({
    provider: "multi-search",
    region: "US",
    language: "en",
    state: "ready",
    fetchedAt: new Date().toISOString(),
    queries: [],
  });
  engine.documents.forResearch = () => ({ enabled: false }) as any;
  try {
    await work({
      engine,
      db,
      collections: () => collections,
      run: (deadlineAt) =>
        operationContext.run({ runId: "recovery-test", userId: "qa" }, () =>
          singleReport(engine, "sample domain", base.topic, {
            geo: "US",
            owner: "qa",
            private: true,
            deadlineAt,
          }),
        ),
    });
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("invalid model JSON is regenerated once from unchanged sources and privately replayable", async () => {
  await harness(async ({ run, db, collections, engine }) => {
    const requests: any[] = [];
    const broken = '{"headline":"unterminated';
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return reply(requests.length === 1 ? broken : JSON.stringify(draft()));
    };
    const result = await run();
    assert.equal(requests.length, 2);
    assert.equal(collections(), 1);
    assert.ok(result.brief?.report);
    assert.equal(result.aiError, undefined);
    assert.equal(result.analysisError, undefined);
    const firstInput = JSON.parse(requests[0].messages[1].content);
    const retryInput = JSON.parse(requests[1].messages[1].content);
    assert.deepEqual(firstInput.sources, retryInput.sources);
    assert.equal(retryInput.previousFailure, "invalid_response");
    assert.ok(!requests[1].messages[1].content.includes(broken));
    assert.equal(requests[1].temperature, 0);
    const calls = db
      .prepare("SELECT operation,error FROM provider_calls ORDER BY id")
      .all() as any[];
    assert.deepEqual(
      calls.map((x) => [x.operation, x.error]),
      [
        ["report-write", "invalid_response"],
        ["report-recover", null],
      ],
    );
    const diagnostics = db
      .prepare("SELECT value FROM cache WHERE key LIKE 'model-diagnostic:%'")
      .all()
      .map((x: any) => JSON.parse(x.value));
    const failed = diagnostics.find((x) => x.error === "invalid_response");
    assert.equal(failed.response, broken);
    assert.ok(failed.detail);
    assert.deepEqual(failed.request, requests[0]);
    assert.equal(failed.request.headers, undefined);
    assert.ok(!JSON.stringify(result).includes(broken));
    assert.ok(
      !JSON.stringify(engine.store.adminOverview(7, 0, "")).includes(broken),
    );
    assert.equal(engine.store.canRead(result.id), false);
  });
});

test("schema and citation failures recover but never bypass evidence validation", async () => {
  for (const failure of ["schema", "citation"] as const)
    await harness(async ({ run, db }) => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        const bad = draft();
        if (failure === "schema") bad.verdict = null as any;
        else
          bad.commercial = [
            { name: "Sample", audience: text, evidence: ["S99Q1"] },
          ];
        return reply(JSON.stringify(calls === 1 ? bad : draft()));
      };
      const result = await run();
      assert.equal(calls, 2);
      assert.ok(result.brief?.report);
      const row = db
        .prepare("SELECT value FROM cache WHERE key=?")
        .get("model-diagnostic:recovery-test:delivery") as any;
      assert.equal(JSON.parse(row.value).failures[0].code, `report_${failure}`);
    });
});

test("two invalid responses stop at two attempts, retain evidence and remain refundable", async () => {
  await harness(async ({ run, collections, engine }) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return reply("not JSON");
    };
    const result = await run();
    assert.equal(calls, 2);
    assert.equal(collections(), 1);
    assert.equal(result.brief, undefined);
    assert.deepEqual(result.analysisError, {
      code: "invalid_response",
      attempts: 2,
    });
    assert.ok(researchWarnings(result, true).includes(result.aiError!));
    assert.ok(engine.store.report(result.id));
    assert.ok(!result.aiError?.includes("time limit"));
  });
});

test("authorization failures do not retry or expose provider text", async () => {
  await harness(async ({ run }) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("PRIVATE PROVIDER ERROR", { status: 401 });
    };
    const result = await run();
    assert.equal(calls, 1);
    assert.equal(result.analysisError?.code, "http_401");
    assert.ok(!JSON.stringify(result).includes("PRIVATE PROVIDER ERROR"));
  });
});

test("deadline aborts the real request and never starts recovery after expiry", async () => {
  await harness(async ({ run }) => {
    let calls = 0,
      aborted = false;
    globalThis.fetch = async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    };
    const start = Date.now();
    const result = await run(Date.now() + 80);
    assert.equal(calls, 1);
    assert.equal(aborted, true);
    assert.ok(Date.now() - start < 1000);
    assert.equal(result.analysisError?.code, "model_timeout");
  });
});

test("private diagnostic retention is bounded and cannot change report data", async () => {
  await harness(async ({ engine, db }) => {
    for (let i = 0; i < 205; i++)
      engine.store.recordModelDiagnostic(`old-${i}`, { response: "private" });
    const count = db
      .prepare(
        "SELECT count(*) AS n FROM cache WHERE key LIKE 'model-diagnostic:%'",
      )
      .get() as any;
    assert.equal(count.n, 200);
    engine.store.set("model-diagnostic:expired", { response: "expired" }, -1);
    engine.store.recordModelDiagnostic("new", { response: "fresh" });
    assert.equal(engine.store.get("model-diagnostic:expired", true), null);
  });
});

test("broken SSE retains partial answer without reasoning and recovers with a fresh response", async () => {
  await harness(async ({ run, db }) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls > 1) return reply(JSON.stringify(draft()));
      const event = (x: unknown) => "data: " + JSON.stringify(x) + "\n\n";
      const content = '{"headline":"partial';
      return new Response(
        event({
          model: "deepseek-flash",
          choices: [
            {
              index: 0,
              delta: { reasoning_content: "DO NOT STORE REASONING", content },
            },
          ],
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const result = await run();
    assert.ok(result.brief?.report);
    assert.equal(calls, 2);
    const diagnostics = db
      .prepare("SELECT value FROM cache WHERE key LIKE 'model-diagnostic:%'")
      .all()
      .map((x: any) => JSON.parse(x.value));
    const failed = diagnostics.find((x) => x.error === "model_stream_error");
    assert.equal(failed.response, '{"headline":"partial');
    assert.equal(failed.detail, "incomplete_model_stream");
    assert.ok(!JSON.stringify(diagnostics).includes("DO NOT STORE REASONING"));
  });
});

test("capped completions and rate limits get at most one recovery", async () => {
  for (const error of ["output_limit", "rate_limit"])
    await harness(async ({ run }) => {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        if (calls > 1) return reply(JSON.stringify(draft()));
        return error === "output_limit"
          ? reply('{"cut":', "length")
          : new Response("busy", { status: 429 });
      };
      const result = await run();
      assert.ok(result.brief?.report);
      assert.equal(calls, 2);
    });
});

test("repeated invented citations remain a failed report rather than a false success", async () => {
  await harness(async ({ run }) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      const raw = draft();
      raw.commercial = [
        { name: "Sample", audience: text, evidence: ["S999Q1"] },
      ];
      return reply(JSON.stringify(raw));
    };
    const result = await run();
    assert.equal(calls, 2);
    assert.equal(result.brief, undefined);
    assert.equal(result.analysisError?.code, "report_citation");
  });
});

test("malformed JSON followed by one malformed direction delivers validated findings with a refund warning", async () => {
  await harness(async ({ run }) => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1)
        return reply(
          '{"unverified":[{"en":"first","zh":"第一"},"verdict":{"en":"wrong nesting","zh":"错误嵌套"}]}',
        );
      const raw = {
        ...draft(),
        directions: [
          { title: { en: "Broken direction", zh: text, task: text } },
        ],
      };
      return reply(JSON.stringify(raw));
    };
    const result = await run();
    assert.equal(calls, 2);
    assert.ok(result.brief?.report);
    assert.deepEqual(result.brief.report.directions, []);
    assert.ok(result.aiError);
    assert.equal(result.analysisError, undefined);
    assert.ok(researchWarnings(result, true).includes(result.aiError));
  });
});
