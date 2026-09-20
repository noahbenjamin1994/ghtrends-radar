import { createHash, randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { Engine } from "../core/engine.js";
import {
  DEEP_VERSION,
  deepMarkdown,
  deepRequestSchema,
  type DeepTask,
} from "../core/deep.js";
import { operationContext } from "../core/operations.js";
import { mergeActivity } from "../core/activity.js";
import { streamSnapshot } from "./stream.js";
import { visibleOpportunities } from "../core/opportunities.js";
import { requestLocale } from "../core/i18n.js";
import { runDeepResearch } from "../providers/deep.js";
import type { installAuth } from "./auth.js";
import { CreditAccountClient } from "./credits.js";
import { DeepBilling } from "./deep-billing.js";

const messages: Record<string, [string, string]> = {
  deep_billing_pending: [
    "Your research credit is being confirmed. Check your saved task shortly.",
    "研究次数正在核对，请稍后查看已保存的任务。",
  ],
  deep_paid_disabled: [
    "Purchased research is being prepared for this deployment.",
    "本站正在准备已购专项研究服务。",
  ],
  deep_paid_consent: [
    "Confirm one purchased credit to continue this research.",
    "请确认使用 1 次已购次数，再继续本项研究。",
  ],
  deep_removed: [
    "This research content was deleted. Open your history to continue.",
    "这份研究内容已删除，请从个人历史继续。",
  ],
  deep_missing: [
    "Open a saved research task to continue.",
    "请从个人历史打开专项研究。",
  ],
  deep_disabled: [
    "Focused research is being prepared for this deployment.",
    "本站正在准备专项研究服务。",
  ],
  deep_active: [
    "Your research is in progress. Open it from your history.",
    "你的研究正在进行，请从个人历史查看进度。",
  ],
  deep_capacity: [
    "Research capacity is in use. Continue at the next daily reset.",
    "今日专项研究容量已使用，请在次日继续。",
  ],
  deep_attempts: [
    "This task has used its three collection attempts. Its evidence remains in your history.",
    "本任务已完成三次采集尝试，已取得的证据保存在个人历史。",
  ],
  deep_trial_used: [
    "Your introductory research credit is in use. Your saved research remains available.",
    "首次专项体验次数已使用或预留，已有研究可随时查阅。",
  ],
  deep_request_changed: [
    "Review the selected direction and start a new request.",
    "请核对所选方向后重新发起研究。",
  ],
  deep_input: [
    "Choose a direction and question, with up to 400 characters of context.",
    "请选择一个方向和问题，补充信息最多 400 字。",
  ],
};
export const deepView = (task: DeepTask) => {
  const { owner: _owner, work: _work, ...view } = task;
  return view;
};

/** Durable tasks; one execution lane shared with standard scans. */
export function installDeepRoutes(
  app: Express,
  engine: Engine,
  auth: ReturnType<typeof installAuth>,
  lane: {
    available: () => boolean;
    ownerBusy: (owner: string) => boolean;
    released: () => void;
  },
  credits = new CreditAccountClient(),
) {
  let running = false,
    stopped = false;
  const enabled =
    process.env.GHTRENDS_DEEP_RESEARCH === "1" && engine.research.enabled;
  const capacity = Math.max(
    1,
    Math.min(
      200,
      Math.floor(Number(process.env.GHTRENDS_DEEP_DAILY_REQUESTS) || 20),
    ),
  );
  const paidCapacity = Math.max(
    1,
    Math.min(
      200,
      Math.floor(Number(process.env.GHTRENDS_PAID_DEEP_DAILY_REQUESTS) || 20),
    ),
  );
  const paidAttempts = Math.max(
    1,
    Math.min(
      100,
      Math.floor(Number(process.env.GHTRENDS_PAID_DEEP_DAILY_ATTEMPTS) || 10),
    ),
  );
  const paidEnabled =
    auth.hosted &&
    enabled &&
    credits.enabled &&
    process.env.GHTRENDS_PAID_RESEARCH === "1";
  const billing = new DeepBilling(engine.store, credits);
  engine.store.interruptDeepTasks();
  const hasActive = (owner: string) =>
    engine.store.deepPending().some((t) => t.owner === owner) ||
    engine.store.deepBillingBusy(owner);
  const status = (owner?: string) => ({
    enabled,
    allowance: owner ? engine.store.deepAllowance(owner, auth.hosted) : null,
    paidAvailable: paidEnabled,
    paidDailyAttempts: paidAttempts,
  });
  const nextTask = () =>
    !enabled
      ? undefined
      : engine.store
          .deepPending()
          .filter(
            (t) =>
              t.state === "queued" &&
              (t.funding !== "pack" ||
                (billing.connected &&
                  (engine.store.deepPayment(t.id)?.nextAt || 0) <= Date.now())),
          )
          .sort(
            (a, b) =>
              Number(b.funding === "pack") - Number(a.funding === "pack"),
          )[0];
  async function kick() {
    if (running || stopped || !enabled || !lane.available()) return;
    const next = nextTask();
    if (!next) return;
    running = true;
    let task: DeepTask | null = null;
    try {
      if (next.funding === "pack" && !(await billing.prepare(next))) return;
      task = engine.store.claimDeepTask(next.id, next.owner);
      if (!task) return;
      const active = task;
      // Reserve for one hour; bound execution checkpoints to fifteen minutes,
      // leaving settlement time even when a provider request finishes slowly.
      const deadline =
        task.funding === "pack"
          ? Math.min(
              Date.now() + 15 * 60000,
              Date.parse(
                engine.store.deepPayment(task.id)!.receipt!.lease_expires_at,
              ) - 60000,
            )
          : Infinity;
      const checkpoint = () => {
        if (Date.now() >= deadline) throw new Error("deep_deadline");
        engine.store.checkpointDeepTask(active);
      };
      const complete = await operationContext.run(
        {
          runId: task.id,
          userId: task.owner,
          onActivity: (activity) => {
            active.activities = mergeActivity(active.activities, activity);
            checkpoint();
          },
        },
        () => runDeepResearch(engine, active, checkpoint),
      );
      engine.store.finishDeepTask(task, complete && Date.now() < deadline);
    } catch {
      if (task) {
        task.problem = task.stage === "sources" ? "sources" : "model";
        engine.store.finishDeepTask(task, false);
      }
    } finally {
      running = false;
      if (!stopped) {
        void billing.reconcile().catch(() => {});
        lane.released();
        // Async admission failures carry their durable next-at time.
        void kick().catch(() => {});
      }
    }
  }
  const handler =
    (fn: (q: Request, r: Response) => unknown) =>
    (q: Request, r: Response, next: (e?: unknown) => void) => {
      Promise.resolve()
        .then(() => fn(q, r))
        .catch((e) => {
          if (!messages[e.message]) {
            next(e);
            return;
          }
          const zh =
            requestLocale(
              q.query.lang,
              q.get("cookie"),
              q.get("accept-language"),
            ) === "zh";
          r.status(e.status || 400).json({
            error: messages[e.message][zh ? 1 : 0],
            code: e.message,
          });
        });
    };
  const fail = (code: string, status: number): never => {
    throw Object.assign(new Error(code), { status });
  };
  app.get(
    "/api/research",
    handler((q, r) => {
      const user = auth.requireUser(q);
      r.json({
        ...status(user.id),
        tasks: engine.store.deepHistory(user.id).map((t) => ({
          id: t.id,
          title: t.title,
          question: t.request.question,
          reportId: t.request.reportId,
          state: t.state,
          stage: t.stage,
          credit: t.credit,
          funding: t.funding,
          created: t.created,
          updated: t.updated,
        })),
      });
    }),
  );
  app.post(
    "/api/research",
    handler((q, r) => {
      const user = auth.protect(q);
      if (!enabled) fail("deep_disabled", 503);
      const parsed = deepRequestSchema.safeParse(q.body);
      if (!parsed.success) fail("deep_input", 400);
      const input = parsed.data!;
      if (input.funding === "pack" && !paidEnabled)
        fail("deep_paid_disabled", 503);
      const market =
        engine.store.canRead(input.reportId, user.id) &&
        engine.store.report(input.reportId);
      const direction = visibleOpportunities(
        (market && market.brief) || undefined,
      )?.opportunities.find((d) => d.id === input.directionId);
      if (!market || !direction) fail("deep_missing", 404);
      const { requestKey: _requestKey, ...identity } = input;
      // Return an identical durable request before the busy/credit checks.
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(identity))
        .digest("hex");
      const prior = engine.store.deepRequest(user.id, input.requestKey);
      if (!prior && lane.ownerBusy(user.id)) fail("deep_active", 409);
      const now = new Date().toISOString();
      const result = engine.store.createDeepTask(
        {
          id: randomUUID(),
          owner: user.id,
          request: input,
          title: { en: direction!.en.title, zh: direction!.zh.title },
          geo: market ? market.geo : "",
          version: DEEP_VERSION,
          model: engine.research.model,
          created: now,
          updated: now,
          state: "queued",
          stage: "queued",
          attempts: 1,
          credit: auth.hosted ? "reserved" : "own-keys",
          funding: input.funding === "pack" ? "pack" : undefined,
        },
        fingerprint,
        auth.hosted,
        input.funding === "pack" ? paidCapacity : capacity,
      );
      r.status(result.created ? 202 : 200).json(deepView(result.task));
      void kick().catch(() => {});
    }),
  );
  app.get(
    "/api/research/:id",
    handler((q, r) => {
      const user = auth.requireUser(q),
        task = engine.store.deepTask(String(q.params.id), user.id);
      if (!task) fail("deep_missing", 404);
      if (q.query.stream === "1")
        return streamSnapshot(
          r,
          () => {
            const currentUser = auth.requireUser(q);
            const current = engine.store.deepTask(
              String(q.params.id),
              currentUser.id,
            );
            return current ? deepView(current) : undefined;
          },
          (view) =>
            ["complete", "partial"].includes(view.state) &&
            !["checking", "settling"].includes(view.credit),
        );
      r.json(deepView(task!));
    }),
  );
  app.get(
    "/api/research/:id/export",
    handler((q, r) => {
      const user = auth.requireUser(q),
        task = engine.store.deepTask(String(q.params.id), user.id);
      if (!task) fail("deep_missing", 404);
      const view = deepView(task!),
        lang = requestLocale(
          q.query.lang,
          q.get("cookie"),
          q.get("accept-language"),
        );
      if (q.query.format === "json")
        return r.attachment(`research-${task!.id}.json`).json(view);
      return r
        .attachment(`research-${task!.id}-${lang}.md`)
        .type("text/markdown")
        .send(deepMarkdown(view, lang));
    }),
  );
  app.delete(
    "/api/research/:id",
    handler((q, r) => {
      const user = auth.protect(q);
      engine.store.removeDeepTask(String(q.params.id), user.id);
      r.json({ removed: true });
    }),
  );
  app.post(
    "/api/research/:id/cancel",
    handler((q, r) => {
      const user = auth.protect(q);
      const task = engine.store.deepTask(String(q.params.id), user.id);
      if (!task) fail("deep_missing", 404);
      if (task!.state === "running") fail("deep_active", 409);
      if (task!.state === "queued") {
        task!.problem = "interrupted";
        engine.store.finishDeepTask(task!, false);
      }
      r.json(deepView(engine.store.deepTask(task!.id, user.id)!));
      void billing.reconcile().catch(() => {});
    }),
  );
  app.post(
    "/api/research/:id/retry",
    handler((q, r) => {
      const user = auth.protect(q);
      if (!enabled) fail("deep_disabled", 503);
      const task = engine.store.deepTask(String(q.params.id), user.id);
      if (!task) fail("deep_missing", 404);
      if (task!.funding === "pack") {
        if (
          q.body?.funding !== "pack" ||
          !Number.isInteger(q.body?.fromAttempt) ||
          q.body.fromAttempt < 1 ||
          q.body.fromAttempt > 3
        )
          fail("deep_paid_consent", 400);
        if (q.body.fromAttempt < task!.attempts) return r.json(deepView(task!));
        if (q.body.fromAttempt !== task!.attempts)
          fail("deep_request_changed", 409);
      }
      if (task!.funding === "pack" && task!.state === "partial") {
        if (!paidEnabled) fail("deep_paid_disabled", 503);
      }
      if (task!.state === "partial" && lane.ownerBusy(user.id))
        fail("deep_active", 409);
      const result = engine.store.retryDeepTask(
        task!.id,
        user.id,
        auth.hosted,
        task!.funding === "pack" ? paidCapacity : capacity,
      );
      r.status(result.state === "queued" ? 202 : 200).json(deepView(result));
      void kick().catch(() => {});
    }),
  );
  const recovery = setInterval(() => {
    if (!stopped)
      void billing
        .reconcile()
        .then(() => kick())
        .catch(() => {});
  }, 5000);
  recovery.unref();
  return {
    status,
    next: nextTask,
    hasActive,
    kick,
    get running() {
      return running;
    },
    stop: () => {
      stopped = true;
      clearInterval(recovery);
    },
  };
}
