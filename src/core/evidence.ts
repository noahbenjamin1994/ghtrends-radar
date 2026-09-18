import type { DemandEvidence, InterestPoint, Market } from "./types.js";
import type { WebEvidence } from "../providers/search.js";

const WEEK = 7 * 86400000;

export function searchCollectionMessage(
  web: WebEvidence | undefined,
  locale: "en" | "zh",
) {
  const zh = locale === "zh";
  if (!web || web.state === "setup")
    return zh
      ? "网页搜索需要管理员配置采集服务。"
      : "Web search requires a configured collection service.";
  if (web.state === "ready") return "";
  const challenge = web.queries.some((q) =>
    /challenge|http_429/.test(q.error || ""),
  );
  const reason = challenge
    ? zh
      ? "Google 要求访问验证，本轮搜索已暂停。"
      : "Google requested access verification. This search attempt has stopped."
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
