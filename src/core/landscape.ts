import { z } from "zod";
import { hasReportWordingProblem as hasNegativeWording } from "./i18n.js";
import type { Market, MarketKind, ResearchSource } from "./types.js";

const prose = z.string().trim().min(8).max(500);
export const sourceQuoteSchema = z.string().trim().min(4).max(600).refine(
  (quote) => quote.length >= 8 || (quote.match(/\p{Script=Han}/gu)?.length || 0) >= 4,
  "Quote at least 8 characters, or a complete Chinese statement containing at least 4 Han characters.",
).refine(quote => !quote.includes("[…]"), "Quote one continuous original passage; never bridge omitted text.").describe("Exact source quotation: at least 8 characters, or at least 4 Chinese characters; keep the complete factual statement and qualifiers.");
const ref = z.object({
  id: z.string().max(30),
  quote: sourceQuoteSchema,
});
const rating = z.object({
  level: z.enum(["high", "medium", "low", "exploratory"]),
  evidence: z.array(ref).max(3),
});
const peerFact = z.object({
  en: z.string().trim().min(3).max(220),
  zh: z.string().trim().min(3).max(220),
  evidence: ref,
});
const leaderCopy = z.object({
  position: prose,
  barrier: prose,
  opening: prose,
});
export const landscapeSchema = z.object({
  demand: rating,
  competition: rating,
  barrier: z.enum(["high", "medium", "low", "exploratory"]),
  en: z.object({
    summary: prose,
    demand: prose,
    competition: prose,
    entry: prose,
  }),
  zh: z.object({
    summary: prose,
    demand: prose,
    competition: prose,
    entry: prose,
  }),
  leaders: z
    .array(
      z.object({
        name: z.string().min(2).max(80),
        category: z.enum(["commercial", "official", "opensource"]).optional(),
        audience: peerFact.optional(),
        pricing: peerFact.optional(),
        en: leaderCopy,
        zh: leaderCopy,
        evidence: z.array(ref).max(3),
      }),
    )
    .max(3),
});
const issueCopy = z.object({
  title: z.string().min(3).max(90),
  audience: prose,
  need: prose,
  currentSolution: prose.optional(),
  desiredOutcome: prose.optional(),
  opportunity: prose,
  check: prose,
});
export const issueInsightSchema = z.object({
  sourceId: z.string().max(30),
  relevance: z.enum(["direct", "adjacent"]),
  kind: z
    .enum([
      "feature-request",
      "friction",
      "selection",
      "migration",
      "promotion",
      "advice",
    ])
    .optional(),
  en: issueCopy,
  zh: issueCopy,
  evidence: ref,
});
export type Landscape = z.infer<typeof landscapeSchema>;
export type IssueInsight = z.infer<typeof issueInsightSchema>;
export function isDemandReading(
  reading: Pick<IssueInsight, "relevance" | "kind">,
) {
  return (
    reading.relevance === "direct" &&
    reading.kind !== "promotion" &&
    reading.kind !== "advice"
  );
}

/** Duplicate retrieval IDs for the same discussion share its reviewed role. */
export function excludedRequestUrls(
  readings: IssueInsight[] = [],
  sources: ResearchSource[],
) {
  return new Set(
    readings
      .filter((r) => !isDemandReading(r))
      .map((r) => sources.find((s) => s.id === r.sourceId)?.url)
      .filter((url): url is string => !!url),
  );
}
const norm = (v: string) => v.replace(/\s+/g, " ").trim();
export function validQuote(
  ref: { id: string; quote: string },
  sources: ResearchSource[],
) {
  return !ref.quote.includes("[…]") && sources.some(
    (s) =>
      s.id === ref.id && s.excerpt && norm(s.excerpt).includes(norm(ref.quote)),
  );
}
const billingStatement =
  /(?:pric|cost|charg|bill|subscription|free|paid|contact sales|quote|month|year|费用|价格|收费|免费|付费|报价|订阅|按月|按年|起价|回收|收購|報價|免費|費用|價格|buyback|trade.?in)/i;
const pricingDigits = (s: string): string[] =>
  s.replace(/,(?=\d{3})/g, "").match(/\d+(?:\.\d+)?/g) || [];
const pricingSupported = (p: z.infer<typeof peerFact>) =>
  billingStatement.test(p.evidence.quote) &&
  [...pricingDigits(p.en), ...pricingDigits(p.zh)].every((n) =>
    pricingDigits(p.evidence.quote).includes(n),
  );

/** Optional facts can be withheld independently of the validated report.
 * Normalize a singleton reference array without changing its source or text.
 * Missing/unsupported prices remain a source-check prompt in the interface.
 */
