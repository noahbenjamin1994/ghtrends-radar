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
export interface SearchResult {
  title: string;
  url: string;
  excerpt: string;
  kind: "organic" | "ad";
}
export interface WebEvidence {
  provider: "decodo-google" | "google-mobile";
  adCoverage?: "visible-placements";
  region: string;
  language: string;
  fetchedAt: string;
  state: "ready" | "partial" | "failed" | "pending" | "setup";
  queries: (SearchQuery & {
    state: "ready" | "failed" | "pending";
    error?: string;
    retryAt?: string;
    fetchedAt?: string;
    results: SearchResult[];
  })[];
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
  $("div.zMzFAb").each((_, block) => {
    const card = $(block),
      heading = card.find("a.fuLhoc").has(".CVA68e").first();
    if (!heading.length) return;
    const title = heading
      .find(".CVA68e")
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
    let ad = card.find("[data-text-ad]").length > 0;
    card.find("span").each((_, node) => {
      if (
        /^(Sponsored|Ad|Ads|广告|贊助|赞助商广告)$/i.test($(node).text().trim())
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
        .find(".taTFJ .FrIlee")
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
};
export type SearchTransport = (input: {
  query: string;
  region: string;
  language: string;
  proxy: string;
  cookies: Record<string, string>;
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
    const timer = setTimeout(() => finish(new Error("search_timeout")), 30000);
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
  return (
    web?.queries.flatMap((q, i) => {
      // A single brand's help pages otherwise occupy the entire model budget.
      // Keep independent websites first; GitHub repositories remain distinct.
      const organic = q.results.filter((r) => r.kind === "organic");
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
      selected.push(...q.results.filter((r) => r.kind === "ad").slice(0, 2));
      return selected.map((r, j) => ({
        id: `W${i + 1}R${j + 1}`,
        kind: "search" as const,
        label: r.title,
        url: r.url,
        fetchedAt: q.fetchedAt || web!.fetchedAt,
        searchIntent: q.intent,
        placement: r.kind,
        excerpt: `Google search excerpt. Query: ${q.query}. Region: ${web!.region}. Language: ${web!.language}. Placement: ${r.kind}. Title: ${r.title}. Snippet: ${r.excerpt}`,
      }));
    }) || []
  );
}
export class GoogleSearch {
  private queue = Promise.resolve();
  private lastRequest = 0;
  private pending = new Map<
    string,
    Promise<{ results: SearchResult[]; fetchedAt: string }>
  >();
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
      provider: this.mode === "api" ? "decodo-google" : "google-mobile",
      mode: this.mode,
      maxQueries: 3,
      cacheHours: 6,
    };
  }
  async collect(topic: Topic, geo: string): Promise<WebEvidence> {
    const language = /[\u3400-\u9fff]/.test(topic.plan?.input || topic.name)
      ? "zh-CN"
      : "en";
    const region = geo || "US";
    // Curated categories already expand aliases (AI4S -> AI for Science).
    const base =
      topic.plan?.model === "curated"
        ? topic.keyword
        : topic.plan?.input || topic.keyword;
    const planned = topic.plan?.webQueries?.length
      ? topic.plan.webQueries
      : [
          {
            query: `${base} ${language === "en" ? "services pricing" : "服务 价格"}`,
            intent: "competition",
          },
          {
            query: `${base} ${language === "en" ? "user problems reviews" : "使用体验 求助"}`,
            intent: "demand",
          },
          { query: `${topic.keyword} open source tools`, intent: "opensource" },
        ];
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
      provider: this.mode === "api" ? "decodo-google" : "google-mobile",
      adCoverage: "visible-placements",
      region,
      language,
      fetchedAt: new Date().toISOString(),
      state: "setup",
      queries: [],
    };
    if (!this.enabled) return web;
    const results = await Promise.allSettled(
      queries.map((q) => this.search(q.query, region, language)),
    );
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
    const count = web.queries.filter((q) => q.state === "ready").length;
    web.state =
      count === queries.length && count > 0
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
  ): Promise<{ results: SearchResult[]; fetchedAt: string }> {
    const identity = createHash("sha256")
      .update(
        this.mode === "api"
          ? process.env.DECODO_SCRAPER_TOKEN || ""
          : (process.env.GOOGLE_SEARCH_PROXY ||
              process.env.GOOGLE_TRENDS_PROXY ||
              "") + "direct-v1",
      )
      .digest("hex")
      .slice(0, 12);
    const key =
      "google-search:v2:" +
      createHash("sha256")
        .update(JSON.stringify([query, region, language, identity]))
        .digest("hex");
    const cached = this.store.get<{
      results: SearchResult[];
      fetchedAt: string;
    }>(key);
    if (cached) {
      this.store.recordCall({
        provider: "search",
        operation: "google-serp",
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
          const results = await this.direct(query, region, language);
          const page = { results, fetchedAt: new Date().toISOString() };
          this.store.set(key, page, 6 * 3600000);
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
        const page = { results: result, fetchedAt: new Date().toISOString() };
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
  ): Promise<SearchResult[]> {
    const routes = [
      process.env.GOOGLE_SEARCH_PROXY || process.env.GOOGLE_TRENDS_PROXY,
      process.env.GOOGLE_SEARCH_PROXY_FALLBACK ||
        process.env.GOOGLE_TRENDS_PROXY_FALLBACK,
    ]
      .filter((p): p is string => !!p)
      .map(searchProxy)
      .filter((p, i, a) => a.indexOf(p) === i);
    // A rotating gateway assigns a fresh exit per request. Budget at most three
    // attempts, including the configured fallback; never retry a fixed exit.
    const attempts = routes.map((proxy, i) => ({ proxy, i }));
    const rotatingRoute = attempts.find(({ proxy }) => {
      const u = new URL(proxy);
      return u.hostname === "gate.decodo.com" && u.port === "7000";
    });
    while (rotatingRoute && attempts.length < 3) attempts.push(rotatingRoute);
    let failure = searchFailure(new Error("search_cooldown"));
    const exhausted = new Map<
      string,
      { error: string; retryAt: string; delay: number }
    >();
    for (const [attempt, { proxy, i }] of attempts.entries()) {
      const identity = createHash("sha256")
          .update(proxy)
          .digest("hex")
          .slice(0, 24),
        cooldown = "google-search:direct-cooldown:" + identity;
      const cooling = this.store.get<{ error: string; retryAt: string }>(
        cooldown,
      );
      if (cooling) {
        failure = searchFailure(
          new Error(cooling.error || "search_cooldown"),
          cooling.retryAt,
        );
        continue;
      }
      if (attempt) await new Promise((r) => setTimeout(r, 750));
      const started = Date.now(),
        call: ProviderCall = {
          provider: "search",
          operation: "google-serp",
          started: new Date(started).toISOString(),
          durationMs: 0,
          proxyRoute: i === 0 ? "primary" : "backup",
        };
      let rotating = false;
      try {
        const configured = new URL(proxy);
        rotating =
          configured.hostname === "gate.decodo.com" &&
          configured.port === "7000";
        const raw = await this.transport({
          query,
          region,
          language,
          proxy: searchProxy(proxy),
          cookies: { CONSENT: "YES+" },
        });
        call.status = raw.status;
        if (Number.isSafeInteger(raw.bytes) && raw.bytes! >= 0)
          call.transferBytes = raw.bytes;
        if (raw.error) throw new Error("search_transport");
        if (raw.status !== 200)
          throw new Error(
            raw.status === 302
              ? "search_challenge"
              : `search_http_${raw.status}`,
          );
        if (typeof raw.html !== "string") throw new Error("search_format");
        const results = parseGooglePage(raw.html);
        return results;
      } catch (e) {
        call.error =
          e instanceof Error && /^search_[a-z0-9_]+$/.test(e.message)
            ? e.message
            : "search_transport";
        const delay =
          (call.status === 429 || call.error === "search_challenge") &&
          !rotating
            ? 15 * 60000
            : 60000;
        const retryAt = new Date(Date.now() + delay).toISOString();
        failure = searchFailure(new Error(call.error), retryAt);
        exhausted.set(cooldown, { error: call.error, retryAt, delay });
        // Credentials/payment/runtime errors require configuration recovery.
        if (
          [401, 402, 407].includes(call.status || 0) ||
          call.error === "search_runtime"
        )
          break;
      } finally {
        call.durationMs = Date.now() - started;
        this.store.recordCall(call);
      }
    }
    for (const [key, value] of exhausted)
      this.store.set(key, value, value.delay);
    throw failure;
  }
}
