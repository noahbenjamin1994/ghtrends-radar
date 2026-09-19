import { z } from "zod";
import { profileSchema } from "./fit.js";
import { hasNegativeWording, proseCounterpart } from "./i18n.js";
import { evidenceRef, recoverSourceQuote } from "./opportunities.js";
import { validQuote } from "./landscape.js";
import { sourceUseConditions, projectUseCopy } from "./capabilities.js";
import {
  countedExperimentSchema,
  experimentPlanSchema,
  normalizeExperimentPlan,
  renderExperiment,
} from "./experiment.js";
import type { ResearchSource } from "./types.js";
import type { WebEvidence, SearchQuery } from "../providers/search.js";
import type { DocumentRead } from "../providers/documents.js";

export const DEEP_VERSION = "10";
export const deepQuestions = {
  competitors: [
    "Where is the opening among existing products?",
    "现有同行之间，还有什么切入空间？",
  ],
  scope: [
    "What should my first release deliver?",
    "首版应该交付什么，投入多少？",
  ],
  opensource: [
    "What can I build on open source?",
    "借助开源项目，可以做出什么？",
  ],
  audience: [
    "Where can I find the first users?",
    "第一批适合验证的用户在哪里？",
  ],
} as const;
export const deepRequestSchema = z
  .object({
    reportId: z.string().regex(/^[a-f0-9]{16}$/),
    directionId: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    question: z.enum(["competitors", "scope", "opensource", "audience"]),
    funding: z.enum(["trial", "pack"]).optional(),
    context: z
      .string()
      .trim()
      .max(400)
      .regex(/^[^\x00-\x1f<>]*$/)
      .default(""),
    profile: profileSchema.optional(),
    requestKey: z.string().uuid(),
  })
  .strict();
export type DeepRequest = z.infer<typeof deepRequestSchema>;
const copy = z
  .object({
    en: z.string().trim().min(8).max(500),
    zh: z.string().trim().min(5).max(240),
  })
  .strip();
export const deepBriefSchema = z
  .object({
    headline: copy,
    answer: copy,
    findings: z
      .array(
        z
          .object({
            area: z.enum(["audience", "competitors", "opensource", "scope"]),
            subject: z
              .object({
                en: z.string().trim().min(2).max(100),
                zh: z.string().trim().min(2).max(60),
              })
              .strip(),
            statement: copy,
            implication: copy,
            basis: z.enum(["observed", "inferred"]),
            evidence: z
              .array(evidenceRef.extend({ quote: z.string().min(8).max(500) }))
              .max(3),
          })
          .strip(),
      )
      .min(2)
      .max(6),
    plan: z
      .object({
        deliverable: copy,
        resources: copy,
        effort: z
          .object({
            hoursMin: z.number().int().min(1).max(2000),
            hoursMax: z.number().int().min(1).max(2000),
            assumption: copy,
          })
          .strip(),
        maintenance: copy,
        experiment: z.object({
          en: z.string().min(8).max(1100),
          zh: z.string().min(5).max(1100),
        }),
        continueIf: copy,
        changeIf: copy,
      })
      .strip(),
    checks: z.array(copy).max(5),
    experimentPlan: experimentPlanSchema.optional(),
  })
  .strip();
export type DeepBrief = z.infer<typeof deepBriefSchema>;

/** Only the five authored fields and shared counts are generated for new pilots. */
export const deepGenerationSchema = deepBriefSchema.extend({
  plan: deepBriefSchema.shape.plan.omit({
    experiment: true,
    continueIf: true,
    changeIf: true,
  }),
  experimentPlan: countedExperimentSchema,
  checks: deepBriefSchema.shape.checks.max(3),
});

export function deepProjectUseConditions(
  result: DeepBrief,
  sources: ResearchSource[],
) {
  const ids = new Set(
    result.findings.flatMap((f) => f.evidence.map((ref) => ref.id)),
  );
  // A cited license or release belongs to the same repository's README notice.
  const projects = new Set(
    sources
      .filter((s) => ids.has(s.id || ""))
      .flatMap(
        (s) =>
          /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)(?:\/|$)/i
            .exec(s.url)?.[1]
            ?.toLowerCase() || [],
      ),
  );
  for (const s of sources) {
    const project = /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)(?:\/|$)/i
      .exec(s.url)?.[1]
      ?.toLowerCase();
    if (s.id && project && projects.has(project)) ids.add(s.id);
  }
  return sourceUseConditions(sources, ids);
}

