import { z } from "zod";
import { hasNegativeWording, hasRecoveryTimeReference } from "./i18n.js";
import type { Brief, ResearchSource } from "./types.js";

const prose = z.string().trim().min(8).max(500);
export const evidenceRef = z.object({
  id: z.string().max(30),
  quote: z.string().min(8).max(300),
});
const assessment = z.object({
  level: z.enum(["high", "medium", "low", "exploratory"]),
  basis: z.enum(["observed", "inferred"]),
  evidence: z.array(evidenceRef).max(3),
});
const copy = z.object({
  title: z.string().trim().min(3).max(90),
  audience: prose,
  demand: prose,
  competition: prose,
  resources: prose,
  delivery: prose,
  upkeep: prose,
  wedge: prose,
  experiment: prose,
});
export const opportunitySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
  query: z
    .string()
    .trim()
    .min(2)
    .max(70)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} .+/#()&-]*$/u),
  effort: z.enum(["low", "medium", "high"]),
  demand: assessment,
  competition: assessment,
  en: copy,
  zh: copy,
});
export type Opportunity = z.infer<typeof opportunitySchema>;
export const opportunityMapSchema = z.object({
  opportunities: z.array(opportunitySchema).min(3).max(5),
  recommendedId: z.string(),
  selection: z.object({
    en: z.string().trim().min(8).max(1000),
    zh: z.string().trim().min(8).max(1000),
  }),
});
export type OpportunityMap = z.infer<typeof opportunityMapSchema>;

export function proseRepairs(raw: unknown): { path: string; value: string }[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Record<string, any>,
    fields: { path: string; value: string }[] = [];
  const visit = (node: unknown, path: string) => {
    if (typeof node === "string") {
      if (hasNegativeWording(node) || hasRecoveryTimeReference(node))
        fields.push({ path, value: node });
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) visit(v, `${path}.${k}`);
    }
  };
  for (const lang of ["en", "zh"]) {
    visit(data[lang], lang);
    visit(data.selection?.[lang], `selection.${lang}`);
    if (Array.isArray(data.opportunities))
      data.opportunities.forEach((o: any, i: number) =>
        visit(o[lang], `opportunities.${i}.${lang}`),
      );
  }
  return fields;
}

export function applyProseRepairs(
  raw: unknown,
  response: unknown,
  requested: { path: string; value: string }[],
): unknown {
  const parsed = z
    .object({
      edits: z
        .array(
          z.object({ path: z.string(), value: z.string().min(1).max(1000) }),
        )
        .max(40),
    })
    .safeParse(response);
  if (!parsed.success) return raw;
  const result = structuredClone(raw) as any;
  for (const edit of parsed.data.edits) {
    if (!requested.some((r) => r.path === edit.path)) continue;
    const keys = edit.path.split(".");
    if (keys.some((k) => ["__proto__", "prototype", "constructor"].includes(k)))
      continue;
    let node = result;
    for (const key of keys.slice(0, -1)) {
      if (!node || !Object.hasOwn(node, key)) {
        node = null;
        break;
      }
      node = node[key];
    }
    if (
      node &&
      Object.hasOwn(node, keys.at(-1)!) &&
      typeof node[keys.at(-1)!] === "string"
    )
      node[keys.at(-1)!] = edit.value;
  }
  return result;
}

