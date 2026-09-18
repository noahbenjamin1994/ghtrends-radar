// Run after `npm run build`, with the operator's DeepSeek environment available.
// Uses an isolated database and only query planning, never source collection.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Research, QUERY_PLAN_VERSION } from "../dist/providers/research.js";
import { Store } from "../dist/core/store.js";
import { operationContext } from "../dist/core/operations.js";

const { values } = parseArgs({
  options: {
    cases: { type: "string", default: "tests/fixtures/research-inputs.json" },
    out: { type: "string" },
    geo: { type: "string", default: "US" },
  },
});
if (!values.out || !process.env.DEEPSEEK_API_KEY)
  throw new Error(
    "Provide --out and DEEPSEEK_API_KEY. Results contain the supplied test inputs.",
  );
const cases = JSON.parse(readFileSync(values.cases, "utf8"));
if (
  !Array.isArray(cases) ||
  cases.length > 200 ||
  cases.some((c) => typeof c.input !== "string")
)
  throw new Error("Provide an array of up to 200 input cases.");
const dir = mkdtempSync(join(tmpdir(), "ghtrends-preflight-audit-"));
const store = new Store(dir),
  results = new Array(cases.length);
let index = 0;
try {
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (index < cases.length) {
        const i = index++,
          c = cases[i],
          id = randomUUID(),
          started = Date.now();
        const research = new Research(store),
          original = research.json.bind(research);
        let raw;
        research.json = async (...args) => {
          raw = await original(...args);
          return raw;
        };
        store.startRun({
          id,
          kind: "preflight",
          input: c.input,
          geo: values.geo,
          background: true,
          created: new Date().toISOString(),
        });
        let row;
        try {
          const topic = await operationContext.run({ runId: id }, () =>
            research.plan(c.input, undefined, values.geo),
          );
          const terms = topic.plan?.trends || [topic.keyword];
          const scopePass =
            (c.require || []).every((pattern) =>
              terms.every((term) => new RegExp(pattern, "i").test(term)),
            ) &&
            (c.exclude || []).every((pattern) =>
              terms.every((term) => !new RegExp(pattern, "i").test(term)),
            );
          row = {
            status: "ready",
            keyword: topic.keyword,
            trends: terms,
            queries: topic.queries || [topic.query],
            entity: topic.plan?.entity,
            scope: topic.scope,
            model: topic.plan?.model,
            scopePass,
          };
        } catch (e) {
          row = {
            status:
              e.status === 422
                ? e.choices?.length
                  ? "clarify"
                  : "guide"
                : "error",
            error: e.message,
            fields: e.fields,
            raw,
          };
        }
        const accepted =
          c.expected === "ready"
            ? ["ready", "clarify"].includes(row.status)
            : row.status === c.expected;
        results[i] = { ...c, ...row, accepted, ms: Date.now() - started };
        store.updateRun(id, row.status === "error" ? "failed" : "complete");
      }
    }),
  );
  const metrics = store.adminOverview(1, 0, "");
  const times = results
    .filter((r) => r.raw || (r.model && r.model !== "curated"))
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  const summary = {
    date: new Date().toISOString(),
    version: QUERY_PLAN_VERSION,
    geo: values.geo,
    method:
      "Query planning only; fresh isolated database; two concurrent workers; status acceptance and synonym scope checked separately. Timing excludes browser/network overhead.",
    count: cases.length,
    valid: cases.filter((c) => c.expected === "ready").length,
    acceptedValid: results.filter((r) => r.expected === "ready" && r.accepted)
      .length,
    scopeFailures: results.filter((r) => r.scopePass === false).length,
    errors: results.filter((r) => !r.accepted || r.scopePass === false),
    planMs: {
      p50: times[Math.floor(times.length * 0.5)],
      p95: times[
        Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)
      ],
    },
    providers: metrics.providers,
    models: metrics.models,
  };
  writeFileSync(values.out, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length) process.exitCode = 1;
} finally {
  store.close();
  rmSync(dir, { recursive: true, force: true });
}
