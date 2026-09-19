import { z } from "zod";

/** Count people and their tasks separately; both outcome thresholds use people. */
export const experimentCountsSchema = z
  .object({
    participants: z.number().int().min(1).max(50),
    tasksPerParticipant: z.number().int().min(1).max(20),
    successfulTasksPerParticipant: z.number().int().min(1).max(20),
    continueAt: z.number().int().min(1).max(50),
    redirectAtMost: z.number().int().min(0).max(49),
  })
  .superRefine((counts, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message,
      });
    if (counts.successfulTasksPerParticipant > counts.tasksPerParticipant)
      issue(
        "successfulTasksPerParticipant",
        "Successful tasks must fit one participant's task count.",
      );
    if (counts.continueAt > counts.participants)
      issue(
        "continueAt",
        "The continue threshold must fit the participant count.",
      );
    if (counts.redirectAtMost >= counts.continueAt)
      issue(
        "redirectAtMost",
        "The redirect threshold must be strictly below the continue threshold.",
      );
  });

const experimentCopy = z.object({
  participants: z.string().trim().min(8).max(250),
  task: z.string().trim().min(8).max(350),
  timebox: z.string().trim().min(8).max(180),
  measurement: z.string().trim().min(8).max(300),
  continueIf: z.string().trim().min(8).max(300),
  redirectIf: z.string().trim().min(8).max(300),
  redirectAction: z.string().trim().min(8).max(140).optional(),
});

// Legacy plans remain readable. New generation uses the required counts below.
export const experimentPlanSchema = z.object({
  directionId: z.string().min(2).max(41),
  counts: experimentCountsSchema.optional(),
  en: experimentCopy,
  zh: experimentCopy,
});
export type ExperimentPlan = z.infer<typeof experimentPlanSchema>;

const countedCopy = experimentCopy
  .omit({ continueIf: true, redirectIf: true })
  .extend({
    participants: z.string().trim().min(8).max(160),
    task: z.string().trim().min(8).max(220),
    timebox: z.string().trim().min(8).max(140),
    measurement: z.string().trim().min(8).max(180),
    redirectAction: z.string().trim().min(8).max(140),
  });
export const countedExperimentSchema = z.object({
  directionId: z.string().min(2).max(41),
  counts: experimentCountsSchema,
  en: countedCopy,
  zh: countedCopy,
});

export function renderExperiment(plan: ExperimentPlan, lang: "en" | "zh") {
  const p = plan[lang],
    c = plan.counts;
  if (!c)
    return {
      experiment: [p.participants, p.task, p.timebox, p.measurement].join(" "),
      successSignal: p.continueIf,
      pivotSignal: p.redirectIf,
    };
  const total = c.participants * c.tasksPerParticipant;
  const intermediate =
    c.redirectAtMost + 1 < c.continueAt
      ? lang === "zh"
        ? `达标人数为 ${c.redirectAtMost + 1}–${c.continueAt - 1} 人时，继续收集证据。`
        : `For ${c.redirectAtMost + 1}–${c.continueAt - 1} qualifying participants, gather more evidence.`
      : "";
  return lang === "zh"
    ? {
        experiment: `邀请 ${c.participants} 位参与者：${p.participants} 每人完成 ${c.tasksPerParticipant} 次任务，共 ${total} 次。${p.task} ${p.timebox} 单次成功标准：${p.measurement} 每人至少 ${c.successfulTasksPerParticipant}/${c.tasksPerParticipant} 次成功即为达标。`,
        successSignal: `建议：完成全部 ${c.participants} 人的测试后，至少 ${c.continueAt} 人达标时继续投入。${intermediate}`,
        pivotSignal: `建议：完成全部 ${c.participants} 人的测试后，至多 ${c.redirectAtMost} 人达标时调整方向。${p.redirectAction}`,
      }
    : {
        experiment: `Recruit ${c.participants} participants: ${p.participants} Each completes ${c.tasksPerParticipant} tasks (${total} total). ${p.task} ${p.timebox} A task succeeds when: ${p.measurement} Each participant qualifies with at least ${c.successfulTasksPerParticipant}/${c.tasksPerParticipant} successful tasks.`,
        successSignal:
          `Proposed: finish all ${c.participants} participants' tests, then continue if at least ${c.continueAt} qualify. ${intermediate}`.trim(),
        pivotSignal: `Proposed: finish all ${c.participants} participants' tests, then redirect if at most ${c.redirectAtMost} qualify. ${p.redirectAction}`,
      };
}

/** New authoring omits derived decision prose. Rendering owns its numbers. */
export function normalizeExperimentPlan(
  raw: unknown,
): ExperimentPlan | undefined {
  const counted = countedExperimentSchema.safeParse(raw);
  if (counted.success) {
    const plan: ExperimentPlan = {
      ...counted.data,
      en: { ...counted.data.en, continueIf: "", redirectIf: "" },
      zh: { ...counted.data.zh, continueIf: "", redirectIf: "" },
    };
    for (const lang of ["en", "zh"] as const) {
      const fields = renderExperiment(plan, lang);
      plan[lang].continueIf = fields.successSignal;
      plan[lang].redirectIf = fields.pivotSignal;
    }
    return plan;
  }
  // A malformed counted plan must be repaired with its own schema.
  if (raw && typeof raw === "object" && "counts" in raw) return undefined;
  const legacy = experimentPlanSchema.safeParse(raw);
  return legacy.success ? legacy.data : undefined;
}

export const COUNTED_EXPERIMENT_PROMPT = `Create ONE experimentPlan bound to recommendedId. counts contains integers: participants (1–50), tasksPerParticipant (1–20), successfulTasksPerParticipant (at most tasksPerParticipant), continueAt (at most participants), redirectAtMost (strictly below continueAt). These are proposed pilot sizes and thresholds, shared by both languages. Use a small feasible cohort. The application calculates total tasks, each participant's qualification, continue/redirect wording, and intermediate outcomes. A complete cohort is required before either decision.
Each en/zh object contains: participants (who to recruit and required access, omit cohort numbers), task (what ONE task involves, artifact and existing comparison), timebox (proposed duration), measurement (one observable task-success condition, optionally AND one cost/time guardrail), redirectAction (a concrete change to try). Omit continueIf/redirectIf and duplicate cohort/qualification thresholds. Define all task items and expected outcomes: mixed normal/abnormal fixtures measure correct handling of both, with a stated denominator; timing names the start/end and same-task baseline. An existing batch form stays the comparison for a proposed batch-form extension. Keep one trial's success separate from the count of successful trials and people. Measurement thresholds describe ONE task; recruitment and decision counts live ONLY in counts. Resources, permissions and recruitment remain requirements. Preserve equivalent task-success conditions in both languages. Target one short sentence per field within the supplied bounds.`;