/** Small, fixed edit targets keep bilingual claims and evidence together. */
export function deepEditableFields(
  raw: unknown,
): { path: string; value: unknown }[] {
  const parsed = deepBriefSchema.safeParse(raw);
  if (!parsed.success) return [];
  const value = parsed.data;
  return [
    { path: "headline", value: value.headline },
    { path: "answer", value: value.answer },
    ...value.findings.flatMap((finding, i) =>
      (
        ["subject", "statement", "implication", "basis", "evidence"] as const
      ).map((key) => ({ path: `findings.${i}.${key}`, value: finding[key] })),
    ),
    ...Object.entries(value.plan)
      .filter(
        ([key]) =>
          !value.experimentPlan?.counts ||
          !["experiment", "continueIf", "changeIf"].includes(key),
      )
      .map(([key, item]) => ({
        path: `plan.${key}`,
        value: item,
      })),
    ...(value.experimentPlan
      ? [{ path: "experimentPlan", value: value.experimentPlan }]
      : []),
    { path: "checks", value: value.checks },
  ];
}

export function applyDeepEdits(
  raw: unknown,
  response: unknown,
  requested: string[],
): unknown {
  const patches = z
    .object({
      edits: z
        .array(
          z.object({ path: z.string().max(100), value: z.unknown() }).strip(),
        )
        .max(32),
    })
    .safeParse(response);
  if (!patches.success) return raw;
  const allowed = new Set(
    deepEditableFields(raw)
      .map((f) => f.path)
      .filter((path) => requested.includes(path)),
  );
  const result = structuredClone(raw) as Record<string, any>,
    seen = new Set<string>();
  for (const edit of patches.data.edits) {
    if (!allowed.has(edit.path) || seen.has(edit.path)) continue;
    seen.add(edit.path);
    const keys = edit.path.split("."),
      leaf = keys.pop()!;
    const target = keys.reduce((node: any, key) => node?.[key], result);
    if (target && Object.hasOwn(target, leaf)) target[leaf] = edit.value;
  }
  return result;
}

