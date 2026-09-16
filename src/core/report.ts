import type { Market, Repo } from "./types.js";
import { text, localeUrl, type Locale } from "./i18n.js";
import { marketAssessment } from "./assessment.js";
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
    a.summary,
    "",
    ...(m.brief
      ? [
          `## ${t("Research brief")}`,
          "",
          m.brief[locale].summary,
          "",
          ...m.brief[locale].nextSteps.map((s) => "- " + s),
          "",
          t(
            "AI interpretation of the evidence below. Verify the sources before acting.",
          ),
          "",
        ]
      : []),
    ...(m.topic.plan
      ? [
          `## ${t("How we understood your search")}`,
          "",
          m.topic.plan.explanation[locale],
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
    `## ${t("Open demand signals")}`,
    "",
    ...m.gaps.map(
      (g) =>
        `- [${cell(g.title)}](${g.url}) (↑ ${g.reactions}; ${g.state}; ${g.repo})`,
    ),
    "",
    `## ${t("Scope and limitations")}`,
    "",
    ...m.limitations.map((x) => `- ${t(x)}`),
    "",
    baseUrl
      ? `[${t("View this snapshot")}](${localeUrl(baseUrl + "/report/" + m.id, locale)}) · [ghtrends](https://github.com/noahbenjamin1994/ghtrends-radar)`
      : `${t("Local report")} ${m.id} · [ghtrends](https://github.com/noahbenjamin1994/ghtrends-radar)`,
    "",
  ].join("\n");
}
