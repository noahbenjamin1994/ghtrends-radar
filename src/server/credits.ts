import type { Express } from "express";
import {
  creditAccountSchema,
  creditHistoryQuery,
  type CreditAccount,
} from "../core/credits.js";
import type { Store } from "../core/store.js";
import type { installAuth } from "./auth.js";

type Page = { activity_cursor?: string; purchase_cursor?: string };
type Snapshot = { data: CreditAccount; syncedAt: string };

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await this.transport(this.endpoint, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Internal-API-Key": this.key,
        },
        body: JSON.stringify({
          ...page,
          project_id: this.project,
          user_id: owner,
          quota_type: "deep_research",
          limit: 20,
        }),
      });
      if (!response.ok || !response.body)
        throw new Error("credits_unavailable");
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
      return {
        data: creditAccountSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        ),
        syncedAt: new Date().toISOString(),
      };
    } catch {
      // Provider bodies and request headers may contain private billing data.
      throw new Error("credits_unavailable");
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
        return r
          .status(503)
          .json({
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