export function deepEffortText(
  effort: DeepBrief["plan"]["effort"],
  lang: "en" | "zh",
) {
  // Stored preview-v1 reports remain readable; new generation uses numeric hours.
  if (!("hoursMin" in effort))
    return (effort as { en: string; zh: string })[lang];
  const range =
    effort.hoursMin === effort.hoursMax
      ? String(effort.hoursMin)
      : `${effort.hoursMin}–${effort.hoursMax}`;
  return `${range} ${lang === "zh" ? "人时" : "person-hours"} · ${effort.assumption[lang]}`;
}
export function normalizeDeepBrief(
  raw: unknown,
  sources: ResearchSource[] = [],
): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const value = structuredClone(raw) as any;
  const experiment = normalizeExperimentPlan(value.experimentPlan);
  if (experiment?.counts && value.plan && typeof value.plan === "object") {
    value.experimentPlan = experiment;
    for (const lang of ["en", "zh"] as const) {
      const rendered = renderExperiment(experiment, lang);
      for (const [key, text] of Object.entries({
        experiment: rendered.experiment,
        continueIf: rendered.successSignal,
        changeIf: rendered.pivotSignal,
      })) {
        value.plan[key] = { ...value.plan[key], [lang]: text };
      }
    }
  }
  if (value.checks === undefined && Array.isArray(value.plan?.checks)) {
    value.checks = value.plan.checks;
    delete value.plan.checks;
  }
  for (const finding of Array.isArray(value.findings) ? value.findings : []) {
    for (const ref of Array.isArray(finding?.evidence)
      ? finding.evidence
      : []) {
      const source = sources.find((s) => s.id === ref?.id);
      if (source?.excerpt && typeof ref?.quote === "string") {
        const recovered = recoverSourceQuote(ref.quote, source.excerpt);
        if (recovered) ref.quote = recovered;
      }
    }
  }
  const readable = (node: unknown, key = ""): unknown => {
    if (typeof node === "string" && (key === "en" || key === "zh")) {
      let prose =
        key === "zh"
          ? node
              .replace(/不可变的?/g, "写入后保持原样的")
              .replace(/模型无关/g, "模型可替换")
              .replace(/无锁(?:手机|机)/g, "SIM unlocked 机型")
          : node;
      prose = prose
        .replace(/[（(](E\d+)[）)]/g, (whole, id) =>
          sources.some((s) => s.id === id) ? "" : whole,
        )
        .replace(/ {2,}/g, " ")
        .trim();
      return prose;
    }
    if (Array.isArray(node)) return node.map((v) => readable(v));
    if (node && typeof node === "object")
      return Object.fromEntries(
        Object.entries(node).map(([k, v]) => [k, readable(v, k)]),
      );
    return node;
  };
  return readable(value);
}
export function deepCopyRepairs(raw: unknown, sources: ResearchSource[] = []) {
  const fields: {
    path: string;
    value: string;
    maxCharacters: number;
    counterpart?: { language: "en" | "zh"; value: string };
  }[] = [];
  const visit = (v: unknown, path: string) => {
    if (
      (raw as any)?.experimentPlan?.counts &&
      /^plan\.(experiment|continueIf|changeIf)(\.|$)/.test(path)
    )
      return;
    const prose =
      /^(?:headline|answer|findings\.\d+\.(?:subject|statement|implication)|plan\.(?:deliverable|resources|effort\.assumption|maintenance|experiment|continueIf|changeIf)|checks\.\d+)\.(en|zh)$/.exec(
        path,
      );
    const pilot =
      /^experimentPlan\.(en|zh)\.(participants|task|timebox|measurement|redirectAction)$/.exec(
        path,
      );
    if (/^experimentPlan\.(en|zh)\.(continueIf|redirectIf)$/.test(path)) return;
    const maxCharacters = pilot
      ? (
          {
            participants: 200,
            task: 280,
            timebox: 140,
            measurement: 200,
            redirectAction: 140,
          } as Record<string, number>
        )[pilot[2]!]!
      : path.startsWith("plan.experiment.")
        ? 1100
        : path.includes(".subject.")
          ? prose?.[1] === "zh"
            ? 60
            : 100
          : prose?.[1] === "zh"
            ? 240
            : 500;
    if (
      typeof v === "string" &&
      (prose || pilot) &&
      (hasNegativeWording(v) ||
        v.length > maxCharacters ||
        /\bknownProjects\b/.test(v) ||
        (v.match(/\bE\d+\b/g) || []).some((id) =>
          sources.some((s) => s.id === id),
        ))
    ) {
      const counterpart = proseCounterpart(raw, path);
      fields.push({
        path,
        value: v,
        maxCharacters,
        ...(counterpart ? { counterpart } : {}),
      });
    } else if (v && typeof v === "object")
      for (const [k, child] of Object.entries(v))
        visit(child, path ? `${path}.${k}` : k);
  };
  visit(raw, "");
  return fields;
}
export interface DeepEvidence {
  collectionFinished?: boolean;
  collectedAt: string;
  queries: SearchQuery[];
  githubQuery: string;
  web?: WebEvidence;
  sources: ResearchSource[];
  reads: DocumentRead[];
}
export interface DeepTask {
  id: string;
  owner: string;
  request: DeepRequest;
  title: { en: string; zh: string };
  geo: string;
  version: string;
  model: string;
  created: string;
  updated: string;
  state: "queued" | "running" | "complete" | "partial";
  stage:
    | "queued"
    | "planning"
    | "sources"
    | "writing"
    | "reviewing"
    | "complete"
    | "partial";
  attempts: number;
  attemptDays?: string[];
  funding?: "trial" | "pack" | "own-keys";
  credit:
    | "checking"
    | "reserved"
    | "settling"
    | "used"
    | "returned"
    | "uncharged"
    | "own-keys";
  evidence?: DeepEvidence;
  // Internal synthesis checkpoint; only approved result is exposed to readers.
  work?: {
    fingerprint: string;
    draft: DeepBrief;
    corrections: string[];
    repairFields: string[];
  };
  result?: DeepBrief;
  problem?: "sources" | "model" | "interrupted" | "credits" | "billing";
}
export type DeepTaskView = Omit<DeepTask, "owner" | "work">;
export interface DeepAllowance {
  limit: number | null;
  remaining: number | null;
  reserved: number;
  used: number;
}
export const deepAreaLabels = {
  audience: ["People & their need", "人群与需求"],
  competitors: ["Other products", "同行与切入空间"],
  opensource: ["Open-source foundation", "可以复用的开源基础"],
  scope: ["First release", "首版交付"],
} as const;
export const deepPlanLabels = {
  deliverable: ["Build this first", "先交付什么"],
  resources: ["People, data & access", "人员、资料与权限"],
  effort: ["Effort estimate", "投入估算"],
  maintenance: ["Ongoing work", "后续维护"],
  experiment: ["Your first experiment", "第一个验证实验"],
  continueIf: ["Invest further when", "继续投入的条件"],
  changeIf: ["Change direction when", "调整方向的条件"],
} as const;