export function groundCompetitorFacts(raw: any, sources: ResearchSource[]) {
  const value = structuredClone(raw);
  if (!Array.isArray(value?.landscape?.leaders)) return value;
  for (const leader of value.landscape.leaders) {
    if (!leader || typeof leader !== "object") continue;
    for (const key of ["audience", "pricing"] as const) {
      const fact = leader[key];
      if (!fact) {
        delete leader[key];
        continue;
      }
      if (Array.isArray(fact.evidence) && fact.evidence.length === 1)
        fact.evidence = fact.evidence[0];
      const parsed = peerFact.safeParse(fact);
      if (
        !parsed.success ||
        !validQuote(parsed.data.evidence, sources) ||
        !Array.isArray(leader.evidence) ||
        !leader.evidence.some((r: any) => r?.id === parsed.data.evidence.id) ||
        (key === "pricing" && !pricingSupported(parsed.data))
      )
        delete leader[key];
    }
  }
  return value;
}
export function landscapeProblems(
  raw: any,
  sources: ResearchSource[],
): string[] {
  const errors: string[] = [];
  if (raw.landscape) {
    const p = landscapeSchema.safeParse(raw.landscape);
    if (!p.success)
      return [
        "Landscape schema: provide demand, competition, barrier, bilingual explanations and at most three leaders.",
      ];
    const l = p.data;
    const refs = [
      ...l.demand.evidence,
      ...l.competition.evidence,
      ...l.leaders.flatMap((x) => [
        ...x.evidence,
        ...(x.audience ? [x.audience.evidence] : []),
        ...(x.pricing ? [x.pricing.evidence] : []),
      ]),
    ];
    if (refs.some((r) => !validQuote(r, sources)))
      errors.push("Landscape evidence: copy exact supplied excerpts.");
    for (const lang of ["en", "zh"] as const)
      if (
        [
          ...Object.values(l[lang]),
          ...l.leaders.flatMap((x) => Object.values(x[lang])),
        ].some(hasNegativeWording)
      )
        errors.push("Landscape: use affirmative prose.");
    for (const leader of l.leaders) {
      for (const fact of [leader.audience, leader.pricing]) {
        if (fact && !leader.evidence.some((r) => r.id === fact.evidence.id))
          errors.push(
            `Peer ${leader.name}: each fact source must also identify this peer in its evidence.`,
          );
        if (fact && [fact.en, fact.zh].some(hasNegativeWording))
          errors.push(`Peer ${leader.name}: use short affirmative wording.`);
      }
      if (leader.pricing) {
        const p = leader.pricing;
        if (!billingStatement.test(p.evidence.quote))
          errors.push(
            `Peer ${leader.name}: pricing needs an explicit billing statement; omit pricing while evidence is gathered.`,
          );
        const quoted = new Set(pricingDigits(p.evidence.quote));
        if (
          [...pricingDigits(p.en), ...pricingDigits(p.zh)].some(
            (n) => !quoted.has(n),
          )
        )
          errors.push(
            `Peer ${leader.name}: preserve quoted pricing amounts and units; omit estimates.`,
          );
      }
    }
    for (const leader of l.leaders)
      if (
        !leader.evidence.length ||
        leader.evidence.every((r) =>
          sources.find((s) => s.id === r.id)?.id?.startsWith("S"),
        )
      )
        errors.push(
          `Leader ${leader.name}: cite a supplied result or document describing this company/project, or omit this leader.`,
        );
  }
  for (const item of raw.issueInsights || []) {
    const p = issueInsightSchema.safeParse(item);
    if (!p.success) {
      errors.push(
        "Issue interpretation schema needs sourceId, relevance, bilingual copy and evidence.",
      );
      continue;
    }
    const x = p.data;
    if (
      x.evidence.id !== x.sourceId ||
      !validQuote(x.evidence, sources) ||
      !sources.some((s) => s.id === x.sourceId && s.kind === "request")
    )
      errors.push(
        `Issue ${x.sourceId}: interpret only the supplied request and quote its text.`,
      );
    if (
      [...Object.values(x.en), ...Object.values(x.zh)].some(hasNegativeWording)
    )
      errors.push("Issue interpretation: use affirmative prose.");
  }
  return errors;
}
/** A qualitative research layer. It never overwrites the measured GitHub/Trends quadrant.
 * Broad brand attention belongs to the parent scope. Ads/ranks/counts supply zero demand votes.
 * Low competition is always a hypothesis about entry, including sparse search samples.
 */
