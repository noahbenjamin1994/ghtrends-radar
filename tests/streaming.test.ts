import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCompletion } from "../src/providers/completion.js";
import { Research } from "../src/providers/research.js";
import { Store } from "../src/core/store.js";
import { operationContext } from "../src/core/operations.js";
import type { ResearchActivity } from "../src/core/activity.js";

function stream(text: string, split = 3) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += split)
          controller.enqueue(bytes.slice(i, i + split));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
const event = (data: unknown) => "data: " + JSON.stringify(data) + "\r\n\r\n";
const delta = (data: unknown) =>
  event({ model: "deepseek-flash", choices: [{ index: 0, delta: data }] });
const tail = (finish = "stop") =>
  event({ choices: [{ index: 0, delta: {}, finish_reason: finish }] }) +
  event({
    choices: [],
    usage: {
      prompt_tokens: 200,
      completion_tokens: 100,
      prompt_cache_hit_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 70 },
    },
  }) +
  "data: [DONE]\r\n\r\n";

test("model SSE preserves fragmented UTF-8 JSON, discards reasoning text, and captures final usage", async () => {
  const phases: string[] = [];
  const response = await readCompletion(
    stream(
      ": keepalive\r\n\r\n" +
        delta({ reasoning_content: "PRIVATE REASONING" }) +
        delta({ content: '{"结论":' }) +
        delta({ content: '"测试"}' }) +
        tail(),
    ),
    (p) => phases.push(p),
  );
  assert.deepEqual(JSON.parse(response.choices[0].message.content), {
    结论: "测试",
  });
  assert.equal(response.usage.completion_tokens_details.reasoning_tokens, 70);
  assert.ok(phases.includes("thinking") && phases.includes("writing"));
  assert.ok(!JSON.stringify(response).includes("PRIVATE REASONING"));
});

test("truncated, errored and malformed model streams never become valid completions", async () => {
  for (const text of [
    delta({ content: "{}" }),
    delta({ content: "{}" }) + "data: [DONE]\n\n",
    "data: {broken}\n\n",
    event({ error: { message: "private provider message" } }),
  ]) {
    await assert.rejects(() => readCompletion(stream(text), () => {}));
  }
  const capped = await readCompletion(
    stream(delta({ content: "{}" }) + tail("length")),
    () => {},
  );
  assert.equal(capped.choices[0].finish_reason, "length");
  assert.equal(capped.usage.completion_tokens, 100);
});

test("streamed research records reasoning and costs, emits safe progress, and rejects capped output", async () => {
  const env = { ...process.env },
    originalFetch = globalThis.fetch;
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-stream-")),
    store = new Store(dir);
  process.env.GHTRENDS_LLM_PRICING_JSON = JSON.stringify({
    "deepseek-flash": { input: 0.3, cachedInput: 0.006, output: 1.2 },
  });
  let finish = "stop";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    assert.equal(body.stream_options.include_usage, true);
    assert.equal(body.thinking.type, "disabled");
    return stream(delta({ content: '{"edits":[]}' }) + tail(finish));
  };
  try {
    const activities: ResearchActivity[] = [],
      research = new Research(store);
    delete process.env.GHTRENDS_RESEARCH_THINKING;
    delete process.env.GHTRENDS_RESEARCH_REVIEW_THINKING;
    assert.equal(research.strategyThinking, "low");
    assert.equal(research.reviewThinking, "low");
    const run = () =>
      operationContext.run(
        { runId: "test", onActivity: (x) => activities.push(x) },
        () =>
          research.json(
            "Private system prompt",
            { secret: "private source" },
            100,
            "issue-reading",
            false,
          ),
      );
    assert.deepEqual(await run(), { edits: [] });
    assert.deepEqual(
      activities.map((a) => a.state),
      ["waiting", "writing", "complete"],
    );
    assert.ok(!JSON.stringify(activities).includes("private"));
    finish = "length";
    await assert.rejects(run, (error: any) => error.code === "output_limit");
    const db = new DatabaseSync(join(dir, "ghtrends.sqlite"));
    const calls = db
      .prepare("SELECT * FROM provider_calls ORDER BY id")
      .all() as any[];
    db.close();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].error, "output_limit");
    assert.equal(calls[1].output_tokens, 100);
    assert.equal(calls[1].reasoning_tokens, 70);
    assert.ok(calls[0].cost_usd > 0);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = env;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
