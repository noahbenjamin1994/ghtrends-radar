import { discoveryQueries, hackerNewsQuery, collectHackerNews, capDiscoveryResults } from "./public-sources.js";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { z } from "zod";
import type { Store } from "../core/store.js";
import type { ResearchSource, Topic } from "../core/types.js";
import type { ProviderCall } from "../core/operations.js";

export const searchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[^<>\x00-\x1f]+$/),
  intent: z.enum(["competition", "demand", "opensource"]),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export const SEARCH_VERSION = "6";
export type SearchEngine = "google" | "duckduckgo" | "hackernews";
interface SearchPage {
  results: SearchResult[];
  fetchedAt: string;
  engine: SearchEngine;
  region?: string;
  adCoverage: "visible-placements" | "limited" | "organic-only";
  fallbackReason?: string;
}
export interface SearchResult {
  title: string;
  url: string;
  excerpt: string;
  kind: "organic" | "ad";
  relevance?: {
    role: "direct" | "resource" | "adjacent" | "unrelated" | "unclear";
    quote: string;
  };
}
export interface WebEvidence {
  provider: "decodo-google" | "google-mobile" | "multi-search";
  version?: string;
  adCoverage?: "visible-placements";
  region: string;
  language: string;
  fetchedAt: string;
  state: "ready" | "partial" | "failed" | "pending" | "setup";
  review?: {
    version: string;
    model: string;
    reviewed: number;
    status: "complete" | "partial" | "failed";
  };
  queries: (SearchQuery & {
    state: "ready" | "failed" | "pending";
    error?: string;
    retryAt?: string;
    fetchedAt?: string;
    engine?: SearchEngine;
    region?: string;
    adCoverage?: SearchPage["adCoverage"];
    fallbackReason?: string;
    results: SearchResult[];
  })[];
}

/** Keep query expansions anchored to the user's object and its genuine synonyms.
 * Search operators and purchasing intent are discovery details, not a new scope. */
export function scopedWebQueries(topic: Topic): SearchQuery[] {
  const input = topic.plan?.input || topic.keyword;
  const base = topic.plan?.model === "curated" ? topic.keyword : input;
  const zh = /[\u3400-\u9fff]/.test(base);
  const normalize = (s: string) =>
    s
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  // English expansions keep the literal object. Curated aliases and translated
  // inputs may use their published/canonical spelling.
  const anchors = (
    topic.plan?.model === "curated" || /[\u3400-\u9fff]/.test(input)
      ? [input, ...(topic.plan?.trends || [topic.keyword])]
      : [input]
  ).map(normalize);
  const qualifiers = [
    [/\bai\b|人工智能/i, /\bai\b|artificial intelligence|人工智能/i],
    [/self[ -]hosted|自托管/i, /self[ -]hosted|自托管/i],
    [/\boffline\b|离线/i, /\boffline\b|离线/i],
  ];
  const suffixes = {
    competition: zh ? "替代产品 价格" : "alternatives pricing",
    demand: zh ? "使用体验 求助" : "user problems reviews",
    opensource: "open source",
  };
  const intents: SearchQuery["intent"][] = topic.plan?.webQueries?.length
    ? [...new Set(topic.plan.webQueries.map((q) => q.intent))]
    : ["competition", "demand", "opensource"];
  return intents.map((intent) => {
    const candidate = topic.plan?.webQueries?.find((q) => q.intent === intent);
    if (
      candidate &&
      searchQuerySchema.safeParse(candidate).success &&
      anchors.some((a) => a && normalize(candidate.query).includes(a)) &&
      qualifiers.every(
        ([trigger, required]) =>
          !trigger!.test(input) || required!.test(candidate.query),
      )
    )
      return candidate;
    const fallback = qualifiers.every(
      ([trigger, required]) => !trigger!.test(input) || required!.test(base),
    )
      ? base
      : input;
    return { intent, query: `${fallback.slice(0, 120)} ${suffixes[intent]}` };
  });
}

