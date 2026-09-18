import type { DemandEvidence, InterestPoint, Market } from "./types.js";
import type { WebEvidence } from "../providers/search.js";

const WEEK = 7 * 86400000;
type WebQuery = WebEvidence["queries"][number];
export function searchEngineLabel(query: WebQuery) {
  return query.engine === "duckduckgo" ? "DuckDuckGo" : "Google";
}
export function searchQueryUrl(query: WebQuery, web: WebEvidence) {
  return query.engine === "duckduckgo"
    ? `https://duckduckgo.com/?${new URLSearchParams({ q: query.query })}`
    : `https://www.google.com/search?${new URLSearchParams({ q: query.query, hl: web.language, gl: web.region.toLowerCase() })}`;
}
export function adSampleQueries(web?: WebEvidence) {
  return (
    web?.queries.filter(
      (q) =>
        q.state === "ready" &&
        (q.adCoverage === "visible-placements" ||
          (!q.adCoverage && q.engine !== "duckduckgo")),
    ) || []
  );
}
export function searchEvidenceIsFresh(web?: WebEvidence, now = Date.now()) {
  return (
    !!web &&
    web.state === "ready" &&
    web.queries.length > 0 &&
    web.queries.every((q) => {
      const age = now - Date.parse(q.fetchedAt || web.fetchedAt);
      return (
        q.state === "ready" &&
        Number.isFinite(age) &&
        age >= -60000 &&
        age < (q.engine === "duckduckgo" ? 30 * 60000 : 6 * 3600000)
      );
    })
  );
}

export function searchCollectionMessage(
  web: WebEvidence | undefined,
  locale: "en" | "zh",
) {
  const zh = locale === "zh";
  if (!web || web.state === "setup")
    return zh
      ? "网页搜索需要管理员配置采集服务。"
      : "Web search requires a configured collection service.";
  const fallback = web.queries.some(
    (q) => q.state === "ready" && q.engine === "duckduckgo",
  );
  if (web.state === "ready")
    return fallback
      ? zh
        ? "已由 DuckDuckGo 补充网页证据；每组查询标注实际来源与采集时间。"
        : "DuckDuckGo supplied fallback web evidence. Each query identifies its source and collection time."
      : "";
  const challenge = web.queries.some((q) =>
    /challenge|http_429/.test(q.error || ""),
  );
  const reason = challenge
    ? zh
      ? web.provider === "multi-search"
        ? "搜索服务要求访问验证，本轮采集已暂停。"
        : "Google 要求访问验证，本轮搜索已暂停。"
      : "Search access verification paused this collection attempt."
    : zh
      ? "本轮网页采集已结束，部分搜索证据待补充。"
      : "This collection attempt has ended with gaps in search coverage.";
  return (
    reason +
    (zh
      ? "点击「更新研究」可重试；成功采集的结果会保留。"
      : "Choose Update research to retry; successful search results are retained.")
  );
}

export function researchWarnings(m: Market, searchExpected = false): string[] {
  return [
    m.demand.error,
    m.demand.collectionError,
    m.supply.error,
    m.aiError,
    searchExpected && m.web?.state !== "ready"
      ? "Web search collection needs a retry; this attempt's research credit is returned."
      : undefined,
  ].filter((x): x is string => !!x);
}

export function sourceEvidenceIsFresh(
  market: Pick<Market, "demand" | "supply">,
  now = Date.now(),
) {
  return [market.demand.fetchedAt, market.supply.fetchedAt].every((date) => {
    const age = now - Date.parse(date);
    return Number.isFinite(age) && age >= -60000 && age < 86400000;
  });
}

/** Weekly timestamps mark interval starts. A week must have ended when collected. */
export function completeWeeklySeries(evidence: DemandEvidence, asOf: string) {
  const cutoff = Math.min(Date.parse(asOf), Date.parse(evidence.fetchedAt));
  const weeks = new Map<number, InterestPoint>();
  const conflicts = new Set<number>();
  if (!Number.isFinite(cutoff))
    return { points: [], hasConflicts: false, conflictDates: [] as number[] };
  for (const point of evidence.points) {
    const time = Date.parse(point.date);
    if (
      point.partial ||
      !Number.isFinite(time) ||
      time + WEEK > cutoff ||
      !Number.isFinite(point.value) ||
      point.value < 0 ||
      point.value > 100
    )
      continue;
    const current = {
      ...point,
      date: new Date(time).toISOString(),
      anchor:
        point.anchor !== undefined &&
        Number.isFinite(point.anchor) &&
        point.anchor >= 0 &&
        point.anchor <= 100
          ? point.anchor
          : undefined,
    };
    const previous = weeks.get(time);
    if (
      previous &&
      (previous.value !== point.value ||
        (previous.anchor !== undefined &&
          current.anchor !== undefined &&
          previous.anchor !== current.anchor))
    ) {
      conflicts.add(time);
    } else if (!previous || previous.anchor === undefined) {
      weeks.set(time, current);
    }
  }
  return {
    points: [...weeks.entries()]
      .filter(([time]) => !conflicts.has(time))
      .sort(([a], [b]) => a - b)
      .map(([, point]) => point),
    hasConflicts: conflicts.size > 0,
    conflictDates: [...conflicts],
  };
}
