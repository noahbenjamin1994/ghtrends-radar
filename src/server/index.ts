import express from "express";
import sharp from "sharp";
import { marketCard } from "../core/card.js";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../core/engine.js";
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
interface Job {
  id: string;
  state: "queued" | "running" | "complete" | "failed";
  topic: string;
  geo: string;
  keyword?: string;
  refresh?: boolean;
  created: number;
  market?: Market;
  error?: string;
}
export function createApp(engine = new Engine()) {
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
  const dashboardMarkets = (geo = "") =>
    engine.store
      .markets(geo)
      .filter(
        (m) =>
          process.env.GHTRENDS_HOSTED !== "1" ||
          TOPICS.some((t) => t.slug === m.topic.slug),
      );
  const jobs = new Map<string, Job>(),
    limits = new Map<string, { count: number; reset: number }>();
  const baseURL = (q: express.Request) =>
    new URL(process.env.PUBLIC_URL || `${q.protocol}://${q.get("host")}`)
      .origin;
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
  let processing = false;
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
      for (const job of jobs.values())
        if (job.state === "queued") {
          job.state = "running";
          try {
            job.market = await engine.scan(job.topic, {
              geo: job.geo,
              keyword: job.keyword,
              refresh: job.refresh,
            });
            job.state = "complete";
          } catch (e) {
            job.error = (e as Error).message;
            job.state = "failed";
          }
          await new Promise<void>((r) => setTimeout(r, 35000).unref());
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
      for (const [id, job] of jobs)
        if (
          Date.now() - job.created > 3600000 &&
          !["queued", "running"].includes(job.state)
        )
          jobs.delete(id);
      for (const topic of TOPICS) {
        const m = engine.store.market(topic.slug);
        if (
          m &&
          sourceEvidenceIsFresh(m) &&
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
      }
      void processJobs();
    };
    const first = setTimeout(schedule, 10000),
      timer = setInterval(schedule, 3600000);
    first.unref();
    timer.unref();
    app.locals.stopCollector = () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }
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
      [...unique.values()].sort((a, b) => b.reactions - a.reactions),
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
      const m = engine.store.market(t.slug, geo);
      if (!m)
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
      if (!m) return r.status(404).json({ error: "Report not found." });
      r.set("Cache-Control", "public,max-age=31536000,immutable");
      if (q.query.format === "md")
        return r.type("text/markdown").send(marketMarkdown(m, baseURL(q)));
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
      if (!m) return r.status(404).json({ error: "Report not found." });
      const base = baseURL(q);
      const svg = marketCard(m, `${base}/report/${m.id}`);
      r.set("Cache-Control", "public,max-age=31536000,immutable");
      if (String(q.params.file).endsWith(".svg"))
        return r.type("image/svg+xml").send(svg);
      const key = `card:${base}:${id}`,
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
      const topic = resolveTopic(
          q.body.topic,
          typeof q.body.keyword === "string" ? q.body.keyword : undefined,
        ),
        geo = validateGeo(q.body.geo ?? "");
      const existing = engine.store.market(topic.slug, geo, topic.keyword);
      if (
        existing &&
        existing.version === ALGORITHM_VERSION &&
        (existing.kind === "uncertain" || sourceEvidenceIsFresh(existing)) &&
        existing.topic.keyword === topic.keyword &&
        Date.now() - Date.parse(existing.asOf) <
          (existing.kind === "uncertain" ? 300000 : 86400000)
      )
        return r.json({ state: "complete", market: existing });
      for (const job of jobs.values())
        if (
          job.topic === topic.slug &&
          job.geo === geo &&
          job.keyword === topic.keyword &&
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
      for (const [id, j] of jobs)
        if (Date.now() - j.created > 3600000) jobs.delete(id);
      const job: Job = {
        id: randomUUID(),
        state: "queued",
        topic: topic.slug,
        geo,
        keyword: topic.keyword,
        created: Date.now(),
      };
      jobs.set(job.id, job);
      void processJobs();
      return r.status(202).json(job);
    }),
  );
  app.get("/api/jobs/:id", (q, r) => {
    const job = jobs.get(String(q.params.id));
    return job
      ? r.json(job)
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
      "https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.1.5/ghtrends-radar-0.1.5.tgz",
    ),
  );
  app.get("/sitemap.xml", (q, r) =>
    r
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/docs", "/gaps", ...dashboardMarkets().map((m) => "/market/" + m.topic.slug)].map((path) => `<url><loc>${escape(baseURL(q) + path)}</loc></url>`).join("")}</urlset>`,
      ),
  );
  app.get("/robots.txt", (q, r) =>
    r
      .type("text/plain")
      .send(
        `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${baseURL(q)}/sitemap.xml\n`,
      ),
  );
  app.get(
    "/{*path}",
    safe((q, r) => {
      const file = resolve(web, "index.html");
      if (!existsSync(file))
        return r.status(503).send("The interface is being built.");
      r.set("Cache-Control", "no-cache");
      const path = q.path.replace(/\/+$/, "") || "/";
      if (path !== q.path)
        return r.redirect(308, path + q.url.slice(q.path.length));
      const isReport = /^\/report\/[a-f0-9]{16}$/.test(path),
        isMarket = /^\/market\/[^/]+$/.test(path),
        geo =
          path === "/" || isMarket
            ? validateGeo(String(q.query.geo || ""))
            : "";
      let m: Market | null = null;
      if (isReport) m = engine.store.report(path.slice(8));
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
            `/market/${topic.slug}${geo ? `?geo=${geo}` : ""}`,
          );
        m = engine.store.market(topic.slug, geo);
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
        ["/", "/docs", "/gaps", "/compare", "/watch"].includes(path) ||
        repository;
      const status = m || known ? 200 : 404;
      const markets = dashboardMarkets(geo);
      const html = renderDocument(readFileSync(file, "utf8"), {
        base: baseURL(q),
        path,
        geo,
        market: m,
        markets,
        status,
        noindex:
          repository ||
          ["/compare", "/watch"].includes(path) ||
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
        invalid ? 400 : status && [404, 429].includes(status) ? status : 502,
      ).json({ error: error.message });
    },
  );
  return app;
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
