import { createHash } from "node:crypto";
import type { Store } from "../core/store.js";

export interface ProxyUsage {
  configured: boolean;
  state: "ready" | "setup" | "refreshing";
  fetchedAt?: string;
  error?: "authentication" | "provider" | "format";
  subscription: {
    totalGb: number;
    usedGb: number;
    remainingGb: number;
    validUntil?: string;
  } | null;
  traffic: {
    bytes: number;
    requests: number;
    daily: { day: string; bytes: number; requests: number }[];
  } | null;
}
const number = (v: unknown): number | null => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export function parseSubscription(raw: any): ProxyUsage["subscription"] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.data)
      ? raw.data
      : [raw?.data || raw];
  const row = rows.find((r: any) => r?.service_type === "residential_proxies");
  if (!row) return null;
  const totalGb = number(row.traffic_limit),
    usedGb = number(row.traffic_per_period ?? row.traffic);
  if (totalGb === null || usedGb === null) return null;
  return {
    totalGb,
    usedGb,
    remainingGb: Math.max(0, totalGb - usedGb),
    ...(typeof row.valid_until === "string"
      ? { validUntil: row.valid_until.slice(0, 30) }
      : {}),
  };
}
export function parseTraffic(raw: any): ProxyUsage["traffic"] {
  const totals = raw?.metadata?.totals;
  const bytes = number(totals?.total_rx_tx),
    requests = number(totals?.requests);
  if (bytes === null || requests === null || !Array.isArray(raw?.data))
    return null;
  return {
    bytes,
    requests,
    daily: raw.data.flatMap((r: any) => {
      const bytes = number(r.rx_tx_bytes),
        requests = number(r.requests);
      return typeof r.key === "string" &&
        /^\d{4}-\d{2}-\d{2}/.test(r.key) &&
        bytes !== null &&
        requests !== null
        ? [{ day: r.key.slice(0, 10), bytes, requests }]
        : [];
    }),
  };
}
export class ProxyUsageClient {
  private pending = new Map<string, Promise<ProxyUsage>>();
  constructor(private store: Store) {}
  async overview(days: number): Promise<ProxyUsage> {
    const apiKey = process.env.DECODO_API_KEY;
    if (!apiKey)
      return {
        configured: false,
        state: "setup",
        subscription: null,
        traffic: null,
      };
    const key =
      "proxy-usage:v1:" +
      createHash("sha256").update(apiKey).digest("hex").slice(0, 16) +
      ":" +
      days;
    const cached = this.store.get<ProxyUsage>(key);
    if (cached) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.collect(days, key, apiKey).finally(() =>
      this.pending.delete(key),
    );
    this.pending.set(key, task);
    return task;
  }
  private async collect(
    days: number,
    key: string,
    apiKey: string,
  ): Promise<ProxyUsage> {
    const previous = this.store.get<ProxyUsage>(key, true);
    const get = async (path: string, body?: unknown) => {
      const response = await fetch("https://api.decodo.com" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: apiKey,
          Accept: "application/json",
          "User-Agent": "ghtrends-radar/0.12",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!response.ok)
        throw new Error(
          [401, 403].includes(response.status) ? "authentication" : "provider",
        );
      return response.json();
    };
    const now = new Date(),
      start = new Date(now);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    start.setUTCHours(0, 0, 0, 0);
    const stamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
    const results = await Promise.allSettled([
      get("/v2/subscriptions"),
      get("/api/v2/statistics/traffic", {
        proxyType: "residential_proxies",
        startDate: stamp(start),
        endDate: stamp(now),
        groupBy: "day",
        limit: 500,
        page: 1,
        sortBy: "grouping_key",
        sortOrder: "asc",
      }),
    ]);
    const subscription =
      results[0].status === "fulfilled"
        ? parseSubscription(results[0].value)
        : null;
    const traffic =
      results[1].status === "fulfilled" ? parseTraffic(results[1].value) : null;
    const success = !!subscription && !!traffic;
    const failed = results.find((r) => r.status === "rejected");
    const result: ProxyUsage = {
      configured: true,
      state: success ? "ready" : "refreshing",
      fetchedAt: success ? now.toISOString() : previous?.fetchedAt,
      subscription: subscription || previous?.subscription || null,
      traffic: traffic || previous?.traffic || null,
      ...(success
        ? {}
        : {
            error:
              failed?.status === "rejected" &&
              failed.reason?.message === "authentication"
                ? "authentication"
                : failed
                  ? "provider"
                  : "format",
          }),
    };
    this.store.set(key, result, success ? 15 * 60000 : 60000);
    return result;
  }
}
