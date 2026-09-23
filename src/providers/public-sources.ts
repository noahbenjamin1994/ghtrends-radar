import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { Topic } from "../core/types.js";
import type { Store } from "../core/store.js";
import type { SearchQuery, WebEvidence } from "./search.js";

export type DiscoveryProfile = "software" | "goods" | "general";
export function discoveryProfile(topic: Topic): DiscoveryProfile {
  const input = topic.plan?.input || topic.keyword;
  // Preserve explicit software jobs even when the surrounding industry sells goods.
  if (
    /\b(?:api|saas|software|sdk|rag|mcp|agent|llm|database|developer|firmware)\b|软件|开发工具|智能体|数据库|代码|编程|固件/i.test(
      input,
    )
  )
    return "software";
  const context = [
    input,
    topic.description,
    topic.plan?.intent,
    topic.plan?.explanation?.en,
    topic.plan?.explanation?.zh,
  ]
    .filter(Boolean)
    .join(" ");
  if (
    /\b(?:merchandise|collectibles?|toys?|apparel|jewelry|furniture|headphones?|keyboards?|skincare|cosmetics?|handmade|physical goods)\b|周边|玩具|手办|集换卡|服装|珠宝|家具|耳机|键盘|护肤|化妆品|实物商品/i.test(
      context,
    )
  )
    return "goods";
  return topic.plan?.model === "curated" ||
    /\b(?:software|saas|open.source|developer|coding)\b|开源软件|开发者/i.test(
      context,
    )
    ? "software"
    : "general";
}

/** Reallocate existing searches instead of adding serial SERP requests. */
export function discoveryQueries(
  topic: Topic,
  original: SearchQuery[],
): SearchQuery[] {
  // Focused research already plans separate official, buyer, community and
  // open-source searches. Preserve that deliberate mix instead of collapsing
  // both demand queries into the same discovery query.
  if (topic.plan?.version?.startsWith("deep-")) return original;
  const profile = discoveryProfile(topic);
  const base = (
    topic.plan?.model === "curated"
      ? topic.keyword
      : topic.plan?.input || topic.keyword
  )
    .replace(/[<>\x00-\x1f]/g, " ")
    .trim()
    .slice(0, 70);
  return original.map((q) => {
    if (q.intent === "demand")
      return {
        ...q,
        query: `${base} (site:reddit.com OR site:news.ycombinator.com OR site:trustpilot.com)`,
      };
    if (q.intent === "opensource" && profile === "goods")
      return {
        intent: "competition",
        query: `${base} (site:amazon.com OR site:ebay.com OR site:etsy.com)`,
      };
    return q;
  });
}

export function hackerNewsQuery(topic: Topic): string | undefined {
  if (discoveryProfile(topic) !== "software") return;
  if (topic.plan?.version?.startsWith("deep-"))
    return topic.plan.githubTerms.join(" ").trim().slice(0, 100) || undefined;
  const q =
    topic.plan?.model === "curated"
      ? topic.keyword
      : topic.plan?.input || topic.keyword;
  // HN has little coverage of literal Chinese queries; use an existing planner alias.
  const value = /[\u3400-\u9fff]/.test(q)
    ? topic.plan?.trends.find((s) => !/[\u3400-\u9fff]/.test(s))
    : q;
  return value?.trim().slice(0, 100) || undefined;
}

type QueryEvidence = WebEvidence["queries"][number];
export async function collectHackerNews(
  store: Store,
  query: string,
  transport: typeof fetch = fetch,
): Promise<QueryEvidence> {
  const key =
    "hn-search:v1:" + createHash("sha256").update(query).digest("hex");
  const cached = store.get<QueryEvidence>(key);
  if (cached) {
    store.recordCall({
      provider: "search",
      operation: "hn-search",
      cached: true,
      costUsd: 0,
      durationMs: 0,
      started: new Date().toISOString(),
    });
    return cached;
  }
  const started = Date.now();
  let status: number | undefined,
    bytes = 0;
  const base = {
    query,
    intent: "demand" as const,
    engine: "hackernews" as const,
    adCoverage: "organic-only" as const,
    region: "GLOBAL",
    fetchedAt: new Date().toISOString(),
  };
  let result: QueryEvidence;
  try {
    const url = new URL("https://hn.algolia.com/api/v1/search");
    url.searchParams.set("query", query);
    url.searchParams.set("tags", "story");
    url.searchParams.set("hitsPerPage", "4");
    url.searchParams.set(
      "numericFilters",
      `created_at_i>${Math.floor(Date.now() / 1000) - 2 * 365 * 86400}`,
    );
    const response = await transport(url, {
      signal: AbortSignal.timeout(6000),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    status = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("http");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("body");
    const chunks: Uint8Array[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 256000) {
        await reader.cancel();
        throw new Error("size");
      }
      chunks.push(chunk.value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Array.isArray(data.hits)) throw new Error("format");
    const results = data.hits.slice(0, 4).flatMap((h: any) => {
      if (
        !/^\d{1,12}$/.test(String(h.objectID)) ||
        typeof h.title !== "string" ||
        h._tags?.includes("dead")
      )
        return [];
      const plain = (s: string) => load(s).text().replace(/\s+/g, " ").trim();
      const title = plain(h.title).slice(0, 200),
        excerpt = plain(
          typeof h.story_text === "string" ? h.story_text : "",
        ).slice(0, 650);
      return [
        {
          title,
          url: `https://news.ycombinator.com/item?id=${h.objectID}`,
          kind: "organic" as const,
          excerpt: `${excerpt || title} [HN search index; published ${typeof h.created_at === "string" ? h.created_at.slice(0, 10) : "date unavailable"}; discussion counts and votes are attention signals, not customer demand.]`,
        },
      ];
    });
    result = { ...base, state: "ready", results };
    store.set(key, result, 6 * 3600000);
  } catch {
    result = {
      ...base,
      state: "failed",
      results: [],
      error: "Hacker News search is temporarily unavailable.",
      retryAt: new Date(Date.now() + 60000).toISOString(),
    };
    store.set(key, result, 60000);
  }
  store.recordCall({
    provider: "search",
    operation: "hn-search",
    started: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    costUsd: 0,
    status,
    transferBytes: bytes,
    ...(result.state === "failed" ? { error: "hn_search_unavailable" } : {}),
  });
  return result;
}

/** Fair, deterministic cap before the existing relevance model. No new AI call. */
export function capDiscoveryResults(web: WebEvidence, limit = 30) {
  const kept = web.queries.map(() => [] as QueryEvidence["results"]);
  const seen = new Set<string>();
  let count = 0;
  for (let row = 0; row < 30 && count < limit; row++)
    for (let i = 0; i < web.queries.length && count < limit; i++) {
      const r = web.queries[i]!.results[row];
      if (!r) continue;
      let key: string;
      try {
        const u = new URL(r.url);
        u.hash = "";
        for (const k of [...u.searchParams.keys()])
          if (/^utm_|^(?:fbclid|gclid)$/i.test(k)) u.searchParams.delete(k);
        key = u.href;
      } catch {
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      kept[i]!.push(r);
      count++;
    }
  web.queries.forEach((q, i) => {
    q.results = kept[i]!;
  });
  return web;
}
