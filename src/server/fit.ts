import { createHash, randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Engine } from "../core/engine.js";
import { FIT_VERSION, profileSchema, type SavedFit } from "../core/fit.js";
import { operationContext } from "../core/operations.js";
import { visibleOpportunities } from "../core/opportunities.js";
import type { installAuth } from "./auth.js";

/** Personal recommendations stay separate from the immutable, shareable report. */
export function installFitRoutes(
  app: Express,
  engine: Engine,
  auth: ReturnType<typeof installAuth>,
) {
  const pending = new Map<
    string,
    {
      key: string;
      reportId: string;
      persistLatest: boolean;
      promise: Promise<SavedFit>;
    }
  >();
  const preserveSelection = (owner: string, reportId: string) => {
    const running = pending.get(owner);
    if (running?.reportId === reportId) running.persistLatest = false;
  };
  const latestKey = (owner: string, reportId: string) =>
    `direction-fit:last:${owner}:${reportId}`;
  const report = (id: string, owner: string) => {
    const m = /^[a-f0-9]{16}$/.test(id) && engine.store.report(id);
    if (!m || !engine.store.canRead(id, owner))
      throw Object.assign(
        new Error("Open a report in your research history to continue."),
        { status: 404 },
      );
    return m;
  };
  app.get("/api/reports/:id/fit", (q, r) => {
    const user = auth.requireUser(q),
      m = report(String(q.params.id), user.id);
    const saved = engine.store.get<SavedFit>(latestKey(user.id, m.id));
    // Prompt revisions change generation cache keys; saved user selections stay readable.
    r.json(saved && ["1", FIT_VERSION].includes(saved.version) ? saved : null);
  });
  app.delete("/api/reports/:id/fit", (q, r) => {
    const user = auth.protect(q),
      m = report(String(q.params.id), user.id);
    preserveSelection(user.id, m.id);
    engine.store.take(latestKey(user.id, m.id));
    r.json({ cleared: true });
  });
  app.post("/api/reports/:id/fit", async (q, r) => {
    const user = auth.protect(q),
      m = report(String(q.params.id), user.id);
    const parsed = profileSchema.safeParse(q.body);
    if (!parsed.success)
      return r
        .status(400)
        .json({ error: "Choose your experience, time and goal to continue." });
    if (!visibleOpportunities(m.brief))
      return r.status(422).json({
        error: "Choose a report with researched directions to continue.",
      });
    const profile = parsed.data;
    const key =
      "direction-fit:" +
      createHash("sha256")
        .update(
          JSON.stringify([
            user.id,
            m.id,
            FIT_VERSION,
            engine.research.model,
            profile,
          ]),
        )
        .digest("hex");
    const cached = engine.store.get<SavedFit>(key);
    if (cached) {
      preserveSelection(user.id, m.id);
      engine.store.set(latestKey(user.id, m.id), cached, 30 * 86400000);
      return r.json(cached);
    }
    const current = pending.get(user.id);
    if (current?.key === key) {
      current.persistLatest = true;
      const result = await current.promise;
      return r.json(result);
    }
    if (current)
      return r.status(429).set("Retry-After", "3").json({
        error:
          "Your recommendations are being prepared. Continue when they are ready.",
      });
    if (!engine.research.enabled)
      return r.status(503).json({
        error: "Configure the research model to tailor these directions.",
      });
    const budget = engine.store.consumePreparationBudget(user.id);
    if (!budget.allowed)
      return r.status(429).json({
        error: "Continue preparing your research at the shown time.",
        retryAt: budget.retryAt,
      });
    const id = randomUUID();
    engine.store.startRun({
      id,
      kind: "fit",
      userId: user.id,
      input: m.topic.plan?.input || m.topic.name,
      geo: m.geo,
      background: false,
      created: new Date().toISOString(),
    });
    engine.store.updateRun(id, "running");
    const promise = operationContext.run(
      { runId: id, userId: user.id },
      async () => {
        try {
          const result = await engine.research.fit(m, profile);
          engine.store.set(key, result, 30 * 86400000);
          if (pending.get(user.id)?.persistLatest)
            engine.store.set(latestKey(user.id, m.id), result, 30 * 86400000);
          engine.store.updateRun(id, "complete");
          return result;
        } catch (error) {
          engine.store.updateRun(id, "failed", {
            error: (error as Error).message,
          });
          throw error;
        }
      },
    );
    pending.set(user.id, { key, reportId: m.id, persistLatest: true, promise });
    try {
      return r.json(await promise);
    } finally {
      pending.delete(user.id);
    }
  });
}
