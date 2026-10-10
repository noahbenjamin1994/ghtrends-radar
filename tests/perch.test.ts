import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/core/store.js";
import { Perch } from "../src/providers/perch.js";

test("perch returns a finished task's valid items and nothing from a failed one", async () => {
  const originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "perch-"));
  process.env.PERCH_URL = "http://perch.test/";
  process.env.PERCH_TOKEN = "t".repeat(32);
  const store = new Store(dir);
  try {
    const perch = new Perch(store);
    assert.equal(perch.enabled, true);
    const seen: string[] = [];
    let status = "done";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method} ${url}`);
      assert.equal(
        (init?.headers as Record<string, string>).authorization,
        "Bearer " + "t".repeat(32),
      );
      const polled = String(url).endsWith("/v1/tasks/abc");
      return Response.json({
        task: {
          id: "abc",
          status: polled ? status : "queued",
          failure_kind: status === "dead" ? "needs_mapping" : null,
          result: polled
            ? {
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
              }
            : null,
        },
      });
    }) as typeof fetch;
    const items = await perch.run(
      "zhihu.search",
      { keyword: "密码管理器" },
      Date.now() + 10000,
    );
    assert.deepEqual(
      items.map((i) => i.external_id),
      ["2"],
    );
    assert.deepEqual(seen, [
      "POST http://perch.test/v1/tasks",
      "GET http://perch.test/v1/tasks/abc",
    ]);
    status = "dead";
    assert.deepEqual(
      await perch.run("zhihu.answer", { answer_id: "2" }, Date.now() + 10000),
      [],
    );
    delete process.env.PERCH_TOKEN;
    assert.equal(new Perch(store).enabled, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PERCH_URL;
    delete process.env.PERCH_TOKEN;
    store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