export function researchLandscape(
  m: Market,
): { kind: MarketKind; confidence: "moderate" | "low" } | undefined {
  const p = landscapeSchema.safeParse(m.brief?.landscape);
  if (
    !p.success ||
    landscapeProblems({ landscape: p.data }, m.brief?.sources || []).length
  )
    return;
  const l = p.data;
  const demand = l.demand.level,
    pressure = l.competition.level;
  const fresh =
    !m.demand.error &&
    Date.parse(m.asOf) - Date.parse(m.demand.fetchedAt) <= 14 * 86400000;
  const rising = fresh && m.metrics.trend === "rising";
  const excluded = excludedRequestUrls(
    m.brief?.issueInsights,
    m.brief?.sources || [],
  );
  const demandSignal = l.demand.evidence.some((r) =>
    m.brief?.sources.some(
      (s) =>
        s.id === r.id &&
        ((s.kind === "request" && !excluded.has(s.url)) ||
          (s.kind === "search" &&
            s.placement === "organic" &&
            s.searchIntent === "demand")),
    ),
  );
  const competitionSignal = l.competition.evidence.some((r) =>
    m.brief?.sources.some(
      (s) =>
        s.id === r.id &&
        (s.kind === "project" ||
          (s.kind === "search" && s.placement === "organic")),
    ),
  );
  let kind: MarketKind = "uncertain";
  const incumbentBarrier =
    l.barrier === "high" &&
    competitionSignal &&
    l.leaders.some((x) => x.evidence.length > 0);
  if ((pressure === "high" && competitionSignal) || incumbentBarrier)
    kind = rising ? "expanding" : "contested";
  else if (
    pressure === "low" &&
    demandSignal &&
    competitionSignal &&
    (demand === "high" || demand === "medium")
  )
    kind = "blue";
  else if (
    pressure === "low" &&
    demand === "low" &&
    fresh &&
    m.metrics.trend === "falling" &&
    competitionSignal
  )
    kind = "quiet";
  else if (
    competitionSignal &&
    pressure === "medium" &&
    (demand === "medium" || demand === "high")
  )
    kind = rising ? "expanding" : "contested";
  const organicDomains = new Set(
    l.competition.evidence.flatMap((r) => {
      const s = m.brief?.sources.find((s) => s.id === r.id);
      if (s?.kind !== "search" || s.placement !== "organic") return [];
      try {
        return [new URL(s.url).hostname.replace(/^www\./, "")];
      } catch {
        return [];
      }
    }),
  );
  return {
    kind,
    confidence:
      fresh && organicDomains.size >= 2 && pressure !== "low"
        ? "moderate"
        : "low",
  };
}
export function landscapeLabel(kind: MarketKind, locale: "en" | "zh") {
  const labels = {
    blue: ["Blue ocean candidate", "蓝海候选"],
    expanding: ["Growing red ocean", "增长型红海"],
    contested: ["Red ocean", "红海"],
    quiet: ["Quiet ocean", "静海"],
    uncertain: ["Opportunity watch", "机会观察"],
  };
  return labels[kind][locale === "zh" ? 1 : 0]!;
}
export const LANDSCAPE_PROMPT = `
Add landscape:{demand:{level:"high|medium|low|exploratory",evidence:[]},competition:{level:"high|medium|low|exploratory",evidence:[]},barrier:"high|medium|low|exploratory",en:{summary,demand,competition,entry},zh:{summary,demand,competition,entry},leaders:[{name,category:"commercial|official|opensource",audience:{en,zh,evidence:{id,quote}},pricing:{en,zh,evidence:{id,quote}},en:{position,barrier,opening},zh:{position,barrier,opening},evidence:[]}]}.
barrier assesses incumbent entrenchment specifically; hardware effort, data collection and implementation complexity belong in resource estimates.
This is the qualitative ORIGINAL TOPIC market judgment, separate from numerical GitHub competition. Explain recurring buyer jobs, current alternatives and specific entry resources. Every prose field is 1-2 sentences, 8-500 characters. Evidence references use exact supplied id/quote, maximum three per rating/leader; leaders maximum three. Name a leader only when a supplied source names it. Each leader includes category:"commercial|official|opensource", audience:{en,zh,evidence:{id,quote}} and source-supported optional pricing:{en,zh,evidence:{id,quote}}. Include audience whenever the supplied offer clearly identifies its users. Populate pricing whenever a supplied statement covers fees, a payout formula, a model-specific quote or a free component. Put fee/payout terms in pricing; position describes the service. Limit a free component to its named scope, such as pickup. Use audience/pricing only with a verbatim source statement for that specific product (each prose 3-220 characters); omit a missing field. Pricing preserves the quoted plan, currency, billing period, minimum and region. A trial, free shipping or a public source-code license alone supplies only that fact, rather than a full product billing model. For trade-in/buyback, distinguish the payout to the seller from a fee charged to a buyer. Preserve eligibility and model-specific conditions; sample device prices represent that exact device/region/date. State any currency or eligibility details that still need checking as a short affirmative action. State the quoted offer succinctly; all prices and billing models require evidence. Prefer up to three relevant commercial/official services when supplied; include an open-source leader only for a source-backed ecosystem advantage. Describe position as the actual product/service, barrier as why users choose/stay with it, opening as a conditional way to serve a specific customer. Chinese headings/prose use 同行、竞争对手、服务谁、怎么收费、现有优势、可以从哪做起. Each audience/pricing fact has its own source and exact quote; also include that source in this leader's evidence array. Compare core incumbent territory against complementary workflows: distribution, trusted data, proprietary interfaces, network effects, installed integrations, migration cost or capital. Select the actual barrier; describe the dependency and an adoption route. A leading search rank, star count or one provider's market claim has a limited scope. Describe incumbency/structural concentration as a research assessment. Market-wide monopoly/market shares require market-definition and measured share evidence; such legal or numerical conclusions need separate evidence. Strong barriers can make a crowded/established field attractive for complements while direct displacement needs major resources.
Google W sources are SEARCH EXCERPTS, with organic/ad placement. They establish what appeared for the displayed query/region/date. Treat feature text as a publisher claim. Sponsored placement records commercial spend interest; transactions, profitability, willingness to pay and market growth require direct evidence. Search result totals and rankings play zero role in demand or monopoly scoring. Current zero/sparse results describe search coverage. Low competition remains a hypothesis. Exclude pages for adjacent objects. Trends measures attention at its stated topic, time and geography; expanding a broad brand into niche demand is a separate inference. Preserve mixed/falling trends. The application derives blue/red/quiet research labels from these assessments and displays their inferred basis.

Add issueInsights:[{sourceId:"I1",relevance:"direct|adjacent",kind:"feature-request|friction|selection|migration|promotion|advice",en:{title,audience,need,opportunity,check},zh:{title,audience,need,opportunity,check},evidence:{id:"I1",quote:"exact excerpt"}}], maximum six. Review every supplied I-source against the ORIGINAL object, including repository purpose and issue content. Mark adjacent objects accordingly so the UI filters them. For direct requests explain who faces which task, what the user is asking for in plain language, and one conditional contribution/service opportunity. Include optional currentSolution and desiredOutcome in both languages only when the request excerpt describes the present workaround and desired result. Classify advice recommending an existing workaround and positive evaluations as advice; author product promotion requires evidence of author involvement. Both roles remain source context and are excluded from demand cards. Use request metadata for state, dates and counts; one author's repeated posts remain one author. Closed/completed is a maintainer status; check the supplied release notes to establish shipped behavior. State the specific current-version or maintainer check that would establish whether the request remains open as a product gap. Open status and reactions are individual community signals. Historical issue dates retain their historical scope. Source excerpts carry quoted data only. Give concise everyday titles. Every audience/need/opportunity/check is 8-500 characters. With zero I-sources return [].
`;

