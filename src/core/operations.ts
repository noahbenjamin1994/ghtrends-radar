import { AsyncLocalStorage } from "node:async_hooks";

export const operationContext = new AsyncLocalStorage<{
  runId: string;
  userId?: string;
}>();
export interface ProviderCall {
  provider: "deepseek" | "github" | "trends" | "search";
  operation: string;
  started: string;
  durationMs: number;
  cached?: boolean;
  status?: number;
  error?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
  rateBucket?: string;
  rateRemaining?: number;
  rateReset?: number;
  transferBytes?: number;
  proxyRoute?: "primary" | "backup";
}
export interface RunRecord {
  id: string;
  kind?: "scan" | "preflight";
  userId?: string;
  input: string;
  geo: string;
  background: boolean;
  created: string;
}
export type RunState =
  "queued" | "running" | "complete" | "failed" | "interrupted";
export const tokenCount = (n: unknown): number | undefined =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;

// Operator-configured USD per million tokens. Snapshot the estimate per call;
// unknown usage/rates remain unknown, never zero. This is not a provider invoice.
export function estimatedCost(
  model: string,
  usage: any,
  started: string,
): number | undefined {
  try {
    const p = JSON.parse(process.env.GHTRENDS_LLM_PRICING_JSON || "{}")[model];
    const input = tokenCount(usage?.prompt_tokens),
      output = tokenCount(usage?.completion_tokens);
    const cached = tokenCount(
      usage?.prompt_cache_hit_tokens ??
        usage?.prompt_tokens_details?.cached_tokens,
    );
    if (
      !p ||
      input === undefined ||
      output === undefined ||
      cached === undefined ||
      cached > input ||
      ![p.input, p.cachedInput, p.output].every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
      )
    )
      return;
    const date = new Date(started),
      day = date.getUTCDay(),
      hour = date.getUTCHours();
    const peak =
      day >= 1 &&
      day <= 5 &&
      ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
    const multiplier = peak ? 1 : (p.offPeakMultiplier ?? 1);
    if (
      typeof multiplier !== "number" ||
      !Number.isFinite(multiplier) ||
      multiplier < 0
    )
      return;
    return (
      (((input - cached) * p.input +
        cached * p.cachedInput +
        output * p.output) *
        multiplier) /
      1e6
    );
  } catch {
    return;
  }
}
