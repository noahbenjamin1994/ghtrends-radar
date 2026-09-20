import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scopedWebQueries,
  searchSources,
  type WebEvidence,
} from "../src/providers/search.js";
import { Research } from "../src/providers/research.js";
import { Store } from "../src/core/store.js";
import { competitorDiscovery } from "../src/core/evidence.js";
import type { Topic } from "../src/core/types.js";
const topic: Topic = {
  slug: "auto-research",
  name: "Auto Research",
  keyword: "auto research",
  query: "topic:autoresearch",
  description: "AI automated research and AI research assistants",
  color: "#fff",
  aliases: [],
  plan: {
    input: "auto research",
    model: "test",
    version: "17",
    intent: "AI automated research and AI research assistants",
    trends: ["auto research"],
    githubTopics: ["autoresearch"],
    githubTerms: [],
    explanation: { en: "AI research", zh: "AI 研究" },
    webQueries: [
      { query: "automated research platform pricing", intent: "competition" },
      {
        query: "automated literature review user challenges",
        intent: "demand",
      },
      { query: "auto research open source", intent: "opensource" },
    ],
  },
};
const web = (): WebEvidence => ({
  provider: "multi-search",
  version: "5",
  region: "US",
  language: "en",
  fetchedAt: "2026-09-20",
  state: "ready",
  queries: [
    {
      query: "auto research ai",
      intent: "competition",
      state: "ready",
      results: [
        {
          title: "Research that goes deeper",
          url: "https://claude.ai/",
          excerpt:
            "Claude helps you research faster. Search the web, analyze data, and synthesize findings.",
          kind: "ad",
        },
        {
          title: "Automated Pricing Research",
          url: "https://quantilope.com/pricing",
          excerpt: "Automated pricing research for market researchers.",
          kind: "organic",
        },
        {
          title: "Top AI Research Tools",
          url: "https://guide.example/research",
          excerpt: "A comparison of AI research assistants.",
          kind: "organic",
        },
        {
          title: "AI Research Assistant",
          url: "https://product.example/research",
          excerpt:
            "Search the web and synthesize sources with an AI research assistant.",
          kind: "organic",
        },
        {
          title: "Pricing and Plans",
          url: "https://maze.co/pricing",
          excerpt: "Pricing and Plans for your team.",
          kind: "organic",
        },
      ],
    },
  ],
});
test("web expansions preserve the object, synonyms and explicit constraints", () => {
  const queries = scopedWebQueries(topic);
  assert.equal(queries[0]!.query, "auto research alternatives pricing");
  assert.equal(queries[1]!.query, "auto research user problems reviews");
  const broadened = structuredClone(topic);
  broadened.plan!.trends = ["automated research"];
  assert.equal(
    scopedWebQueries(broadened)[0]!.query,
    "auto research alternatives pricing",
  );
  const ai = structuredClone(topic);
  ai.plan!.input = "auto research ai";
  ai.plan!.webQueries![0]!.query = "auto research pricing";
  assert.match(scopedWebQueries(ai)[0]!.query, /auto research ai/);
  ai.plan!.webQueries![0]!.query = "auto research ai alternatives";
  assert.equal(scopedWebQueries(ai)[0]!.query, "auto research ai alternatives");
  const cat = {
    ...topic,
    keyword: "cat translator",
    plan: {
      ...topic.plan!,
      input: "小猫语言翻译器",
      trends: ["cat translator", "meow translator"],
      webQueries: [
        { query: "meow translator pricing", intent: "competition" as const },
      ],
    },
  };
  assert.equal(scopedWebQueries(cat)[0]!.query, "meow translator pricing");
  const hosted = {
    ...topic,
    plan: {
      ...topic.plan!,
      input: "self hosted AI research",
      trends: ["AI research"],
      webQueries: [
        { query: "AI research pricing", intent: "competition" as const },
      ],
    },
  };
  assert.match(scopedWebQueries(hosted)[0]!.query, /self hosted AI research/);
});
test("topic-reviewed sources gate competitors and model context while preserving ad provenance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-web-fit-")),
    store = new Store(dir),
    old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test";
  try {
    const r = new Research(store);
    let calls = 0;
    r.json = async (_prompt, input, _limit, operation, thinking) => {
      calls++;
      assert.equal(operation, "web-relevance");
      assert.equal(thinking, false);
      assert.equal((input as any).scope.input, "auto research");
      return {
        results: [
          {
            id: "0:0",
            role: "direct",
            quote: "Search the web, analyze data, and synthesize findings.",
          },
          {
            id: "0:1",
            role: "unrelated",
            quote: "Automated pricing research for market researchers.",
          },
          {
            id: "0:2",
            role: "resource",
            quote: "A comparison of AI research assistants.",
          },
          {
            id: "0:3",
            role: "direct",
            quote: "Search the web and synthesize sources",
          },
          {
            id: "0:4",
            role: "unclear",
            quote: "Pricing and Plans for your team.",
          },
        ],
      };
    };
    const input = web(),
      before = JSON.stringify(input),
      reviewed = await r.reviewWeb(topic, input);
    assert.equal(JSON.stringify(input), before);
    assert.equal(reviewed.review!.status, "complete");
    assert.deepEqual(
      competitorDiscovery(reviewed).map((x) => x.url),
      ["https://product.example/research"],
    );
    const sources = searchSources(reviewed);
    assert.equal(sources.length, 3);
    assert.equal(
      sources.find((s) => s.url === "https://claude.ai/")?.placement,
      "ad",
    );
    assert.equal(
      sources.find((s) => s.url === "https://product.example/research")
        ?.placement,
      "organic",
    );
    assert.ok(sources.every((s) => !/quantilope|maze\.co/.test(s.url)));
    assert.equal(
      competitorDiscovery(input).length,
      0,
      "historical unreviewed results stay in sources only",
    );
    await r.reviewWeb(topic, input);
    assert.equal(calls, 1);
    // The same page can be relevant to a different user job: reviews are scoped.
    r.json = async () => {
      calls++;
      return {
        results: [
          {
            id: "0:1",
            role: "direct",
            quote: "Automated pricing research for market researchers.",
          },
        ],
      };
    };
    const pricing = await r.reviewWeb(
      {
        ...topic,
        description: "Pricing research",
        keyword: "pricing research",
        plan: undefined,
      },
      input,
    );
    assert.equal(calls, 2);
    assert.deepEqual(
      competitorDiscovery(pricing).map((x) => x.url),
      ["https://quantilope.com/pricing"],
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});
test("failed, forged, duplicate and missing reviews stay out of promoted results", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-web-review-")),
    store = new Store(dir),
    old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test";
  try {
    const r = new Research(store);
    r.json = async () => ({
      results: [
        { id: "0:0", role: "direct", quote: "invented quotation" },
        { id: "0:1", role: "direct", quote: "Automated pricing research" },
        { id: "0:1", role: "unrelated", quote: "Automated pricing research" },
        {
          id: "0:2",
          role: "invalid",
          quote: "A comparison of AI research assistants.",
        },
        { id: "99:1", role: "direct", quote: "foreign source" },
      ],
    });
    let reviewed = await r.reviewWeb(topic, web());
    assert.equal(reviewed.review!.status, "failed");
    assert.equal(searchSources(reviewed).length, 0);
    r.json = async () => {
      throw Error("transport");
    };
    reviewed = await r.reviewWeb(topic, web());
    assert.equal(competitorDiscovery(reviewed).length, 0);
    assert.equal(
      reviewed.queries[0]!.results.length,
      5,
      "raw evidence survives a review failure",
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});

test("autoresearch spellings use the same AI scope and retain the exact buyer search", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ghtrends-auto-scope-")),
    store = new Store(dir),
    old = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test";
  try {
    const research = new Research(store);
    research.json = async () => {
      throw Error("curated scopes use zero model calls");
    };
    for (const input of ["autoresearch", "auto research", "auto research ai"]) {
      const planned = await research.plan(input);
      assert.equal(planned.plan!.input, input);
      assert.match(planned.plan!.intent, /AI automated research/);
      assert.equal(planned.keyword, "autoresearch");
      assert.equal(scopedWebQueries(planned)[0]!.query, "auto research ai");
      assert.ok(
        scopedWebQueries(planned).every(
          (q) => !/market research|pricing research/.test(q.query),
        ),
      );
    }
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
    if (old === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = old;
  }
});
