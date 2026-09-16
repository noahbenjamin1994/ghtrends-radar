import { completeWeeklySeries } from "../core/evidence.js";
import { demandMetrics } from "../core/analyze.js";
import type { ProviderCall } from "../core/operations.js";
import { fetch as request, ProxyAgent } from "undici";
import type { DemandEvidence, InterestPoint } from "../core/types.js";
import { Store } from "../core/store.js";
import { validateGeo } from "../core/topics.js";
const ORIGIN = "https://trends.google.com";
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
  private dispatcher: ProxyAgent | undefined;
  constructor(private store: Store) {
    const proxy = process.env.GOOGLE_TRENDS_PROXY;
    if (proxy) this.dispatcher = new ProxyAgent(proxy);
  }
  private async read(
    path: string,
    params: Record<string, string> = {},
    optional = false,
  ): Promise<any> {
    const url = new URL(path, ORIGIN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 2; attempt++) {
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
      };
      try {
        const r = await request(url, {
          dispatcher: this.dispatcher,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "X-Requested-With": "XMLHttpRequest",
            Referer: ORIGIN + "/trends/explore",
            ...(this.cookie ? { Cookie: this.cookie } : {}),
          },
          signal: AbortSignal.timeout(optional ? 7000 : 30000),
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
        if (r.status === 429 && attempt === 0 && !optional) {
          await r.body?.cancel();
          const seconds = Math.max(
            30,
            Number(r.headers.get("retry-after")) || 30,
          );
          if (seconds > 60)
            throw new Error(
              `Google Trends requested a ${seconds}-second cooldown. Retry later.`,
            );
          await new Promise((r) => setTimeout(r, seconds * 1000));
          continue;
        }
        if (!r.ok)
          throw new Error(
            `Google Trends returned ${r.status}. Retry later or import an exported Trends file.`,
          );
        const text = await r.text();
        return path.includes("/api/") ? parseGoogleJson(text) : null;
      } catch (e) {
        call.error ||= "network_error";
        throw e;
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
  ): Promise<DemandEvidence> {
    validateGeo(geo);
    const terms = [...new Set([keyword, ...synonyms])].slice(0, 3);
    if (terms.length > 1) {
      // Independent normalization prevents a popular synonym rounding the primary to zero.
      const evidence = await Promise.all(
        terms.map((term, i) =>
          this.demand(term, geo, i === 0 ? onTimeline : undefined),
        ),
      );
      const usable = (d: DemandEvidence) => {
        const now = new Date().toISOString(),
          last = completeWeeklySeries(d, now).points.at(-1);
        return (
          !d.collectionError &&
          demandMetrics(d, now).fast !== null &&
          [d.fetchedAt, last?.date].every(
            (s) =>
              s &&
              Date.parse(s) <= Date.now() + 60000 &&
              Date.now() - Date.parse(s) < 14 * 86400000,
          )
        );
      };
      const selected = usable(evidence[0]!) ? 0 : evidence.findIndex(usable);
      const index = Math.max(0, selected),
        primary = evidence[index]!;
      const result = {
        ...primary,
        alternatives: evidence.filter((_, i) => i !== index),
      };
      if (index !== 0) {
        result.requestedKeyword = keyword;
        result.selectionReason =
          "The planned primary term lacks usable evidence. The first usable same-intent variant is shown; selection uses data coverage, never growth direction.";
      }
      onTimeline?.(result);
      return result;
    }
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
      // The HTML warmup is optional; Google may rate-limit it independently.
      try {
        await this.read("/trends/explore", {}, true);
      } catch {}
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
        throw new Error("Google Trends did not return a time series.");
      const timeline = await this.read("/trends/api/widgetdata/multiline", {
        hl: "en-US",
        tz: "0",
        req: JSON.stringify(timeseries.request),
        token: timeseries.token,
      });
      if (timeseries.request?.resolution !== "WEEK")
        throw new Error("Google Trends did not return weekly observations.");
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
            "Google Trends returned a different query than requested.",
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
          "Google Trends returned no observations for this keyword.",
        );
      this.store.set(key, result, 86400000);
    } catch (e) {
      result.error = (e as Error).message;
      const previous = this.store.get<DemandEvidence>(key, true);
      if (previous?.points.length)
        return { ...previous, collectionError: result.error };
    }
    return result;
  }
  async close() {
    await this.dispatcher?.close();
  }
}
