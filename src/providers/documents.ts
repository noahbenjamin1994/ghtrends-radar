import { evidenceExcerpt } from "../core/excerpts.js";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as wait } from "node:timers/promises";
import { PassThrough, Transform, Writable, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { Agent, request } from "undici";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import type { Store } from "../core/store.js";
import type { ProviderCall } from "../core/operations.js";
import type { ResearchSource } from "../core/types.js";
import { publicSearchUrl } from "./search.js";

// robots-parser is CommonJS; its default-export declaration differs under NodeNext.
const robotsParser = createRequire(import.meta.url)("robots-parser") as (
  url: string,
  text: string,
) => {
  isAllowed(url: string, agent: string): boolean | undefined;
  getCrawlDelay(agent: string): number | undefined;
};

export const DOCUMENT_VERSION = "4";
const agentName = "ghtrendsbot";
const agentHeader = "ghtrendsbot/1.0 (+https://ghtrends.dev/radar/)";
// Documentation shells can exceed 1 MB while their useful article is short.
// Keep a bounded download; only the existing 6,000-character excerpt is retained.
const MAX_BYTES = 2_000_000;
const blockedHosts =
  /(?:^|\.)(?:reddit\.com|redd\.it|twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|tiktok\.com)$/i;
export type DocumentStatus =
  "read" | "robots" | "access" | "unavailable" | "limit" | "format" | "deleted";
export interface DocumentRead {
  url: string;
  status: DocumentStatus;
  observedAt: string;
}
export interface DocumentEvidence {
  version: string;
  sources: ResearchSource[];
  reads: DocumentRead[];
}
export interface PageResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
}
export type DocumentTransport = (
  url: URL,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<PageResponse>;
const failure = (status: DocumentStatus) =>
  Object.assign(new Error(`document_${status}`), { documentStatus: status });
// Keep a finite set of transient network errors; access, DNS policy and format
// failures retain their original result. Raw exception text stays private.
const transientTransportCode = (error: any) => {
  const code = error?.code || error?.cause?.code;
  return /^(?:ECONNRESET|EPIPE|ETIMEDOUT|EAI_AGAIN|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/.test(
    code || "",
  )
    ? String(code)
    : undefined;
};
export const publicAddress = (address: string) => {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
};

export async function publicAddresses(
  hostname: string,
  signal: AbortSignal,
  resolver: (hostname: string) => Promise<LookupAddress[]> = (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
) {
  signal.throwIfAborted();
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => reject(failure("limit"));
    signal.addEventListener("abort", abort, { once: true });
    resolver(hostname)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw failure("access");
  signal.throwIfAborted();
  return addresses;
}

export async function documentBody(
  body: Readable,
  encoding: string,
  maxBytes: number,
  signal: AbortSignal,
) {
  const decoder =
    encoding === "gzip"
      ? createGunzip()
      : encoding === "br"
        ? createBrotliDecompress()
        : encoding === "deflate"
          ? createInflate()
          : !encoding || encoding === "identity"
            ? new PassThrough()
            : undefined;
  if (!decoder) {
    body.destroy();
    throw failure("format");
  }
  let bytes = 0,
    decodedBytes = 0;
  const chunks: Buffer[] = [];
  const transfer = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? failure("limit") : null, chunk);
    },
  });
  const output = new Writable({
    write(chunk, _encoding, callback) {
      decodedBytes += chunk.length;
      if (decodedBytes > maxBytes) return callback(failure("limit"));
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  // Bound both wire traffic and decoded content; cancellation closes every stream.
  await pipeline(body, transfer, decoder, output, { signal });
  return { body: Buffer.concat(chunks).toString("utf8"), bytes };
}

/** Resolve once and pin the connection to the checked public addresses. Cookies,
 * proxy credentials and provider keys never enter this transport. */
export const publicRequest: DocumentTransport = async (
  url,
  signal,
  maxBytes,
) => {
  if (!publicSearchUrl(url.href)) throw failure("access");
  const addresses = await publicAddresses(url.hostname, signal);
  const dispatcher = new Agent({
    connect: {
      lookup: (_host, options, callback) => {
        const values = addresses.filter(
          (a) => !options.family || a.family === options.family,
        );
        if (!values.length)
          return callback(new Error("document_address"), "", 4);
        if ((options as any).all) (callback as any)(null, values);
        else callback(null, values[0]!.address, values[0]!.family);
      },
    },
  });
  try {
    const r = await request(url, {
      dispatcher,
      signal,
      method: "GET",
      headers: {
        "user-agent": agentHeader,
        accept: "text/html,text/plain,application/json;q=0.8",
        "accept-encoding": "gzip, br, deflate",
      },
      headersTimeout: 7000,
      bodyTimeout: 7000,
    });
    const headers = Object.fromEntries(
      Object.entries(r.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v.join(", ") : v || "",
      ]),
    );
    const length = Number(headers["content-length"]);
    if (Number.isFinite(length) && length > maxBytes) {
      r.body.destroy();
      throw failure("limit");
    }
    const content = await documentBody(
      r.body,
      (headers["content-encoding"] || "").trim().toLowerCase(),
      maxBytes,
      signal,
    );
    return {
      status: r.statusCode,
      headers,
      ...content,
    };
  } finally {
    await dispatcher.destroy();
  }
};

export function pageText(html: string, focus = "") {
  const $ = load(html);
  const title = $("title")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const rawDate = $("meta[property='article:published_time'],meta[name='date']")
    .first()
    .attr("content");
  const publishedAt =
    rawDate &&
    /^\d{4}-\d\d-\d\d/.test(rawDate) &&
    Number.isFinite(Date.parse(rawDate)) &&
    Date.parse(rawDate) <= Date.now()
      ? new Date(rawDate).toISOString()
      : undefined;
  $(
    "script,style,noscript,svg,iframe,nav,footer,header,form,[hidden],[aria-hidden=true],.cookie-banner,#cookie-banner",
  ).remove();
  $("br").replaceWith("\n");
  $("p,li,h1,h2,h3,h4,tr,div,section").append("\n");
  const root = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");
  const text = root
    .text()
    .replace(/[\t\r ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (
    text.length < 100 ||
    /^(?:just a moment|attention required|checking your browser|access denied|verify (?:you are|that you are) human)/i.test(
      title,
    ) ||
    /enable javascript and cookies to continue|performing security verification/i.test(
      text.slice(0, 900),
    )
  )
    throw failure("format");
  return {
    title,
    text: evidenceExcerpt(text, 6000, focus),
    excerptTruncated: text.length > 6000,
    publishedAt,
  };
}
const hostnameKey = (u: URL) => u.hostname.replace(/^www\./, "");
const hnItem = (url: string) => {
  const u = new URL(url);
  const id = u.searchParams.get("id");
  return u.origin === "https://news.ycombinator.com" &&
    u.pathname === "/item" &&
    id &&
    /^[1-9]\d{0,10}$/.test(id)
    ? Number(id)
    : undefined;
};
const discussion = (url: string) =>
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/discussions\/[1-9]\d*$/.test(url);

export class DocumentReader {
  constructor(
    private store: Store,
    private transport: DocumentTransport = publicRequest,
  ) {}
  get enabled() {
    return process.env.GHTRENDS_SOURCE_DOCUMENTS !== "0";
  }
  private async read(
    url: URL,
    signal: AbortSignal,
    operation: string,
    maxBytes = MAX_BYTES,
    retryDelayMs = 250,
  ) {
    for (let attempt = 0; ; attempt++) {
      // Each retry shares the original collection deadline.
      signal.throwIfAborted();
      const started = Date.now();
      const attemptSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(8000),
      ]);
      const call: ProviderCall = {
        provider: "documents",
        operation,
        started: new Date(started).toISOString(),
        durationMs: 0,
      };
      try {
        if (operation === "page")
          this.store.set(
            `documents:last:${url.origin}`,
            started,
            Math.max(86400000, retryDelayMs),
          );
        const r = await this.transport(url, attemptSignal, maxBytes);
        call.status = r.status;
        call.transferBytes = r.bytes;
        if (r.status >= 400) call.error = `http_${r.status}`;
        return r;
      } catch (error) {
        const status = (error as any).documentStatus;
        const code =
          transientTransportCode(error) ||
          (attemptSignal.aborted &&
          attemptSignal.reason?.name === "TimeoutError"
            ? "TIMEOUT"
            : undefined);
        call.error = status
          ? `document_${status}`
          : code
            ? `document_transport_${code.toLowerCase()}`
            : "document_transport";
        if (attempt || signal.aborted || status || !code) throw error;
      } finally {
        call.durationMs = Date.now() - started;
        this.store.recordCall(call);
      }
      await wait(Math.min(20000, retryDelayMs), undefined, { signal });
    }
  }
  private async robots(url: URL, signal: AbortSignal) {
    const key = `documents:robots:${url.origin}`;
    let saved = this.store.get<{ status: number; body: string }>(key);
    if (!saved) {
      let target = new URL("/robots.txt", url);
      for (let hop = 0; hop <= 2; hop++) {
        const r = await this.read(target, signal, "robots", 100_000);
        if ([301, 302, 303, 307, 308].includes(r.status)) {
          const next = new URL(r.headers.location || "", target);
          if (
            hop === 2 ||
            !publicSearchUrl(next.href) ||
            hostnameKey(next) !== hostnameKey(url) ||
            (target.protocol === "https:" && next.protocol !== "https:")
          )
            throw failure("robots");
          target = next;
          continue;
        }
        if (r.status !== 200 && r.status !== 404 && r.status !== 410)
          throw failure("robots");
        if (r.status === 200 && /<html|<!doctype/i.test(r.body.slice(0, 400)))
          throw failure("robots");
        saved = { status: r.status, body: r.status === 200 ? r.body : "" };
        this.store.set(key, saved, 86400000);
        break;
      }
    }
    if (!saved) throw failure("robots");
    const rules = robotsParser(new URL("/robots.txt", url).href, saved.body);
    if (rules.isAllowed(url.href, agentName) === false) throw failure("robots");
    const delay = rules.getCrawlDelay(agentName);
    const last = this.store.get<number>(`documents:last:${url.origin}`) || 0;
    if (delay && last + delay * 1000 > Date.now()) throw failure("robots");
    this.store.set(
      `documents:last:${url.origin}`,
      Date.now(),
      Math.max(86400000, (delay || 0) * 1000),
    );
    // A delayed page retry also observes the site's advertised crawl interval.
    return Math.max(250, (delay || 0) * 1000);
  }
  private async page(
    original: ResearchSource,
    allowed: Set<string>,
    signal: AbortSignal,
  ): Promise<ResearchSource> {
    let url = new URL(original.url);
    for (let hop = 0; hop <= 2; hop++) {
      if (
        !publicSearchUrl(url.href) ||
        !allowed.has(hostnameKey(url)) ||
        blockedHosts.test(url.hostname)
      )
        throw failure("access");
      const retryDelayMs = await this.robots(url, signal);
      const r = await this.read(url, signal, "page", MAX_BYTES, retryDelayMs);
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const next = new URL(r.headers.location || "", url);
        if (
          hop === 2 ||
          !r.headers.location ||
          (url.protocol === "https:" && next.protocol !== "https:")
        )
          throw failure("access");
        url = next;
        continue;
      }
      if (r.status === 401 || r.status === 403 || r.status === 429)
        throw failure("access");
      if (r.status !== 200) throw failure("unavailable");
      if (
        !/^(?:text\/html|application\/xhtml\+xml|text\/plain)(?:;|$)/i.test(
          r.headers["content-type"] || "",
        )
      )
        throw failure("format");
      const parsed = pageText(r.body, original.label + " " + (original.excerpt || ""));
      return {
        ...original,
        id: undefined,
        documentType: "page",
        kind: "search",
        url: url.href,
        label: parsed.title || original.label,
        fetchedAt: new Date().toISOString(),
        publishedAt: parsed.publishedAt,
        excerpt: parsed.text,
        excerptTruncated: parsed.excerptTruncated,
      };
    }
    throw failure("limit");
  }
  private async hn(
    url: string,
    signal: AbortSignal,
  ): Promise<ResearchSource[]> {
    const id = hnItem(url);
    if (!id) throw failure("access");
    const item = async (n: number) => {
      const r = await this.read(
        new URL(`https://hacker-news.firebaseio.com/v0/item/${n}.json`),
        signal,
        "hn-item",
        100_000,
      );
      if (
        r.status !== 200 ||
        !/^application\/json/i.test(r.headers["content-type"] || "")
      )
        throw failure("unavailable");
      let value: any;
      try {
        value = JSON.parse(r.body);
      } catch {
        throw failure("format");
      }
      if (!value || value.id !== n || value.deleted || value.dead)
        throw failure("deleted");
      return value;
    };
    const root = await item(id),
      fetchedAt = new Date().toISOString();
    const source = (v: any): ResearchSource | undefined => {
      if (
        !["story", "comment"].includes(v.type) ||
        typeof v.text !== "string" ||
        v.text.trim().length < 40
      )
        return;
      const $ = load(v.text);
      $("script,style").remove();
      $("p,br").append("\n");
      const text = $("body")
        .text()
        .replace(/[\t\r ]+/g, " ")
        .trim()
        .slice(0, 2000);
      if (text.length < 40) return;
      const time =
        Number.isSafeInteger(v.time) &&
        v.time > 0 &&
        v.time * 1000 <= Date.now()
          ? new Date(v.time * 1000).toISOString()
          : undefined;
      return {
        kind: "request",
        documentType: v.type === "comment" ? "hn-comment" : "hn-story",
        label: String(v.title || root.title || "Hacker News comment").slice(
          0,
          180,
        ),
        url: `https://news.ycombinator.com/item?id=${v.id}`,
        parentUrl: v.parent
          ? `https://news.ycombinator.com/item?id=${v.parent}`
          : undefined,
        fetchedAt,
        publishedAt: time,
        request: {
          createdAt: time,
          observedAt: fetchedAt,
          ...(Number.isSafeInteger(v.score) && v.score >= 0
            ? { reactions: v.score }
            : {}),
          ...(typeof v.by === "string"
            ? {
                authorKey: createHash("sha256")
                  .update("hn:" + v.by)
                  .digest("hex")
                  .slice(0, 24),
              }
            : {}),
        },
        excerpt: text,
      };
    };
    const out: ResearchSource[] = [];
    const first = source(root);
    if (first) out.push(first);
    if (root.type === "story") {
      for (const child of (Array.isArray(root.kids) ? root.kids : [])
        .filter((x: unknown) => Number.isSafeInteger(x) && Number(x) > 0)
        .slice(0, 3)) {
        signal.throwIfAborted();
        try {
          const v = await item(child);
          if (v.parent === id) {
            const s = source(v);
            if (s) out.push(s);
          }
        } catch {
          /* Retain independent successful comments. */
        }
      }
    }
    return out;
  }
  async collect(
    candidates: ResearchSource[],
    focus = "",
  ): Promise<DocumentEvidence> {
    const result: DocumentEvidence = {
      version: DOCUMENT_VERSION,
      sources: [],
      reads: [],
    };
    if (!this.enabled) return result;
    // The per-task allowlist comes only from observed organic search results.
    const unique = [
      ...new Map(
        candidates
          .filter(
            (s) =>
              s.placement === "organic" &&
              publicSearchUrl(s.url) &&
              // This reader handles HTML/text. Keep download snippets as evidence,
              // but do not spend a four-page slot on a PDF/archive it cannot parse.
              !/\.(?:pdf|zip|gz|tar|png|jpe?g|webp|mp4)(?:$|[?#])/i.test(s.url) &&
              !discussion(s.url),
          )
          .map((s) => [s.url, s]),
      ).values(),
    ];
    const domains = new Set<string>();
    const terms = [
      ...new Set(focus.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []),
    ].filter(
      (term) =>
        !/^(?:the|for|and|with|from|source|sources|tool|tools)$/.test(term),
    );
    const documentationMatch = (source: ResearchSource) => {
      if (!terms.length) return 0;
      const url = new URL(source.url);
      // A documentation URL is a reading priority, not proof of authority.
      // Require overlap with the selected task, keeping unrelated docs in place.
      if (
        !/^(?:docs?|developer|developers|support)\./i.test(url.hostname) &&
        !/\/(?:docs?|documentation|developers?|help)(?:\/|$)/i.test(
          url.pathname,
        )
      )
        return 0;
      const words = new Set(
        `${url.hostname} ${url.pathname} ${source.label} ${source.excerpt || ""}`
          .toLowerCase()
          .match(/[\p{L}\p{N}]{2,}/gu) || [],
      );
      const matches = terms.filter((term) => words.has(term)).length;
      return matches >= Math.min(2, terms.length) ? matches : 0;
    };
    const ranked = unique
      .sort(
        (a, b) =>
          Number(!!hnItem(b.url)) - Number(!!hnItem(a.url)) ||
          documentationMatch(b) - documentationMatch(a) ||
          Number(b.searchIntent === "competition") -
            Number(a.searchIntent === "competition"),
      )
      .filter((s) => {
        const host = hostnameKey(new URL(s.url));
        if (
          host === "github.com" ||
          blockedHosts.test(host) ||
          domains.has(host)
        )
          return false;
        domains.add(host);
        return true;
      });
    // Retain the best-ranked original and reserve space for each observed job:
    // offers, first-person needs, and reusable tools. No extra page requests.
    const selected = ranked.slice(0, 1);
    for (const intent of ["demand", "competition", "opensource"] as const) {
      if (selected.some(s => s.searchIntent === intent)) continue;
      const source = ranked.find(s => s.searchIntent === intent && !!s.searchRole);
      if (source && selected.length < 4) selected.push(source);
    }
    for (const source of ranked) {
      if (selected.length === 4) break;
      if (!selected.includes(source)) selected.push(source);
    }
    const allowed = new Set(selected.map((s) => hostnameKey(new URL(s.url))));
    const signal = AbortSignal.timeout(20000);
    let cursor = 0;
    const rows: { sources: ResearchSource[]; read: DocumentRead }[] = new Array(
      selected.length,
    );
    await Promise.all(
      Array.from({ length: Math.min(4, selected.length) }, async () => {
        while (cursor < selected.length) {
          const index = cursor++,
            s = selected[index]!;
          const key =
            `documents:${DOCUMENT_VERSION}:` +
            createHash("sha256").update(JSON.stringify([s.url, s.label, s.excerpt])).digest("hex");
          const cached = this.store.get<{
            sources: ResearchSource[];
            read: DocumentRead;
          }>(key);
          if (cached) {
            rows[index] = cached;
            this.store.recordCall({
              provider: "documents",
              operation: "document-cache",
              started: new Date().toISOString(),
              durationMs: 0,
              cached: true,
            });
            continue;
          }
          let sources: ResearchSource[] = [],
            status: DocumentStatus = "read";
          try {
            signal.throwIfAborted();
            sources = hnItem(s.url)
              ? await this.hn(s.url, signal)
              : [await this.page(s, allowed, signal)];
            if (!sources.length) status = "format";
          } catch (e) {
            status = signal.aborted
              ? "limit"
              : (e as any).documentStatus || "unavailable";
          }
          const row = {
            sources,
            read: { url: s.url, status, observedAt: new Date().toISOString() },
          };
          this.store.set(key, row, status === "read" ? 3600000 : 300000);
          rows[index] = row;
        }
      }),
    );
    result.reads = rows.map((r) => r.read);
    result.sources = rows
      .flatMap((r, index) =>
        r.sources.map((s) => ({
          ...s,
          searchIntent: selected[index]!.searchIntent,
          directionId: selected[index]!.directionId,
        })),
      )
      .map((s, i) => ({ ...s, id: `WP${i + 1}` }));
    return result;
  }
}
