import test from "node:test";
import assert from "node:assert/strict";
import {
  countedExperimentSchema,
  experimentCountsSchema,
  experimentPlanSchema,
  normalizeExperimentPlan,
  renderExperiment,
} from "../src/core/experiment.js";
import { syncExperimentPlan, strategySchema } from "../src/core/strategy.js";
import {
  clearOpportunitySchema,
  proseRepairs,
} from "../src/core/opportunities.js";

function pilot() {
  return {
    directionId: "session-notes",
    counts: {
      participants: 5,
      tasksPerParticipant: 5,
      successfulTasksPerParticipant: 4,
      continueAt: 4,
      redirectAtMost: 2,
    },
    en: {
      participants: "Groomers who consent to using redacted session records.",
      task: "Record one grooming session with the existing form and proposed checklist.",
      timebox:
        "Run a one-week pilot after confirming recruitment and asset permissions.",
      measurement:
        "All agreed care details are recorded, and entry takes at most the existing form's time on the same session.",
      redirectAction:
        "Test a shorter checklist using the fields groomers use at the next visit.",
    },
    zh: {
      participants: "征得同意的宠物美容师，使用脱敏服务记录。",
      task: "用现有表单和拟议清单分别记录同一次美容服务。",
      timebox: "确认招募与资料权限后，开展一周试验。",
      measurement:
        "记录全部约定护理信息，且填写耗时至多为现有表单记录同次服务的耗时。",
      redirectAction: "根据美容师下次服务时实际查看的字段，测试更短的清单。",
    },
  };
}

test("per-person trials and the cohort keep different denominators in both languages", () => {
  const p = normalizeExperimentPlan(pilot())!;
  assert.equal(experimentPlanSchema.safeParse(p).success, true);
  const en = renderExperiment(p, "en"),
    zh = renderExperiment(p, "zh");
  assert.match(en.experiment, /Each completes 5 tasks \(25 total\)/);
  assert.match(en.experiment, /at least 4\/5 successful tasks/);
  assert.match(en.successSignal, /at least 4 qualify/);
  assert.match(zh.experiment, /每人完成 5 次任务，共 25 次/);
  assert.match(zh.experiment, /每人至少 4\/5 次成功/);
  assert.match(zh.successSignal, /至少 4 人达标/);
  assert.match(
    en.successSignal,
    /3–3 qualifying participants, gather more evidence/,
  );
  assert.match(zh.pivotSignal, /至多 2 人达标/);
});

test("impossible task counts, oversized cohorts and overlapping outcomes require repair", () => {
  for (const patch of [
    { successfulTasksPerParticipant: 6 },
    { continueAt: 6 },
    { redirectAtMost: 4 },
    { redirectAtMost: 5 },
    { participants: 0 },
    { tasksPerParticipant: 0 },
    { participants: 2.5 },
  ]) {
    const p = pilot();
    Object.assign(p.counts, patch);
    assert.equal(countedExperimentSchema.safeParse(p).success, false);
    assert.equal(normalizeExperimentPlan(p), undefined);
  }
});

test("all permitted continue/redirect thresholds are mutually exclusive and retain middle outcomes", () => {
  for (let participants = 1; participants <= 50; participants++)
    for (let continueAt = 1; continueAt <= participants; continueAt++)
      for (
        let redirectAtMost = 0;
        redirectAtMost < continueAt;
        redirectAtMost++
      ) {
        const c = experimentCountsSchema.parse({
          participants,
          continueAt,
          redirectAtMost,
          tasksPerParticipant: 5,
          successfulTasksPerParticipant: 4,
        });
        for (let qualified = 0; qualified <= participants; qualified++) {
          const decisions = [
            qualified >= c.continueAt,
            qualified <= c.redirectAtMost,
            qualified > c.redirectAtMost && qualified < c.continueAt,
          ];
          assert.equal(decisions.filter(Boolean).length, 1);
        }
      }
});

test("computed thresholds resist prose edits, survive storage and reach both report views", () => {
  const p = normalizeExperimentPlan(pilot())!;
  const raw = {
    recommendedId: p.directionId,
    experimentPlan: p,
    en: { strategy: {} },
    zh: { strategy: {} },
    opportunities: [{ id: p.directionId, en: {}, zh: {} }],
  };
  const synced = syncExperimentPlan(raw);
  synced.experimentPlan.en.continueIf =
    "Continue at any number, including zero.";
  const fixed = syncExperimentPlan(JSON.parse(JSON.stringify(synced)));
  assert.deepEqual(fixed, syncExperimentPlan(raw));
  assert.deepEqual(syncExperimentPlan(fixed), fixed);
  const paths = proseRepairs(fixed, true).map((f) => f.path);
  assert.ok(paths.includes("experimentPlan.en.measurement"));
  assert.ok(paths.includes("experimentPlan.zh.redirectAction"));
  assert.ok(!paths.includes("experimentPlan.en.continueIf"));
  assert.ok(!paths.includes("opportunities.0.zh.successSignal"));
  assert.equal(
    fixed.en.strategy.experiment,
    fixed.opportunities[0].en.experiment,
  );
});

test("maximum authored field sizes fit stored and displayed bounds", () => {
  const p = pilot();
  p.counts = {
    participants: 50,
    tasksPerParticipant: 20,
    successfulTasksPerParticipant: 20,
    continueAt: 50,
    redirectAtMost: 48,
  };
  for (const lang of ["en", "zh"] as const)
    for (const [key, size] of Object.entries({
      participants: 160,
      task: 220,
      timebox: 140,
      measurement: 180,
      redirectAction: 140,
    }))
      (p[lang] as any)[key] = "x".repeat(size);
  const normalized = normalizeExperimentPlan(p)!;
  assert.ok(normalized);
  assert.equal(experimentPlanSchema.safeParse(normalized).success, true);
  for (const lang of ["en", "zh"] as const) {
    const fields = renderExperiment(normalized, lang);
    assert.ok(
      strategySchema.shape.experiment.safeParse(fields.experiment).success,
    );
    assert.ok(
      clearOpportunitySchema.shape.en.shape.successSignal.safeParse(
        fields.successSignal,
      ).success,
    );
    assert.ok(
      clearOpportunitySchema.shape.en.shape.pivotSignal.safeParse(
        fields.pivotSignal,
      ).success,
    );
  }
});

test("historical free-text pilots retain their existing wording", () => {
  const p: any = pilot();
  delete p.counts;
  for (const lang of ["en", "zh"] as const) {
    p[lang].continueIf = "Legacy proposed continue condition.";
    p[lang].redirectIf = "Legacy proposed redirect condition.";
  }
  const normalized = normalizeExperimentPlan(p)!;
  assert.equal(
    renderExperiment(normalized, "en").successSignal,
    p.en.continueIf,
  );
  assert.equal(
    renderExperiment(normalized, "zh").experiment,
    [p.zh.participants, p.zh.task, p.zh.timebox, p.zh.measurement].join(" "),
  );
});