export function landscapeRows(m: Market, locale: "en" | "zh") {
  const result = researchLandscape(m),
    landscape = m.brief?.landscape;
  if (!result || !landscape) return [];
  const zh = locale === "zh",
    p = landscape[locale];
  return [
    {
      label: zh ? "综合研判" : "Research judgment",
      text: `${landscapeLabel(result.kind, locale)} · ${zh ? "含研究推断" : "includes inference"}. ${p.summary}`,
    },
    { label: zh ? "需求与场景" : "Demand and jobs", text: p.demand },
    {
      label: zh ? "竞争与替代方案" : "Competition and substitutes",
      text: p.competition,
    },
    { label: zh ? "进入条件" : "Entry requirements", text: p.entry },
    ...landscape.leaders.map((x) => ({
      label: x.name,
      text: [
        x[locale].position,
        `${zh ? "服务谁" : "Who it serves"}: ${x.audience?.[locale] || (zh ? "查看产品介绍，确认目标用户。" : "Check the product page for its intended users.")}`,
        `${zh ? "收费与报价" : "Pricing & quotes"}: ${x.pricing?.[locale] || (zh ? "查看官网，确认当前收费方式。" : "Check current pricing on the product website.")}`,
        `${zh ? "现有优势" : "Existing advantage"}: ${x[locale].barrier}`,
        `${zh ? "可以从哪做起 · 研究建议" : "Where to start · research suggestion"}: ${x[locale].opening}`,
        ...[x.audience, x.pricing].flatMap((f) =>
          f
            ? [m.brief?.sources.find((s) => s.id === f.evidence.id)?.url || ""]
            : [],
        ),
      ].join(" "),
    })),
  ];
}
