import { researchLandscape, landscapeLabel } from "./landscape.js";
import type { Market } from "./types.js";
import { completeWeeklySeries } from "./evidence.js";
import { resolveTopic } from "./topics.js";
import { hasNegativeWording, hasRecoveryTimeReference } from "./i18n.js";
import { text, MARKET_LABELS, type Locale } from "./i18n.js";

export function outlookPresentation(kind: Market["kind"], locale: Locale) {
  const themes = {
    expanding: {
      color: "#b44336",
      wash: "#fcf5f1",
      en: "Interest is rising. Find your way in.",
      zh: "热度在涨，找准你的切口。",
    },
    contested: {
      color: "#b33d47",
      wash: "#fcf3f3",
      en: "A crowded field. Make your answer distinct.",
      zh: "拥挤的赛道，需要鲜明的答案。",
    },
    blue: {
      color: "#176c91",
      wash: "#f0f7fa",
      en: "An opening to explore. Make the first test count.",
      zh: "机会初现，让第一步更有把握。",
    },
    quiet: {
      color: "#666b8a",
      wash: "#f5f5f9",
      en: "Start with a niche. Find a need worth serving.",
      zh: "从小众需求里，寻找下一步。",
    },
    uncertain: {
      color: "#78684b",
      wash: "#f8f6f1",
      en: "A clearer question. A stronger next move.",
      zh: "看清问题，让下一步更笃定。",
    },
  };
  const theme = themes[kind];
  return {
    color: theme.color,
    wash: theme.wash,
    line: locale === "zh" ? theme.zh : theme.en,
  };
}

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
  const recoveryTime =
    m.demand.retryAt || m.demand.alternatives?.some((d) => d.retryAt);
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
  const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
  if (provisional) {
    if (searchReady && m.metrics.trend === "falling") {
      title = l(
        "Search is cooling. Start with a focused test.",
        "搜索热度回落，先做轻量验证",
      );
      summary = l(
        "Recent search attention is falling. Test one specific use case with a small prototype; use the observed projects and customer conversations to choose your investment.",
        "近期搜索关注度呈下降趋势。先用小原型验证一个具体场景，再结合现有项目和用户反馈决定投入。",
      );
    } else if (searchReady && m.metrics.trend === "rising") {
      title = l(
        "Attention is rising. Find your entry point.",
        "搜索关注度上升，寻找具体切入点",
      );
      summary = l(
        "Growing search attention provides a research lead. Compare alternatives for one audience and test a focused offer while expanding competition coverage.",
        "搜索增长提供了值得跟进的线索。围绕一类用户比较替代方案，测试具体产品，并继续补充竞品覆盖。",
      );
    } else if (searchReady && m.metrics.trend === "stable") {
      title = l(
        "Steady attention. Win a specific use case.",
        "关注度平稳，从具体场景切入",
      );
      summary = l(
        "Search attention is steady. Focus on a recurring task and a clear improvement over the way people solve it today.",
        "搜索关注度保持平稳。优先选择反复发生的任务，验证相对现有做法的明确提升。",
      );
    } else if (m.metrics.trend === "mixed") {
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
  const research = researchLandscape(m);
  // A broad subject changes the scope of a conclusion, not the observed
  // competition. Keep the raw quadrant intact and qualify the rendered verdict.
  const kind: Market["kind"] =
    research && research.kind !== "uncertain"
      ? research.kind
      : m.kind !== "uncertain"
        ? m.kind
        : supplyKnown && m.competition?.level === "established"
          ? searchReady && m.metrics.trend === "rising"
            ? "expanding"
            : "contested"
          : "uncertain";
  const scope =
    research && research.kind !== "uncertain" ? "market" : "opensource";
  const topicName =
    locale === "zh" ? m.topic.plan?.input || t(m.topic.name) : t(m.topic.name);
  const landscape =
    kind === "uncertain"
      ? l("Ocean verdict pending", "红海 / 蓝海待定")
      : scope === "market"
        ? landscapeLabel(kind, locale)
        : t(MARKET_LABELS[kind]);
  const trend = searchReady
    ? l(
        {
          rising: "rising",
          falling: "falling",
          stable: "steady",
          mixed: "mixed",
          unknown: "awaiting assessment",
        }[m.metrics.trend || "unknown"],
        {
          rising: "上升",
          falling: "回落",
          stable: "平稳",
          mixed: "方向分化",
          unknown: "待核对",
        }[m.metrics.trend || "unknown"],
      )
    : l("awaiting a usable weekly series", "待补充完整周数据");
  const direct = supplyKnown ? m.competition?.direct : undefined;
  const evidenceSummary = [
    l(
      `Search attention for “${m.demand.keyword}” is ${trend}.`,
      `“${m.demand.keyword}”的搜索关注度${trend}。`,
    ),
    ...(direct !== undefined
      ? [
          l(
            `${direct} reviewed open-source projects serve this task.`,
            `当前审核范围内有 ${direct} 个同类开源项目。`,
          ),
        ]
      : []),
  ].join(" ");
  const reason =
    scope === "market" && (kind === "contested" || kind === "expanding")
      ? l(
          `Source-backed competitors already serve this market; search attention ${trend}.`,
          `来源显示已有同行服务这个市场，搜索关注度${trend}。`,
        )
      : scope === "market" && m.brief?.landscape
        ? m.brief.landscape[locale].competition
        : kind === "contested" || kind === "expanding"
          ? l(
              `Established open-source alternatives; search attention ${trend}.`,
              `开源替代方案已有规模，搜索关注度${trend}。`,
            )
          : kind === "blue"
            ? l(
                "Rising search attention with limited observed open-source alternatives.",
                "搜索关注度上升，当前观察到的开源替代方案较少。",
              )
            : kind === "quiet"
              ? l(
                  "Limited observed open-source alternatives; test the size of one recurring user task.",
                  "已观察到的开源供给较少，先验证一个具体任务的使用频率。",
                )
              : evidenceSummary;
  // Keep fallback prose tied to the actual query and observations. A generated
  // section may enrich these facts; a collection or writing failure never erases them.
  if (m.topic.scope === "field") {
    title = `${topicName}：${landscape}`;
    if (locale === "en") title = `${topicName}: ${landscape}`;
    summary =
      evidenceSummary +
      " " +
      (kind === "contested" || kind === "expanding"
        ? l(
            "Compare what existing tools already deliver, then test a specific improvement for their users. This verdict covers the observed open-source landscape; commercial offers are listed separately below.",
            "先比较现有工具已经解决的任务，再验证用户愿意采用的具体改进。此处判断对应已观察的开源竞争，商业方案见下方来源。",
          )
        : l(
            "Use the collected projects and product pages below to compare specific user tasks and entry requirements.",
            "结合下方采集到的项目与产品页面，比较具体用户任务和进入条件。",
          ));
  } else {
    title = `${topicName}${locale === "zh" ? "：" : ": "}${title}`;
    summary = `${evidenceSummary} ${summary}`;
  }
  return {
    kind,
    reason,
    scope,
    basisLabel:
      scope === "market"
        ? l("Market research assessment", "综合市场研判")
        : l("Search × open-source competition", "搜索趋势 × 开源竞争"),
    searchReady,
    demandNote,
    landscape,
    level:
      provisional || research
        ? ("provisional" as const)
        : ("measured" as const),
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
      [
        m.brief[locale].headline || "",
        m.brief[locale].summary,
        ...m.brief[locale].nextSteps,
      ].every(
        (v) =>
          !hasNegativeWording(v) &&
          !new RegExp(
            `(?:across|over|throughout)\\s+${m.metrics.points}\\b|在\\s*${m.metrics.points}\\s*(?:个|周)`,
            "i",
          ).test(v) &&
          (!!recoveryTime || !hasRecoveryTimeReference(v)),
      )
        ? {
            ...m.brief[locale],
            kind: "ai" as const,
          }
        : research && m.brief?.landscape
          ? {
              headline: `${topicName}${locale === "zh" ? "：" : ": "}${landscape}`,
              summary: m.brief.landscape[locale].summary,
              nextSteps: [m.brief.landscape[locale].entry],
              kind: "ai" as const,
            }
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
