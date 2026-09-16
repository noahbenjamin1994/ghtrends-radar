import type { Market } from "./types.js";
import { resolveTopic } from "./topics.js";
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
  if (!provisional && m.metrics.horizon === "cooling-above-year") {
    title = t("Cooling recently, still above last year");
    summary = t(
      "The recent search pullback coexists with a higher level than last year. Compare concrete use cases; neither window measures customer demand.",
    );
  }
  if (!provisional && m.metrics.horizon === "rebounding-below-year") {
    title = t("Recovering recently, still below last year");
    summary = t(
      "Recent search attention has improved from a lower base. It has not recovered last year’s level; a seasonal explanation is unproven.",
    );
  }
  const nextSteps = scientific
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
  return {
    landscape: t(MARKET_LABELS[m.kind]),
    level: provisional ? ("provisional" as const) : ("measured" as const),
    title,
    summary,
    facts,
    nextSteps,
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
