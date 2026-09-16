import type { Market } from "./types.js";
import { completeWeeklySeries } from "./evidence.js";
import { resolveTopic } from "./topics.js";
import { hasNegativeWording } from "./i18n.js";
import { text, MARKET_LABELS, type Locale } from "./i18n.js";

export function marketAssessment(m: Market, locale: Locale = "en") {
  const t = (value: string, vars: Record<string, string | number> = {}) =>
    text(value, locale, vars);
  const resolved = resolveTopic(m.topic.slug);
  const changed =
    !m.topic.plan &&
    resolved.keyword.toLowerCase() !== m.demand.keyword.toLowerCase() &&
    resolved.aliases.length > 0;
  const scientific = resolved.slug === "ai-for-science";
  const fresh = (stamp: string) => {
    const age = Date.parse(m.asOf) - Date.parse(stamp);
    return Number.isFinite(age) && age >= -60000 && age <= 14 * 86400000;
  };
  const supplyKnown =
    m.supplyDensity !== "unknown" &&
    !m.supply.error &&
    fresh(m.supply.fetchedAt);
  const latestWeek = completeWeeklySeries(m.demand, m.asOf).points.at(-1);
  const searchReady =
    !m.demand.error &&
    fresh(m.demand.fetchedAt) &&
    !!latestWeek &&
    fresh(latestWeek.date) &&
    (m.metrics.fast !== null || !!m.metrics.emerging);
  const provisional = m.kind === "uncertain";
  const suggested = changed
    ? resolved.keyword
    : m.demand.related.find(
        (r) =>
          r.query.trim().toLowerCase() !==
            m.demand.keyword.trim().toLowerCase() &&
          r.query.length <= 100 &&
          !/[<>\x00-\x1f]/.test(r.query),
      )?.query;
  const facts: string[] = [];
  if (supplyKnown)
    facts.push(
      t("{count} active projects match the published GitHub search scope.", {
        count: m.supply.complete ? m.supply.total : "≥" + m.supply.total,
      }),
    );
  if (!m.demand.error && fresh(m.demand.fetchedAt) && m.metrics.points)
    facts.push(
      t(
        "The keyword “{keyword}” has {weeks} complete weeks; {zero}% are reported as zero.",
        {
          keyword: m.demand.keyword,
          weeks: m.metrics.points,
          zero: Math.round((1 - m.metrics.nonzeroShare) * 100),
        },
      ),
    );
  if (changed)
    facts.push(
      t(
        "This snapshot measured “{keyword}”. The recognized field uses “{resolved}”; a new scan is needed.",
        { keyword: m.demand.keyword, resolved: resolved.keyword },
      ),
    );
  let title = t(m.headline),
    summary = t(m.strategy);
  if (provisional) {
    if (m.metrics.trend === "mixed") {
      title = t("Mixed search signals");
      summary = t(
        "The time windows or related search terms disagree. Narrow the use case and compare the original curves before making a market claim.",
      );
    } else if (changed) {
      title = t("Research the field, not just its abbreviation");
      summary = t(
        "Use the recognized field name, then validate a specific workflow. The current keyword sample cannot establish the field’s demand or competition.",
      );
    } else if (supplyKnown && m.supplyDensity === "dense") {
      title = t("Start with a specific competitive advantage");
      summary = t(
        "Active alternatives already exist at scale. Validate a reason for users to switch before committing; search data has not confirmed sustained demand growth.",
      );
    } else if (supplyKnown && m.supply.total > 0) {
      title = t("Validate a focused use case first");
      summary = t(
        "There are active projects in this search scope. Start with their users and unresolved workflows; the available search data does not justify a broad market bet.",
      );
    } else {
      title = t("Test the problem before building");
      summary = t(
        "The available sources cannot establish both competition and demand. Start with user problems and concrete alternatives; an empty search is not proof of an open market.",
      );
    }
  }
  if (!provisional && searchReady && m.metrics.emerging) {
    title = t("Search rising from a small baseline");
    summary = t(
      "Search interest has stayed above a near-zero baseline in at least six of eight weeks. This is an early signal, so no percentage growth is reported. Check the matching projects and validate a specific use case.",
    );
  }
  if (
    !provisional &&
    searchReady &&
    m.metrics.trend !== "mixed" &&
    m.metrics.horizon === "cooling-above-year"
  ) {
    title = t("Cooling recently, still above last year");
    summary = t(
      "The recent search pullback coexists with a higher level than last year. Compare concrete use cases; neither window measures customer demand.",
    );
  }
  if (
    !provisional &&
    searchReady &&
    m.metrics.trend !== "mixed" &&
    m.metrics.horizon === "rebounding-below-year"
  ) {
    title = t("Recovering recently, still below last year");
    summary = t(
      "Recent search attention has improved from a lower base. It has not recovered last year’s level; a seasonal explanation is unproven.",
    );
  }
  if (m.topic.scope === "field") {
    title = t("Choose a workflow within this field");
    summary = t(
      "Use the measured search trajectory to understand the field, then compare tools that serve one audience and one task.",
    );
  }
  if (!provisional && searchReady && m.metrics.seasonal) {
    title = t("Seasonal pattern · compare the same period last year");
    summary = t(
      "The annual search pattern repeats. The landscape uses year-over-year direction; the recent-window change shows the current seasonal phase.",
    );
  }
  const nextSteps = m.demand.error
    ? [
        t("Open Google Trends to review this keyword and region."),
        t(
          m.demand.retryAt
            ? "Refresh after the displayed recovery time."
            : "Refresh the search history using a familiar same-intent phrase.",
        ),
        t(
          "Ask potential users how they solve this problem today and compare specific alternatives.",
        ),
      ]
    : scientific
      ? [
          t(
            "Pick one workflow, such as materials screening, molecule design or experiment planning, and identify its users.",
          ),
          t(
            "Compare active tools for that workflow and ask users which task still takes too much time.",
          ),
          t(
            "Validate willingness to try a concrete solution before building a general AI for Science platform.",
          ),
        ]
      : [
          t(
            "Inspect the leading projects and their unresolved issues to identify a specific user problem.",
          ),
          t(
            "Ask potential users how they solve that problem today and what would make them switch.",
          ),
          t(
            "Repeat the scan with a familiar search phrase and compare the evidence before committing.",
          ),
        ];
  const demandNote = t(
    m.demand.error
      ? "Search history could not be collected"
      : !fresh(m.demand.fetchedAt) || (latestWeek && !fresh(latestWeek.date))
        ? "Search history is out of date"
        : !m.metrics.regularWeekly
          ? "Recent weekly history is missing or incomplete"
          : m.metrics.emerging
            ? "Small baseline; percentage growth is not yet reliable"
            : m.metrics.baseline < 3
              ? "The comparison baseline is too small"
              : m.metrics.fast === null
                ? "Too many weekly values are reported as zero"
                : "Last 8 complete weeks vs previous 8",
  );
  return {
    searchReady,
    demandNote,
    landscape: t(
      m.topic.scope === "field" ? "Field overview" : MARKET_LABELS[m.kind],
    ),
    level: provisional ? ("provisional" as const) : ("measured" as const),
    title,
    summary,
    facts,
    nextSteps,
    scopeNotes: m.limitations.filter((line) =>
      m.demand.error || !m.metrics.regularWeekly
        ? !/Search baseline is too close|Too many observations are rounded/.test(
            line,
          )
        : true,
    ),
    narrative:
      m.brief &&
      [m.brief[locale].summary, ...m.brief[locale].nextSteps].every(
        (v) => !hasNegativeWording(v),
      )
        ? { ...m.brief[locale], kind: "ai" as const }
        : { summary, nextSteps, kind: "evidence" as const },
    queryExplanation:
      m.topic.plan && !hasNegativeWording(m.topic.plan.explanation[locale])
        ? m.topic.plan.explanation[locale]
        : t(
            "The displayed phrases follow this research scope. Review the source links for the exact queries.",
          ),
    ...(provisional && suggested
      ? { suggestedScan: { topic: resolved.slug, keyword: suggested } }
      : {}),
    ...(scientific
      ? {
          contextSources: [
            {
              title: "Microsoft Research AI for Science",
              url: "https://www.microsoft.com/en-us/research/lab/microsoft-research-ai-for-science/",
            },
          ],
        }
      : {}),
  };
}

export function competitionPressure(m: Pick<Market, "competition">): string {
  const c = m.competition;
  if (!c || !c.sampled) return "—";
  if (!c.enumerated) return "≥" + Math.floor(c.score);
  if (c.upper - c.score > 0.001)
    return `${Math.floor(c.score)}–${Math.ceil(c.upper)}`;
  return String(Math.round(c.score));
}
