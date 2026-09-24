import { createHash, randomUUID } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import type { Engine } from "../core/engine.js";
import { operationContext } from "../core/operations.js";
import { DocumentReader, documentTransport } from "../providers/documents.js";
import { publicSearchUrl, searchQuerySchema } from "../providers/search.js";
import type { installAuth } from "./auth.js";

const urlSchema = z
  .string()
  .max(2048)
  .refine((s) => !!publicSearchUrl(s))
  .transform((s) => publicSearchUrl(s)!);
const focus = z.string().trim().max(200).default("");
const schemas = {
  search: z
    .object({
      query: searchQuerySchema.shape.query,
      region: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .default("US"),
      language: z.enum(["en", "zh-CN"]).default("en"),
    })
    .strict(),
  read: z.object({ url: urlSchema, focus }).strict(),
  batch: z.object({ urls: z.array(urlSchema).min(1).max(8), focus }).strict(),
};

/** Operator-only collection surface. No account pools, model calls or report writes. */
export function installSourceRoutes(
  app: Express,
  engine: Engine,
  auth: ReturnType<typeof installAuth>,
  injectedReader?: DocumentReader,
) {
  const proxy =
    process.env.GHTRENDS_DOCUMENT_PROXY ||
    process.env.GOOGLE_SEARCH_PROXY ||
    process.env.GOOGLE_TRENDS_PROXY;
  const reader =
    injectedReader ||
    new DocumentReader(engine.store, documentTransport(proxy));
  const pending = new Map<string, Promise<unknown>>();
  app.get("/api/sources", (q, r) => {
    auth.requireAdmin(q);
    r.json({
      version: "1",
      mode: "web-only",
      llm: false,
      authentication: "admin-session-and-csrf",
      search: {
        configured: engine.search.enabled && engine.search.mode === "direct",
        engines: ["google", "duckduckgo"],
        deadlineMs: 20000,
      },
      read: {
        configured: !!proxy && reader.enabled,
        transport: "residential-proxy",
        deadlineMs: 15000,
        maxBytes: 2000000,
        maxExcerptCharacters: 6000,
        successCacheSeconds: 3600,
        failureCacheSeconds: 60,
      },
      batch: { maxUrls: 8, concurrency: 4, deadlineMs: 15000 },
      maxConcurrentRequests: 2,
      unsupported: [
        "login-required",
        "browser-rendering",
        "complete-comment-pagination",
        "private-content",
        "restricted-social-platforms-including-reddit-and-x",
      ],
      endpoints: [
        "POST /api/sources/search",
        "POST /api/sources/read",
        "POST /api/sources/batch",
      ],
    });
  });
  for (const kind of ["search", "read", "batch"] as const) {
    app.post(`/api/sources/${kind}`, async (q, r, next) => {
      try {
        const user = auth.requireAdmin(q);
        auth.protect(q);
        const parsed = schemas[kind].safeParse(q.body);
        if (!parsed.success)
          return r.status(400).json({ error: "invalid_input" });
        if (kind !== "search" && (!proxy || !reader.enabled) && !injectedReader)
          return r.status(503).json({ error: "source_setup" });
        const input = parsed.data as any;
        if (input.urls) input.urls = [...new Set(input.urls)];
        const key = createHash("sha256")
          .update(JSON.stringify([user.id, kind, input]))
          .digest("hex");
        const existing = pending.get(key);
        if (existing) return r.json(await existing);
        if (pending.size >= 2)
          return r
            .status(429)
            .set("Retry-After", "2")
            .json({ error: "source_busy" });
        const quotaKey = `source-api:quota:${user.id}:${Math.floor(Date.now() / 60000)}`;
        const quota = engine.store.get<number>(quotaKey) || 0;
        if (quota >= 12)
          return r
            .status(429)
            .set("Retry-After", "60")
            .json({ error: "source_rate_limit" });
        engine.store.set(quotaKey, quota + 1, 60000);
        const started = Date.now();
        const controller = new AbortController();
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]);
        const onClose = () => {
          if (!r.writableEnded) controller.abort();
        };
        r.on("close", onClose);
        const task = operationContext.run(
          {
            runId: "source-" + randomUUID(),
            userId: user.id,
            llmBudget: { calls: 0, outputTokens: 0, maxCalls: 0 },
          },
          async () => {
            if (kind === "search") {
              const data = await engine.search.lookupWeb(
                input.query,
                input.region,
                input.language,
              );
              return {
                state: "ready",
                mode: "web-only",
                durationMs: Date.now() - started,
                ...data,
              };
            }
            const urls: string[] = kind === "read" ? [input.url] : input.urls;
            const results = new Array<
              Awaited<ReturnType<DocumentReader["readWeb"]>>
            >(urls.length);
            let cursor = 0;
            // One worker per origin: do not burst several pages against the same site.
            const lanes = new Map<string, Promise<unknown>>();
            await Promise.all(
              Array.from({ length: Math.min(4, urls.length) }, async () => {
                while (cursor < urls.length) {
                  const i = cursor++,
                    url = urls[i]!,
                    origin = new URL(url).origin;
                  const work = (lanes.get(origin) || Promise.resolve()).then(
                    () => reader.readWeb(url, input.focus, signal),
                  );
                  lanes.set(
                    origin,
                    work.catch(() => {}),
                  );
                  results[i] = await work;
                }
              }),
            );
            const successful = results.filter(
              (v) => v.read.status === "read",
            ).length;
            return {
              state:
                successful === urls.length
                  ? "ready"
                  : successful
                    ? "partial"
                    : "failed",
              mode: "web-only",
              durationMs: Date.now() - started,
              results,
            };
          },
        );
        pending.set(key, task);
        try {
          r.json(await task);
        } finally {
          pending.delete(key);
          r.off("close", onClose);
        }
      } catch (error) {
        const e = error as any;
        if (e.status) return next(error);
        const code = /^search_[a-z_]+$/.test(e.message || "")
          ? e.message
          : "source_unavailable";
        r.status(
          code === "search_timeout" ? 504 : code === "search_busy" ? 429 : 503,
        ).json({ error: code, ...(e.retryAt ? { retryAt: e.retryAt } : {}) });
      }
    });
  }
}
