// Reports one span per outbound collection attempt to scope, the shared
// observability plane. Every call here is fire-and-forget: scope being down,
// slow or misconfigured must never change what a research run returns.
//
// Spans carry the fields that past incidents proved necessary to tell two
// different failure sites apart — engine, exit gateway, HTTP status, byte
// count — not a single opaque error string.
import { randomUUID } from "node:crypto";

export interface SpanInput {
  spanId?: string;
  traceId?: string;
  op: string;
  caller?: string;
  target?: string;
  actorPlanned?: string;
  actorActual?: string;
  phase?: string;
  status: "running" | "ok" | "failed";
  outcome?: string;
  error?: string;
  evidence?: Record<string, unknown>;
  startedAt: number;
  endedAt?: number;
}

const url = () => process.env.SCOPE_URL?.trim() || "";
const token = () => process.env.SCOPE_TOKEN?.trim() || "";

/** Gateway identity without credentials. Never let proxy auth reach a log. */
export function exitLabel(proxy?: string): string | undefined {
  if (!proxy) return undefined;
  try {
    const u = new URL(proxy);
    const country = /-country-([a-z]{2})/i.exec(
      decodeURIComponent(u.username),
    )?.[1];
    return country ? `${u.host}/${country.toUpperCase()}` : u.host;
  } catch {
    return undefined;
  }
}

export function report(span: SpanInput): void {
  const base = url();
  if (!base || !token()) return;
  const body = {
    spans: [
      {
        span_id: span.spanId || randomUUID(),
        trace_id: span.traceId,
        source: "radar",
        caller: span.caller,
        op: span.op,
        channel: "direct",
        target: span.target?.slice(0, 2000),
        actor_planned: span.actorPlanned,
        actor_actual: span.actorActual,
        phase: span.phase,
        status: span.status,
        outcome: span.outcome,
        error: span.error?.slice(0, 4000),
        evidence: span.evidence,
        started_at: new Date(span.startedAt).toISOString(),
        ended_at: span.endedAt ? new Date(span.endedAt).toISOString() : undefined,
        duration_ms: span.endedAt ? Math.round(span.endedAt - span.startedAt) : undefined,
      },
    ],
  };
  // No await, no retry, no queue. A failed report is a lost row in a dashboard;
  // a blocked report is a stalled research run. Those are not comparable.
  void fetch(new URL("/v1/spans", base), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

/** Wraps a transport so every attempt leaves a span. Return value untouched. */
export function traced<A extends unknown[], R>(
  op: string,
  fn: (...args: A) => Promise<R>,
  describe: (args: A, result?: R, error?: unknown) => Omit<SpanInput, "op" | "status" | "startedAt" | "endedAt">,
  // A transport that resolves with `{ error }` failed just as truly as one that
  // threw. Recording it as ok is how a dashboard ends up disagreeing with reality.
  failedIf?: (result: R) => string | undefined,
  traceId?: () => string | undefined,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const startedAt = Date.now();
    const trace = traceId?.();
    try {
      const result = await fn(...args);
      const soft = failedIf?.(result);
      const detail = describe(args, result);
      report({
        ...detail,
        op,
        traceId: trace,
        status: soft ? "failed" : "ok",
        outcome: soft || detail.outcome,
        startedAt,
        endedAt: Date.now(),
      });
      return result;
    } catch (error) {
      const detail = describe(args, undefined, error);
      report({
        ...detail,
        op,
        traceId: trace,
        status: "failed",
        // The thrown message is the outcome bucket here (search_timeout,
        // document_access…), which is exactly what distinguishes the sites.
        outcome: detail.outcome || (error instanceof Error ? error.message : "unknown"),
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        endedAt: Date.now(),
      });
      throw error;
    }
  };
}
