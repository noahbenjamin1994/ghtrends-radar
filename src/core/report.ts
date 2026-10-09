import { verdictTitle } from "./decision.js";
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
import { reportSections } from "./report-contract.js";
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
  if (m.brief?.decision) {
    // Same six sections, same order, as the page.
    const d = m.brief.decision;
    const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
    const quote = (ref: { id: string; quote: string }) => {
      const source = m.brief!.sources.find((s) => s.id === ref.id);
      return source
        ? [documentQuote(ref.quote), documentLink(source.label, source.url)]
        : [];
    };
    const rows = [...d.commercial, ...d.openSource];
    const name = (id: string) => rows.find((r) => r.id === id)?.name || id;
    const gaps = (lane: string) =>
      d.coverage.gaps
        .filter((g) => g.lane === lane)
        .map((g) => `${g.label} (${g.reason})`)
        .join(l("; ", "；"));
    const framing = m.topic.plan?.framing;
    return [
      `# ${framing ? `${framing.who[locale]}${l(": ", "：")}${framing.task[locale]}` : m.topic.plan?.input || m.topic.name}`,
      m.asOf,
      `## ${l("Conclusion", "结论")}: ${verdictTitle(d)[locale]}`,
      d.verdict.reason[locale],
      ...(d.users?.length
        ? [
            `## ${l("User analysis", "用户分析")}`,
            ...d.users.flatMap((u) => [
              `### ${u.who[locale]}`,
              `${l("Scenario", "使用场景")}${l(": ", "：")}${u.scenario[locale]}`,
              `${l("Needs", "对应需求")}${l(": ", "：")}${u.pains
                .map((id) => d.pains.find((p) => p.id === id)?.title[locale])
                .filter(Boolean)
                .join(l("; ", "；"))}`,
            ]),
          ]
        : []),
      `## ${l("Demand analysis", "需求分析")}`,
      ...(d.pains.length
        ? d.pains.flatMap((p) => [
            `### ${p.title[locale]}`,
            ...p.quotes.flatMap(quote),
            ...(p.workaround
              ? [
                  `${l("Current workaround", "现有做法")}${l(" ", "：")}${p.workaround[locale]}`,
                ]
              : []),
          ])
        : [
            l(
              "No first-hand user account of this problem was collected. That is not proof the problem doesn't exist.",
              "未采集到用户对该问题的一手描述。这不代表问题不存在。",
            ),
          ]),
      ...(gaps("pains")
        ? [`${l("Not collected: ", "未采集到：")}${gaps("pains")}`]
        : []),
      `## ${l("Competitor analysis", "竞品分析")}`,
      ...(d.commercial.length
        ? [
            [
              `| ${l("Commercial", "商业")} | ${l("Target users", "目标用户")} | ${l("Pricing", "定价")} | ${l("Unmet need", "未满足需求")} |`,
              "|---|---|---|---|",
              ...d.commercial.map(
                (c) =>
                  `| ${cell(c.name)} | ${cell(c.audience[locale])} | ${cell(c.pricing?.[locale] || l("not published", "未公开"))} | ${cell(c.gap?.[locale] || "")} |`,
              ),
            ].join("\n"),
          ]
        : []),
      ...(d.openSource.length
        ? [
            [
              `| ${l("Open source", "开源")} | ${l("Features", "功能")} | ${l("Last push", "最近提交")} | ${l("License", "许可证")} |`,
              "|---|---|---|---|",
              ...d.openSource.map(
                (o) =>
                  `| ${o.url ? `[${cell(o.name)}](${o.url})` : cell(o.name)} | ${cell(o.capability[locale])} | ${o.pushedAt?.slice(0, 10) || ""} | ${o.license === undefined ? "" : o.license || l("none stated", "未声明")} |`,
              ),
            ].join("\n"),
          ]
        : []),
      ...(!rows.length
        ? [
            l(
              "No product or project serving these people was read this time.",
              "这次没读到在服务这群人的产品或项目。",
            ),
          ]
        : []),
      ...(gaps("supply")
        ? [
            `${l("This list may be incomplete. Not collected: ", "竞品列表可能不完整。未采集到：")}${gaps("supply")}`,
          ]
        : []),
      `## ${l("Market trend", "市场趋势")}`,
      d.timing.summary[locale],
      `## ${l("Opportunities", "机会方向")}`,
      ...(d.directions.length
        ? d.directions.flatMap((x, i) => [
            `### ${i + 1}. ${x.title[locale]}${x.tentative ? l(" (unconfirmed)", "（待核实）") : ""}`,
            `- ${l("Target users", "目标用户")}${l(": ", "：")}${x.audience[locale]}`,
            `- ${l("Addresses", "对应需求")}${l(": ", "：")}${d.pains.find((p) => p.id === x.pain)?.title[locale] || x.pain}`,
            `- ${l("Market gap", "市场空缺")}${l(": ", "：")}${x.whyOpen[locale]} (${x.supply.map(name).join(", ")})`,
            `- ${l("To validate", "待验证假设")}${l(": ", "：")}${x.uncertainty[locale]}`,
          ])
        : [
            l(
              "No direction: an opening needs a pain that existing supply doesn't cover.",
              "暂无机会方向：机会方向需对应一条现有竞品未满足的需求。",
            ),
          ]),
      ...(d.nextStep
        ? [
            `## ${l("Validation plan", "验证计划")}`,
            d.nextStep.who[locale],
            ...d.nextStep.where.map((w) => documentLink(w.label, w.url)),
            d.nextStep.ask[locale],
            `- ${l("Success criterion", "成功标准")}${l(": ", "：")}${d.nextStep.success[locale]}`,
            `- ${l("Failure criterion", "失败标准")}${l(": ", "：")}${d.nextStep.fail[locale]}`,
          ]
        : []),
      `${l("To confirm through user interviews and paid trials: ", "以下假设需通过用户访谈和付费验证确认：")}${d.unverified.map((u) => u[locale]).join(l("; ", "；"))}`,
      `## ${l("Sources", "来源")}`,
      ...m.brief.sources.flatMap((s) => [
        documentLink(s.label, s.url),
        `${s.fetchedAt || ""}${s.excerptTruncated ? " · excerpt truncated" : ""}`,
        documentQuote(s.excerpt || ""),
      ]),
    ].join("\n\n");
  }
  if (m.brief?.report) {
    const report = m.brief.report;
    const refs = (items: { id: string; quote: string }[]) =>
      items.flatMap((ref) => {
        const source = m.brief!.sources.find((s) => s.id === ref.id);
        return source
          ? [documentLink(source.label, source.url), documentQuote(ref.quote)]
          : [];
      });
    return [
      `# ${report.headline[locale]}`,
      m.asOf,
      report.overview[locale],
      ...reportSections.flatMap(([key, en, zh]) => [
        `## ${locale === "zh" ? zh : en}`,
        report[key].summary[locale],
        ...refs(report[key].evidence),
      ]),
      `## ${locale === "zh" ? "从证据中拆出的方向（进入假设）" : "Evidence-derived directions (hypotheses)"}`,
      ...report.directions.flatMap((d) => [
        `### ${d.title[locale]}`,
        ...[d.task, d.existingSupply, d.entry, d.uncertainty].map(
          (v) => v[locale],
        ),
        ...refs(d.evidence),
      ]),
      ...(!report.directions.length
        ? [
            locale === "zh"
              ? "本轮证据不足以支持具体方向。"
              : "Current evidence does not support a specific direction.",
          ]
        : []),
      `## ${locale === "zh" ? "下一步" : "Next step"}`,
      report.nextStep[locale],
      `## ${locale === "zh" ? "本轮边界" : "Limitations"}`,
      ...report.limitations.map((v) => v[locale]),
      `## ${locale === "zh" ? "来源" : "Sources"}`,
      ...m.brief.sources.flatMap((s) => [
        documentLink(s.label, s.url),
        `${s.fetchedAt || ""}${s.excerptTruncated ? " · excerpt truncated" : ""}`,
        documentQuote(s.excerpt || ""),
      ]),
    ].join("\n\n");
  }
  const strategy =
    a.narrative.kind === "ai" ? visibleStrategy(m.brief, locale) : undefined;
  const map = visibleOpportunities(m.brief);
  return [
    `# ${a.narrative.kind === "ai" && a.narrative.headline ? a.narrative.headline : a.title}`,
    "",
    `${m.asOf.slice(0, 10)} · ${t(m.geo || "Worldwide")} · ${t("Method")} ${m.version} · ${t(m.confidence)} ${t("evidence confidence")}`,
    "",
    `**${a.basisLabel}**`,
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
              ? `${searchEngineLabel(q)} · ${q.fetchedAt || m.web!.fetchedAt} · ${q.region || m.web!.region}${q.engine === "duckduckgo" || q.engine === "brave" ? (locale === "zh" ? " · 备用搜索 · 自然结果" : " · Fallback · Organic results") : ""}`
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
