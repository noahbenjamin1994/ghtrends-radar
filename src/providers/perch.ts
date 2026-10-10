import { z } from "zod";
import type { Store } from "../core/store.js";
import { operationContext } from "../core/operations.js";

/** perch runs the logged-in browsers. Radar asks it for what a plain request
 * cannot read; it never drives a browser itself. */
const itemSchema = z.object({
  title: z.string().catch(""),
  url: z.string().url(),
  author: z.string().nullish().catch(null),
  body: z.string().catch(""),
  like_count: z.number().nullish().catch(null),
  published_at: z.number().nullish().catch(null),
  external_id: z.string().nullish().catch(null),
  extra: z
    .object({ content_type: z.string().nullish().catch(null) })
    .nullish()
    .catch(null),
});
const taskSchema = z.object({
  task: z.object({
    id: z.string(),
    status: z.string(),
    failure_kind: z.string().nullish(),
    result: z
      .object({ items: z.array(z.unknown()).catch([]) })
      .nullish()
      .catch(null),
  }),
});
export type PerchItem = z.infer<typeof itemSchema>;

export class Perch {
  private url = (process.env.PERCH_URL || "").replace(/\/+$/, "");
  private token = process.env.PERCH_TOKEN || "";
  constructor(private store: Store) {}
  get enabled() {
    return /^https?:\/\//.test(this.url) && this.token.length >= 32;
  }
  /** Submit one task and wait for it. An account that is busy or logged out
   * is a gap in the sources, never an error in the report. */
  async run(
    kind: "zhihu.search" | "zhihu.answer",
    params: Record<string, string | number>,
    deadline: number,
  ): Promise<PerchItem[]> {
    if (!this.enabled) return [];
    const started = Date.now();
    const signal = operationContext.getStore()?.signal;
    const call = async (path: string, body?: unknown) => {
      const response = await fetch(this.url + path, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: "Bearer " + this.token,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([
          AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!response.ok) throw new Error(`perch_http_${response.status}`);
      return taskSchema.parse(await response.json()).task;
    };
    let error: string | undefined,
      items: PerchItem[] = [];
    try {
      let task = await call("/v1/tasks", { kind, params });
      while (!["done", "dead", "failed", "cancelled"].includes(task.status)) {
        if (Date.now() + 1500 > deadline) {
          // Leave nothing queued on an account for a report that has moved on.
          void call(`/v1/tasks/${task.id}/cancel`, {}).catch(() => {});
          throw new Error("perch_timeout");
        }
        await new Promise((r) => setTimeout(r, 1200));
        task = await call("/v1/tasks/" + task.id);
      }
      if (task.status !== "done")
        throw new Error("perch_" + (task.failure_kind || task.status));
      items = (task.result?.items || []).flatMap((raw) => {
        const item = itemSchema.safeParse(raw);
        return item.success ? [item.data] : [];
      });
    } catch (e) {
      error = /^perch_[a-z0-9_]+$/.test((e as Error).message)
        ? (e as Error).message
        : "perch_transport";
    }
    this.store.recordCall({
      provider: "documents",
      operation: "perch-" + kind,
      started: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      ...(error ? { error } : { status: 200 }),
    });
    return items;
  }
}
