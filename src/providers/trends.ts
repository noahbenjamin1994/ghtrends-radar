import { completeWeeklySeries } from "../core/evidence.js";
import { demandMetrics } from "../core/analyze.js";
import type { ProviderCall } from "../core/operations.js";
import { operationContext, operationSignal } from "../core/operations.js";
import { fetch as request, ProxyAgent, Dispatcher } from "undici";
import type { DemandEvidence, InterestPoint } from "../core/types.js";
import { Store } from "../core/store.js";
import { createHash } from "node:crypto";
import { validateGeo } from "../core/topics.js";
const ORIGIN = "https://trends.google.com";
// Count HTTP bytes before decompression. Provider billing also includes TLS;
// the administrator sees this as an HTTP measurement, alongside the invoice API.
export class TrafficMeter extends Dispatcher {
  constructor(
    private inner: Dispatcher,
    private call: ProviderCall,
  ) {
    super();
  }
  dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    const call = this.call;
    call.transferBytes =
      (call.transferBytes || 0) +
      Buffer.byteLength(
        `${options.method || "GET"} ${options.path} HTTP/1.1\r\n`,
      );
    const headers = options.headers;
    if (Array.isArray(headers))
      call.transferBytes += headers.reduce(
        (n, h) => n + Buffer.byteLength(String(h)) + 2,
        0,
      );
    else if (headers)
      call.transferBytes += Object.entries(headers).reduce(
        (n, [k, v]) => n + Buffer.byteLength(`${k}: ${v}\r\n`),
        0,
      );
    return this.inner.dispatch(
      options,
      new Proxy(handler, {
        get(target, prop) {
          const original = Reflect.get(target, prop);
          if (prop === "onData")
            return (chunk: Buffer) => {
              call.transferBytes! += chunk.length;
              return original?.call(target, chunk);
            };
          if (prop === "onHeaders")
            return (...args: any[]) => {
              call.transferBytes! += args[1].reduce(
                (n: number, h: Buffer | string) => n + Buffer.byteLength(h) + 2,
                0,
              );
              return original?.apply(target, args);
            };
          return typeof original === "function"
            ? original.bind(target)
            : original;
        },
      }),
    );
  }
}
export function parseGoogleJson(text: string): any {
  return JSON.parse(text.replace(/^\)\]\}',?\s*/, ""));
}
export function parseTimeline(data: any, index = 0): InterestPoint[] {
  return (data.default?.timelineData || [])
    .filter(
      (p: any) =>
        Array.isArray(p.value) &&
        p.value.length > index &&
        p.hasData?.[index] !== false &&
        typeof p.value[index] === "number" &&
        Number.isFinite(p.value[index]) &&
        p.value[index] >= 0 &&
        p.value[index] <= 100 &&
        Number.isFinite(Number(p.time)) &&
        Math.abs(Number(p.time)) < 8640000000000,
    )
    .map((p: any) => ({
      date: new Date(Number(p.time) * 1000).toISOString(),
      value: Number(p.value[index]),
      anchor:
        index === 0 && p.value.length > 1 ? Number(p.value[1]) : undefined,
      partial: p.isPartial === true || p.isPartial === "true",
    }));
}
export class Trends {
  private cookie = "";
  private queue = Promise.resolve();
  private nextRequestAt = 0;
  private warmup?: Promise<void>;
  private warmupExpiresAt = 0;
  private inFlight = new Map<string, Promise<DemandEvidence>>();
  private readonly cooldownKey: string;
  private fallback?: Trends;
  private readonly interval = Math.max(
    1000,
    Math.min(10000, Number(process.env.GHTRENDS_TRENDS_INTERVAL_MS) || 1500),
  );
  private cooldown() {
    return this.store.get<{ until: number }>(this.cooldownKey)?.until || 0;
  }
  private cooldownError(until: number) {
    return Object.assign(
      new Error(
        "Google Trends is cooling down. Refresh after the scheduled time or open the source.",
      ),
      { retryAt: new Date(until).toISOString() },
    );
  }
  private dispatcher: ProxyAgent | undefined;
  private routeName: "primary" | "backup";
  constructor(
    private store: Store,
    route?: { proxy?: string; cooldownKey?: string },
  ) {
    this.routeName = route ? "backup" : "primary";
    const proxy = route ? route.proxy : process.env.GOOGLE_TRENDS_PROXY;
    this.cooldownKey =
      route?.cooldownKey ||
      (proxy
        ? "trends:cooldown:route:" +
          createHash("sha256").update(proxy).digest("hex").slice(0, 24)
        : "trends:cooldown:v1");
    if (proxy) {
      try {
        const url = new URL(proxy);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        this.dispatcher = new ProxyAgent(url.href);
      } catch {
        throw new Error(
          "Set GOOGLE_TRENDS_PROXY to an HTTP or HTTPS proxy URL.",
        );
      }
    }
    const fallback = process.env.GOOGLE_TRENDS_PROXY_FALLBACK;
    if (!route && proxy && fallback && fallback !== proxy)
      this.fallback = new Trends(store, { proxy: fallback });
  }
  status() {
    const now = Date.now();
    const routes = [
      this.cooldown(),
      ...(this.fallback ? [this.fallback.cooldown()] : []),
    ];
    const until = routes.every((until) => until > now)
      ? Math.min(...routes)
      : 0;
    return {
      proxy: !!this.dispatcher,
      region: this.dispatcher
        ? process.env.GHTRENDS_TRENDS_PROXY_REGION || "configured"
        : "direct",
      retryAt: until > now ? new Date(until).toISOString() : null,
      routes: routes.length,
      coolingRoutes: routes.filter((until) => until > now).length,
    };
  }
  private async read(
    path: string,
    params: Record<string, string> = {},
    optional = false,
  ): Promise<any> {
    const preceding = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await preceding;
    try {
      operationContext.getStore()?.signal?.throwIfAborted();
      const until = this.cooldown();
      if (until > Date.now()) throw this.cooldownError(until);
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, this.nextRequestAt - Date.now())),
      );
      return await this.request(path, params, optional);
    } finally {
      this.nextRequestAt = Date.now() + this.interval;
      release();
    }
  }
  private async request(
    path: string,
    params: Record<string, string>,
    optional: boolean,
  ): Promise<any> {
    const url = new URL(path, ORIGIN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < (optional ? 1 : 2); attempt++) {
      const started = Date.now();
      const call: ProviderCall = {
        provider: "trends",
        operation: path.includes("multiline")
          ? "timeline"
          : path.includes("relatedsearches")
            ? "related"
            : path.includes("api/explore")
              ? "explore"
              : "warmup",
        started: new Date(started).toISOString(),
        durationMs: 0,
        ...(this.dispatcher
          ? { proxyRoute: this.routeName, transferBytes: 0 }
          : {}),
      };
      try {
        const r = await request(url, {
          dispatcher: this.dispatcher
            ? new TrafficMeter(this.dispatcher, call)
            : undefined,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            Accept: path.includes("/api/")
              ? "application/json, text/plain, */*"
              : "text/html,application/xhtml+xml",
            ...(path.includes("/api/")
              ? { "X-Requested-With": "XMLHttpRequest" }
              : {}),
            Referer: ORIGIN + "/trends/explore",
            ...(this.cookie ? { Cookie: this.cookie } : {}),
          },
          signal: operationSignal(optional ? 7000 : 15000),
        });
        call.status = r.status;
        if (!r.ok) call.error = `http_${r.status}`;
        const cookies = new Map(
          this.cookie
            .split("; ")
            .filter(Boolean)
            .map((c) => [c.split("=")[0]!, c]),
        );
        for (const c of r.headers.getSetCookie()) {
          const pair = c.split(";")[0]!;
          cookies.set(pair.split("=")[0]!, pair);
        }
        this.cookie = [...cookies.values()].join("; ");
        if (r.status === 429 || r.status === 403) {
          await r.body?.cancel();
          const retry = r.headers.get("retry-after"),
            seconds = retry ? Number(retry) : NaN;
          const requested =
            retry && Number.isFinite(seconds)
              ? Date.now() + Math.max(0, seconds) * 1000
              : Date.parse(retry || "");
          const until = Math.max(
            Date.now() + 30000,
            Number.isFinite(requested) && requested <= 8640000000000000
              ? requested
              : Date.now() + 15 * 60000,
          );
          this.store.set(this.cooldownKey, { until }, until - Date.now());
          throw this.cooldownError(until);
        }
        if (!r.ok) {
          await r.body?.cancel();
          const error = Object.assign(
            new Error(
              `Google Trends refresh returned HTTP ${r.status}. Open the source or retry shortly.`,
            ),
            { transient: r.status >= 500 || r.status === 408 },
          );
          throw error;
        }
        const body = await r.text();
        return path.includes("/api/") ? parseGoogleJson(body) : null;
      } catch (e) {
        call.error ||= call.status ? "response_error" : "network_error";
        const transient =
          (e as any).transient || (!call.status && !(e as any).retryAt);
        if (attempt === 0 && !optional && transient) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        if ((e as any).retryAt || call.status) throw e;
        throw new Error(
          "Google Trends connection is being refreshed. Open the source or retry shortly.",
        );
      } finally {
        call.durationMs = Date.now() - started;
        this.store.recordCall(call);
      }
    }
  }
  async demand(
    keyword: string,
    geo = "",
    onTimeline?: (evidence: DemandEvidence) => void,
    synonyms: string[] = [],
    preferPrimary = false,
  ): Promise<DemandEvidence> {
    validateGeo(geo);
    const terms = [keyword, ...synonyms]
      .map((t) => t.trim())
      .filter(
        (t, i, all) =>
          all.findIndex((a) => a.toLowerCase() === t.toLowerCase()) === i,
      )
      .slice(0, 3);
    if (terms.length > 1) {
      // Independent normalization prevents a popular synonym rounding the primary to zero.
      const evidence: DemandEvidence[] = [];
      const usable = (d: DemandEvidence) => {
        const now = new Date().toISOString(),
          last = completeWeeklySeries(d, now).points.at(-1),
          metrics = demandMetrics(d, now);
        return (
          (metrics.fast !== null || metrics.emerging) &&
          [d.fetchedAt, last?.date].every(
            (s) =>
              s &&
              Date.parse(s) <= Date.now() + 60000 &&
              Date.now() - Date.parse(s) < 14 * 86400000,
          )
        );
      };
      for (const [i, term] of terms.entries()) {
        const data = await this.demand(
          term,
          geo,
          i === 0 ? onTimeline : undefined,
        );
        evidence.push(data);
        // The transport already retried. A different keyword cannot repair an
        // unavailable route; retain available dated alternatives without issuing
        // the same failing connection sequence for every synonym.
        if (
          preferPrimary &&
          (data.retryAt ||
            /connection is being refreshed|returned HTTP (?:5\d\d|408)/.test(
              data.collectionError || data.error || "",
            ))
        ) {
          for (const remaining of terms.slice(i + 1)) {
            const saved = this.store.get<DemandEvidence>(
              `trends:v3:${JSON.stringify([remaining])}:${geo}`,
              true,
            );
            if (saved)
              evidence.push({
                ...saved,
                collectionError: data.collectionError || data.error,
                retryAt: data.retryAt,
              });
          }
          break;
        }
        // A current, complete primary series already answers the selected query.
        // Variants remain a recovery path for sparse or unavailable coverage.
        if (
          preferPrimary &&
          !data.collectionError &&
          !data.error &&
          usable(data)
        )
          break;
      }
      // Prefer current measured evidence, then the first usable dated snapshot.
      const current = (d: DemandEvidence) => !d.collectionError && usable(d);
      const freshIndex = current(evidence[0]!)
        ? 0
        : evidence.findIndex(current);
      const selected =
        freshIndex >= 0
          ? freshIndex
          : usable(evidence[0]!)
            ? 0
            : evidence.findIndex(usable);
      const index = Math.max(0, selected),
        primary = evidence[index]!;
      const result = {
        ...primary,
        alternatives: evidence.filter((_, i) => i !== index),
      };
      if (index !== 0) {
        result.requestedKeyword = keyword;
        result.selectionReason =
          "Showing the first same-intent variant with usable coverage, in the planned order.";
      }
      onTimeline?.(result);
      return result;
    }
    const requestKey = JSON.stringify([keyword.toLowerCase(), geo]);
    let pending = this.inFlight.get(requestKey);
    if (!pending) {
      pending = this.collectWithFallback(keyword, geo, onTimeline);
      this.inFlight.set(requestKey, pending);
      void pending
        .finally(() => this.inFlight.delete(requestKey))
        .catch(() => {});
    }
    const data = await pending;
    onTimeline?.(data);
    return data;
  }
  private async collectWithFallback(
    keyword: string,
    geo: string,
    onTimeline?: (data: DemandEvidence) => void,
  ): Promise<DemandEvidence> {
    const primary = await this.collect(keyword, geo, onTimeline);
    if (!this.fallback || !primary.retryAt) return primary;
    // Each route owns its cookies, proxy connection, paced queue and persisted
    // cooldown. Restart the whole Google token sequence on the backup route.
    // One alternate route bounds traffic; neither route bypasses its cooldown.
    const backup = await this.fallback.demand(keyword, geo, onTimeline);
    if (!backup.error && !backup.collectionError) return backup;
    const result =
      primary.points.length &&
      (!backup.points.length ||
        Date.parse(primary.fetchedAt) > Date.parse(backup.fetchedAt))
        ? primary
        : backup;
    return { ...result, retryAt: this.status().retryAt || undefined };
  }
  private async collect(
    keyword: string,
    geo: string,
    onTimeline?: (data: DemandEvidence) => void,
  ): Promise<DemandEvidence> {
    const terms = [keyword];
    const key = `trends:v3:${JSON.stringify(terms)}:${geo}`;
    const cached = this.store.get<DemandEvidence>(key);
    if (cached) {
      this.store.recordCall({
        provider: "trends",
        operation: "demand",
        started: new Date().toISOString(),
        durationMs: 0,
        cached: true,
      });
      onTimeline?.(cached);
      return cached;
    }
    const end = new Date(),
      start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 2);
    const time = `${start.toISOString().slice(0, 10)} ${end.toISOString().slice(0, 10)}`;
    const sourceUrl = `${ORIGIN}/trends/explore?date=${encodeURIComponent(time)}&geo=${geo}&q=${encodeURIComponent(terms.join(","))}`;
    const result: DemandEvidence = {
      keyword,
      geo,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
      points: [],
      related: [],
      normalization: "independent",
    };
    try {
      const until = this.cooldown();
      if (until > Date.now()) throw this.cooldownError(until);
      if (!this.warmup || Date.now() >= this.warmupExpiresAt) {
        // The homepage establishes Google's anonymous NID session. Starting at
        // /explore can return 429 even on a healthy residential proxy. Refresh
        // periodically as sticky proxy sessions expire; use only server cookies.
        this.cookie = "";
        this.warmupExpiresAt = Date.now() + 10 * 60000;
        this.warmup = this.read("/trends/", { geo: "US" }).then(() => {});
      }
      try {
        await this.warmup;
      } catch (error) {
        this.warmup = undefined;
        throw error;
      }
      const req = {
        comparisonItem: terms.map((keyword) => ({
          keyword,
          geo,
          time,
        })),
        category: 0,
        property: "",
      };
      const explore = await this.read("/trends/api/explore", {
        hl: "en-US",
        tz: "0",
        req: JSON.stringify(req),
      });
      const timeseries = explore.widgets?.find(
        (w: any) => w.id === "TIMESERIES",
      );
      if (!timeseries)
        throw new Error(
          "Google Trends weekly history is pending. Open the source to review coverage.",
        );
      const timeline = await this.read("/trends/api/widgetdata/multiline", {
        hl: "en-US",
        tz: "0",
        req: JSON.stringify(timeseries.request),
        token: timeseries.token,
      });
      if (timeseries.request?.resolution !== "WEEK")
        throw new Error(
          "Google Trends returned a different time resolution. Choose a weekly export.",
        );
      const returned =
        timeseries.request.comparisonItem?.map(
          (item: any) => item.complexKeywordsRestriction?.keyword?.[0]?.value,
        ) || [];
      const readSeries = (term: string) => {
        const index = returned.findIndex(
          (value: string) => value?.toLowerCase() === term.toLowerCase(),
        );
        if (index < 0)
          throw new Error(
            "Google Trends returned a different query. Refresh the selected keyword.",
          );
        return {
          keyword: term,
          geo,
          fetchedAt: result.fetchedAt,
          sourceUrl,
          points: parseTimeline(timeline, index).map(({ anchor, ...p }) => p),
          related: [],
          resolution: "WEEK",
          seriesIndex: index,
        };
      };
      Object.assign(result, readSeries(keyword));
      result.alternatives = terms.slice(1).map(readSeries);
      onTimeline?.(structuredClone(result));
      const related = explore.widgets?.find(
        (w: any) => w.id === "RELATED_QUERIES" || w.id === "RELATED_QUERIES_0",
      );
      if (related) {
        try {
          const data = await this.read(
            "/trends/api/widgetdata/relatedsearches",
            {
              hl: "en-US",
              tz: "0",
              req: JSON.stringify(related.request),
              token: related.token,
            },
            true,
          );
          result.related = (data.default?.rankedList || []).flatMap(
            (list: any, index: number) =>
              (list.rankedKeyword || []).map((r: any) => ({
                query: r.query,
                value: r.value,
                formatted: r.formattedValue || String(r.value),
                type: index === 0 ? "top" : "rising",
              })),
          );
        } catch {
          /* Demand can be classified without related-query suggestions. */
        }
      }
      if (!result.points.length)
        throw new Error(
          "Google Trends coverage for this keyword is pending. Try a familiar same-intent phrase.",
        );
      this.store.set(key, result, 86400000);
    } catch (e) {
      result.error = (e as Error).message;
      const previous = this.store.get<DemandEvidence>(key, true);
      result.retryAt = (e as any).retryAt;
      if (previous?.points.length)
        return {
          ...previous,
          collectionError: result.error,
          retryAt: result.retryAt,
        };
    }
    return result;
  }
  async close() {
    await this.dispatcher?.close();
    await this.fallback?.close();
  }
}
