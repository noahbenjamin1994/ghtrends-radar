import { createHash } from "node:crypto";
import { assessCompetition, repoRelevance } from "./competition.js";
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
import { ALGORITHM_VERSION } from "./version.js";
export { ALGORITHM_VERSION } from "./version.js";
// Operational thresholds, published and configurable in code; not universal market laws.
export const POLICY = {
  minStars: 1,
  activeDays: 365,
  minWeeks: 26,
  windowWeeks: 8,
  fastGrowth: 0.25,
  meaningfulGrowth: 0.1,
  minBaseline: 3,
  emergingLevel: 10,
  emergingWeeks: 6,
  emergingRetention: 0.8,
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
  const { points, conflictDates } = completeWeeklySeries(evidence, asOf);
  const latest = points.at(-1);
  const recentCoverage = points.filter(
    (p) =>
      latest &&
      Date.parse(p.date) >= Date.parse(latest.date) - 25 * 7 * 86400000,
  );
  const values = points.map((p) => p.value),
    recent = values.slice(-8),
    base = values.slice(-16, -8);
  const baseline = median(base),
    current = median(recent);
  const regularWeekly =
    recentCoverage.length === POLICY.minWeeks &&
    !conflictDates.some(
      (time) => latest && time >= Date.parse(latest.date) - 25 * 7 * 86400000,
    ) &&
    recentCoverage.every(
      (p, i) =>
        i === 0 ||
        Math.abs(
          (Date.parse(p.date) - Date.parse(recentCoverage[i - 1]!.date)) /
            86400000 -
            7,
        ) < 0.1,
    );
  const validHistory =
    values.length >= POLICY.minWeeks &&
    regularWeekly &&
    base.length === 8 &&
    !evidence.error &&
    (!evidence.resolution || evidence.resolution === "WEEK");
  const usable = validHistory && baseline >= POLICY.minBaseline;
  // A persistent new signal can rise from a near-zero baseline without a
  // meaningful percentage. Six of eight weeks rules out an isolated spike.
  const emerging =
    validHistory &&
    baseline < POLICY.minBaseline &&
    current >= POLICY.emergingLevel &&
    recent.filter((v) => v >= POLICY.emergingLevel).length >=
      POLICY.emergingWeeks &&
    median(recent.slice(-4)) >=
      median(recent.slice(0, 4)) * POLICY.emergingRetention;
  const growth = usable ? current / baseline - 1 : null;
  const band = usable ? growthBand(recent, base) : [null, null];
  // Match dates, not array positions: old missing weeks must not shift YoY.
  const byDate = new Map(points.map((p) => [Date.parse(p.date), p.value]));
  const priorYear = points
    .slice(-8)
    .map((p) => byDate.get(Date.parse(p.date) - 52 * 7 * 86400000))
    .filter((v): v is number => v !== undefined);
  const yearOverYear =
    validHistory &&
    priorYear.length === 8 &&
    median(priorYear) >= POLICY.minBaseline
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
    return validHistory && b.length === weeks && median(b) >= POLICY.minBaseline
      ? median(a) / median(b) - 1
      : null;
  };
  const shortGrowth = change(4),
    quarterGrowth = change(13);
  const persistence =
    recent.filter((v) => v > baseline * (1 + POLICY.fastGrowth / 2)).length /
    (recent.length || 1);
  // Recurring shape across two full annual cycles, rather than just two levels.
  // Exact date pairing tolerates older gaps without shifting the seasonal phase.
  const annual = points.slice(-52).flatMap((p) => {
    const prior = byDate.get(Date.parse(p.date) - 52 * 7 * 86400000);
    return prior === undefined ? [] : [{ current: p.value, prior }];
  });
  const correlation = (a: number[], b: number[]) => {
    const am = mean(a),
      bm = mean(b);
    const numerator = a.reduce((s, v, i) => s + (v - am) * (b[i]! - bm), 0);
    const denominator = Math.sqrt(
      a.reduce((s, v) => s + (v - am) ** 2, 0) *
        b.reduce((s, v) => s + (v - bm) ** 2, 0),
    );
    return denominator > 0 ? numerator / denominator : 0;
  };
  const cycling = (a: number[]) => {
    // Four-week blocks retain narrow holiday peaks that quarterly medians erase.
    const blocks = Math.floor(a.length / 4);
    const q = Array.from({ length: blocks }, (_, i) =>
      median(
        a.slice(
          Math.floor((i * a.length) / blocks),
          Math.floor(((i + 1) * a.length) / blocks),
        ),
      ),
    );
    const changes = q.slice(1).map((v, i) => v - q[i]!);
    const range = Math.max(...q) - Math.min(...q);
    return (
      range >= Math.max(5, median(a) * 0.35) &&
      changes.some((d) => d > range * 0.15) &&
      changes.some((d) => d < -range * 0.15)
    );
  };
  const seasonalCorrelation =
    annual.length >= 40
      ? correlation(
          annual.map((p) => p.current),
          annual.map((p) => p.prior),
        )
      : null;
  const seasonal =
    validHistory &&
    annual.length >= 40 &&
    (seasonalCorrelation ?? 0) >= 0.75 &&
    cycling(annual.map((p) => p.current)) &&
    cycling(annual.map((p) => p.prior));
  const yearBand =
    yearOverYear !== null ? growthBand(recent, priorYear) : [null, null];
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
  let trend: DemandMetrics["trend"] = emerging ? "rising" : "unknown";
  if (fast !== null && growth !== null && quarterGrowth !== null) {
    if (
      growth >= POLICY.meaningfulGrowth &&
      current - baseline >= 2 &&
      (band[0] ?? 0) > 0 &&
      quarterGrowth >= -POLICY.meaningfulGrowth &&
      (shortGrowth ?? -1) >= -POLICY.meaningfulGrowth
    )
      trend = "rising";
    else if (
      growth <= -POLICY.meaningfulGrowth &&
      baseline - current >= 2 &&
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
  let directionBasis: DemandMetrics["directionBasis"] = "recent-windows";
  // Slow, persistent changes can be clear over a quarter while an eight-week
  // percentage stays below 10%. Require agreement, a stable band and a real
  // index change, rather than raising a trend from year-on-year context alone.
  if (
    usable &&
    growth !== null &&
    Math.abs(growth) < POLICY.meaningfulGrowth &&
    quarterGrowth !== null
  ) {
    const qr = values.slice(-13),
      qb = values.slice(-26, -13);
    const qband = growthBand(qr, qb);
    if (
      quarterGrowth >= POLICY.meaningfulGrowth &&
      growth > 0 &&
      (shortGrowth ?? -1) >= 0 &&
      qband[0] > 0 &&
      median(qr) - median(qb) >= 2
    ) {
      trend = "rising";
      directionBasis = "sustained-quarter";
    }
    if (
      quarterGrowth <= -POLICY.meaningfulGrowth &&
      growth < 0 &&
      (shortGrowth ?? 1) <= 0 &&
      qband[1] < 0 &&
      median(qb) - median(qr) >= 2
    ) {
      trend = "falling";
      directionBasis = "sustained-quarter";
    }
  }
  // Seasonal categories compare the same eight calendar weeks year over year.
  // Keep the raw sequential-window percentage visible as a separate measurement.
  if (
    seasonal &&
    yearOverYear !== null &&
    usable &&
    recentNonzeroShare >= POLICY.minNonzero
  ) {
    directionBasis = "seasonal-year";
    if (
      yearOverYear >= POLICY.meaningfulGrowth &&
      (yearBand[0] ?? 0) > 0 &&
      current - median(priorYear) >= 2
    )
      trend = "rising";
    else if (
      yearOverYear <= -POLICY.meaningfulGrowth &&
      (yearBand[1] ?? 0) < 0 &&
      median(priorYear) - current >= 2
    )
      trend = "falling";
    else if (Math.abs(yearOverYear) < POLICY.meaningfulGrowth) trend = "stable";
    else trend = "mixed";
  }
  const horizon: DemandMetrics["horizon"] =
    growth !== null && yearOverYear !== null
      ? growth <= -POLICY.meaningfulGrowth &&
        yearOverYear >= POLICY.meaningfulGrowth
        ? "cooling-above-year"
        : growth >= POLICY.meaningfulGrowth &&
            yearOverYear <= -POLICY.meaningfulGrowth
          ? "rebounding-below-year"
          : "aligned"
      : "unavailable";
  const windowDates = (weeks: number) => {
    if (!regularWeekly) return undefined;
    const current = points.slice(-weeks),
      previous = points.slice(-2 * weeks, -weeks);
    return {
      recentStart: current[0]!.date,
      recentEnd: new Date(
        Date.parse(current.at(-1)!.date) + 6 * 86400000,
      ).toISOString(),
      baselineStart: previous[0]!.date,
      baselineEnd: new Date(
        Date.parse(previous.at(-1)!.date) + 6 * 86400000,
      ).toISOString(),
    };
  };
  return {
    horizon,
    directionBasis,
    seasonalCorrelation,
    yearLower: yearBand[0] ?? null,
    yearUpper: yearBand[1] ?? null,
    emerging,
    windows: {
      short: windowDates(4),
      main: windowDates(8),
      quarter: windowDates(13),
    },
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
  supply = {
    ...supply,
    repositories: supply.repositories.map((r) => ({
      ...r,
      relevance: r.relevance || repoRelevance(r, topic),
    })),
  };
  const metrics = demandMetrics(demand, asOf);
  const alternateTrends = (demand.alternatives || [])
    .filter((d) => {
      const last = completeWeeklySeries(d, asOf).points.at(-1);
      return [d.fetchedAt, last?.date].every(
        (stamp) =>
          stamp &&
          Number.isFinite(Date.parse(stamp)) &&
          Date.parse(stamp) <= Date.parse(asOf) + 60000 &&
          Date.parse(asOf) - Date.parse(stamp) <= POLICY.staleDays * 86400000,
      );
    })
    .map((d) => demandMetrics(d, asOf).trend)
    .filter((t) => t && t !== "unknown");
  const opposing =
    (metrics.trend === "rising" && alternateTrends.includes("falling")) ||
    (metrics.trend === "falling" && alternateTrends.includes("rising"));
  metrics.synonymAgreement = {
    measured: alternateTrends.length + Number(metrics.trend !== "unknown"),
    agreeing:
      alternateTrends.filter((t) => t === metrics.trend).length +
      Number(metrics.trend !== "unknown"),
    opposing: alternateTrends.filter(
      (t) =>
        (metrics.trend === "rising" && t === "falling") ||
        (metrics.trend === "falling" && t === "rising"),
    ).length,
  };
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
  const competition = assessCompetition(topic, supply, asOf);
  const dense = competition.level === "established";
  const supplyKnown = competition.level !== "pending";
  const demandStale = stale(demand.fetchedAt),
    supplyStale = stale(supply.fetchedAt);
  const lastPoint = completeWeeklySeries(demand, asOf).points.at(-1);
  const seriesStale = !lastPoint || stale(lastPoint.date);
  const usable =
    supplyKnown &&
    (metrics.fast !== null || metrics.emerging) &&
    !demandStale &&
    !supplyStale &&
    !seriesStale;
  const kind: MarketKind =
    topic.scope === "field" || !supplyKnown || supplyStale
      ? "uncertain"
      : dense
        ? usable && metrics.trend === "rising"
          ? "expanding"
          : "contested"
        : !usable || metrics.trend === "mixed" || metrics.trend === "unknown"
          ? "uncertain"
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
  if (
    !demand.error &&
    metrics.regularWeekly &&
    metrics.baseline < POLICY.minBaseline &&
    !metrics.emerging
  )
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
  if (
    !demand.error &&
    metrics.regularWeekly &&
    !metrics.emerging &&
    (metrics.recentNonzeroShare ?? metrics.nonzeroShare) < POLICY.minNonzero
  )
    limitations.push(
      "Too many observations are rounded to zero. Try a broader demand keyword.",
    );
  if (demandStale || supplyStale || seriesStale)
    limitations.push(
      "Evidence is stale or missing. Refresh before relying on a market classification.",
    );
  if (metrics.yearOverYear === null)
    limitations.push(
      "The same eight-week period last year could not be compared.",
    );
  if (metrics.trend === "mixed")
    limitations.push(
      "Search windows or related terms show mixed directions. The competition assessment remains tied to the observed alternatives; compare the source curves for search momentum.",
    );
  if (opposing)
    limitations.push(
      "Related search terms move in opposite directions. The primary query is shown unchanged; do not treat one synonym as the whole category.",
    );
  limitations.push(
    "Repository density and search attention are separate observations. Neither proves commercial competition or demand.",
  );
  if (metrics.horizon === "cooling-above-year")
    reasons.push(
      "Search attention is cooling recently but remains above the same period last year. A pullback is not a long-term decline.",
    );
  if (metrics.horizon === "rebounding-below-year")
    reasons.push(
      "Search attention is recovering recently but remains below the same period last year. This does not establish seasonality.",
    );
  if (metrics.emerging) {
    reasons.push(
      "Search interest is newly sustained above a near-zero baseline in at least six of the last eight weeks. A percentage would be misleading.",
    );
    limitations.push(
      "This is an early search signal. Its small historical baseline cannot establish sustained market demand.",
    );
  }
  if (metrics.growth !== null)
    reasons.push(
      `Median weekly search interest ${metrics.growth >= 0 ? "rose" : "fell"} ${Math.abs(metrics.growth * 100).toFixed(0)}% across two consecutive eight-week windows.`,
    );
  reasons.push(
    `${supply.complete ? "" : "≥"}${supply.total.toLocaleString("en-US")} matching active repositories; this is search coverage, not a count of direct competitors.`,
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
  const concentration = competition.concentration;
  if (metrics.directionBasis === "sustained-quarter")
    reasons.push(
      "Search direction follows a sustained thirteen-week change, supported by the shorter windows and the resampling range.",
    );
  if (metrics.seasonal)
    reasons.push(
      "A recurring annual search pattern is present. Direction uses the same eight-week period last year; recent-window change remains visible separately.",
    );
  if (competition.sampled) {
    reasons.push(
      `Project roles: ${competition.direct} direct alternatives, ${competition.adjacent} adjacent projects, ${competition.resources} resources, ${competition.unclear} awaiting review.`,
    );
    reasons.push(
      `Competition pressure: ${competition.score.toFixed(0)}–${competition.upper.toFixed(0)}/100; breadth ${competition.breadth.toFixed(0)}, established alternatives ${competition.incumbency.toFixed(0)}, leading project strength ${competition.dominance.toFixed(0)}.`,
    );
  }
  limitations.push(
    "Competition pressure is an operational index of observed open-source alternatives. Stars and forks indicate developer attention and reuse; user adoption and commercial products deserve separate research.",
  );
  if (!competition.enumerated)
    limitations.push(
      "The displayed projects form a stars-ranked sample. Competition pressure is a lower bound; wider coverage can strengthen the assessment.",
    );
  if (competition.unclear)
    limitations.push(
      "Some project roles await closer review. The pressure range includes their possible contribution.",
    );
  if (supply.review?.status === "fallback")
    limitations.push(
      "Project roles use local metadata rules. A refreshed scan can add an AI review of the descriptions.",
    );
  const confidence =
    kind === "uncertain" ||
    !usable ||
    metrics.trend === "mixed" ||
    metrics.emerging ||
    competition.boundary ||
    competition.direct < 3 ||
    supply.review?.status === "fallback"
      ? "low"
      : "moderate";
  if (topic.scope === "field")
    limitations.push(
      "This field spans several user workflows. Use the search trajectory as context and compare alternatives within one workflow.",
    );
  const labels = {
    blue: "Search rising · limited observed competition",
    expanding: "Search rising · established alternatives",
    contested: !usable
      ? "Established alternatives · search history pending"
      : metrics.trend === "mixed"
        ? "Established alternatives · mixed search signals"
        : metrics.trend === "falling"
          ? "Search falling · established alternatives"
          : "Search stable · established alternatives",
    quiet:
      metrics.trend === "falling"
        ? "Search falling · limited observed competition"
        : "Search stable · limited observed competition",
    uncertain:
      metrics.trend === "mixed"
        ? "Mixed search signals"
        : "More evidence needed",
  };
  const strategies = {
    blue: "Investigate an underserved use case. Validate the problem with users, then move quickly on a focused product.",
    expanding:
      "Search attention is rising alongside established open-source alternatives. Focus on a specific audience, workflow or product advantage.",
    contested:
      "Established open-source alternatives shape this category. Compare their strengths and find a concrete reason for users to choose your product.",
    quiet:
      "Observed competition is limited and search interest is stable or cooling. Explore a focused niche and validate user needs.",
    uncertain:
      "Review the measured search direction and project roles. Complete the highlighted evidence before choosing a market strategy.",
  };
  // No calibrated opportunity score: keyword scope changes counts and scale.
  const score = null;
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
    headline:
      kind !== "uncertain" && metrics.horizon === "cooling-above-year"
        ? "Cooling recently, still above last year"
        : kind !== "uncertain" && metrics.horizon === "rebounding-below-year"
          ? "Recovering recently, still below last year"
          : labels[kind],
    strategy: strategies[kind],
    reasons,
    limitations,
    demand,
    supply,
    metrics,
    supplyDensity: supplyKnown ? (dense ? "dense" : "sparse") : "unknown",
    concentration,
    competition,
    gaps,
    score,
  };
}