// Parse only the result rows in the lightweight page. A challenge, a new layout,
// or a tracking/ad link is never evidence of an empty market or an organic hit.
export function parseDuckDuckGoPage(html: string): SearchResult[] {
  if (html.length > 1_000_000) throw new Error("search_size");
  const $ = load(html);
  $("script,style,noscript").remove();
  const text = $("body").text();
  if (
    $("#challenge-form,form[action*='anomaly.js']").length ||
    /bots use DuckDuckGo|complete the following challenge/i.test(text)
  )
    throw new Error("search_challenge");
  const output: SearchResult[] = [],
    seen = new Set<string>();
  $("a.result-link").each((_, node) => {
    const heading = $(node),
      title = heading.text().replace(/\s+/g, " ").trim();
    let target: URL;
    try {
      target = new URL(
        heading.attr("href") || "",
        "https://lite.duckduckgo.com",
      );
      if (/(^|\.)duckduckgo\.com$/.test(target.hostname)) {
        if (target.pathname !== "/l/" || target.searchParams.has("ad_domain"))
          return;
        target = new URL(target.searchParams.get("uddg") || "");
      }
    } catch {
      return;
    }
    if (/(^|\.)(duckduckgo\.com|bing\.com)$/.test(target.hostname)) return;
    const url = publicSearchUrl(target.href);
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    const rows = heading.closest("tr").nextUntil("tr:has(a.result-link)");
    output.push({
      title: title.slice(0, 240),
      url,
      kind: "organic",
      excerpt: rows
        .find(".result-snippet")
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200),
    });
  });
  if (
    !output.length &&
    !(
      /No results found|No more results|没有找到结果/i.test(text) &&
      $("form input[name=q]").length
    )
  )
    throw new Error("search_format");
  return output.slice(0, 10);
}
const searchFailure = (error: unknown, retryAt?: string) =>
  Object.assign(
    new Error(
      error instanceof Error && /^search_[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "search_transport",
    ),
    { retryAt },
  );
// Links are rendered, never fetched by this provider. Reject dangerous schemes,
// credentials and local destinations before they reach reports or model sources.
export function publicSearchUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 2000) return;
  try {
    const u = new URL(raw);
    if (
      !/^https?:$/.test(u.protocol) ||
      u.username ||
      u.password ||
      !u.hostname.includes(".") ||
      /^[\d.]+$/.test(u.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname) ||
      u.hostname.includes(":") ||
      (u.port && !["80", "443"].includes(u.port))
    )
      return;
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (/^(?:utm_|gclid$|fbclid$|srsltid$|msclkid$)/i.test(k))
        u.searchParams.delete(k);
    return u.href;
  } catch {
    return;
  }
}
export function parseSearchResults(raw: any): SearchResult[] {
  const wrapper = raw?.results?.[0];
  if (wrapper?.status_code && wrapper.status_code !== 200)
    throw new Error("search_response");
  const content = wrapper?.content;
  const parsed =
    typeof content === "object"
      ? content?.results?.results || content?.results || content
      : undefined;
  if (
    !parsed ||
    (!Array.isArray(parsed.organic) && !Array.isArray(parsed.paid))
  )
    throw new Error("search_format");
  const output: SearchResult[] = [],
    seen = new Set<string>();
  for (const [kind, rows] of [
    ["organic", parsed.organic],
    ["ad", parsed.paid],
  ] as const) {
    for (const r of (Array.isArray(rows) ? rows : []).slice(0, 10)) {
      const url = publicSearchUrl(r.url);
      if (
        !url ||
        typeof r.title !== "string" ||
        !r.title.trim() ||
        seen.has(kind + url)
      )
        continue;
      seen.add(kind + url);
      output.push({
        title: r.title.trim().slice(0, 240),
        url,
        excerpt: typeof r.desc === "string" ? r.desc.slice(0, 1200) : "",
        kind,
      });
    }
  }
  return output;
}
export function parseGooglePage(html: string): SearchResult[] {
  if (html.length > 1_000_000) throw new Error("search_size");
  const $ = load(html);
  $("script,style,noscript").remove();
  const text = $("body").text();
  if (
    /unusual traffic|enable javascript|启用 JavaScript|异常流量/i.test(text) ||
    $("#captcha-form,form[action*='/sorry/']").length
  )
    throw new Error("search_challenge");
  const output: SearchResult[] = [],
    seen = new Set<string>();
  $("div.zMzFAb,[data-text-ad]").each((_, block) => {
    const card = $(block),
      modernAd = card.is("[data-text-ad]"),
      heading = modernAd
        ? card.find("a[href]").has('h3,[role="heading"]').first()
        : card.find("a.fuLhoc").has(".CVA68e").first();
    if (!heading.length) return;
    const title = heading
      .find(modernAd ? 'h3,[role="heading"]' : ".CVA68e")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const href = heading.attr("href");
    if (!href || !title) return;
    let target: URL;
    try {
      target = new URL(href, "https://www.google.com");
    } catch {
      return;
    }
    let ad = modernAd || card.find("[data-text-ad]").length > 0;
    card.find("span").each((_, node) => {
      if (
        /^(Sponsored(?: results)?|Ad|Ads|广告|贊助|赞助商广告)$/i.test(
          $(node).text().trim(),
        )
      )
        ad = true;
    });
    if (target.hostname === "www.google.com" && target.pathname === "/url") {
      try {
        target = new URL(
          target.searchParams.get("q") || target.searchParams.get("url") || "",
        );
      } catch {
        return;
      }
    } else if (
      /^(www\.)?(google\.com|googleadservices\.com)$/.test(target.hostname) &&
      /aclk/.test(target.pathname)
    ) {
      ad = true;
      try {
        target = new URL(target.searchParams.get("adurl") || "");
      } catch {
        return;
      }
    }
    if (/(^|\.)(google\.com|googleadservices\.com)$/.test(target.hostname))
      return;
    const url = publicSearchUrl(target.href),
      kind = ad ? "ad" : "organic";
    if (!url || seen.has(kind + url)) return;
    seen.add(kind + url);
    output.push({
      title: title.slice(0, 240),
      url,
      kind,
      excerpt: card
        .find(modernAd ? ".p4wth" : ".taTFJ .FrIlee")
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200),
    });
  });
  if (
    !output.length &&
    !(
      /did not match any documents|No results found|没有找到|找不到和您查询/i.test(
        text,
      ) && $("form input[name=q]").length
    )
  )
    throw new Error("search_format");
  return [
    ...output.filter((r) => r.kind === "organic").slice(0, 10),
    ...output.filter((r) => r.kind === "ad").slice(0, 4),
  ];
}

