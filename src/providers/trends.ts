import { fetch as request, ProxyAgent } from "undici";
import type { DemandEvidence, InterestPoint } from "../core/types.js";
import { Store } from "../core/store.js";
import { validateGeo } from "../core/topics.js";
const ORIGIN = "https://trends.google.com";
export function parseGoogleJson(text: string): any {
  return JSON.parse(text.replace(/^\)\]\}',?\s*/, ""));
}
export function parseTimeline(data: any): InterestPoint[] {
  return (data.default?.timelineData || [])
    .filter((p: any) => Array.isArray(p.value) && p.value.length)
    .map((p: any) => ({
      date: new Date(Number(p.time) * 1000).toISOString(),
      value: Number(p.value[0]),
      anchor: p.value.length > 1 ? Number(p.value[1]) : undefined,
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
  ): Promise<any> {
    const url = new URL(path, ORIGIN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    for (let attempt = 0; attempt < 2; attempt++) {
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
        signal: AbortSignal.timeout(30000),
      });
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
      if (r.status === 429 && attempt === 0) {
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
    }
  }
  async demand(keyword: string, geo = ""): Promise<DemandEvidence> {
    validateGeo(geo);
    const key = `trends:v1:${keyword}:${geo}`;
    const cached = this.store.get<DemandEvidence>(key);
    if (cached) return cached;
    const end = new Date(),
      start = new Date(end);
    start.setUTCFullYear(start.getUTCFullYear() - 2);
    const time = `${start.toISOString().slice(0, 10)} ${end.toISOString().slice(0, 10)}`;
    const sourceUrl = `${ORIGIN}/trends/explore?date=${encodeURIComponent(time)}&geo=${geo}&q=${encodeURIComponent(keyword + ",github trending")}`;
    const result: DemandEvidence = {
      keyword,
      geo,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
      points: [],
      related: [],
    };
    try {
      // The HTML warmup is optional; Google may rate-limit it independently.
      try {
        await this.read("/trends/explore");
      } catch {}
      const req = {
        comparisonItem: [keyword, "github trending"].map((keyword) => ({
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
      result.points = parseTimeline(timeline);
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
