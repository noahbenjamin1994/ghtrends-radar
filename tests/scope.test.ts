import assert from "node:assert/strict";
import test from "node:test";
import { exitLabel, report, traced } from "../src/providers/scope.js";

test("exit label names the gateway and country but never the credentials", () => {
  const proxy =
    "http://user-spmn3ovaql-country-us-session-abc-sessionduration-30:s3cr3t@gate.decodo.com:7000";
  const label = exitLabel(proxy);
  assert.equal(label, "gate.decodo.com:7000/US");
  assert.ok(!label!.includes("s3cr3t"));
  assert.ok(!label!.includes("spmn3ovaql"));
});

test("a malformed proxy yields no label rather than a leaked raw string", () => {
  assert.equal(exitLabel("not a url"), undefined);
  assert.equal(exitLabel(undefined), undefined);
});

test("reporting is a no-op without configuration and never throws", () => {
  const prev = process.env.SCOPE_URL;
  delete process.env.SCOPE_URL;
  assert.doesNotThrow(() =>
    report({ op: "x", status: "ok", startedAt: Date.now() }),
  );
  if (prev) process.env.SCOPE_URL = prev;
});

test("tracing returns the transport result untouched", async () => {
  const fn = traced(
    "t",
    async (n: number) => ({ status: 200, value: n * 2 }),
    () => ({}),
  );
  assert.deepEqual(await fn(21), { status: 200, value: 42 });
});

test("tracing rethrows the original error object", async () => {
  const boom = Object.assign(new Error("document_access"), { documentStatus: "access" });
  const fn = traced(
    "t",
    async () => {
      throw boom;
    },
    () => ({}),
  );
  await assert.rejects(() => fn(), (e) => e === boom);
});

test("a transport that resolves with an error is not recorded as success", async () => {
  // The Python search transport reports verification pages as `{ error }`
  // rather than throwing. Counting those as ok is how a dashboard starts
  // disagreeing with what actually happened.
  const seen: string[] = [];
  const prevUrl = process.env.SCOPE_URL;
  const prevTok = process.env.SCOPE_TOKEN;
  process.env.SCOPE_URL = "http://scope.invalid";
  process.env.SCOPE_TOKEN = "t".repeat(40);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init: { body: string }) => {
    seen.push(JSON.parse(init.body).spans[0].status);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const fn = traced(
      "search.direct",
      async () => ({ error: "verification" }),
      () => ({}),
      (r) => r.error,
    );
    await fn();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, ["failed"]);
  } finally {
    globalThis.fetch = realFetch;
    if (prevUrl) process.env.SCOPE_URL = prevUrl;
    else delete process.env.SCOPE_URL;
    if (prevTok) process.env.SCOPE_TOKEN = prevTok;
    else delete process.env.SCOPE_TOKEN;
  }
});

test("a search still succeeds when scope is unreachable", async () => {
  const prevUrl = process.env.SCOPE_URL;
  const prevTok = process.env.SCOPE_TOKEN;
  process.env.SCOPE_URL = "http://127.0.0.1:9";
  process.env.SCOPE_TOKEN = "t".repeat(40);
  try {
    const fn = traced("t", async () => "result", () => ({}));
    assert.equal(await fn(), "result");
  } finally {
    if (prevUrl) process.env.SCOPE_URL = prevUrl;
    else delete process.env.SCOPE_URL;
    if (prevTok) process.env.SCOPE_TOKEN = prevTok;
    else delete process.env.SCOPE_TOKEN;
  }
});
