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
  need: prose.optional(),
  service: prose.optional(),
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
  route: z.enum(["opensource", "product", "service"]).optional(),
  basedOn: z.array(evidenceRef).max(3).optional(),
  effort: z.enum(["low", "medium", "high"]),
  demand: assessment,
  competition: assessment,
  en: copy,
  zh: copy,
});
const clearCopy = copy.extend({ need: prose, service: prose });
export const clearOpportunitySchema = opportunitySchema.extend({
  en: clearCopy,
  zh: clearCopy,
});
const overviewCopy = z.object({
  verdict: prose,
  demand: prose,
  competition: prose,
  opening: prose,
  entry: prose,
  scope: prose,
});
export const overviewSchema = z.object({
  en: overviewCopy,
  zh: overviewCopy,
  evidence: z.array(evidenceRef).max(6).default([]),
});
export type MarketOverview = z.infer<typeof overviewSchema>;
export type Opportunity = z.infer<typeof opportunitySchema>;
export const opportunityMapSchema = z.object({
  overview: overviewSchema.optional(),
  opportunities: z.array(opportunitySchema).min(3).max(5),
  recommendedId: z.string(),
  selection: z.object({
    en: z.string().trim().min(8).max(1000),
    zh: z.string().trim().min(8).max(1000),
  }),
});
export type OpportunityMap = z.infer<typeof opportunityMapSchema>;

export function hasCoverageQuantity(text: string): boolean {
  return /(?:数百|数千|数万|hundreds|thousands).{0,14}(?:开源|工具|项目|repositories|tools|projects)/i.test(
    text,
  );
}

