import { appPath, basePathFromUrl } from "../core/paths.js";
import { ENGAGEMENT_EVENTS, type EngagementEvent } from "../core/engagement.js";
import { selectGapSignals } from "../core/gaps.js";
import express from "express";
import { operationContext } from "../core/operations.js";
import sharp from "sharp";
import { installAuth } from "./auth.js";
import { marketCard } from "../core/card.js";
import { isIP } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine, type ScanProgress } from "../core/engine.js";
import {
  TOPICS,
  resolveTopic,
  validateGeo,
  validateRepo,
} from "../core/topics.js";
import { ALGORITHM_VERSION, POLICY } from "../core/analyze.js";
import { marketMarkdown } from "../core/report.js";
import type { Market } from "../core/types.js";
import { renderDocument } from "./html.js";
import { sourceEvidenceIsFresh } from "../core/evidence.js";
import { requestLocale, localeUrl, type Locale } from "../core/i18n.js";
interface Job {
  id: string;
  state: "queued" | "running" | "complete" | "failed";
  topic: string;
  input?: string;
  geo: string;
  keyword?: string;
  refresh?: boolean;
  created: number;
  market?: Market;
  error?: string;
  progress?: ScanProgress;
  owner?: string;
  choices?: { label: string; query: string }[];
  clarification?: { en: string; zh: string };
}
export function createApp(engine = new Engine()) {
  const basePath = process.env.PUBLIC_URL
    ? basePathFromUrl(process.env.PUBLIC_URL)
    : "";
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY)
    app.set("trust proxy", process.env.TRUST_PROXY.split(","));
  app.use(express.json({ limit: "8kb" }));
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
    });
    next();
  });
  const auth = installAuth(app, engine.store);
  engine.store.interruptRuns();
  app.use("/api", (_q, r, next) => {
    r.set("Cache-Control", "no-store").vary("Cookie");
    next();
  });
  const dailyLimit = Math.max(
    1,
    Number(process.env.GHTRENDS_DAILY_SCANS) || 10,
  );
  const dashboardMarkets = (geo = "") =>
    engine.store
      .markets(geo, true)
      .filter(
        (m) =>
          process.env.GHTRENDS_HOSTED !== "1" ||
          TOPICS.some((t) => t.slug === m.topic.slug),
      );
  const jobs = new Map<string, Job>(),
    limits = new Map<string, { count: number; reset: number }>();
  const localeFor = (q: express.Request): Locale =>
    requestLocale(q.query.lang, q.get("cookie"), q.get("accept-language"));
  const baseURL = (q: express.Request) =>
    new URL(process.env.PUBLIC_URL || `${q.protocol}://${q.get("host")}`)
      .origin + basePath;
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  let processing = false,
    nextBackgroundAt = 0;
  let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
  const clientIP = (q: express.Request) => {
    const trusted = process.env.GHTRENDS_CLIENT_IP_HEADER;
    const header = trusted ? q.get(trusted) : undefined;
    return header && isIP(header) ? header : q.ip || "anonymous";
  };
  const permitted = (ip: string) => {
    const now = Date.now();
    for (const [k, v] of limits) if (v.reset < now) limits.delete(k);
    const r = limits.get(ip) || { count: 0, reset: now + 3600000 };
    r.count++;
    limits.set(ip, r);
    return r.count <= 8;
  };
  async function processJobs() {
    if (processing) return;
    processing = true;
    try {
      while (true) {
        const job = [...jobs.values()]
          .filter((j) => j.state === "queued")
          .sort(
            (a, b) =>
              Number(!!a.refresh) - Number(!!b.refresh) ||
              a.created - b.created,
          )[0];
        if (!job) break;
        if (job.refresh && Date.now() < nextBackgroundAt) {
          clearTimeout(backgroundTimer);
          backgroundTimer = setTimeout(
            () => void processJobs(),
            nextBackgroundAt - Date.now(),
          ).unref();
          break;
        }
        job.state = "running";
        engine.store.updateRun(job.id, "running");
        try {
          job.market = await operationContext.run(
            { runId: job.id, userId: job.owner },
            () =>
              engine.scan(job.topic, {
                geo: job.geo,
                keyword: job.keyword,
                refresh: job.refresh,
                ai: job.refresh ? false : undefined,
                owner: job.owner,
                private: auth.hosted && !!job.owner,
                onProgress: (progress) => {
                  job.progress = { ...job.progress, ...progress };
                  engine.store.set("job:" + job.id, job, 3600000);
                },
              }),
          );
          job.state = "complete";
          engine.store.updateRun(job.id, "complete", {
            reportId: job.market.id,
            warnings: [
              job.market.demand.error,
              job.market.demand.collectionError,
              job.market.supply.error,
              job.market.aiError,
            ].filter((x): x is string => !!x),
          });
          delete job.progress?.preview;
        } catch (e) {
          job.error = (e as Error).message;
          job.state = "failed";
          engine.store.updateRun(job.id, "failed", { error: job.error });
          job.choices = (e as any).choices;
          job.clarification = (e as any).clarification;
        }
        engine.store.set("job:" + job.id, job, 3600000);
        if (job.refresh) nextBackgroundAt = Date.now() + 35000;
      }
    } finally {
      processing = false;
    }
  }
  const safe =
    <T>(
      handler: (req: express.Request, res: express.Response) => Promise<T> | T,
    ) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) =>
      Promise.resolve(handler(req, res)).catch(next);
  if (process.env.GHTRENDS_AUTO_COLLECT === "1") {
    const schedule = () => {
      engine.store.pruneOperations();
      for (const [id, job] of jobs)
        if (
          Date.now() - job.created > 3600000 &&
          !["queued", "running"].includes(job.state)
        )
          jobs.delete(id);
      for (const topic of TOPICS) {
        const m = engine.store.market(topic.slug, "", topic.keyword, true);
        if (
          m &&
          sourceEvidenceIsFresh(m) &&
          m.demand.normalization === "independent" &&
          m.topic.query === topic.query &&
          JSON.stringify(m.topic.queries) === JSON.stringify(topic.queries) &&
          !m.demand.error &&
          !m.demand.collectionError &&
          !m.supply.error
        )
          continue;
        if (
          [...jobs.values()].some(
            (j) =>
              j.topic === topic.slug &&
              j.geo === "" &&
              ["queued", "running"].includes(j.state),
          )
        )
          continue;
        const job: Job = {
          id: randomUUID(),
          state: "queued",
          topic: topic.slug,
          geo: "",
          keyword: topic.keyword,
          refresh: true,
          created: Date.now(),
        };
        jobs.set(job.id, job);
        engine.store.startRun({
          id: job.id,
          userId: job.owner,
          input: job.topic,
          geo: job.geo,
          background: true,
          created: new Date(job.created).toISOString(),
        });
      }
      void processJobs();
    };
    const first = setTimeout(schedule, 10000),
      timer = setInterval(schedule, 3600000);
    first.unref();
    timer.unref();
    app.locals.stopCollector = () => {
      clearTimeout(first);
      clearTimeout(backgroundTimer);
      clearInterval(timer);
    };
  }
  const engagementEnabled =
    auth.hosted && process.env.GHTRENDS_ANALYTICS !== "0";
  const eventLimits = new Map<string, { count: number; until: number }>();
  app.post("/api/events", (q, r) => {
    if (!engagementEnabled) return r.sendStatus(204);
    if (q.get("origin") !== new URL(baseURL(q)).origin)
      return r.sendStatus(403);
    if (!ENGAGEMENT_EVENTS.includes(q.body?.event)) return r.sendStatus(400);
    const now = Date.now();
    for (const [key, value] of eventLimits)
      if (value.until < now) eventLimits.delete(key);
    const ip = clientIP(q);
    const limit = eventLimits.get(ip) || { count: 0, until: now + 60000 };
    if (++limit.count > 60) return r.sendStatus(429);
    eventLimits.set(ip, limit);
    engine.store.recordEvent(q.body.event as EngagementEvent);
    return r.sendStatus(204);
  });
  app.get("/api/account", (q, r) => {
    const user = auth.user(q);
    r.set("Cache-Control", "no-store").json({
      engagementEnabled,
      hosted: auth.hosted,
      authAvailable: auth.enabled,
      aiAvailable: engine.research.enabled,
      user: user ? { name: user.name, isAdmin: auth.isAdmin(user) } : null,
      csrf: user?.csrf || "",
      dailyLimit,
      used: user ? engine.store.usage(user.id) : 0,
    });
  });
  app.get(
    "/api/admin",
    safe((q, r) => {
      auth.requireAdmin(q);
      const days = Number(q.query.days || 7),
        page = Number(q.query.page || 0),
        state = String(q.query.state || "");
      if (
        ![1, 7, 30].includes(days) ||
        !Number.isInteger(page) ||
        page < 0 ||
        page > 10000 ||
        ![
          "",
          "queued",
          "running",
          "complete",
          "failed",
          "interrupted",
        ].includes(state)
      )
        return r.status(400).json({ error: "Invalid admin filter." });
      return r.json({
        ...engine.store.adminOverview(days, page, state),
        version: ALGORITHM_VERSION,
        queue: [...jobs.values()]
          .filter((j) => j.state === "queued" || j.state === "running")
          .map((j) => ({
            id: j.id,
            input: j.input || j.topic,
            state: j.state,
            stage: j.progress?.stage,
            background: !!j.refresh,
            created: j.created,
          })),
        configuration: {
          mode: auth.hosted ? "hosted" : "self-hosted",
          auth: auth.enabled,
          ai: engine.research.enabled,
          model: engine.research.model,
          dailyLimit,
          adminUserIds: (process.env.GHTRENDS_ADMIN_USER_IDS || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          pricingConfigured: !!process.env.GHTRENDS_LLM_PRICING_JSON,
        },
      });
    }),
  );
  app.get(
    "/api/history",
    safe((q, r) => {
      const user = auth.requireUser(q);
      return r
        .set("Cache-Control", "no-store")
        .json(engine.store.history(user.id));
    }),
  );
  app.post(
    "/api/history",
    safe((q, r) => {
      const user = auth.protect(q),
        id = String(q.body?.id || "");
      if (!engine.store.canRead(id, user.id))
        return r.status(404).json({ error: "Report not found." });
      const m = engine.store.report(id)!;
      engine.store.addHistory(user.id, id, m.topic.plan?.input || m.topic.name);
      return r.json({ ok: true });
    }),
  );
  app.delete(
    "/api/history/:id",
    safe((q, r) => {
      const user = auth.protect(q);
      engine.store.removeHistory(user.id, String(q.params.id));
      return r.json({ ok: true });
    }),
  );
  app.get(
    "/api/watch",
    safe((q, r) => {
      const user = auth.requireUser(q);
      return r
        .set("Cache-Control", "no-store")
        .json(
          auth.hosted
            ? engine.store.userWatch(user.id)
            : engine.store.watchList(),
        );
    }),
  );
  app.post(
    "/api/watch",
    safe((q, r) => {
      const user = auth.protect(q),
        repo = validateRepo(String(q.body?.repo || "")),
        added = q.body?.added === true;
      if (
        added &&
        (auth.hosted
          ? engine.store.userWatch(user.id)
          : engine.store.watchList()
        ).length >= 50
      )
        return r
          .status(400)
          .json({ error: "The watchlist holds up to 50 repositories." });
      if (auth.hosted) engine.store.setUserWatch(user.id, repo, added);
      else if (added) engine.store.watchAdd(repo);
      else engine.store.watchRemove(repo);
      return r.json(
        auth.hosted
          ? engine.store.userWatch(user.id)
          : engine.store.watchList(),
      );
    }),
  );
  app.post(
    "/api/reports/:id/share",
    safe((q, r) => {
      const user = auth.protect(q),
        id = String(q.params.id),
        shared = q.body?.shared === true;
      if (!engine.store.shareReport(user.id, id, shared))
        return r.status(404).json({ error: "Report not found." });
      return r
        .set("Cache-Control", "no-store")
        .json({ shared, url: baseURL(q) + "/report/" + id });
    }),
  );
  app.get(
    "/api/reports/:id/access",
    safe((q, r) => {
      const id = String(q.params.id),
        user = auth.user(q);
      if (!engine.store.canRead(id, user?.id))
        return r.status(404).json({ error: "Report not found." });
      return r.set("Cache-Control", "no-store").json({
        public: engine.store.isPublic(id),
        owned: !!user && engine.store.ownsReport(user.id, id),
        saved: !!user && engine.store.hasHistory(user.id, id),
      });
    }),
  );
  app.get("/api/health", (_q, r) =>
    r.json({
      status: "ok",
      version: ALGORITHM_VERSION,
      markets: dashboardMarkets().length,
    }),
  );
  app.get("/api/methodology", (_q, r) =>
    r.json({
      version: ALGORITHM_VERSION,
      policy: POLICY,
      source: "https://github.com/noahbenjamin1994/ghtrends-radar",
      scope:
        "Open-source supply and relative search-demand signals. Not a revenue or investment forecast.",
    }),
  );
  app.get("/api/gaps", (_q, r) => {
    const unique = new Map<string, Market["gaps"][number]>();
    for (const m of dashboardMarkets())
      for (const gap of m.gaps) unique.set(gap.url, gap);
    r.set("Cache-Control", "public,max-age=300").json(
      selectGapSignals([...unique.values()]),
    );
  });
  app.get(
    "/api/markets",
    safe((q, r) => {
      const geo = validateGeo(String(q.query.geo ?? ""));
      r.set("Cache-Control", "public,max-age=60").json({
        markets: dashboardMarkets(geo).map((m) => ({
          ...m,
          demand: {
            ...m.demand,
            points: m.demand.points.slice(-27),
            related: [],
          },
          supply: { ...m.supply, repositories: [] },
          gaps: [],
        })),
        topics: TOPICS,
      });
    }),
  );
  app.get(
    "/api/markets/:topic",
    safe((q, r) => {
      const t = resolveTopic(String(q.params.topic)),
        geo = validateGeo(String(q.query.geo ?? ""));
      const m = engine.store.market(t.slug, geo, t.keyword, true);
      if (!m || !engine.store.isPublic(m.id))
        return r
          .status(404)
          .json({ error: "This topic has not been scanned yet." });
      return r.json(m);
    }),
  );
  app.get(
    "/api/reports/:id",
    safe((q, r) => {
      const id = String(q.params.id);
      if (!/^[a-f0-9]{16}$/.test(id))
        return r.status(400).json({ error: "Invalid report ID." });
      const m = engine.store.report(id);
      if (!m || !engine.store.canRead(m.id, auth.user(q)?.id))
        return r.status(404).json({ error: "Report not found." });
      r.vary("Cookie");
      r.set(
        "Cache-Control",
        engine.store.isPublic(m.id)
          ? "public,max-age=0,must-revalidate"
          : "private,no-store",
      );
      if (q.query.format === "md")
        return r
          .set(
            "Cache-Control",
            engine.store.isPublic(m.id)
              ? "public,max-age=0,must-revalidate"
              : "private,no-store",
          )
          .type("text/markdown")
          .send(
            marketMarkdown(m, baseURL(q), q.query.lang === "zh" ? "zh" : "en"),
          );
      return r.json(m);
    }),
  );
  app.get(
    "/api/cards/:file",
    safe(async (q, r) => {
      const id = String(q.params.file).replace(/\.(png|svg)$/, "");
      if (!/^[a-f0-9]{16}$/.test(id))
        return r.status(400).json({ error: "Invalid report ID." });
      const m = engine.store.report(id);
      if (!m || !engine.store.canRead(m.id, auth.user(q)?.id))
        return r.status(404).json({ error: "Report not found." });
      const base = baseURL(q);
      const svg = marketCard(
        m,
        localeUrl(
          `${base}/report/${m.id}`,
          q.query.lang === "zh" ? "zh" : "en",
        ),
        q.query.lang === "zh" ? "zh" : "en",
      );
      r.vary("Cookie");
      r.set(
        "Cache-Control",
        engine.store.isPublic(m.id)
          ? "public,max-age=0,must-revalidate"
          : "private,no-store",
      );
      if (String(q.params.file).endsWith(".svg"))
        return r.type("image/svg+xml").send(svg);
      const key = `card:${createHash("sha256").update(svg).digest("hex")}`,
        cached = engine.store.get<string>(key);
      const bytes = cached
        ? Buffer.from(cached, "base64")
        : await sharp(Buffer.from(svg)).png().toBuffer();
      if (!cached) engine.store.set(key, bytes.toString("base64"), 31536000000);
      return r.type("png").send(bytes);
    }),
  );
  app.post(
    "/api/scan",
    safe((q, r) => {
      if (typeof q.body?.topic !== "string")
        return r.status(400).json({ error: "A topic is required." });
      const user = auth.protect(q),
        input = q.body.topic.trim();
      if (!input || input.length > 300 || /[\x00-\x1f<>]/.test(input))
        return r
          .status(400)
          .json({ error: "Enter a topic between 1 and 300 characters." });
      const keyword =
        typeof q.body.keyword === "string" ? q.body.keyword.trim() : undefined;
      if (keyword && (keyword.length > 100 || /[\x00-\x1f<>]/.test(keyword)))
        return r.status(400).json({ error: "Invalid demand keyword." });
      const topic = engine.research.enabled
          ? { slug: input, keyword }
          : resolveTopic(input, keyword),
        geo = validateGeo(q.body.geo ?? "");
      const existing =
        !auth.hosted && !engine.research.enabled
          ? engine.store.market(topic.slug, geo, topic.keyword)
          : null;
      if (
        existing &&
        existing.version === ALGORITHM_VERSION &&
        (existing.kind === "uncertain" || sourceEvidenceIsFresh(existing)) &&
        Date.now() - Date.parse(existing.asOf) <
          (existing.kind === "uncertain" ? 300000 : 86400000) &&
        existing.topic.query === resolveTopic(input, keyword).query &&
        JSON.stringify(existing.topic.queries) ===
          JSON.stringify(resolveTopic(input, keyword).queries)
      ) {
        engine.store.addHistory(user.id, existing.id, input);
        return r
          .set("Cache-Control", "no-store")
          .json({ state: "complete", market: existing });
      }
      for (const job of jobs.values())
        if (
          job.owner === user.id &&
          job.input === input &&
          job.geo === geo &&
          job.keyword === keyword &&
          ["queued", "running"].includes(job.state)
        )
          return r.status(202).json(job);
      if (!permitted(clientIP(q)))
        return r.status(429).json({
          error:
            "Scan limit reached. Explore the existing reports or try again in an hour.",
        });
      if (
        [...jobs.values()].filter((j) =>
          ["queued", "running"].includes(j.state),
        ).length >= 12
      )
        return r
          .status(429)
          .json({ error: "The scan queue is full. Please try again shortly." });
      if (auth.hosted && !engine.store.consumeUsage(user.id, dailyLimit))
        return r.status(429).json({
          error:
            "Your daily scan allowance is used. Saved reports remain available.",
        });
      for (const [id, j] of jobs)
        if (Date.now() - j.created > 3600000) jobs.delete(id);
      const job: Job = {
        id: randomUUID(),
        state: "queued",
        topic: input,
        input,
        owner: user.id,
        geo,
        keyword,
        created: Date.now(),
      };
      jobs.set(job.id, job);
      engine.store.startRun({
        id: job.id,
        userId: job.owner,
        input,
        geo: job.geo,
        background: false,
        created: new Date(job.created).toISOString(),
      });
      engine.store.set("job:" + job.id, job, 3600000);
      void processJobs();
      return r.status(202).json(job);
    }),
  );
  app.get("/api/jobs/:id", (q, r) => {
    r.set("Cache-Control", "no-store");
    const id = String(q.params.id),
      live = jobs.get(id),
      job = live || engine.store.get<Job>("job:" + id);
    if (job?.owner !== auth.user(q)?.id)
      return r.status(404).json({ error: "Scan not found." });
    if (job && !live && ["queued", "running"].includes(job.state)) {
      job.state = "failed";
      job.error = "The server restarted. Please run this scan again.";
    }
    return job
      ? r.json({
          ...job,
          queuePosition:
            job.state === "queued"
              ? [...jobs.values()].filter(
                  (j) =>
                    j.state === "running" ||
                    (j.state === "queued" &&
                      (Number(!!j.refresh) < Number(!!job.refresh) ||
                        (!!j.refresh === !!job.refresh &&
                          j.created < job.created))),
                ).length
              : 0,
        })
      : r.status(404).json({
          error: "Scan not found. It may have expired; check the topic page.",
        });
  });
  app.get(
    "/api/repo",
    safe(async (q, r) => {
      const name = validateRepo(String(q.query.name ?? ""));
      const cached = engine.store.get("repo:" + name + ":true");
      if (cached) return r.json(cached);
      if (auth.hosted) auth.requireUser(q);
      if (!permitted(clientIP(q)))
        return r.status(429).json({
          error: "Repository request limit reached. Try again later.",
        });
      return r.json(await engine.github.repo(name));
    }),
  );
  app.get(
    "/api/compare",
    safe(async (q, r) => {
      if (auth.hosted) auth.requireUser(q);
      const names = String(q.query.repos ?? "").split(",");
      if (!permitted(clientIP(q)))
        return r.status(429).json({
          error: "Comparison request limit reached. Try again later.",
        });
      return r.json(await engine.compare(names));
    }),
  );
  app.use("/api", (_q, r) =>
    r.status(404).json({ error: "Endpoint not found." }),
  );
  const web = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../web-dist",
  );
  app.use(express.static(web, { maxAge: "1h", index: false }));
  app.get("/ghtrends.tgz", (_q, r) =>
    r.redirect(
      302,
      "https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.8.0/ghtrends-radar-0.8.0.tgz",
    ),
  );
  app.get("/sitemap.xml", (q, r) =>
    r
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/start", "/docs", "/gaps", ...dashboardMarkets().map((m) => "/market/" + m.topic.slug)].flatMap((path) => (["en", "zh"] as const).map((locale) => `<url><loc>${escape(localeUrl(baseURL(q) + path, locale))}</loc></url>`)).join("")}</urlset>`,
      ),
  );
  app.get("/robots.txt", (q, r) =>
    r
      .type("text/plain")
      .send(
        `User-agent: *\nAllow: /\nDisallow: ${basePath}/api/\nSitemap: ${baseURL(q)}/sitemap.xml\n`,
      ),
  );
  app.get(
    "/{*path}",
    safe((q, r) => {
      const file = resolve(web, "index.html");
      if (!existsSync(file))
        return r.status(503).send("The interface is being built.");
      const locale = localeFor(q);
      r.set("Cache-Control", "private,no-cache");
      r.vary("Accept-Language").vary("Cookie");
      if (q.query.lang === "en" || q.query.lang === "zh")
        r.cookie("ghtrends_lang", locale, {
          maxAge: 365 * 86400000,
          sameSite: "lax",
          httpOnly: true,
          path: basePath || "/",
        });
      const path = q.path.replace(/\/+$/, "") || "/";
      if (path !== q.path)
        return r.redirect(
          308,
          appPath(path, basePath) + q.url.slice(q.path.length),
        );
      const isReport = /^\/report\/[a-f0-9]{16}$/.test(path),
        isMarket = /^\/market\/[^/]+$/.test(path),
        geo =
          path === "/" || isMarket
            ? validateGeo(String(q.query.geo || ""))
            : "";
      let m: Market | null = null;
      if (isReport && engine.store.canRead(path.slice(8), auth.user(q)?.id))
        m = engine.store.report(path.slice(8));
      if (isMarket) {
        let input: string;
        try {
          input = decodeURIComponent(path.slice(8));
        } catch {
          return r.status(400).type("text").send("Invalid category URL.");
        }
        const topic = resolveTopic(input);
        if (path.slice(8) !== topic.slug)
          return r.redirect(
            308,
            localeUrl(
              appPath(
                `/market/${topic.slug}${geo ? `?geo=${geo}` : ""}`,
                basePath,
              ),
              locale,
            ),
          );
        m = engine.store.market(topic.slug, geo, topic.keyword, true);
        if (m && !engine.store.isPublic(m.id)) m = null;
      }
      let repository = false;
      if (path.startsWith("/repo/")) {
        try {
          validateRepo(decodeURIComponent(path.slice(6)));
          repository = true;
        } catch {
          /* Invalid repository paths are real 404 pages. */
        }
      }
      const known =
        [
          "/",
          "/docs",
          "/start",
          "/gaps",
          "/compare",
          "/watch",
          "/history",
          "/admin",
        ].includes(path) || repository;
      const status = m || known ? 200 : 404;
      const markets = dashboardMarkets(geo);
      const html = renderDocument(readFileSync(file, "utf8"), {
        base: baseURL(q),
        locale,
        path,
        geo,
        market: m,
        markets,
        status,
        noindex:
          repository ||
          !!(m && !engine.store.isPublic(m.id)) ||
          ["/compare", "/watch", "/history", "/admin"].includes(path) ||
          (path === "/" && !markets.length),
      });
      return r.status(status).type("html").send(html);
    }),
  );
  app.use(
    (
      error: Error,
      q: express.Request,
      r: express.Response,
      _n: express.NextFunction,
    ) => {
      const invalid =
        (error as Error & { status?: number }).status === 400 ||
        /Invalid|Enter a|Use a|Region|Compare between|Choose at least/.test(
          error.message,
        );
      const status = (error as Error & { status?: number; retryAfter?: number })
        .status;
      const retry = (error as Error & { retryAfter?: number }).retryAfter;
      if (retry) r.set("Retry-After", String(Math.ceil(retry)));
      r.status(
        invalid
          ? 400
          : status && [401, 403, 404, 422, 429, 503].includes(status)
            ? status
            : 502,
      ).json({ error: error.message });
    },
  );
  if (!basePath) return app;
  const root = express();
  root.disable("x-powered-by");
  // Canonicalize the mount itself; descendants retain their existing URL policy.
  root.use((q, r, next) => {
    if (q.path === basePath)
      return r.redirect(308, basePath + "/" + q.url.slice(q.path.length));
    next();
  });
  root.use(basePath, app);
  root.locals.stopCollector = app.locals.stopCollector;
  return root;
}
export async function startServer(
  port = Number(process.env.PORT || 3721),
  host = process.env.HOST || "127.0.0.1",
) {
  const engine = new Engine();
  const app = createApp(engine);
  const server = app.listen(port, host, () =>
    process.stderr.write(`ghtrends is running at http://${host}:${port}\n`),
  );
  const stop = () => {
    app.locals.stopCollector?.();
    server.close(() => {
      void engine.close().then(() => process.exit(0));
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  return server;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void startServer();
