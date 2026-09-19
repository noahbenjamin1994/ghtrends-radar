import type { Express } from "express";
import {
  creditAccountSchema,
  creditHistoryQuery,
  creditReceiptSchema,
  type CreditAccount,
  type CreditReceipt,
} from "../core/credits.js";
import type { Store } from "../core/store.js";
import type { installAuth } from "./auth.js";

type Page = { activity_cursor?: string; purchase_cursor?: string };
type Snapshot = { data: CreditAccount; syncedAt: string };
export class CreditServiceError extends Error {
  constructor(public code: "unavailable" | "conflict" | "exhausted") {
    super("credits_" + code);
  }
}

/** Credentials, identity and destination are selected by the server exclusively. */
export class CreditAccountClient {
  private endpoint = "";
  private key = "";
  private project = "";
  private cache = new Map<
    string,
    { until: number; promise: Promise<Snapshot> }
  >();
  constructor(
    private transport: typeof fetch = fetch,
    env = process.env,
  ) {
    if (
      env.GHTRENDS_HOSTED !== "1" ||
      !env.GHTRENDS_NEXUS_URL ||
      !env.GHTRENDS_NEXUS_PROJECT_KEY
    )
      return;
    const url = new URL(env.GHTRENDS_NEXUS_URL);
    const internal =
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      /\.svc(?:\.cluster\.local)?$/.test(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && internal)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/", "/v1", "/v1/"].includes(url.pathname)
    )
      throw new Error(
        "Configure an HTTPS Nexus origin or an internal cluster service.",
      );
    this.endpoint = url.origin + "/v1/internal/credit-packs/account";
    this.key = env.GHTRENDS_NEXUS_PROJECT_KEY;
    this.project = env.GHTRENDS_NEXUS_PROJECT_ID || "ghtrends";
    if (!/^[a-zA-Z0-9_.-]{1,32}$/.test(this.project))
      throw new Error("Configure a valid Nexus project ID.");
  }
  get enabled() {
    return !!this.endpoint;
  }
  invalidate(owner: string) {
    for (const key of this.cache.keys())
      if (key.startsWith(`[${JSON.stringify(owner)},`)) this.cache.delete(key);
  }
  async reserve(
    owner: string,
    taskId: string,
    attempt: number,
  ): Promise<CreditReceipt> {
    return this.receipt("reserve", owner, taskId, attempt, {
      ttl_seconds: 3600,
    });
  }
  async settle(
    owner: string,
    taskId: string,
    attempt: number,
    receipt: CreditReceipt,
    outcome: "used" | "released",
  ): Promise<CreditReceipt> {
    return this.receipt("settle", owner, taskId, attempt, {
      reservation_id: receipt.reservation_id,
      outcome,
    });
  }
  private async receipt(
    operation: "reserve" | "settle",
    owner: string,
    taskId: string,
    attempt: number,
    fields: Record<string, unknown>,
  ) {
    if (
      !/^[a-f0-9-]{36}$/.test(taskId) ||
      !Number.isInteger(attempt) ||
      attempt < 1 ||
      attempt > 3
    )
      throw new CreditServiceError("conflict");
    try {
      const receipt = creditReceiptSchema.parse(
        await this.request(operation, owner, {
          ...fields,
          task_ref: taskId,
          attempt,
        }),
      );
      if (receipt.task_ref !== taskId || receipt.attempt !== attempt)
        throw new CreditServiceError("conflict");
      return receipt;
    } catch (error) {
      if (error instanceof CreditServiceError) throw error;
      throw new CreditServiceError("conflict");
    } finally {
      this.invalidate(owner);
    }
  }
  async overview(owner: string, page: Page = {}): Promise<Snapshot> {
    if (!this.enabled || !owner || owner.length > 64)
      throw new Error("credits_unavailable");
    const key = JSON.stringify([
      owner,
      page.activity_cursor,
      page.purchase_cursor,
    ]);
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.promise;
    // Bounded, account-specific in-flight coalescing and a short refresh budget.
    for (const [id, entry] of this.cache)
      if (entry.until <= Date.now()) this.cache.delete(id);
    if (this.cache.size >= 256) throw new Error("credits_unavailable");
    const promise = this.read(owner, page);
    this.cache.set(key, { until: Date.now() + 10000, promise });
    return promise;
  }
  private async read(owner: string, page: Page): Promise<Snapshot> {
    try {
      return {
        data: creditAccountSchema.parse(
          await this.request("account", owner, { ...page, limit: 20 }),
        ),
        syncedAt: new Date().toISOString(),
      };
    } catch {
      throw new Error("credits_unavailable");
    }
  }
  private async request(
    operation: "account" | "reserve" | "settle",
    owner: string,
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.enabled || !owner || owner.length > 64)
      throw new CreditServiceError("unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.transport(
        this.endpoint.replace(/account$/, operation),
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Internal-API-Key": this.key,
          },
          body: JSON.stringify({
            ...fields,
            project_id: this.project,
            user_id: owner,
            quota_type: "deep_research",
          }),
        },
      );
      if (!response.body) throw new CreditServiceError("unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 1024 * 1024) throw new Error("credits_unavailable");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (response.status === 402 && data?.detail?.code === "credits_exhausted")
        throw new CreditServiceError("exhausted");
      if (
        [404, 409, 422].includes(response.status) &&
        [
          "attempt_conflict",
          "first_attempt_required",
          "stale_attempt",
          "reservation_not_found",
          "outcome_conflict",
        ].includes(data?.detail?.code)
      )
        throw new CreditServiceError("conflict");
      if (!response.ok) throw new CreditServiceError("unavailable");
      return data;
    } catch (error) {
      // Provider bodies and request headers may contain private billing data.
      throw error instanceof CreditServiceError
        ? error
        : new CreditServiceError("unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}

export function installCreditAccountRoutes(
  app: Express,
  store: Store,
  auth: ReturnType<typeof installAuth>,
  client = new CreditAccountClient(),
) {
  app.get("/api/account/credits", async (q, r, next) => {
    try {
      const user = auth.requireUser(q);
      const parsed = creditHistoryQuery.safeParse(q.query);
      if (!parsed.success)
        return r
          .status(400)
          .json({ error: "Refresh your account to load these records." });
      if (!auth.hosted || !client.enabled) return r.json({ state: "off" });
      const { lang: _lang, ...page } = parsed.data;
      try {
        const snapshot = await client.overview(user.id, page);
        const activity = snapshot.data.activity.map(
          ({ task_ref, ...event }) => ({
            ...event,
            // A ledger reference alone grants no access to research. Deleted and
            // foreign tasks retain their financial entry, with no content link.
            researchId:
              task_ref &&
              /^[a-f0-9-]{36}$/.test(task_ref) &&
              store.deepTask(task_ref, user.id)
                ? task_ref
                : null,
          }),
        );
        return r.json({
          state: "ready",
          syncedAt: snapshot.syncedAt,
          data: { ...snapshot.data, activity },
        });
      } catch {
        r.set("Retry-After", "10");
        return r.status(503).json({
          state: "unavailable",
          retryAfter: 10,
          error: "Your account is syncing. Refresh in a moment.",
        });
      }
    } catch (error) {
      next(error);
    }
  });
}