export function proseRepairs(
  raw: unknown,
  all = false,
): { path: string; value: string }[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Record<string, any>,
    fields: { path: string; value: string }[] = [];
  const directionIds = (data.opportunities || [])
    .map((o: any) => o.id)
    .filter((id: unknown) => typeof id === "string" && id.includes("-"));
  const visit = (node: unknown, path: string) => {
    if (typeof node === "string") {
      if (
        all ||
        hasNegativeWording(node) ||
        hasRecoveryTimeReference(node) ||
        hasCoverageQuantity(node) ||
        /\b(?:S[12]|[RI]\d+|W\d+R\d+|D\d+[AIR]\d+)\b/.test(node) ||
        directionIds.some((id: string) => node.includes(id))
      )
        fields.push({ path, value: node });
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) visit(v, `${path}.${k}`);
    }
  };
  for (const lang of ["en", "zh"]) {
    visit(data[lang], lang);
    visit(data.overview?.[lang], `overview.${lang}`);
    visit(data.landscape?.[lang], `landscape.${lang}`);
    data.landscape?.leaders?.forEach((x: any, i: number) => {
      visit(x[lang], `landscape.leaders.${i}.${lang}`);
      visit(x.audience?.[lang], `landscape.leaders.${i}.audience.${lang}`);
      visit(x.pricing?.[lang], `landscape.leaders.${i}.pricing.${lang}`);
    });
    data.issueInsights?.forEach((x: any, i: number) =>
      visit(x[lang], `issueInsights.${i}.${lang}`),
    );
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
        .max(100),
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

/** Recover a nearly verbatim quotation from one unambiguous source span.
 * Numeric claims and remote text remain unchanged; the returned text is copied
 * directly from the supplied source. Larger/ambiguous differences stay invalid.
 */
export function recoverSourceQuote(
  quote: string,
  excerpt: string,
): string | undefined {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const q = norm(quote),
    source = norm(excerpt);
  // A model may quote the visible label of a Markdown link. Map that exact
  // visible text back to its original source span, retaining the link markup.
  if (q.length >= 8 && q.length <= 500 && !source.includes(q)) {
    const chars: string[] = [],
      starts: number[] = [],
      ends: number[] = [];
    const append = (start: number, end: number) => {
      for (let i = start; i < end; i++) {
        chars.push(source[i]!);
        starts.push(i);
        ends.push(i + 1);
      }
    };
    let cursor = 0;
    for (const match of source.matchAll(
      /\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/g,
    )) {
      append(cursor, match.index);
      const labelStart = chars.length;
      append(match.index + 1, match.index + 1 + match[1]!.length);
      starts[labelStart] = match.index;
      ends[ends.length - 1] = match.index + match[0].length;
      cursor = match.index + match[0].length;
    }
    if (cursor) {
      append(cursor, source.length);
      const visible = chars.join(""),
        start = visible.indexOf(q);
      if (start >= 0 && visible.indexOf(q, start + 1) < 0) {
        const candidate = source.slice(
          starts[start],
          ends[start + q.length - 1],
        );
        if (candidate.length <= 500) return candidate;
      }
    }
  }
  if (q.length < 40 || q.length > 300 || source.includes(q)) return;
  const start = source.indexOf(q.slice(0, 16));
  if (start < 0 || source.indexOf(q.slice(0, 16), start + 1) >= 0) return;
  const end = source.indexOf(q.slice(-16), start + 16);
  if (end < 0 || source.indexOf(q.slice(-16), end + 1) >= 0) return;
  const candidate = source.slice(start, end + 16);
  if (candidate.length > 300 || Math.abs(candidate.length - q.length) > 2)
    return;
  if (
    JSON.stringify(candidate.match(/\d+(?:\.\d+)?/g)) !==
    JSON.stringify(q.match(/\d+(?:\.\d+)?/g))
  )
    return;
  let row = Array.from({ length: candidate.length + 1 }, (_, i) => i);
  for (let i = 1; i <= q.length; i++) {
    const next = [i];
    for (let j = 1; j <= candidate.length; j++)
      next[j] = Math.min(
        next[j - 1]! + 1,
        row[j]! + 1,
        row[j - 1]! + Number(q[i - 1] !== candidate[j - 1]),
      );
    if (Math.min(...next) > 2) return;
    row = next;
  }
  return row[candidate.length]! <= 2 ? candidate : undefined;
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
    ...(result.overview?.evidence || []),
    ...((result as any).landscape?.demand?.evidence || []),
    ...((result as any).landscape?.competition?.evidence || []),
    ...((result as any).landscape?.leaders?.flatMap((x: any) => [
      ...(x.evidence || []),
      ...(x.audience ? [x.audience.evidence] : []),
      ...(x.pricing ? [x.pricing.evidence] : []),
    ]) || []),
    ...((result as any).issueInsights
      ?.map((x: any) => x.evidence)
      .filter(Boolean) || []),
    ...result.opportunities.flatMap((o) => [
      ...(o.basedOn || []),
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
    else if (excerpt)
      ref.quote = recoverSourceQuote(ref.quote, excerpt) || ref.quote;
  }
  for (const o of result.opportunities) {
    for (const axis of ["demand", "competition"] as const) {
      if (o[axis].evidence.some((r) => r.id === "S1" || r.id === "S2"))
        o[axis].basis = "inferred";
    }
    if (o.demand.level === "high" && o.demand.basis === "inferred")
      o.demand.level = "medium";
    const requests = new Set(
      o.demand.evidence
        .filter((r) =>
          sources.some(
            (s) =>
              s.id === r.id &&
              s.kind === "request" &&
              s.request?.state !== "answered" &&
              s.request?.state !== "closed" &&
              (!s.directionId || s.directionId === o.id),
          ),
        )
        .map((r) => sources.find((s) => s.id === r.id)!.url),
    );
    if (o.demand.level === "high" && requests.size < 2)
      o.demand.level = requests.size ? "medium" : "exploratory";
    if (!requests.size) o.demand.basis = "inferred";
    // A named tool documents an alternative. Pressure across a whole niche is
    // an inference unless the evidence was collected for that specific job.
    const nicheSupply = o.competition.evidence.some((r) =>
      sources.some(
        (s) => s.id === r.id && s.directionId === o.id && s.kind === "project",
      ),
    );
    if (o.competition.level === "low" || !nicheSupply)
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
      ...Object.entries(map.overview?.[lang] || {}).map(
        ([k, v]): [string, string] => [`overview.${lang}.${k}`, v],
      ),
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
  for (const ref of map.overview?.evidence || []) {
    const source = sources.find((s) => s.id === ref.id);
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    if (!source?.excerpt || !norm(source.excerpt).includes(norm(ref.quote)))
      problems.push(`Overview ${ref.id}: quote a supplied source verbatim.`);
  }
  for (const o of map.opportunities) {
    for (const ref of o.basedOn || []) {
      const source = sources.find((s) => s.id === ref.id);
      if (
        !source?.excerpt ||
        !source.excerpt
          .replace(/\s+/g, " ")
          .includes(ref.quote.replace(/\s+/g, " "))
      )
        problems.push(`${o.id}: basedOn needs an exact project quotation.`);
    }
    if (
      o.route === "opensource" &&
      !o.basedOn?.some((r) =>
        sources.some((s) => s.id === r.id && s.kind === "project"),
      )
    )
      problems.push(
        `${o.id}: name and quote a supplied project document for the open-source contribution.`,
      );
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
              s.request?.state !== "answered" &&
              s.request?.state !== "closed" &&
              (!s.directionId || s.directionId === o.id),
          ),
        )
        .map((r) => sources.find((s) => s.id === r.id)!.url),
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
  if (
    !brief ||
    !["2", "3", "4", "5", "6"].includes(brief.strategyVersion || "")
  )
    return;
  if (
    ["3", "4", "5", "6"].includes(brief.strategyVersion || "") &&
    (!overviewSchema.safeParse(brief.overview).success ||
      !z
        .array(clearOpportunitySchema)
        .min(3)
        .max(5)
        .safeParse(brief.opportunities).success)
  )
    return;
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
    ...(o.route
      ? [
          [
            lang === "zh" ? "机会类型" : "Opportunity type",
            opportunityRoute(o.route, lang),
          ],
        ]
      : []),
    [lang === "zh" ? "服务谁" : "Who it serves", p.audience],
    ...(p.need ? [[lang === "zh" ? "解决什么问题" : "The need", p.need]] : []),
    ...(p.service
      ? [[lang === "zh" ? "提供什么服务" : "What you offer", p.service]]
      : []),
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

export function overviewRows(overview: MarketOverview, lang: "en" | "zh") {
  const labels =
    lang === "zh"
      ? [
          "整体判断",
          "需求从哪里来",
          "竞争集中在哪里",
          "机会集中在哪里",
          "适合谁进入",
          "本次依据覆盖范围",
        ]
      : [
          "Overall judgment",
          "Demand drivers",
          "Competitive landscape",
          "Where the openings are",
          "Who can enter",
          "Evidence coverage",
        ];
  const keys = [
    "verdict",
    "demand",
    "competition",
    "opening",
    "entry",
    "scope",
  ] as const;
  return keys.map((key, i) => ({
    label: labels[i]!,
    text: overview[lang][key],
  }));
}

export const OPPORTUNITY_PROMPT = `
PARENT TOPIC FIRST — mandatory top-level overview:
"overview":{"en":{"verdict":"a direct overall judgment about the ORIGINAL input and its opportunity structure","demand":"why people need products/services around this topic; distinguish observed search attention from conditional purchase/service demand","competition":"where competition concentrates across relevant product, commercial service, built-in and open-source alternatives; identify evidence scope","opening":"two or three kinds of unmet job or friction worth testing, and WHY they could support an opportunity","entry":"who could enter given skills, capital, access and distribution; explain small-team versus resource-heavy entry","scope":"the measured query, region and source coverage; explain which broader judgments are conditional"},"zh":{"verdict":"先直接回答原词整体的机会判断","demand":"需求来自哪些人和情境，分清搜索关注与消费或付费推断","competition":"原词整体的竞争结构，覆盖商品、服务、官方功能及开源方案","opening":"机会集中在哪些环节，以及形成机会的具体原因","entry":"哪些创业者或团队适合进入，各自需要什么关键条件","scope":"原词、实际检索词、地域与来源覆盖的关系，明示哪些属于领域推演"},"evidence":[{"id":"supplied source ID","quote":"exact excerpt"}]}.
This overview is an independent answer to the original topic, useful even if every direction card is hidden. Judge the core business of the topic as well as adjacent services. For a phone brand, explain demand for buying/replacing/using those phones, competition in selling/distributing them, and resources such as stock, supplier access, working capital and after-sales service; compare these with adjacent-service entry using conditional domain reasoning. Designing a competing phone changes the object and belongs outside this input unless requested. This section must answer the original field even when all five direction cards are hidden. Summarizing or enumerating the five services is incomplete. Use everyday language in the headline and overview too. Replace abstractions such as 可信验证、流程支持、交接物、窄软件/数据交付物 with the actual person, task and useful result. For example, 帮买家选对机型、帮门店检查旧手机 immediately describe an offer. It must address the broad opportunity before prioritizing one service. Keep the measured classification unchanged. For a physical-product or brand field, GitHub documents cover software workflows; overall commercial competition and demand are conditional domain analysis unless directly supported. Compare making/selling the core product with adjacent services where relevant. Parent search growth belongs only to the measured parent term. Use at most six evidence references. Use 2-3 sentences per field, specific to THIS topic. All prose follows the affirmative wording rules.

READER COMPREHENSION — every direction's en and zh object additionally requires:
"need":"the specific question, decision or task the customer struggles with, expressed in everyday language",
"service":"what YOU would provide: what the customer gives you, what they receive, and how it helps their task".
The title names a familiar customer benefit or service, around 8-18 Chinese characters / 4-9 English words. Prefer everyday verbs such as 帮用户选、帮门店检查、教用户设置. Leave protocol names, technical ledgers, signatures and indexes to implementation details. Explain technical terms through the user's concrete task. Audience <= 50 Chinese characters / 28 English words; need and service <= 100 Chinese characters / 50 English words. A reader must identify customer, need and offer from the title and these three fields alone. Use conditional wording in demand/assumptions, while service describes the concrete proposed offer. Preserve depth in mechanism, resources and experiments.

DIVERSITY BEFORE SOURCE DETAIL: For a broad input, independently consider at least five materially different customer jobs across its lifecycle before reading source prominence as a priority. Select five directions that cover at least three jobs/stages or customer groups, subject to explicit user constraints. Limit closely related technical maintenance features to one direction for an unconstrained consumer-brand input. A phrase such as 小米手机 asks for opportunities around phones; it retains buying, everyday use, upkeep, resale and professional services as candidate jobs. Choose useful specific offerings across that scope; each still needs a distinctive mechanism. README availability is a retrieval property. It must never set the report's audience or erase consumer/service opportunities. Keep broad hypotheses clearly labeled and give each a discriminating experiment. Never turn a broad consumer field into five developer utilities. For a narrow requested tool, keep the explicit task and vary real customer workflows instead.

OPPORTUNITY MAP — mandatory additional top-level fields:
"recommendedId":"one direction ID", "selection":{"en":"why this direction comes first for a small independent team, and who should choose an alternative","zh":"优先顺序的具体理由及其它方向更适合谁"},
"opportunities":[{"id":"stable-english-slug","query":"short 2-3 word GitHub phrase","effort":"low|medium|high","demand":{"level":"high|medium|low|exploratory","basis":"observed|inferred","evidence":[{"id":"source ID","quote":"exact excerpt"}]},"competition":{"level":"high|medium|low|exploratory","basis":"observed|inferred","evidence":[]},"en":{"title":"distinct direction","audience":"persona, triggering task and frequency","demand":"frequency, urgency, individual request signals or conditional inference; separate attention from willingness to pay","competition":"named documented alternatives, built-in substitutes, switching costs, scope of current comparison","resources":"skills plus data/device/hardware/access/distribution needed, and the hardest dependency","delivery":"estimated team size and elapsed time for a defined prototype, with assumptions","upkeep":"recurring data curation, testing, support, compute or acquisition costs","wedge":"concrete artifact and mechanism that earns adoption alongside alternatives","experiment":"feasible first test with proposed numerical decision threshold"},"zh":{"title":"细分方向","audience":"人群、触发任务、频率","demand":"需求信号与成立条件","competition":"已有替代方案与进入门槛","resources":"技能、数据、设备、权限、触达渠道及最难获得的资源","delivery":"明示估算的首版人数、工期、交付范围与前提","upkeep":"持续维护、支持、算力、数据更新等成本","wedge":"首个交付物及采用理由","experiment":"针对该方向的实验与建议数字门槛"}}].

Each direction includes route:"opensource|product|service" and basedOn:[{id,quote}] (maximum three exact project-source references). Actively evaluate open-source project opportunities: useful upstream contribution, plugin/integration, reusable dataset or testing tool, and hosting/support around a concrete project. If a relevant project document exists, include at least one genuinely useful open-source direction alongside other user jobs. The basedOn array names the exact reusable source; explain what it already does and what contribution or complement the proposal adds. Source snippets can identify candidates; implementation and license compatibility belong in the explicit next check. Generic software with an open-source label is weak. Keep diverse jobs; at most two directions centered on specialist maintenance. A relevant open-source direction can share an ordinary consumer job. Public stars are supply signals.

Return 3-5 genuinely distinct directions: five for a broad brand, field or ecosystem when coherent, three for a narrow product. Distinguish different user jobs, buyers, lifecycle stages or business/resource models; renaming the same feature three times is weak. Keep the user's original object: Xiaomi phones spans phone selection, ownership, maintenance, resale, specialist tooling; Xiaomi vacuums and lamps serve other objects. Source prominence reflects GitHub coverage rather than user importance. Retain consumer/professional/service or hardware-adjacent directions when relevant, and describe their data, trust or distribution requirements. Favor an implementable software/data contribution in each. Preserve explicit constraints.

Draft the full map first, with one short targeted query for EACH direction. The application will check each query, read a candidate README and seek individual issue signals. In the review, keep direction IDs and their tasks stable; refine the artifact and assessments using directionId-tagged sources. A-source and D-source searches are scoped feature checks. Documents for another object (e.g. a vacuum in a phone search) belong outside the argument. Explicitly consider alternatives outside GitHub as hypotheses for further comparison unless a supplied source documents them. Originality requires a mechanism, bottleneck or adoption advantage. An existing implementation motivates a complementary workflow or a specific difference to test.

Ratings are qualitative judgments with reasons, never calculated market scores. Demand high requires at least two relevant independent user-request sources and a credible repeat/urgency explanation; such signals establish observed requests in that sample, with wider demand a hypothesis. An implementation or its star count establishes supply only. Use medium/inferred for a plausible recurring task, low/inferred for episodic use, exploratory/inferred for an early demand hypothesis. Use observed only for the dimension directly supported by citations. The parent Google Trends series and overall repository counts stay separate from each direction's demand and competition. Small/empty GitHub results establish scope coverage, so low competition remains inferred. Favor clearly conditional reasoning over invented adoption, pricing, search volume or market share.

Effort describes the scoped first deliverable: low ~ one generalist and public data in 1-2 weeks; medium needs specialist skill, integrations, multiple devices or 3-6 weeks; high needs hard-to-obtain data, hardware inventory, laboratory work, certification, several specialties or sustained operations. These are orientation examples: provide a realistic ESTIMATE and assumptions for this specific direction. Separate a demo's resources from production upkeep. Include commercial acquisition/distribution and trust requirements when material. Never invent current prices. Each field should be concise, around 20-45 English words / 30-85 Chinese characters. Use natural Chinese; translate outcome as 结果, user action as 行为. Each experiment includes a proposed numeric criterion. All directions need real substance.

The report headline and summary introduce the portfolio and its tradeoffs. The existing nine-field strategy develops recommendedId in greater depth and matches that direction exactly. The selection explains prioritization assuming a solo developer or small team; also state which direction suits a team with additional resources. Rank through an explicit judgment rather than invented numeric scores. Keep all three to five directions in the final answer, even if source collection is partial; inferred judgments remain useful with testable assumptions. Both languages represent identical directions, ratings and resource estimates. Every narrative field follows the affirmative language rules. References retain original source text.
`;

export function opportunityRoute(
  route: string | undefined,
  locale: "en" | "zh",
) {
  return route === "opensource"
    ? locale === "zh"
      ? "开源切入"
      : "Open-source contribution"
    : route === "service"
      ? locale === "zh"
        ? "服务机会"
        : "Service opportunity"
      : locale === "zh"
        ? "产品机会"
        : "Product opportunity";
}
