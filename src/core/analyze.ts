import { createHash } from "node:crypto";
import { completeWeeklySeries } from "./evidence.js";
import type {
  DemandEvidence,
  DemandMetrics,
  SupplyEvidence,
  Topic,
  Market,
  MarketKind,
  Gap,
} from "./types.js";
export const ALGORITHM_VERSION = "1.1.0";
// Operational thresholds, published and configurable in code; not universal market laws.
export const POLICY = {
  denseSupply: 50,
  minStars: 5,
  activeDays: 180,
  minWeeks: 26,
  windowWeeks: 8,
  fastGrowth: 0.25,
  meaningfulGrowth: 0.1,
  minBaseline: 3,
  minNonzero: 0.6,
  staleDays: 14,
};
export const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length
    ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) /
        2
    : 0;
};
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
// Deterministic two-week block resampling retains local dependence. This band is
// a stability diagnostic, not a calibrated probability of commercial success.
function growthBand(recent: number[], base: number[]): [number, number] {
  let state = 0x51a7;
  const rand = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const sample = (a: number[]) => {
    const out: number[] = [];
    while (out.length < a.length) {
      const i = Math.floor(rand() * a.length);
      out.push(a[i]!, a[(i + 1) % a.length]!);
    }
    return out.slice(0, a.length);
  };
  const draws: number[] = [];
  for (let i = 0; i < 800; i++) {
    const b = median(sample(base));
    if (b >= 1) draws.push(median(sample(recent)) / b - 1);
  }
  draws.sort((a, b) => a - b);
  return draws.length
    ? [
        draws[Math.floor(draws.length * 0.05)]!,
        draws[Math.floor(draws.length * 0.95)]!,
      ]
    : [0, 0];
}
export function demandMetrics(
  evidence: DemandEvidence,
  asOf: string,
): DemandMetrics {
  const { points, hasConflicts } = completeWeeklySeries(evidence, asOf);
  const values = points.map((p) => p.value),
    recent = values.slice(-8),
    base = values.slice(-16, -8);
  const baseline = median(base),
    current = median(recent);
  const regularWeekly =
    points.length > 1 &&
    !hasConflicts &&
    points.every(
      (p, i) =>
        i === 0 ||
        Math.abs(
          (Date.parse(p.date) - Date.parse(points[i - 1]!.date)) / 86400000 - 7,
        ) < 0.1,
    );
  const usable =
    values.length >= POLICY.minWeeks &&
    regularWeekly &&
    base.length === 8 &&
    baseline >= POLICY.minBaseline &&
    !evidence.error &&
    (!evidence.resolution || evidence.resolution === "WEEK");
  const growth = usable ? current / baseline - 1 : null;
  const band = usable ? growthBand(recent, base) : [null, null];
  const priorYear = values.slice(-60, -52);
  const yearOverYear =
    values.length >= 60 && median(priorYear) >= POLICY.minBaseline
      ? current / median(priorYear) - 1
      : null;
  const slopes: number[] = [];
  for (let i = 0; i < recent.length; i++)
    for (let j = i + 1; j < recent.length; j++)
      slopes.push((recent[j]! - recent[i]!) / (j - i));
  const nonzeroShare = values.length
    ? values.filter((v) => v > 0).length / values.length
    : 0;
  const recentNonzeroShare =
    values.slice(-26).filter((v) => v > 0).length /
    Math.min(26, values.length || 1);
  const change = (weeks: number) => {
    const a = values.slice(-weeks),
      b = values.slice(-2 * weeks, -weeks);
    return usable && b.length === weeks && median(b) >= POLICY.minBaseline
      ? median(a) / median(b) - 1
      : null;
  };
  const shortGrowth = change(4),
    quarterGrowth = change(13);
  const persistence =
    recent.filter((v) => v > baseline * (1 + POLICY.fastGrowth / 2)).length /
    (recent.length || 1);
  const seasonal =
    growth !== null &&
    growth >= POLICY.fastGrowth &&
    yearOverYear !== null &&
    yearOverYear <= 0.1;
  const recentPoints = points.slice(-8),
    anchorMean =
      recentPoints.length === 8 &&
      recentPoints.every((p) => p.anchor !== undefined)
        ? mean(recentPoints.map((p) => p.anchor!))
        : 0;
  const fast =
    usable && recentNonzeroShare >= POLICY.minNonzero
      ? growth! >= POLICY.fastGrowth &&
        (band[0] ?? -1) > 0 &&
        persistence >= 0.75 &&
        !seasonal
      : null;
  let trend: DemandMetrics["trend"] = "unknown";
  if (fast !== null && growth !== null && quarterGrowth !== null) {
    if (seasonal) trend = "mixed";
    else if (
      growth >= POLICY.meaningfulGrowth &&
      (band[0] ?? 0) > 0 &&
      quarterGrowth >= -POLICY.meaningfulGrowth &&
      (shortGrowth ?? -1) >= -POLICY.meaningfulGrowth
    )
      trend = "rising";
    else if (
      growth <= -POLICY.meaningfulGrowth &&
      (band[1] ?? 0) < 0 &&
      quarterGrowth <= POLICY.meaningfulGrowth &&
      (shortGrowth ?? 1) <= POLICY.meaningfulGrowth
    )
      trend = "falling";
    else if (
      Math.abs(growth) < POLICY.meaningfulGrowth &&
      Math.abs(quarterGrowth) < 0.2 &&
      Math.abs(shortGrowth ?? 1) < 0.2
    )
      trend = "stable";
    else trend = "mixed";
  }
  return {
    recent: current,
    baseline,
    growth,
    lower: band[0] ?? null,
    upper: band[1] ?? null,
    yearOverYear: regularWeekly ? yearOverYear : null,
    slope: median(slopes),
    nonzeroShare,
    points: values.length,
    anchorRatio: anchorMean >= 1 ? mean(recent) / anchorMean : null,
    persistence,
    fast,
    seasonal,
    regularWeekly,
    shortGrowth,
    quarterGrowth,
    trend,
    recentNonzeroShare,
  };
}
export function analyze(
  topic: Topic,
  demand: DemandEvidence,
  supply: SupplyEvidence,
  gaps: Gap[] = [],
  asOf = new Date().toISOString(),
): Market {
  const metrics = demandMetrics(demand, asOf);
  const alternateTrends = (demand.alternatives || [])
    .map((d) => demandMetrics(d, asOf).trend)
    .filter((t) => t && t !== "unknown");
  const opposing =
    (metrics.trend === "rising" && alternateTrends.includes("falling")) ||
    (metrics.trend === "falling" && alternateTrends.includes("rising"));
  if (opposing) metrics.trend = "mixed";
  const reasons: string[] = [],
    limitations: string[] = [
      "Google Trends measures relative search attention, not customers, revenue or willingness to pay.",
      "Supply counts active repositories matching the displayed GitHub topic and phrase queries; unmatched and closed-source competitors are outside this coverage.",
    ];
  const stale = (date: string) =>
    !Number.isFinite(Date.parse(date)) ||
    Date.parse(date) > Date.parse(asOf) + 60000 ||
    (Date.parse(asOf) - Date.parse(date)) / 86400000 > POLICY.staleDays;
  const dense = supply.total >= POLICY.denseSupply;
  const supplyKnown =
    !supply.error &&
    Number.isFinite(supply.total) &&
    supply.total >= 0 &&
    (supply.complete || supply.repositories.length >= POLICY.denseSupply);
  const demandStale = stale(demand.fetchedAt),
    supplyStale = stale(supply.fetchedAt);
  const lastPoint = completeWeeklySeries(demand, asOf).points.at(-1);
  const seriesStale = !lastPoint || stale(lastPoint.date);
  const usable =
    supplyKnown &&
    metrics.fast !== null &&
    !demandStale &&
    !supplyStale &&
    !seriesStale;
  const kind: MarketKind =
    !usable || metrics.trend === "mixed" || metrics.trend === "unknown"
      ? "uncertain"
      : dense
        ? metrics.trend === "rising"
          ? "expanding"
          : "contested"
        : metrics.trend === "rising"
          ? "blue"
          : "quiet";
  if (demand.error)
    limitations.push(`Search-demand collection: ${demand.error}`);
  if (demand.collectionError)
    limitations.push(
      `Showing the last successful search snapshot from ${demand.fetchedAt.slice(0, 10)}. Refresh failed: ${demand.collectionError}`,
    );
  if (supply.error) limitations.push(`GitHub collection: ${supply.error}`);
  if (!supply.complete)
    limitations.push(
      "The repository search is incomplete. Displayed supply is not a census.",
    );
  if (metrics.baseline < POLICY.minBaseline)
    limitations.push(
      "Search baseline is too close to zero for a stable growth estimate. Low volume does not prove no demand.",
    );
  if (metrics.points < POLICY.minWeeks)
    limitations.push(
      `At least ${POLICY.minWeeks} complete weekly observations are required.`,
    );
  if (!metrics.regularWeekly)
    limitations.push(
      "The time series must contain consecutive weekly observations; missing, conflicting or differently spaced observations cannot be classified.",
    );
  if ((metrics.recentNonzeroShare ?? metrics.nonzeroShare) < POLICY.minNonzero)
    limitations.push(
      "Too many observations are rounded to zero. Try a broader demand keyword.",
    );
  if (demandStale || supplyStale || seriesStale)
    limitations.push(
      "Evidence is stale or missing. Refresh before relying on a market classification.",
    );
  if (metrics.yearOverYear === null)
    limitations.push("Year-over-year seasonality could not be checked.");
  if (metrics.trend === "mixed")
    limitations.push(
      "Short and longer search windows do not agree, or seasonality may explain the rise. A single market label would overstate the evidence.",
    );
  if (opposing)
    limitations.push(
      "Related search terms move in opposite directions. The primary query is shown unchanged; do not treat one synonym as the whole category.",
    );
  limitations.push(
    "Repository density and search attention are separate observations. Neither proves commercial competition or demand.",
  );
  if (metrics.seasonal)
    reasons.push(
      "Recent search growth repeats last year’s level and is treated as seasonal, not a new breakout.",
    );
  if (metrics.growth !== null)
    reasons.push(
      `Median weekly search interest ${metrics.growth >= 0 ? "rose" : "fell"} ${Math.abs(metrics.growth * 100).toFixed(0)}% across two consecutive eight-week windows.`,
    );
  reasons.push(
    `${supply.total.toLocaleString("en-US")} matching active repositories; the published dense-supply threshold is ${POLICY.denseSupply}.`,
  );
  if (
    metrics.shortGrowth !== null &&
    metrics.shortGrowth !== undefined &&
    metrics.quarterGrowth !== null &&
    metrics.quarterGrowth !== undefined
  )
    reasons.push(
      `Four-week search change: ${(metrics.shortGrowth * 100).toFixed(0)}%; thirteen-week change: ${(metrics.quarterGrowth * 100).toFixed(0)}%. These windows check the direction of the eight-week comparison.`,
    );
  const stars = supply.repositories.map((r) => r.stars).sort((a, b) => b - a),
    totalStars = stars.reduce((a, b) => a + b, 0);
  const concentration =
    totalStars > 0
      ? stars.slice(0, 3).reduce((a, b) => a + b, 0) / totalStars
      : null;
  const confidence =
    kind === "uncertain"
      ? "low"
      : supply.complete &&
          metrics.yearOverYear !== null &&
          (metrics.recentNonzeroShare ?? metrics.nonzeroShare) > 0.85
        ? "high"
        : "moderate";
  const labels = {
    blue: "Search rising · limited observed supply",
    expanding: "Search rising · established supply",
    contested:
      metrics.trend === "falling"
        ? "Search falling · established supply"
        : "Search stable · established supply",
    quiet:
      metrics.trend === "falling"
        ? "Search falling · limited observed supply"
        : "Search stable · limited observed supply",
    uncertain:
      metrics.trend === "mixed"
        ? "Mixed search signals"
        : "More evidence needed",
  };
  const strategies = {
    blue: "Investigate an underserved use case. Validate the problem with users, then move quickly on a focused product.",
    expanding:
      "Demand is growing alongside competition. Look for a specific audience, workflow or cost advantage.",
    contested:
      "Many active repositories match this scope. Check the search direction, alternatives and specific user problems before choosing an entry point.",
    quiet:
      "A small category without sustained search growth. Check external demand before investing; it may be early, niche or inactive.",
    uncertain:
      "Gather stronger evidence or refine the demand keyword. The available data does not support a reliable quadrant.",
  };
  // A transparent ranking aid, not a prediction. Missing evidence never earns a score.
  const score =
    usable && kind !== "uncertain"
      ? Math.round(
          100 *
            (0.55 * clamp((metrics.growth! + 0.25) / 1.25) +
              0.3 / (1 + supply.total / POLICY.denseSupply) +
              0.15 * metrics.persistence),
        )
      : null;
  const id = createHash("sha256")
    .update(
      JSON.stringify({
        v: ALGORITHM_VERSION,
        asOf,
        topic,
        geo: demand.geo,
        demand,
        supply,
        gaps,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  return {
    id,
    version: ALGORITHM_VERSION,
    topic,
    geo: demand.geo,
    asOf,
    kind,
    confidence,
    headline: labels[kind],
    strategy: strategies[kind],
    reasons,
    limitations,
    demand,
    supply,
    metrics,
    supplyDensity: supplyKnown ? (dense ? "dense" : "sparse") : "unknown",
    concentration,
    gaps,
    score,
  };
}
