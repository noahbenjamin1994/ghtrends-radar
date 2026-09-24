import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { Engine } from "../src/core/engine.js";
import { Store } from "../src/core/store.js";
import {
  DocumentReader,
  type DocumentTransport,
} from "../src/providers/documents.js";
import { installSourceRoutes } from "../src/server/sources.js";
import { operationContext } from "../src/core/operations.js";

const html =
  "<title>Product pricing</title><main>Starter costs $12 per month. Annual billing is required. The starter plan excludes team sharing. Export is available for paid customers only.</main>";
const response = (body = html, status = 200) => ({
  body,
  status,
  headers: { "content-type": "text/html" },
  bytes: body.length,
});

test("source API coalesces duplicates and rejects overload without starting extra work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "source-busy-")),
    engine = new Engine(new Store(dir));
  const app = express();
  app.use(express.json());
  let release!: () => void,
    entered!: () => void,
    calls = 0;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  engine.search.lookupWeb = async () => {
    calls++;
    if (calls === 2) entered();
    await gate;
    return {
      results: [],
      fetchedAt: new Date().toISOString(),
      engine: "google",
      adCoverage: "limited",
    };
  };
  installSourceRoutes(app, engine, {
    requireAdmin: () => ({ id: "admin" }),
    protect: () => ({ id: "admin" }),
  } as any);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/sources/search`;
  const post = (query: string) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
  try {
    const a = post("first query"),
      b = post("second query");
    await started;
    assert.equal((await post("third query")).status, 429);
    const duplicate = post("first query");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 2);
    release();
    for (const response of await Promise.all([a, b, duplicate]))
      assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    release();
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("web reader caches, coalesces, serializes origins and never uses platform APIs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "source-reader-")),
    store = new Store(dir);
  const urls: string[] = [];
  let active = 0,
    maximum = 0;
  const transport: DocumentTransport = async (url) => {
    urls.push(url.href);
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return url.pathname === "/robots.txt" ? response("", 404) : response();
  };
  const reader = new DocumentReader(store, transport);
  try {
    const [a, b] = await Promise.all([
      reader.readWeb("https://news.ycombinator.com/item?id=1"),
      reader.readWeb("https://news.ycombinator.com/item?id=1"),
      reader.readWeb("https://news.ycombinator.com/item?id=2"),
    ]);
    assert.equal(a.read.status, "read");
    assert.deepEqual(a.sources, b.sources);
    assert.equal(maximum, 1);
    assert.equal(urls.length, 3);
    assert.ok(
      urls.every((url) => new URL(url).hostname === "news.ycombinator.com"),
    );
    const hit = await reader.readWeb("https://news.ycombinator.com/item?id=1");
    assert.equal(hit.cached, true);
    assert.equal(hit.read.observedAt, a.read.observedAt);
    assert.equal(urls.length, 3);
    await assert.rejects(() => reader.readWeb("http://127.0.0.1/admin"));
    const denied = await reader.readWeb(
      "https://reddit.com/r/example/comments/1",
    );
    assert.equal(denied.read.status, "access");
    assert.equal(urls.length, 3);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("web reader preserves robots denial, cancellation and bounded negative cache", async () => {
  const dir = mkdtempSync(join(tmpdir(), "source-deny-")),
    store = new Store(dir);
  let calls = 0;
  const reader = new DocumentReader(store, async () => {
    calls++;
    return response("User-agent: *\nDisallow: /", 200);
  });
  try {
    const blocked = await reader.readWeb("https://example.com/private");
    assert.equal(blocked.read.status, "robots");
    assert.equal(blocked.sources.length, 0);
    assert.equal(
      (await reader.readWeb("https://example.com/private")).cached,
      true,
    );
    assert.equal(calls, 1);
    const signal = AbortSignal.abort();
    assert.equal(
      (await reader.readWeb("https://other.example.com/page", "", signal)).read
        .status,
      "limit",
    );
    assert.equal(calls, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("source API requires admin and CSRF, validates input, bounds batches and cannot call a model", async () => {
  const dir = mkdtempSync(join(tmpdir(), "source-api-")),
    engine = new Engine(new Store(dir));
  const reader = new DocumentReader(engine.store, async (url) =>
    url.pathname === "/robots.txt" ? response("", 404) : response(),
  );
  const app = express();
  app.use(express.json());
  const auth = {
    requireAdmin(q: any) {
      if (q.get("admin") !== "yes")
        throw Object.assign(new Error("admin_required"), { status: 401 });
      return { id: "admin" };
    },
    protect(q: any) {
      if (q.get("csrf") !== "yes")
        throw Object.assign(new Error("csrf_required"), { status: 403 });
    },
  } as any;
  engine.search.lookupWeb = async () => {
    assert.equal(operationContext.getStore()?.llmBudget?.maxCalls, 0);
    await assert.rejects(
      () => engine.research.json("must stop", {}),
      /model-call budget/,
    );
    return {
      results: [],
      fetchedAt: new Date().toISOString(),
      engine: "google",
      adCoverage: "limited",
    };
  };
  installSourceRoutes(app, engine, auth, reader);
  app.use((e: any, _q: any, r: any, _next: any) =>
    r.status(e.status || 500).json({ error: e.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/sources`;
  const post = (
    path: string,
    body: unknown,
    headers = { admin: "yes", csrf: "yes" },
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal(
      (
        await post(
          "/read",
          { url: "https://example.com" },
          { admin: "yes", csrf: "no" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await post("/read", { url: "http://localhost/admin" })).status,
      400,
    );
    assert.equal(
      (await post("/read", { url: "https://example.com", cookies: "secret" }))
        .status,
      400,
    );
    assert.equal(
      (await post("/batch", { urls: Array(9).fill("https://example.com") }))
        .status,
      400,
    );
    const batch = await (
      await post("/batch", {
        urls: [
          "https://example.com/a",
          "https://example.com/a#fragment",
          "https://reddit.com/r/example",
        ],
      })
    ).json();
    assert.equal(batch.state, "partial");
    assert.equal(batch.results.length, 2);
    assert.equal(batch.results[0].read.status, "read");
    assert.equal(batch.results[1].read.status, "access");
    assert.equal(
      (await post("/search", { query: "product pricing" })).status,
      200,
    );
    assert.equal(
      (await (await fetch(base, { headers: { admin: "yes" } })).json()).llm,
      false,
    );
    for (let i = 0; i < 10; i++)
      await post("/read", { url: "https://example.com/a" });
    assert.equal(
      (await post("/read", { url: "https://example.com/a" })).status,
      429,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