/** Rating provenance follows source scope even when a model overstates its label. */
export function groundOpportunityRatings(
  raw: unknown,
  sources: ResearchSource[],
): unknown {
  const parsed = opportunityMapSchema.safeParse(raw);
  if (!parsed.success) return raw;
  const result = structuredClone(raw) as OpportunityMap;
  // Models sometimes add sentence-final punctuation to an otherwise verbatim excerpt.
  // Keep only the portion actually present in the supplied source.
  const rootRefs = (result as { evidence?: unknown }).evidence;
  const refs = [
    ...(Array.isArray(rootRefs)
      ? rootRefs.filter(
          (r) => r && typeof r.id === "string" && typeof r.quote === "string",
        )
      : []),
    ...result.opportunities.flatMap((o) => [
      ...o.demand.evidence,
      ...o.competition.evidence,
    ]),
  ];
  for (const ref of refs) {
    const excerpt = sources.find((s) => s.id === ref.id)?.excerpt;
    const norm = (v: string) => v.replace(/\s+/g, " ").trim();
    const trimmed = ref.quote.replace(/[.!。！]+$/, "");
    if (
      excerpt &&
      !norm(excerpt).includes(norm(ref.quote)) &&
      trimmed.length >= 8 &&
      norm(excerpt).includes(norm(trimmed))
    )
      ref.quote = trimmed;
  }
  for (const o of result.opportunities) {
    const requests = new Set(
      o.demand.evidence
        .filter((r) =>
          sources.some(
            (s) =>
              s.id === r.id &&
              s.kind === "request" &&
              (!s.directionId || s.directionId === o.id),
          ),
        )
        .map((r) => r.id),
    );
    if (o.demand.level === "high" && requests.size < 2)
      o.demand.level = requests.size ? "medium" : "exploratory";
    if (!requests.size) o.demand.basis = "inferred";
    if (o.competition.level === "low" || !o.competition.evidence.length)
      o.competition.basis = "inferred";
  }
  return result;
}

export function opportunityProblems(
  map: OpportunityMap,
  sources: ResearchSource[],
): string[] {
  const problems: string[] = [];
  const ids = map.opportunities.map((o) => o.id);
  if (new Set(ids).size !== ids.length || !ids.includes(map.recommendedId))
    problems.push(
      "Use distinct direction IDs and select one of those IDs as recommendedId.",
    );
  for (const lang of ["en", "zh"] as const) {
    const titles = map.opportunities.map((o) => o[lang].title.toLowerCase());
    if (new Set(titles).size !== titles.length)
      problems.push("Directions need distinct titles and user tasks.");
    const fields: [string, string][] = [
      [`selection.${lang}`, map.selection[lang]],
      ...map.opportunities.flatMap((o) =>
        Object.entries(o[lang]).map(([key, value]): [string, string] => [
          `${o.id}.${lang}.${key}`,
          value,
        ]),
      ),
    ];
    for (const [path, value] of fields)
      if (hasNegativeWording(value) || hasRecoveryTimeReference(value))
        problems.push(
          `${path}: rewrite this field in affirmative product prose (Chinese excludes every 不/无/未/没): ${JSON.stringify(value.slice(0, 500))}`,
        );
  }
  for (const o of map.opportunities) {
    for (const axis of ["demand", "competition"] as const) {
      const a = o[axis];
      for (const ref of a.evidence) {
        const source = sources.find((s) => s.id === ref.id);
        const norm = (s: string) => s.replace(/\s+/g, " ").trim();
        if (!source?.excerpt || !norm(source.excerpt).includes(norm(ref.quote)))
          problems.push(`${o.id} ${axis}: quote a supplied source verbatim.`);
        if (
          axis === "demand" &&
          source?.directionId &&
          source.directionId !== o.id
        )
          problems.push(
            `${o.id} ${axis}: use evidence for this direction's task.`,
          );
      }
      if (a.basis === "observed" && !a.evidence.length)
        problems.push(
          `${o.id} ${axis}: observed judgments require direction-specific evidence; otherwise choose inferred.`,
        );
      if (
        a.basis === "observed" &&
        a.evidence.some((r) => r.id === "S1" || r.id === "S2")
      )
        problems.push(
          `${o.id} ${axis}: umbrella metrics describe the parent query; direction judgments need their own evidence.`,
        );
    }
    const demandSignals = new Set(
      o.demand.evidence
        .filter((r) =>
          sources.some(
            (s) =>
              s.id === r.id &&
              s.kind === "request" &&
              (!s.directionId || s.directionId === o.id),
          ),
        )
        .map((r) => r.id),
    );
    if (
      o.demand.level === "high" &&
      (o.demand.basis !== "observed" || demandSignals.size < 2)
    )
      problems.push(
        `${o.id}: high demand requires multiple relevant user-request sources. With fewer signals use medium or exploratory and explain the hypothesis.`,
      );
    if (o.demand.basis === "observed" && !demandSignals.size)
      problems.push(
        `${o.id}: a project feature documents supply; observed demand needs user-request evidence. Use inferred for a workflow hypothesis.`,
      );
    if (o.competition.level === "low" && o.competition.basis === "observed")
      problems.push(
        `${o.id}: limited GitHub coverage supports an inferred low-competition hypothesis; describe commercial and built-in alternatives as further checks.`,
      );
  }
  return [...new Set(problems)];
}

