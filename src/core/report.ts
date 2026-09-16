import type { Market, Repo } from "./types.js";
import { text, localeUrl, type Locale } from "./i18n.js";
import { marketAssessment, competitionPressure } from "./assessment.js";
const cell = (s: string) => s.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
export function compareMarkdown(repos: Repo[], locale: Locale = "en"): string {
  const t = (s: string) => text(s, locale);
  return [
    "| " +
      [
        "Repository",
        "Stars",
        "7-day stars",
        "30-day stars",
        "Last push",
        "License",
      ]
        .map(t)
        .join(" | ") +
      " |",
    "|---|---:|---:|---:|---|---|",
    ...repos.map(
      (r) =>
        `| [${cell(r.name)}](${r.url}) | ${r.stars} | ${r.growth7d ?? t("Unavailable")} | ${r.growth30d ?? t("Unavailable")} | ${r.pushedAt.slice(0, 10)} | ${r.license ?? t("Not specified")} |`,
    ),
  ].join("\n");
}
export function marketMarkdown(
  m: Market,
  baseUrl?: string,
  locale: Locale = "en",
): string {
  const t = (s: string) => text(s, locale),
    a = marketAssessment(m, locale);
  return [
    `# ${t(m.topic.name)}: ${a.title}`,
    "",
    `${m.asOf.slice(0, 10)} · ${t(m.geo || "Worldwide")} · ${t("Method")} ${m.version} · ${t(m.confidence)} ${t("evidence confidence")}`,
    "",
    `**${t(a.level === "provisional" ? "Preliminary recommendation" : "Measured classification")}**`,
    "",
    `${t("Landscape")}: **${a.landscape}**`,
    `${t("Measured search term")}: ${cell(m.demand.keyword)}`,
    a.demandNote,
    ...(m.competition
      ? [
          `${t("Competition pressure")}: **${competitionPressure(m)} / 100** · ${t("pressure." + m.competition.level)}`,
          `${t("Direct alternatives")}: ${m.competition.direct} · ${t("Within {sample} inspected projects").replace("{sample}", String(m.competition.sampled))}`,
          `${t("Direction basis")}: ${t("basis." + (m.metrics.directionBasis || "recent-windows"))}`,
        ]
      : []),
    ...(m.demand.retryAt
      ? [`${t("Google Trends refresh window")}: ${m.demand.retryAt}`]
      : []),
    "",
    a.summary,
    "",
    ...(m.brief
      ? [
          `## ${t("Research brief")}`,
          "",
          a.narrative.summary,
          "",
          ...a.narrative.nextSteps.map((s) => "- " + s),
          "",
          t(
            a.narrative.kind === "ai"
              ? "AI interpretation of the evidence below. Verify the sources before acting."
              : "This recommendation follows the collected source evidence.",
          ),
          "",
        ]
      : []),
    ...(m.topic.plan
      ? [
          `## ${t("How we understood your search")}`,
          "",
          a.queryExplanation || "",
          "",
          `- Google Trends: ${m.topic.plan.trends.join(" · ")}`,
          `- GitHub: ${(m.topic.queries || [m.topic.query]).join(" · ")}`,
          "",
        ]
      : []),
    ...(a.level === "provisional"
      ? [
          `## ${t("What we know")}`,
          "",
          ...a.facts.map((x) => `- ${x}`),
          "",
          `## ${t("What to do next")}`,
          "",
          ...a.nextSteps.map((x, i) => `${i + 1}. ${x}`),
          "",
        ]
      : []),
    ...(m.demand.selectionReason
      ? [
          t(m.demand.selectionReason),
          `${m.demand.requestedKeyword} → ${m.demand.keyword}`,
          "",
        ]
      : []),
    `## ${t("Evidence")}`,
    "",
    ...m.reasons.map((x) => `- ${t(x)}`),
    "",
    `- ${t("Search demand")}: [Google Trends](${m.demand.sourceUrl})`,
    ...(m.supply.searches?.length
      ? m.supply.searches
      : [{ url: m.supply.sourceUrl, query: m.supply.query }]
    ).map(
      (source) => `- ${t("Supply")}: [${cell(source.query)}](${source.url})`,
    ),
    "",
    `## ${t("Leading repositories")}`,
    "",
    compareMarkdown(m.supply.repositories.slice(0, 10), locale),
    "",
    ...(m.competition
      ? [
          `## ${t("Review project roles")}`,
          "",
          `| ${t("Repository")} | ${t("Roles in the inspected sample")} | ${t("Evidence")} |`,
          "|---|---|---|",
          ...m.supply.repositories
            .slice(0, 60)
            .map(
              (r) =>
                `| [${cell(r.name)}](${r.url}) | ${t("role." + (r.relevance?.role || "unclear"))} | ${cell(r.relevance?.method === "model" ? r.relevance.reason : t(r.relevance?.reason || "Project role awaiting closer review"))} |`,
            ),
          "",
        ]
      : []),
    `## ${t("Open demand signals")}`,
    "",
    ...m.gaps.map(
      (g) =>
        `- [${cell(g.title)}](${g.url}) (↑ ${g.reactions}; ${g.state}; ${g.repo})`,
    ),
    "",
    `## ${t("Scope and limitations")}`,
    "",
    ...a.scopeNotes.map((x) => `- ${t(x)}`),
    "",
    baseUrl
      ? `[${t("View this snapshot")}](${localeUrl(baseUrl + "/report/" + m.id, locale)}) · [ghtrends](https://github.com/noahbenjamin1994/ghtrends-radar)`
      : `${t("Local report")} ${m.id} · [ghtrends](https://github.com/noahbenjamin1994/ghtrends-radar)`,
    "",
  ].join("\n");
}
