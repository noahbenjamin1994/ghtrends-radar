import { z } from "zod";
import type { Store } from "../core/store.js";
import { operationContext } from "../core/operations.js";

/** Radar buys what a plain request cannot read from the same Data API its
 * customers use, with a key of its own. It never drives a browser itself. */
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
const callSchema = z.object({
  status: z.string(),
  outcome: z.string().nullish(),
  result: z
    .object({ items: z.array(z.unknown()).catch([]) })
    .nullish()
    .catch(null),
});
export type DataItem = z.infer<typeof itemSchema>;

export class DataApi {
  private url = (process.env.DATA_API_URL || "").replace(/\/+$/, "");
  private key = process.env.DATA_API_KEY || "";
  constructor(private store: Store) {}
  get enabled() {
    return /^https?:\/\//.test(this.url) && /^sk_.{20,}$/.test(this.key);
  }
  /** One call, waited for on the server. An account that is busy or logged
   * out is a gap in the sources, never an error in the report. */
  async run(
    op: "zhihu.search" | "zhihu.answer",
    params: Record<string, string | number>,
    deadline: number,
  ): Promise<DataItem[]> {
    if (!this.enabled) return [];
    const started = Date.now();
    const signal = operationContext.getStore()?.signal;
    const wait = Math.max(1, (deadline - started) / 1000 - 2);
    let error: string | undefined,
      items: DataItem[] = [];
    try {
      const response = await fetch(this.url + "/v1/call", {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.key,
          "content-type": "application/json",
        },
        body: JSON.stringify({ op, params, wait }),
        signal: AbortSignal.any([
          AbortSignal.timeout(Math.max(1000, deadline - started)),
          ...(signal ? [signal] : []),
        ]),
      });
      if (!response.ok) throw new Error(`dataapi_http_${response.status}`);
      const call = callSchema.parse(await response.json());
      // Still running after the wait: the report has moved on without it.
      if (call.status === "running") throw new Error("dataapi_timeout");
      if (call.status !== "ok")
        throw new Error("dataapi_" + (call.outcome || call.status));
      items = (call.result?.items || []).flatMap((raw) => {
        const item = itemSchema.safeParse(raw);
        return item.success ? [item.data] : [];
      });
    } catch (e) {
      error = /^dataapi_[a-z0-9_]+$/.test((e as Error).message)
        ? (e as Error).message
        : "dataapi_transport";
    }
    this.store.recordCall({
      provider: "documents",
      operation: "dataapi-" + op,
      started: new Date(started).toISOString(),
      durationMs: Date.now() - started,
      ...(error ? { error } : { status: 200 }),
    });
    return items;
  }
}