type DirectResponse = {
  status?: number;
  bytes?: number;
  html?: string;
  cookies?: Record<string, string>;
  error?: string;
  region?: string;
};
export type SearchTransport = (input: {
  engine: SearchEngine;
  query: string;
  region: string;
  language: string;
  proxy: string;
  cookies: Record<string, string>;
  timeoutMs?: number;
}) => Promise<DirectResponse>;
const directRequest: SearchTransport = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.env.GHTRENDS_SEARCH_PYTHON || "python3",
      [
        fileURLToPath(
          new URL("../../scripts/google-search.py", import.meta.url),
        ),
      ],
      {
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          PATH: process.env.PATH || "/usr/bin:/bin",
          ...(process.env.PYTHONPATH
            ? { PYTHONPATH: process.env.PYTHONPATH }
            : {}),
        },
      },
    );
    let body = "",
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("search_transport"));
        }
      }
    };
    const timer = setTimeout(
      () => finish(new Error("search_timeout")),
      (input.timeoutMs || 18000) + 1000,
    );
    child.once("error", () => finish(new Error("search_runtime")));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) finish(new Error("search_size"));
    });
    child.once("close", (code) =>
      finish(code ? new Error("search_transport") : undefined),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
  });
// A mobile search is one stateless request. On Decodo's rotating gateway, keep
// country targeting and release the Trends-specific sticky session parameters.
// Other proxy providers retain their configured URL verbatim.
export function searchProxy(raw: string): string {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("search_proxy");
  if (url.hostname === "gate.decodo.com" && url.port === "7000")
    url.username = decodeURIComponent(url.username)
      .replace(/-sessionduration-\d+/gi, "")
      .replace(/-session-[a-z0-9]+/gi, "");
  return url.href;
}
export function searchSources(web?: WebEvidence): ResearchSource[] {
  const groups = (
    web?.queries.map((q, i) => {
      // A single brand's help pages otherwise occupy the entire model budget.
      // Keep independent websites first; GitHub repositories remain distinct.
      const usable = q.results.filter(
        (r) =>
          !web?.review ||
          r.relevance?.role === "direct" ||
          r.relevance?.role === "resource",
      );
      const organic = usable.filter((r) => r.kind === "organic");
      const selected: SearchResult[] = [],
        sites: string[] = [];
      for (const r of organic) {
        const url = new URL(r.url);
        const host = url.hostname.replace(/^(www|m)\./, "");
        const site =
          host === "github.com"
            ? host + url.pathname.split("/").slice(0, 3).join("/")
            : host;
        if (
          sites.some(
            (s) =>
              site === s || site.endsWith("." + s) || s.endsWith("." + site),
          )
        )
          continue;
        sites.push(site);
        selected.push(r);
        if (selected.length === 4) break;
      }
      for (const r of organic) {
        if (selected.length === 4) break;
        if (!selected.includes(r)) selected.push(r);
      }
      // Pricing pages often rank below news. Preserve a small extra budget for
      // the evidence editor to compare real offers and validate their scope.
      if (q.intent === "competition")
        for (const r of organic) {
          if (selected.length >= 6) break;
          if (
            !selected.includes(r) &&
            /pricing|\bplans\b|价格|报价/i.test(
              r.title + " " + new URL(r.url).pathname,
            )
          )
            selected.push(r);
        }
      selected.push(...usable.filter((r) => r.kind === "ad").slice(0, 2));
      return selected.map((r, j) => ({
        id: `W${i + 1}R${j + 1}`,
        kind: "search" as const,
        label: r.title,
        url: r.url,
        fetchedAt: q.fetchedAt || web!.fetchedAt,
        searchIntent: q.intent,
        ...(r.relevance?.role === "direct" || r.relevance?.role === "resource"
          ? { searchRole: r.relevance.role } : {}),
        placement: r.kind,
        excerpt: `${q.engine === "hackernews" ? "Hacker News / Algolia" : q.engine === "duckduckgo" ? "DuckDuckGo" : "Google"} search excerpt. Query: ${q.query}. Search market: ${q.region || web!.region}. Language: ${web!.language}. Placement: ${r.kind}. Title: ${r.title}. Snippet: ${r.excerpt}`,
      }));
    }) || []
  );
  const output: ResearchSource[] = [], seen = new Set<string>();
  for (let row = 0; row < 8 && output.length < 16; row++) {
    for (const group of groups) {
      const source = group[row];
      if (!source || seen.has(source.url) || output.length === 16) continue;
      seen.add(source.url); output.push(source);
    }
  }
  return output;
}
export class GoogleSearch {
  private queue = Promise.resolve();
  private lastRequest = 0;
  private pending = new Map<string, Promise<SearchPage>>();
  constructor(
    private store: Store,
    private transport: SearchTransport = directRequest,
  ) {}
  get mode(): "direct" | "api" | "off" {
    const mode = process.env.GHTRENDS_SEARCH_MODE;
    return mode === "off"
      ? "off"
      : mode === "api" ||
          (!mode &&
            process.env.DECODO_SCRAPER_TOKEN &&
            !(
              process.env.GOOGLE_SEARCH_PROXY || process.env.GOOGLE_TRENDS_PROXY
            ))
        ? "api"
        : "direct";
  }
  get enabled() {
    return this.mode === "api"
      ? !!process.env.DECODO_SCRAPER_TOKEN
      : this.mode === "direct" &&
          !!(
            process.env.GOOGLE_SEARCH_PROXY || process.env.GOOGLE_TRENDS_PROXY
          );
  }
  status() {
    return {
      configured: this.enabled,
      provider: this.mode === "api" ? "decodo-google" : "multi-search",
      version: SEARCH_VERSION,
      engines: this.mode === "api" ? ["google"] : ["google", "duckduckgo"],
      mode: this.mode,
      maxQueries: 3,
      publicDiscovery: process.env.GHTRENDS_PUBLIC_SOURCES === "1",
      maxHackerNewsQueries: process.env.GHTRENDS_PUBLIC_SOURCES === "1" ? 1 : 0,
      publicSourceDeadlineMs: 6000,
      cacheHours: 6,
      fallbackCacheMinutes: 30,
      primaryAttempts: this.mode === "api" ? 1 : 2,
      directQueryBudgetMs: 45000,
      adCoverage: this.mode === "api" ? "visible-placements" : "limited",
    };
  }
  async collect(topic: Topic, geo: string): Promise<WebEvidence> {
    const language = /[\u3400-\u9fff]/.test(topic.plan?.input || topic.name)
      ? "zh-CN"
      : "en";
    const region = geo || "US";
    const discovery = process.env.GHTRENDS_PUBLIC_SOURCES === "1";
    const scoped = scopedWebQueries(topic);
    const planned = discovery ? discoveryQueries(topic, scoped) : scoped;
    const queries = [
      ...new Map(
        planned.flatMap((q) => {
          const p = searchQuerySchema.safeParse(q);
          return p.success
            ? [[p.data.query.toLowerCase(), p.data] as const]
            : [];
        }),
      ).values(),
    ].slice(0, 3);
    const web: WebEvidence = {
      provider: this.mode === "api" ? "decodo-google" : "multi-search",
      version: SEARCH_VERSION,
      region,
      language,
      fetchedAt: new Date().toISOString(),
      state: "setup",
      queries: [],
    };
    if (!this.enabled) return web;
    const hnQuery = discovery ? hackerNewsQuery(topic) : undefined;
    const [results, hn] = await Promise.all([
      Promise.allSettled(queries.map((q) => this.search(q.query, region, language))),
      hnQuery ? collectHackerNews(this.store, hnQuery) : undefined,
    ]);
    web.queries = queries.map((q, i) => {
      const result = results[i]!;
      if (result.status === "fulfilled")
        return { ...q, state: "ready", ...result.value };
      const failure = searchFailure(result.reason, result.reason?.retryAt);
      return {
        ...q,
        state: "failed",
        results: [],
        error: failure.message,
        retryAt: failure.retryAt,
      };
    });
    if (hn) web.queries.push(hn);
    if (discovery) capDiscoveryResults(web);
    const count = web.queries.filter((q) => q.state === "ready").length;
    web.state =
      count === web.queries.length && count > 0
        ? "ready"
        : count
          ? "partial"
          : "failed";
    return web;
  }
  private search(
    query: string,
    region: string,
    language: string,
  ): Promise<SearchPage> {
    const identity = createHash("sha256")
      .update(
        this.mode === "api"
          ? process.env.DECODO_SCRAPER_TOKEN || ""
          : JSON.stringify([
              process.env.GOOGLE_SEARCH_PROXY ||
                process.env.GOOGLE_TRENDS_PROXY ||
                "",
              process.env.GOOGLE_SEARCH_PROXY_FALLBACK ||
                process.env.GOOGLE_TRENDS_PROXY_FALLBACK ||
                "",
            ]),
      )
      .digest("hex")
      .slice(0, 12);
    const key =
      `web-search:v${SEARCH_VERSION}:` +
      createHash("sha256")
        .update(JSON.stringify([query, region, language, identity]))
        .digest("hex");
    const cached = this.store.get<SearchPage>(key);
    if (cached) {
      this.store.recordCall({
        provider: "search",
        operation: `${cached.engine}-serp`,
        cached: true,
        costUsd: 0,
        durationMs: 0,
        started: new Date().toISOString(),
      });
      return Promise.resolve(cached);
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.queue.then(async () => {
      if (this.mode === "direct") {
        const wait = 1500 - (Date.now() - this.lastRequest);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        try {
          const page = await this.direct(query, region, language);
          // Give the primary source another chance after a short fallback cache.
          this.store.set(
            key,
            page,
            page.engine === "google" ? 6 * 3600000 : 30 * 60000,
          );
          return page;
        } finally {
          this.lastRequest = Date.now();
        }
      }
      const cooling = this.store.get<{ error: string; retryAt: string }>(
        "google-search:cooldown:" + identity,
      );
      if (cooling)
        throw searchFailure(
          new Error(cooling.error || "search_cooldown"),
          cooling.retryAt,
        );
      const started = Date.now();
      const call: ProviderCall = {
        provider: "search",
        operation: "google-serp",
        started: new Date(started).toISOString(),
        durationMs: 0,
      };
      try {
        const token = process.env.DECODO_SCRAPER_TOKEN!.replace(
          /^Basic\s+/i,
          "",
        );
        const response = await fetch(
          "https://scraper-api.decodo.com/v2/scrape",
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              target: "google_search",
              query,
              parse: true,
              headless: "html",
              geo: region,
              locale: language === "zh-CN" ? "zh-cn" : "en-us",
              page_count: 1,
            }),
            signal: AbortSignal.timeout(35000),
            redirect: "error",
          },
        );
        call.status = response.status;
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`search_http_${response.status}`);
        }
        // Bound provider data before parsing. API transfer is separate from residential plan billing.
        const reader = response.body?.getReader();
        if (!reader) throw new Error("search_body");
        let size = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          size += r.value.length;
          if (size > 2_000_000) {
            await reader.cancel();
            throw new Error("search_size");
          }
          chunks.push(r.value);
        }
        const result = parseSearchResults(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        const page: SearchPage = {
          results: result,
          fetchedAt: new Date().toISOString(),
          engine: "google",
          adCoverage: "visible-placements",
        };
        this.store.set(key, page, 6 * 3600000);
        return page;
      } catch (e) {
        call.error =
          e instanceof Error && /^search_[a-z0-9_]+$/.test(e.message)
            ? e.message
            : "search_transport";
        const delay =
          call.status === 401 || call.status === 403 ? 5 * 60000 : 60000;
        const retryAt = new Date(Date.now() + delay).toISOString();
        this.store.set(
          "google-search:cooldown:" + identity,
          { error: call.error, retryAt },
          delay,
        );
        throw searchFailure(new Error(call.error), retryAt);
      } finally {
        call.durationMs = Date.now() - started;
        this.store.recordCall(call);
      }
    });
    this.queue = task.then(
      () => {},
      () => {},
    );
    this.pending.set(key, task);
    void task.finally(() => this.pending.delete(key)).catch(() => {});
    return task;
  }
  private async direct(
    query: string,
    region: string,
    language: string,
  ): Promise<SearchPage> {
    const routes = [
      process.env.GOOGLE_SEARCH_PROXY || process.env.GOOGLE_TRENDS_PROXY,
      process.env.GOOGLE_SEARCH_PROXY_FALLBACK ||
        process.env.GOOGLE_TRENDS_PROXY_FALLBACK,
    ]
      .filter((p): p is string => !!p)
      .map(searchProxy)
      .filter((p, i, a) => a.indexOf(p) === i);
    const first = routes[0];
    if (!first) throw new Error("search_proxy");
    // Give Google one fresh-exit retry, retaining the rotating pool's country.
    // Then use an independent index, with its own bounded retry/cooldown.
    const rotating =
      new URL(first).hostname === "gate.decodo.com" &&
      new URL(first).port === "7000";
    const candidates = [{ proxy: first, route: 0 }];
    if (rotating || routes[1])
      candidates.push({
        proxy: rotating ? first : routes[1]!,
        route: rotating ? 0 : 1,
      });
    const attempts = (["google", "duckduckgo"] as const).flatMap((engine) =>
      candidates.map((candidate) => ({ engine, ...candidate })),
    );
    // A separate configured route can recover a primary proxy-account error.
    if (rotating && routes[1]) {
      attempts[1] = { engine: "google", proxy: routes[1], route: 1 };
      attempts[3] = { engine: "duckduckgo", proxy: routes[1], route: 1 };
    }
    const deadline = Date.now() + 45000;
    let failure = searchFailure(new Error("search_cooldown")),
      primaryError: string | undefined;
    const exhausted = new Map<
      string,
      { error: string; retryAt: string; delay: number }
    >();
    for (const [attempt, { engine, proxy, route }] of attempts.entries()) {
      const identity = createHash("sha256")
          .update(proxy)
          .digest("hex")
          .slice(0, 24),
        cooldown = `web-search:cooldown:${engine}:${identity}`;
      const cooling = this.store.get<{ error: string; retryAt: string }>(
        cooldown,
      );
      if (cooling) {
        failure = searchFailure(new Error(cooling.error), cooling.retryAt);
        if (engine === "google") primaryError = failure.message;
        continue;
      }
      if (attempt) await new Promise((r) => setTimeout(r, 750));
      const timeoutMs = Math.min(18000, deadline - Date.now());
      if (timeoutMs < 1000) break;
      const started = Date.now(),
        call: ProviderCall = {
          provider: "search",
          operation: `${engine}-serp`,
          started: new Date(started).toISOString(),
          durationMs: 0,
          proxyRoute: route === 0 ? "primary" : "backup",
        };
      try {
        const raw = await this.transport({
          engine,
          query,
          region,
          language,
          proxy,
          cookies: engine === "google" ? { CONSENT: "YES+" } : {},
          timeoutMs,
        });
        call.status = raw.status;
        if (Number.isSafeInteger(raw.bytes) && raw.bytes! >= 0)
          call.transferBytes = raw.bytes;
        if (raw.error) throw new Error("search_transport");
        if (raw.status !== 200)
          throw new Error(
            [202, 302, 303].includes(raw.status || 0)
              ? "search_challenge"
              : `search_http_${raw.status}`,
          );
        if (typeof raw.html !== "string") throw new Error("search_format");
        const results =
          engine === "google"
            ? parseGooglePage(raw.html)
            : parseDuckDuckGoPage(raw.html);
        // Clear transient failures for a route that subsequently succeeded.
        exhausted.delete(cooldown);
        for (const [key, value] of exhausted)
          this.store.set(key, value, value.delay);
        return {
          results,
          engine,
          region:
            raw.region && /^(?:[A-Z]{2}|GLOBAL)$/.test(raw.region)
              ? raw.region
              : region,
          fetchedAt: new Date().toISOString(),
          adCoverage: engine === "google" ? "limited" : "organic-only",
          ...(engine === "duckduckgo" ? { fallbackReason: primaryError } : {}),
        };
      } catch (e) {
        call.error = searchFailure(e).message;
        if (engine === "google") primaryError = call.error;
        const delay =
          call.error === "search_challenge" || call.status === 429
            ? 5 * 60000
            : 60000;
        const retryAt = new Date(Date.now() + delay).toISOString();
        failure = searchFailure(new Error(call.error), retryAt);
        exhausted.set(cooldown, { error: call.error, retryAt, delay });
        if (call.error === "search_runtime") break;
        // An account/proxy error affects every engine on this route. Try a
        // separately configured route, while pausing this one across engines.
        if ([401, 402, 407].includes(call.status || 0)) {
          for (const affected of ["google", "duckduckgo"])
            this.store.set(
              `web-search:cooldown:${affected}:${identity}`,
              { error: call.error, retryAt },
              delay,
            );
        }
      } finally {
        call.durationMs = Date.now() - started;
        this.store.recordCall(call);
        // Persist after this query's retry budget, so a transient failure never
        // suppresses its own fresh-exit retry. Later queries share the cooldown.
      }
    }
    for (const [key, value] of exhausted)
      this.store.set(key, value, value.delay);
    throw failure;
  }
}
