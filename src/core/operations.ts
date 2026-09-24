import { AsyncLocalStorage } from "node:async_hooks";
import type { ResearchActivity } from "./activity.js";

export const operationContext = new AsyncLocalStorage<{
  runId: string;
  userId?: string;
  onActivity?: (activity: ResearchActivity) => void;
  llmBudget?: { calls: number; outputTokens: number; maxCalls: number };
}>();

// Upper bounds, not generation targets. Full bilingual legacy reports need
// more room than small JSON decisions; never spend thinking tokens.
export function llmOutputLimit(operation: string) {
  if (/^(plan|deep-plan|query-repair)$/.test(operation)) return 900;
  if (operation === "strategy-deep-write") return 4500;
  if (operation === "strategy-deep-repair") return 3000;
  if (operation === "strategy-deep-review") return 1800;
  if (/^strategy-(review|edit)$/.test(operation)) return 9000;
  if (/copy|relevance|portfolio-review/.test(operation)) return 2200;
  if (/issue-reading|evidence-review/.test(operation)) return 3500;
  return 4000;
}
export interface ProviderCall {
  provider: "deepseek" | "github" | "trends" | "search" | "documents";
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
  kind?: "scan" | "preflight" | "fit" | "deep";
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