export function visibleOpportunities(
  brief?: Brief,
): OpportunityMap | undefined {
  if (brief?.strategyVersion !== "2") return;
  const parsed = opportunityMapSchema.safeParse(brief);
  if (!parsed.success || opportunityProblems(parsed.data, brief.sources).length)
    return;
  return parsed.data;
}

export function opportunityLabel(
  kind: "effort" | "demand" | "competition" | "basis",
  value: string,
  lang: "en" | "zh",
) {
  const labels: Record<string, Record<string, [string, string]>> = {
    effort: {
      low: ["Light", "投入较少"],
      medium: ["Moderate", "投入适中"],
      high: ["Heavy", "投入较多"],
    },
    demand: {
      high: ["Strong signals", "需求信号较强"],
      medium: ["Specific need", "具体需求"],
      low: ["Occasional need", "低频需求"],
      exploratory: ["Demand hypothesis", "需求推演"],
    },
    competition: {
      high: ["Intense", "竞争较强"],
      medium: ["Established alternatives", "已有替代方案"],
      low: ["Room to explore", "竞争空间待实测"],
      exploratory: ["Landscape to explore", "竞争格局待实测"],
    },
    basis: {
      observed: ["Source signals", "来源信号"],
      inferred: ["Research inference", "研究推断"],
    },
  };
  return labels[kind]?.[value]?.[lang === "zh" ? 1 : 0] || value;
}

export function opportunityRows(o: Opportunity, lang: "en" | "zh") {
  const p = o[lang];
  return [
    [lang === "zh" ? "用户与任务" : "Audience & task", p.audience],
    [
      lang === "zh" ? "需求" : "Demand",
      `${opportunityLabel("demand", o.demand.level, lang)} · ${opportunityLabel("basis", o.demand.basis, lang)}. ${p.demand}`,
    ],
    [
      lang === "zh" ? "竞争" : "Competition",
      `${opportunityLabel("competition", o.competition.level, lang)} · ${opportunityLabel("basis", o.competition.basis, lang)}. ${p.competition}`,
    ],
    [
      lang === "zh" ? "所需资源" : "Resources",
      `${opportunityLabel("effort", o.effort, lang)}. ${p.resources}`,
    ],
    [lang === "zh" ? "首版投入估算" : "First-release estimate", p.delivery],
    [lang === "zh" ? "持续成本" : "Ongoing cost", p.upkeep],
    [lang === "zh" ? "切入点与采用理由" : "Entry point & adoption", p.wedge],
    [lang === "zh" ? "验证方法" : "Validation", p.experiment],
  ].map(([label, text]) => ({ label: label!, text: text! }));
}

