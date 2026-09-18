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
import { visibleOpportunities } from "../core/opportunities.js";
import { requestLocale } from "../core/i18n.js";
import { runDeepResearch } from "../providers/deep.js";
import type { installAuth } from "./auth.js";

const messages: Record<string, [string, string]> = {
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
  const { owner: _owner, ...view } = task;
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
  engine.store.interruptDeepTasks();
  const hasActive = (owner: string) =>
    engine.store.deepPending().some((t) => t.owner === owner);
  const status = (owner?: string) => ({
    enabled,
    allowance: owner ? engine.store.deepAllowance(owner, auth.hosted) : null,
  });
  async function kick() {
    if (running || stopped || !lane.available()) return;
    const next = engine.store.deepPending().find((t) => t.state === "queued");
    if (!next) return;
    running = true;
    const task = engine.store.claimDeepTask(next.id, next.owner);
    try {
      if (!task) return;
      const complete = await operationContext.run(
        { runId: task.id, userId: task.owner },
        () =>
          runDeepResearch(engine, task, () =>
            engine.store.checkpointDeepTask(task),
          ),
      );
      engine.store.finishDeepTask(task, complete);
    } catch {
      if (task) {
        task.problem = task.stage === "sources" ? "sources" : "model";
        engine.store.finishDeepTask(task, false);
      }
    } finally {
      running = false;
      if (!stopped) {
        lane.released();
        void kick();
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
        },
        fingerprint,
        auth.hosted,
        capacity,
      );
      r.status(result.created ? 202 : 200).json(deepView(result.task));
      void kick();
    }),
  );
  app.get(
    "/api/research/:id",
    handler((q, r) => {
      const user = auth.requireUser(q),
        task = engine.store.deepTask(String(q.params.id), user.id);
      if (!task) fail("deep_missing", 404);
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
    "/api/research/:id/retry",
    handler((q, r) => {
      const user = auth.protect(q);
      if (!enabled) fail("deep_disabled", 503);
      const task = engine.store.deepTask(String(q.params.id), user.id);
      if (!task) fail("deep_missing", 404);
      if (task!.state === "partial" && lane.ownerBusy(user.id))
        fail("deep_active", 409);
      const result = engine.store.retryDeepTask(
        task!.id,
        user.id,
        auth.hosted,
        capacity,
      );
      r.status(result.state === "queued" ? 202 : 200).json(deepView(result));
      void kick();
    }),
  );
  return {
    status,
    hasActive,
    kick,
    get running() {
      return running;
    },
    stop: () => {
      stopped = true;
    },
  };
}
