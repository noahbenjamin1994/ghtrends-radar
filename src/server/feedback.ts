import type { Express, Request } from "express";
import type { Engine } from "../core/engine.js";
import { feedbackInputSchema, feedbackTargetSchema } from "../core/feedback.js";
import type { installAuth } from "./auth.js";
import { requestLocale } from "../core/i18n.js";

export function installFeedbackRoutes(
  app: Express,
  engine: Engine,
  auth: ReturnType<typeof installAuth>,
) {
  const target = (q: Request) => {
    const parsed = feedbackTargetSchema.safeParse(q.params);
    if (!parsed.success)
      throw Object.assign(new Error("Open a saved report to leave feedback."), {
        status: 400,
      });
    return parsed.data;
  };
  const method = (kind: "report" | "deep", id: string, owner: string) => {
    if (kind === "report") {
      const report = engine.store.report(id);
      if (report && engine.store.canRead(id, owner))
        return report.brief?.strategyVersion || report.version;
    } else {
      const task = engine.store.deepTask(id, owner);
      if (task && ["complete", "partial"].includes(task.state))
        return task.version;
    }
    throw Object.assign(new Error("Open a saved report to leave feedback."), {
      status: 404,
    });
  };
  app.get("/api/account/feedback", (q, r) => {
    const user = auth.requireUser(q);
    if (q.query.format === "json") r.attachment("ghtrends-feedback.json");
    r.json(engine.store.feedbackHistory(user.id));
  });
  app.get("/api/feedback/:kind/:id", (q, r) => {
    const user = auth.requireUser(q),
      { kind, id } = target(q);
    const saved = engine.store.feedback(user.id, kind, id);
    if (!saved) method(kind, id, user.id);
    r.json(saved);
  });
  app.post("/api/feedback/:kind/:id", (q, r) => {
    const user = auth.protect(q),
      { kind, id } = target(q),
      version = method(kind, id, user.id);
    const chinese =
      requestLocale(q.query.lang, q.get("cookie"), q.get("accept-language")) ===
      "zh";
    const parsed = feedbackInputSchema.safeParse(q.body);
    if (!parsed.success)
      return r.status(400).json({
        error: chinese
          ? "请选择一项反馈，补充说明最多 500 字。"
          : "Choose one response and keep your optional note within 500 characters.",
      });
    const now = Date.now(),
      key = `feedback-writes:${user.id}`;
    const limit = engine.store.get<{ count: number; until: number }>(key) || {
      count: 0,
      until: now + 60000,
    };
    if (limit.count >= 30)
      return r
        .status(429)
        .set(
          "Retry-After",
          String(Math.max(1, Math.ceil((limit.until - now) / 1000))),
        )
        .json({
          error: chinese
            ? "反馈正在保存，请稍后继续。"
            : "Please continue updating your feedback shortly.",
        });
    engine.store.set(
      key,
      { ...limit, count: limit.count + 1 },
      Math.max(1, limit.until - now),
    );
    r.json(
      engine.store.saveFeedback(
        user.id,
        kind,
        id,
        parsed.data,
        version,
        auth.isAdmin(user) || !auth.hosted,
      ),
    );
  });
  app.delete("/api/feedback/:kind/:id", (q, r) => {
    const user = auth.protect(q),
      { kind, id } = target(q);
    engine.store.removeFeedback(user.id, kind, id);
    r.json({ deleted: true });
  });
}