export const OPPORTUNITY_PROMPT = `
OPPORTUNITY MAP — mandatory additional top-level fields:
"recommendedId":"one direction ID", "selection":{"en":"why this direction comes first for a small independent team, and who should choose an alternative","zh":"优先顺序的具体理由及其它方向更适合谁"},
"opportunities":[{"id":"stable-english-slug","query":"short 2-3 word GitHub phrase","effort":"low|medium|high","demand":{"level":"high|medium|low|exploratory","basis":"observed|inferred","evidence":[{"id":"source ID","quote":"exact excerpt"}]},"competition":{"level":"high|medium|low|exploratory","basis":"observed|inferred","evidence":[]},"en":{"title":"distinct direction","audience":"persona, triggering task and frequency","demand":"frequency, urgency, individual request signals or conditional inference; separate attention from willingness to pay","competition":"named documented alternatives, built-in substitutes, switching costs, scope of current comparison","resources":"skills plus data/device/hardware/access/distribution needed, and the hardest dependency","delivery":"estimated team size and elapsed time for a defined prototype, with assumptions","upkeep":"recurring data curation, testing, support, compute or acquisition costs","wedge":"concrete artifact and mechanism that earns adoption alongside alternatives","experiment":"feasible first test with proposed numerical decision threshold"},"zh":{"title":"细分方向","audience":"人群、触发任务、频率","demand":"需求信号与成立条件","competition":"已有替代方案与进入门槛","resources":"技能、数据、设备、权限、触达渠道及最难获得的资源","delivery":"明示估算的首版人数、工期、交付范围与前提","upkeep":"持续维护、支持、算力、数据更新等成本","wedge":"首个交付物及采用理由","experiment":"针对该方向的实验与建议数字门槛"}}].

Return 3-5 genuinely distinct directions: five for a broad brand, field or ecosystem when coherent, three for a narrow product. Distinguish different user jobs, buyers, lifecycle stages or business/resource models; renaming the same feature three times is weak. Keep the user's original object: Xiaomi phones spans phone selection, ownership, maintenance, resale, specialist tooling; Xiaomi vacuums and lamps serve other objects. Source prominence reflects GitHub coverage rather than user importance. Retain consumer/professional/service or hardware-adjacent directions when relevant, and describe their data, trust or distribution requirements. Favor an implementable software/data contribution in each. Preserve explicit constraints.

Draft the full map first, with one short targeted query for EACH direction. The application will check each query, read a candidate README and seek individual issue signals. In the review, keep direction IDs and their tasks stable; refine the artifact and assessments using directionId-tagged sources. A-source and D-source searches are scoped feature checks. Documents for another object (e.g. a vacuum in a phone search) belong outside the argument. Explicitly consider alternatives outside GitHub as hypotheses for further comparison unless a supplied source documents them. Originality requires a mechanism, bottleneck or adoption advantage. An existing implementation motivates a complementary workflow or a specific difference to test.

Ratings are qualitative judgments with reasons, never calculated market scores. Demand high requires at least two relevant independent user-request sources and a credible repeat/urgency explanation; such signals establish observed requests in that sample, with wider demand a hypothesis. An implementation or its star count establishes supply only. Use medium/inferred for a plausible recurring task, low/inferred for episodic use, exploratory/inferred for an early demand hypothesis. Use observed only for the dimension directly supported by citations. The parent Google Trends series and overall repository counts stay separate from each direction's demand and competition. Small/empty GitHub results establish scope coverage, so low competition remains inferred. Favor clearly conditional reasoning over invented adoption, pricing, search volume or market share.

Effort describes the scoped first deliverable: low ~ one generalist and public data in 1-2 weeks; medium needs specialist skill, integrations, multiple devices or 3-6 weeks; high needs hard-to-obtain data, hardware inventory, laboratory work, certification, several specialties or sustained operations. These are orientation examples: provide a realistic ESTIMATE and assumptions for this specific direction. Separate a demo's resources from production upkeep. Include commercial acquisition/distribution and trust requirements when material. Never invent current prices. Each field should be concise, around 20-45 English words / 30-85 Chinese characters. Use natural Chinese; translate outcome as 结果, user action as 行为. Each experiment includes a proposed numeric criterion. All directions need real substance.

The report headline and summary introduce the portfolio and its tradeoffs. The existing nine-field strategy develops recommendedId in greater depth and matches that direction exactly. The selection explains prioritization assuming a solo developer or small team; also state which direction suits a team with additional resources. Rank through an explicit judgment rather than invented numeric scores. Keep all three to five directions in the final answer, even if source collection is partial; inferred judgments remain useful with testable assumptions. Both languages represent identical directions, ratings and resource estimates. Every narrative field follows the affirmative language rules. References retain original source text.
`;
