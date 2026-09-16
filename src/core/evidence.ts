import type { DemandEvidence, InterestPoint, Market } from "./types.js";

const WEEK = 7 * 86400000;

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
