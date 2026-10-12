import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import { DataApi } from "../src/providers/dataapi.js";
import { GoogleSearch } from "../src/providers/search.js";

test("the Data API client keeps a finished call's valid items and nothing from an unfinished or failed one", async () => {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "dataapi-"));
  const key = "sk_" + "t".repeat(40);
  process.env.DATA_API_URL = "http://api.test/";
  process.env.DATA_API_KEY = key;
  const store = new Store(dir);
  try {
    const api = new DataApi(store);
    assert.equal(api.enabled, true);
    const seen: unknown[] = [];
    let reply: unknown = {
      request_id: "req_1",
      status: "ok",
      outcome: "ok",
      credits_charged: 10,
      result: {
        items: [
          {
            title: "大家都用什么软件进行密码管理？",
            url: "https://www.zhihu.com/question/1/answer/2",
            body: "前十几年我都是很排斥这类密码管理软件的。",
            external_id: "2",
            extra: { content_type: "answer" },
          },
          { title: "no url" },
        ],
      },
    };
    let http = 200;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      assert.equal(String(url), "http://api.test/v1/call");
      assert.equal(
        (init?.headers as Record<string, string>).authorization,
        "Bearer " + key,
      );
      seen.push(JSON.parse(String(init?.body)));
      return Response.json(reply, { status: http });
    }) as typeof fetch;
    const items = await api.run(
      "zhihu.search",
      { keyword: "密码管理器" },
      Date.now() + 10000,
    );
    assert.deepEqual(
      items.map((i) => i.external_id),
      ["2"],
    );
    const sent = seen[0] as { op: string; params: unknown; wait: number };
    assert.equal(sent.op, "zhihu.search");
    assert.deepEqual(sent.params, { keyword: "密码管理器" });
    assert.ok(sent.wait > 6 && sent.wait <= 8);
    const none = () =>
      api.run("zhihu.answer", { answer_id: "2" }, Date.now() + 10000);
    reply = { request_id: "req_2", status: "running", credits_quoted: 10 };
    assert.deepEqual(await none(), []);
    reply = { request_id: "req_3", status: "failed", outcome: "captcha" };
    assert.deepEqual(await none(), []);
    http = 402;
    assert.deepEqual(await none(), []);
    process.env.DATA_API_KEY = "t".repeat(40);
    assert.equal(new DataApi(store).enabled, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DATA_API_URL;
    delete process.env.DATA_API_KEY;
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a web search is bought from the Data API, and Radar's own route answers only when that fails", async () => {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "dataapi-search-"));
  process.env.DATA_API_URL = "http://api.test";
  process.env.DATA_API_KEY = "sk_" + "t".repeat(40);
  process.env.GOOGLE_SEARCH_PROXY = "http://user:pass@proxy.test:8000";
  const store = new Store(dir);
  try {
    const asked: string[] = [];
    let http = 200;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.op, "brave.search");
      assert.equal(sent.params.region, "us");
      asked.push(sent.params.keyword);
      return Response.json(
        {
          status: "ok",
          outcome: "ok",
          result: {
            items: ["a", "b", "c", "a"].map((id) => ({
              title: ` Password  manager ${id} `,
              url: `https://example.com/${id}`,
              body: `They  said ${id}`,
            })),
          },
        },
        { status: http },
      );
    }) as typeof fetch;
    let own = 0;
    const search = new GoogleSearch(
      store,
      async () => {
        own++;
        return { status: 429 };
      },
      new DataApi(store),
    );
    const page = await search.lookupWeb("password manager pricing");
    assert.equal(page.engine, "brave");
    assert.deepEqual(
      page.results.map((r) => [r.title, r.url, r.excerpt, r.kind]),
      ["a", "b", "c"].map((id) => [
        `Password manager ${id}`,
        `https://example.com/${id}`,
        `They said ${id}`,
        "organic",
      ]),
    );
    assert.deepEqual(asked, ["password manager pricing"]);
    assert.equal(own, 0);
    http = 502;
    await assert.rejects(search.lookupWeb("keepass alternatives"));
    assert.ok(own > 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DATA_API_URL;
    delete process.env.DATA_API_KEY;
    delete process.env.GOOGLE_SEARCH_PROXY;
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
