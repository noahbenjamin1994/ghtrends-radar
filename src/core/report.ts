import {
  documentStatusLabel,
  adCollectionMessage,
  searchCollectionMessage,
  searchEngineLabel,
} from "./evidence.js";
import { landscapeRows, researchLandscape } from "./landscape.js";
import {
  reportIssueSignals,
  issueReading,
  requestStatus,
  requestAction,
} from "./gaps.js";
import {
  visibleOpportunities,
  opportunityRows,
  overviewRows,
} from "./opportunities.js";
import type { Market, Repo } from "./types.js";
import { text, localeUrl, type Locale } from "./i18n.js";
import { marketAssessment, competitionPressure } from "./assessment.js";
import { visibleStrategy, strategyRows } from "./strategy.js";
import { projectUseConditions, projectUseCopy } from "./capabilities.js";
const cell = (s: string) => s.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const documentLink = (label: string, url: string) =>
  `[${cell(label).replace(/[\\\[\]<>]/g, "\\$&")}]` +
  `(<${url.replace(/[<>\r\n]/g, encodeURIComponent)}>)`;
const documentQuote = (source: string) => {
  const fence = "`".repeat(
    Math.max(3, ...[...source.matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
  return `${fence}text\n${source}\n${fence}`;
};
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
  const strategy =
    a.narrative.kind === "ai" ? visibleStrategy(m.brief, locale) : undefined;
  const map = visibleOpportunities(m.brief);
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
          `${t("Open-source competition")}: **${competitionPressure(m)} / 100** · ${t("pressure." + m.competition.level)}`,
          `${t("Open-source alternatives")}: ${m.competition.direct} · ${t("Within {sample} inspected projects").replace("{sample}", String(m.competition.sampled))}`,
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
          ...(map?.overview && !researchLandscape(m)
            ? [
                `## ${locale === "zh" ? "原词整体机会" : "The overall opportunity"}`,
                "",
                ...overviewRows(map.overview, locale).flatMap((row) => [
                  `### ${row.label}`,
                  "",
                  row.text,
                  "",
                ]),
                ...map.overview.evidence.flatMap((ref) => {
                  const source = m.brief!.sources.find((s) => s.id === ref.id);
                  return source
                    ? [`- [${cell(source.label)}](${source.url})`]
                    : [];
                }),
                "",
              ]
            : []),
          ...landscapeRows(m, locale).flatMap((row) => [
            `### ${row.label}`,
            "",
            row.text,
            "",
          ]),
          ...(map
            ? [
                `## ${locale === "zh" ? "细分方向地图" : "Opportunity map"}`,
                "",
                map.selection[locale],
                "",
                ...map.opportunities.flatMap((o) => [
                  `### ${o[locale].title}${o.id === map.recommendedId ? (locale === "zh" ? " · 建议优先" : " · First to explore") : ""}`,
                  "",
                  ...opportunityRows(o, locale).flatMap((r) => [
                    `**${r.label}**`,
                    r.text,
                    "",
                  ]),
                  ...(projectUseConditions(m.brief!, o.id).length
                    ? [
                        `**${projectUseCopy(locale).title}**`,
                        projectUseCopy(locale).text,
                        ...projectUseConditions(m.brief!, o.id).flatMap(
                          (condition) => [
                            documentLink(condition.project, condition.url),
                            documentQuote(condition.quote),
                            "",
                          ],
                        ),
                      ]
                    : []),
                  ...[...o.demand.evidence, ...o.competition.evidence]
                    .filter(
                      (r, i, all) => all.findIndex((x) => x.id === r.id) === i,
                    )
                    .flatMap((r) => {
                      const s = m.brief!.sources.find((s) => s.id === r.id);
                      return s ? [`- [${cell(s.label)}](${s.url})`] : [];
                    }),
                  "",
                ]),
                locale === "zh"
                  ? "资源与工期为首版范围估算；需求与竞争均标明来源信号或研究推断。"
                  : "Resources and timelines estimate the scoped first release. Demand and competition distinguish source signals from research inference.",
                "",
              ]
            : []),
          ...(strategy
            ? strategyRows(strategy, locale).flatMap((row) => [
                `### ${row.label}`,
                "",
                row.text,
                "",
              ])
            : a.narrative.nextSteps.map((s) => "- " + s)),
          ...(strategy
            ? [
                locale === "zh"
                  ? "策略由 AI 提出；数字门槛为建议实验标准，真实结果用于决定下一步。"
                  : "AI strategy hypothesis. Numeric thresholds are proposed experiment criteria; actual outcomes guide the next decision.",
                "",
                ...(m.brief?.evidence || []).flatMap((ref) => {
                  const source = m.brief!.sources.find((s) => s.id === ref.id);
                  return source
                    ? [`- [${cell(source.label)}](${source.url})`]
                    : [];
                }),
              ]
            : []),
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
    `## ${locale === "zh" ? "用户的问题与进展" : "User requests and progress"}`,
    "",
    ...reportIssueSignals(m).flatMap((g) => {
      const reading = issueReading(m.brief, g.url),
        insight = reading?.[locale];
      return [
        `- [${cell(insight?.title || g.title)}](${g.url}) (${[g.reactions == null ? undefined : `↑ ${g.reactions}`, requestStatus(g, locale), g.repo].filter(Boolean).join("; ")})`,
        ...[
          [locale === "zh" ? "发布" : "Posted", g.createdAt],
          [locale === "zh" ? "更新" : "Updated", g.updatedAt],
          [locale === "zh" ? "采集" : "Collected", g.observedAt],
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => `${label}: ${value!.slice(0, 10)}`),
        ...(insight
          ? [
              "",
              insight.audience,
              insight.need,
              ...(insight.currentSolution ? [insight.currentSolution] : []),
              ...(insight.desiredOutcome ? [insight.desiredOutcome] : []),
              requestAction(g, insight.opportunity, locale),
              insight.check,
              `> ${reading!.evidence.quote.replace(/\n/g, "\n> ")}`,
              "",
            ]
          : []),
      ];
    }),
    ...(m.web
      ? [
          "",
          `## ${locale === "zh" ? "网页搜索证据" : "Web search evidence"}`,
          "",
          `${m.web.region} · ${m.web.language} · ${m.web.fetchedAt.slice(0, 10)}`,
          searchCollectionMessage(m.web, locale),
          adCollectionMessage(m.web, locale),
          locale === "zh"
            ? "搜索结果为地域样本。广告反映商业投放意向，购买与持续使用需要行为证据。"
            : "A regional search sample. Ads signal marketing intent; purchases and sustained use need behavioral evidence.",
          ...m.web.queries.flatMap((q) => [
            "",
            `### ${cell(q.query)}`,
            q.state === "ready"
              ? `${searchEngineLabel(q)} · ${q.fetchedAt || m.web!.fetchedAt} · ${q.region || m.web!.region}${q.engine === "duckduckgo" ? (locale === "zh" ? " · 备用搜索 · 自然结果" : " · Fallback · Organic results") : ""}`
              : locale === "zh"
                ? "采集已暂停 · 可更新研究后重试"
                : "Collection stopped · update research to retry",
            ...q.results.map(
              (r) =>
                `- ${r.kind === "ad" ? (locale === "zh" ? "广告" : "Ad") : locale === "zh" ? "自然结果" : "Organic"}: [${cell(r.title)}](${r.url}) — ${cell(r.excerpt)}${r.kind === "ad" ? ` · ${locale === "zh" ? "投放网站" : "Landing-page website"}: ${new URL(r.url).hostname}` : ""}`,
            ),
          ]),
        ]
      : []),
    "",
    ...(m.documents
      ? [
          `## ${locale === "zh" ? "原文与许可" : "Original text and licenses"}`,
          ...m.documents.sources.flatMap((s) => [
            `### ${documentLink(s.label, s.url)}`,
            ...(s.publishedAt
              ? [`${locale === "zh" ? "发布" : "Published"}: ${s.publishedAt}`]
              : []),
            `${locale === "zh" ? "采集" : "Collected"}: ${s.fetchedAt || ""}`,
            ...(s.parentUrl
              ? [
                  documentLink(
                    locale === "zh" ? "查看上下文" : "Discussion context",
                    s.parentUrl,
                  ),
                ]
              : []),
            documentQuote(s.excerpt || ""),
          ]),
          ...m.documents.reads
            .filter((r) => r.status !== "read")
            .map(
              (r) =>
                `- ${documentLink(r.url, r.url)}: ${documentStatusLabel(r.status, locale)}`,
            ),
          "",
        ]
      : []),
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