/** Exact quotes anchor claims. Semantic support is checked separately by the reviewer. */
export function deepProblems(
  raw: unknown,
  sources: ResearchSource[],
  directionId?: string,
): string[] {
  if ((raw as any)?.experimentPlan?.counts) {
    const pilot = countedExperimentSchema.safeParse(
      (raw as any).experimentPlan,
    );
    if (!pilot.success)
      return pilot.error.issues
        .slice(0, 8)
        .map((i) => `experimentPlan.${i.path.join(".")}: ${i.message}`);
  }
  const parsed = deepBriefSchema.safeParse(raw);
  if (!parsed.success)
    return parsed.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".")}: ${i.message}`);
  const result = parsed.data,
    problems: string[] = [];
  if (
    directionId &&
    (!result.experimentPlan?.counts ||
      result.experimentPlan.directionId !== directionId)
  )
    problems.push(
      "experimentPlan: provide shared pilot counts for the selected directionId.",
    );
  if (result.experimentPlan?.counts) {
    const normalized = normalizeExperimentPlan(result.experimentPlan);
    if (!normalized)
      problems.push(
        "experimentPlan: use valid shared counts and bounded bilingual task fields.",
      );
    else
      for (const lang of ["en", "zh"] as const) {
        const rendered = renderExperiment(normalized, lang);
        if (
          result.plan.experiment[lang] !== rendered.experiment ||
          result.plan.continueIf[lang] !== rendered.successSignal ||
          result.plan.changeIf[lang] !== rendered.pivotSignal
        )
          problems.push(
            "experimentPlan: derive both languages' experiment and decisions from the same shared counts.",
          );
      }
  }
  if (result.plan.effort.hoursMax < result.plan.effort.hoursMin)
    problems.push(
      "plan.effort: hoursMax must be at least hoursMin; use one coherent total effort range.",
    );
  for (const [path, value] of [
    ["plan.effort.assumption", result.plan.effort.assumption],
    ["answer", result.answer],
  ] as const) {
    if (/人[日天]|person[- ]days?/i.test(value.en + value.zh))
      problems.push(
        `${path}: express estimated effort as one total person-hour range, with an explicit scope assumption. Keep the answer focused on the selected question; detailed estimates belong in plan.effort.`,
      );
  }
  for (const [i, f] of result.findings.entries()) {
    if (f.basis === "observed" && !f.evidence.length)
      problems.push(
        `findings.${i}: cite an exact source quote for the observed fact.`,
      );
    for (const [j, ref] of f.evidence.entries())
      if (!validQuote(ref, sources))
        problems.push(
          `findings.${i}.evidence.${j}.quote: replace this quote with one exact, contiguous span from source ${ref.id}; preserve source markup. Current quote: ${JSON.stringify(ref.quote)}. Adjust the statement only if the corrected evidence changes its support.`,
        );
  }
  const checkCopy = (v: unknown, path: string) => {
    if (
      typeof v === "string" &&
      (/\.(en|zh)$/.test(path) || /^experimentPlan\.(en|zh)\./.test(path)) &&
      hasNegativeWording(v)
    )
      problems.push(
        `${path}: express this affirmatively, preserving its uncertainty and action: ${JSON.stringify(v)}`,
      );
    else if (v && typeof v === "object")
      for (const [k, child] of Object.entries(v))
        checkCopy(child, path ? `${path}.${k}` : k);
  };
  checkCopy(result, "");
  return problems;
}

export function deepDeliveryReady(
  result: DeepBrief,
  evidence: DeepEvidence,
  question: DeepRequest["question"],
) {
  const observed = result.findings.filter((f) => f.basis === "observed");
  const cited = evidence.sources.filter((s) =>
    observed.some((f) => f.evidence.some((r) => r.id === s.id)),
  );
  // A proposed scope can legitimately cite original documentation. Its
  // inferred label describes the judgment, rather than downgrading the source.
  const originals = evidence.sources.filter(
    (s) =>
      (!!s.documentType || s.kind === "project" || s.kind === "request") &&
      result.findings.some((f) => f.evidence.some((r) => r.id === s.id)),
  );
  if (new Set(cited.map((s) => s.url)).size < 2 || !originals.length)
    return false;
  const focused = observed.filter((f) =>
    question === "scope"
      ? ["scope", "opensource", "competitors"].includes(f.area)
      : f.area === question,
  );
  if (!focused.length) return false;
  const focusedSources = evidence.sources.filter((s) =>
    focused.some((f) => f.evidence.some((r) => r.id === s.id)),
  );
  if (
    question === "audience" &&
    !focusedSources.some((s) => s.kind === "request")
  )
    return false;
  if (
    question === "opensource" &&
    !focusedSources.some((s) => s.documentType === "license")
  )
    return false;
  if (
    question === "competitors" &&
    !focusedSources.some(
      (s) => s.documentType === "page" || s.kind === "project",
    )
  )
    return false;
  return true;
}

export function deepMarkdown(task: DeepTaskView, lang: "en" | "zh") {
  const l = (pair: readonly [string, string]) => pair[lang === "zh" ? 1 : 0];
  const literal = (s: string) =>
    s.replace(/[\\`*_{}\[\]<>#!|]/g, "\\$&").replace(/\r?\n/g, " ");
  const lines = [
    `# ${literal(task.title[lang])}`,
    "",
    l(deepQuestions[task.request.question]),
    "",
    task.updated,
    "",
  ];
  if (task.result) {
    const b = task.result;
    lines.push(
      `## ${literal(b.headline[lang])}`,
      "",
      literal(b.answer[lang]),
      "",
    );
    for (const f of b.findings) {
      lines.push(
        `### ${l(deepAreaLabels[f.area])}`,
        "",
        `${literal(f.subject[lang])} · ${l(f.basis === "observed" ? ["Source evidence", "来源证据"] : ["Research inference", "研究推断"])}`,
        "",
        literal(f.statement[lang]),
        "",
      );
      for (const ref of f.evidence) {
        const s = task.evidence?.sources.find((s) => s.id === ref.id);
        if (s)
          lines.push(
            `> ${literal(ref.quote)}`,
            "",
            `[${literal(s.label)}](${s.url.replace(/[()\s]/g, encodeURIComponent)})`,
            "",
          );
      }
      if (f.implication)
        lines.push(
          `**${l(["What this suggests", "对你的意义"])} · ${l(["Research inference", "研究推断"])}**`,
          "",
          literal(f.implication[lang]),
          "",
        );
    }
    for (const [key, label] of Object.entries(deepPlanLabels)) {
      lines.push(
        `### ${l(label)}`,
        "",
        literal(
          key === "effort"
            ? deepEffortText(b.plan.effort, lang)
            : b.plan[key as Exclude<keyof typeof b.plan, "effort">][lang],
        ),
        "",
      );
      if (key === "resources") {
        const notices = deepProjectUseConditions(
            b,
            task.evidence?.sources || [],
          ),
          copy = projectUseCopy(lang);
        if (notices.length) {
          lines.push(`#### ${copy.title}`, "", copy.text, "");
          for (const notice of notices)
            lines.push(
              `> ${literal(notice.quote)}`,
              "",
              `[${literal(notice.project)}](${notice.url.replace(/[()\s]/g, encodeURIComponent)})`,
              "",
            );
        }
      }
    }
    if (b.checks.length)
      lines.push(
        `### ${l(["Checks before committing", "投入前再核对"])}`,
        "",
        ...b.checks.map((c) => `- ${literal(c[lang])}`),
        "",
      );
  }
  lines.push(
    `## ${l(["Research record", "研究记录"])}`,
    "",
    `${l(["Status", "状态"])}: ${task.state} · ${l(["Credit", "次数"])}: ${task.credit}`,
    "",
    `${l(["Sources collected", "来源采集"])}: ${task.evidence?.collectedAt || task.created}`,
    "",
  );
  for (const s of task.evidence?.sources || [])
    lines.push(
      `- [${literal(s.label)}](${s.url.replace(/[()\s]/g, encodeURIComponent)}) · ${s.fetchedAt || ""}`,
    );
  return lines.join("\n");
}
