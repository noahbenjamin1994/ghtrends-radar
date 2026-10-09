import { createHash, randomUUID } from "node:crypto";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Engine, ScanProgress } from "../core/engine.js";
import type { Trends } from "./trends.js";
import { analyze } from "../core/analyze.js";
import { operationContext } from "../core/operations.js";
import {
  REPORT_DEADLINE_MS,
  REPORT_VERSION,
  parseReport,
  reportCitations,
  type ReportContent,
} from "../core/report-contract.js";
import {
  DECISION_PROMPT,
  decisionDraftSchema,
  finalizeDecision,
  legacyReport,
  parseDecisionDraft,
  userEvidence as isUserEvidence,
  type Decision,
  type Revision,
} from "../core/decision.js";
import type { LaneItem, Lanes } from "../core/engine.js";
import { STRATEGY_VERSION } from "../core/strategy.js";
import type {
  DemandEvidence,
  Market,
  ResearchSource,
  SupplyEvidence,
  Topic,
} from "../core/types.js";
import { searchSources, scopedWebQueries, type WebEvidence } from "./search.js";
import { DOCUMENT_VERSION } from "./documents.js";

/** Safe error categories for progress and recovery; raw answers stay private. */
const seconds = (name: string, fallback: number) =>
  Math.max(1, Number(process.env[name]) || fallback) * 1000;
/** Phase budgets inside the overall deadline. Collection never eats the write. */
const COLLECT_MS = seconds("GHTRENDS_COLLECT_SECONDS", 25);
const READ_MS = seconds("GHTRENDS_READ_SECONDS", 20);
const WRITE_MS = seconds("GHTRENDS_WRITE_SECONDS", 80);
const WRITE_RESERVE_MS = 24000;
const RECOVERY_RESERVE_MS = 8000;
const READ_PAGES = 8;
/** Threads where people speak for themselves; a result snippet is their words. */
const FORUM =
  /(?:^|\.)(?:reddit\.com|stackoverflow\.com|stackexchange\.com|v2ex\.com|news\.ycombinator\.com|quora\.com)$/i;
/** The poster's words: the result snippet, or the post title when it has none.
 * Search pages prefix the post date; it is the source's date, not its text. */
const forumWords = (s: ResearchSource) => {
  const raw = (s.excerpt || "").split(" Snippet: ").pop()!.trim();
  const dated =
    /^(?:(\d{4})年(\d{1,2})月(\d{1,2})日|([A-Z][a-z]+ \d{1,2}, \d{4}))\s*-\s*/.exec(
      raw,
    );
  const time = dated
    ? Date.parse(
        dated[4] ||
          `${dated[1]}-${dated[2]!.padStart(2, "0")}-${dated[3]!.padStart(2, "0")}`,
      )
    : NaN;
  const publishedAt = Number.isNaN(time)
    ? undefined
    : new Date(time).toISOString();
  const snippet = dated ? raw.slice(dated[0].length) : raw;
  if (snippet.length >= 60) return { excerpt: snippet, publishedAt };
  const title = s.label
    .replace(/^r\/\w+ on Reddit:\s*/i, "")
    .replace(/\s*[-|:]\s*(?:Reddit|Stack Overflow|Hacker News)\s*$/i, "")
    .trim();
  return { excerpt: title.length >= 20 ? title : "", publishedAt };
};
/** These refuse page reads; opening them only spends a slot on a failure. */
const UNREADABLE = /(?:^|\.)(?:reddit\.com|quora\.com)$/i;

export function reportFailure(error: unknown) {
  const e = error as {
    code?: string;
    message?: string;
    issues?: { path?: (string | number)[]; code?: string }[];
  };
  if (Array.isArray(e?.issues))
    return {
      code: "report_schema",
      detail: e.issues
        .slice(0, 8)
        .map((issue) => `${issue.path?.join(".")}:${issue.code}`)
        .join(","),
      retryable: true,
    };
  if (
    [
      "Report citation does not match the collected source.",
      "Report citation ID is not in the collected source.",
      "Observed finding requires source evidence.",
    ].includes(e?.message || "")
  )
    return { code: "report_citation", detail: e.message!, retryable: true };
  if (e?.message === "No topic evidence available.")
    return { code: "no_evidence", detail: "no_evidence", retryable: false };
  const code = e?.message === "report_deadline" ? "model_timeout" : e?.code;
  if (
    code &&
    /^(invalid_response|output_limit|completion_status|model_timeout|model_stream_error|network_error|http_\d{3})$/.test(
      code,
    )
  )
    return { code, detail: code, retryable: !/^http_4(?!08|29)/.test(code) };
  return {
    code: "report_write_failed",
    detail: "report_write_failed",
    retryable: false,
  };
}

/** Measurements are rendered by code, not rewritten into a different time window. */
export function finalizeReport(
  report: Omit<ReportContent, "demandTrend">,
  market: Market,
  sources: ResearchSource[],
) {
  const growth = market.metrics.growth;
  const missing =
    !!market.demand.error || !!market.demand.collectionError || growth === null;
  const change = growth === null ? "" : `${Math.abs(growth * 100).toFixed(1)}%`;
  const value: ReportContent = {
    ...structuredClone(report),
    demandTrend: {
      status: missing ? "missing" : "observed",
      summary: missing
        ? {
            en: "A reliable search-interest comparison is unavailable in this collection. This is not zero demand.",
            zh: "本轮没有取得可用的搜索趋势比较，不能解读为零需求。",
          }
        : {
            en: `Relative interest for “${market.demand.keyword}” ${growth! < 0 ? "fell" : "rose"} ${change}: last 8 complete weeks versus the previous 8, not the full history. Search attention is not paying demand.`,
            zh: `“${market.demand.keyword}”最近8个完整周较此前8周${growth! < 0 ? "下降" : "上升"}${change}；并非整个历史区间的变化，搜索关注不等于付费需求。`,
          },
      evidence: [
        {
          id: "S1",
          quote: sources.find((s) => s.id === "S1")!.excerpt!.slice(0, 260),
        },
      ],
    },
  };
  // One definition of first-hand user evidence for both report shapes.
  const userEvidence = (id: string) =>
    isUserEvidence(sources.find((s) => s.id === id));
  if (!value.userNeeds.evidence.some((ref) => userEvidence(ref.id))) {
    value.userNeeds = {
      status: "missing",
      evidence: [],
      summary: {
        en: "No original user-task evidence was read in this collection. Vendor descriptions and search snippets do not establish user demand.",
        zh: "本轮尚未读到用户实际任务的一手材料。供应商功能描述与搜索摘要不能证明用户需求。",
      },
    };
    value.directions = [];
    value.headline = {
      en: "Domain evidence collected; entry directions remain unverified",
      zh: "领域证据已整理，进入方向仍待验证",
    };
    value.overview = {
      en: `This collection includes ${market.supply.repositories.length} repository candidates and ${market.documents?.sources.length || 0} original pages. Without original user-task evidence, it cannot establish a market gap or recommend an entry direction.`,
      zh: `本轮取得${market.supply.repositories.length}个仓库候选与${market.documents?.sources.length || 0}份网页原文。缺少用户实际任务的一手材料，尚不能确认市场缺口或推荐进入方向。`,
    };
    value.nextStep = {
      en: "The current sources do not support an entry decision. Update the report when user-task and commercial evidence can be collected.",
      zh: "当前来源不足以支持进入决策；待能补齐用户任务与商业供给材料时更新报告。",
    };
  } else {
    value.directions = value.directions.filter((d) =>
      d.evidence.some((ref) => userEvidence(ref.id)),
    );
  }
  return value;
}

/** A phase stops its actual transports as well as returning by the deadline. */
export async function reportPhase<T>(
  ms: number,
  work: () => Promise<T>,
): Promise<T> {
  const parent = operationContext.getStore();
  const controller = new AbortController();
  const signal = parent?.signal
    ? AbortSignal.any([parent.signal, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const expired = new Promise<never>((_, reject) => {
    abort = () => reject(new Error("report_deadline"));
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => controller.abort(), Math.max(1, ms));
  });
  try {
    if (ms <= 0) throw new Error("report_deadline");
    signal.throwIfAborted();
    return await Promise.race([
      operationContext.run(
        { ...parent, runId: parent?.runId || randomUUID(), signal },
        work,
      ),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}

export async function singleReport(
  engine: Engine,
  input: string,
  topic: Topic,
  options: {
    geo: string;
    owner?: string;
    private?: boolean;
    deadlineAt?: number;
    reportId?: string;
    onProgress?: (p: ScanProgress) => void;
    trends?: Trends;
  },
): Promise<Market> {
  const started = Date.now();
  const deadline = Math.min(
    options.deadlineAt || Infinity,
    started + REPORT_DEADLINE_MS,
  );
  const remaining = () => deadline - Date.now();
  const stamp = () => new Date().toISOString();
  let demand: DemandEvidence = {
    keyword: topic.keyword,
    geo: options.geo,
    fetchedAt: stamp(),
    sourceUrl: `https://trends.google.com/trends/explore?${new URLSearchParams({ q: topic.keyword, geo: options.geo })}`,
    points: [],
    related: [],
    error: "Search trend was not collected within this report's time budget.",
  };
  let supply: SupplyEvidence = {
    query: topic.query,
    sourceUrl: `https://github.com/search?${new URLSearchParams({ q: topic.query, type: "repositories" })}`,
    fetchedAt: stamp(),
    total: 0,
    complete: false,
    repositories: [],
    error:
      "Open-source coverage was not collected within this report's time budget.",
  };
  let web: WebEvidence = {
    provider: "multi-search",
    region: options.geo || "US",
    language: /[\u3400-\u9fff]/.test(input) ? "zh-CN" : "en",
    fetchedAt: stamp(),
    state: "failed",
    queries: [],
  };
  const pages: ResearchSource[] = [];
  // First-hand accounts from issue trackers, each already a full text.
  const voices: ResearchSource[] = [];
  const painQueries = (topic.plan?.painQueries || [])
    .map((q) => q.replace(/[<>()"\x00-\x1f]/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2);
  const voiceGaps: string[] = [];
  const reads: NonNullable<Market["documents"]>["reads"] = [];
  const opened = new Set<string>();
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^(www|m)\./, "");
    } catch {
      return url;
    }
  };
  // The page shows what was actually found, as it is found; never a fake bar.
  const lanes = (): Lanes => {
    const result: Lanes = { pains: [], supply: [], timing: [] };
    const page = (url: string): Pick<LaneItem, "state" | "quote"> => {
      const read = reads.find((r) => r.url === url);
      if (read?.status === "read") {
        const text = pages.find((p) => p.url === url || p.parentUrl === url);
        const words = text?.excerpt?.replace(/\s+/g, " ").trim() || "";
        // End on a whole sentence or word; a clipped word reads as a glitch.
        const sentence = /^.{40,170}?[.!?。！？](?=\s|$)/u.exec(words)?.[0];
        return {
          state: "read",
          quote:
            sentence ||
            (words.length > 150
              ? words.slice(0, 150).replace(/\s+\S*$/, "") + "…"
              : words),
        };
      }
      if (read) return { state: "failed" };
      return { state: opened.has(url) ? "reading" : "found" };
    };
    for (const v of voices.slice(0, 6)) {
      const words = (v.excerpt || "").replace(/\s+/g, " ").trim();
      result.pains.push({
        label: v.label,
        url: v.url,
        host: host(v.url),
        kind: "page",
        state: "read",
        quote:
          /^.{40,170}?[.!?。！？](?=\s|$)/u.exec(words)?.[0] ||
          (words.length > 150
            ? words.slice(0, 150).replace(/\s+\S*$/, "") + "…"
            : words),
      });
    }
    for (const label of voiceGaps)
      result.pains.push({ label, state: "failed", kind: "search" });
    for (const q of web.queries) {
      const lane = q.intent === "demand" ? result.pains : result.supply;
      if (q.state === "failed")
        lane.push({ label: q.query, state: "failed", kind: "search" });
      for (const r of q.results.filter((r) => r.kind === "organic").slice(0, 4))
        if (![...result.pains, ...result.supply].some((i) => i.url === r.url))
          lane.push({
            label: r.title,
            url: r.url,
            host: host(r.url),
            kind: q.intent === "opensource" ? "repository" : "page",
            ...page(r.url),
            // A forum result is shown with the poster's own opening words.
            ...(q.intent === "demand" &&
            FORUM.test(new URL(r.url).hostname) &&
            r.excerpt.length >= 60
              ? {
                  state: "read" as const,
                  quote: ((words) =>
                    words.length > 150
                      ? words.slice(0, 150).replace(/\s+\S*$/, "") + "…"
                      : words)(
                    r.excerpt.replace(
                      /^(?:\d{4}年\d{1,2}月\d{1,2}日|[A-Z][a-z]+ \d{1,2}, \d{4})\s*-\s*/,
                      "",
                    ),
                  ),
                }
              : {}),
            // Repository facts come from the GitHub sample, not a page read.
            ...(supply.repositories.some((repo) => repo.url === r.url)
              ? { state: "read" as const }
              : {}),
          });
    }
    for (const r of supply.repositories.slice(0, 4))
      if (!result.supply.some((i) => i.url === r.url))
        result.supply.push({
          label: r.name,
          url: r.url,
          host: "github.com",
          kind: "repository",
          state: "read",
        });
    if (supply.error)
      result.supply.push({ label: "GitHub", state: "failed", kind: "search" });
    const weeks = demand.points.filter((p) => !p.partial).length;
    result.timing.push(
      weeks
        ? {
            label: demand.keyword,
            url: demand.sourceUrl,
            host: "trends.google.com",
            kind: "trend",
            state: "read",
            count: weeks,
          }
        : {
            label: demand.keyword,
            kind: "trend",
            state: collecting ? "reading" : "failed",
          },
    );
    return result;
  };
  const progress = (
    stage: ScanProgress["stage"],
    extra: ScanProgress = { stage },
  ) => options.onProgress?.({ ...extra, stage, topic, lanes: lanes() });
  let collecting = true;
  progress("sources");
  await reportPhase(Math.min(COLLECT_MS, remaining()), async () => {
    await Promise.allSettled([
      (options.trends || engine.trends)
        .demand(topic.keyword, options.geo, (d) => {
          if (collecting) demand = structuredClone(d);
        })
        .then((d) => {
          if (!collecting) return;
          demand = d;
          progress("sources");
        }),
      engine.github
        .supply(
          { ...topic, queries: (topic.queries || [topic.query]).slice(0, 2) },
          undefined,
          true,
        )
        .then(async (s) => {
          if (!collecting) return;
          supply = s;
          progress("sources");
          // People who already use the open-source options say where they fall short.
          const direct = s.repositories.filter(
            (r) => !r.relevance || r.relevance.role === "direct",
          );
          if (!direct.length) return;
          const issues = await engine.github.gaps(direct).catch(() => {
            voiceGaps.push("GitHub Issues");
            return [];
          });
          if (!collecting) return;
          voices.push(
            ...issues.slice(0, 5).map((g): ResearchSource => ({
              kind: "request",
              documentType: "github-issue",
              searchIntent: "demand",
              label: `${g.repo}: ${g.title}`.slice(0, 180),
              url: g.url,
              fetchedAt: g.observedAt || stamp(),
              publishedAt: g.createdAt || undefined,
              request: {
                state: g.state,
                createdAt: g.createdAt,
                updatedAt: g.updatedAt,
                observedAt: g.observedAt,
                reactions: g.reactions,
                comments: g.comments,
              },
              excerpt: `${g.title}. ${g.excerpt}`.replace(/\s+/g, " ").trim(),
            })),
          );
          progress("sources");
        }),
      engine.search
        .collect(
          topic,
          options.geo,
          [
            ...scopedWebQueries(topic).slice(0, 3),
            // Where people ask and complain, searched the way they would write.
            ...(painQueries.length ? painQueries : [topic.keyword]).map(
              (q) => ({
                intent: "demand" as const,
                query: `site:reddit.com ${q.slice(0, 70)}`,
              }),
            ),
          ],
          20000,
          options.trends?.researchProxy(),
          (partial) => {
            if (!collecting) return;
            web = structuredClone(partial);
            progress("sources");
          },
        )
        .then((w) => {
          if (!collecting) return;
          web = w;
          progress("sources");
        }),
    ]);
  }).catch(() => {});
  collecting = false;
  // A source that could not be reached is reported as coverage, not hidden.
  for (const label of voiceGaps.splice(0))
    web.queries.push({
      query: label,
      intent: "demand",
      state: "failed",
      results: [],
      error: "blocked",
    });
  // A phase deadline preserves completed queries and closes the remaining ones.
  if (web.queries.some((q) => q.state === "pending")) {
    web.queries = web.queries.map((q) =>
      q.state === "pending"
        ? { ...q, state: "failed", error: "search_timeout" }
        : q,
    );
    web.state = web.queries.some((q) => q.state === "ready")
      ? "partial"
      : "failed";
  }
  const market = analyze(topic, demand, supply, []);
  market.web = web;
  progress("details", {
    stage: "details",
    preview: market,
    supplyCount: supply.repositories.length,
    weeklyPoints: market.metrics.points,
  });
  // Keep source roles and dates explicit. A search snippet is never a read page.
  const candidates = searchSources(web);
  const reader = engine.documents.forResearch(options.trends?.researchProxy());
  const urls: string[] = [];
  const hosts = new Set<string>();
  // Alternate commercial and user-demand results; don't spend all slots on vendors.
  const commercial = candidates.filter(
    (s) => s.searchIntent === "competition" && s.placement !== "ad",
  );
  const needs = candidates.filter(
    (s) => s.searchIntent === "demand" && s.placement !== "ad",
  );
  for (let i = 0; i < Math.max(commercial.length, needs.length); i++) {
    for (const source of [commercial[i], needs[i]]) {
      if (!source || urls.length >= READ_PAGES) continue;
      const host = new URL(source.url).hostname;
      if (UNREADABLE.test(host)) continue;
      if (!hosts.has(host)) {
        hosts.add(host);
        urls.push(source.url);
      }
    }
  }
  let reading = true;
  if (remaining() > WRITE_RESERVE_MS && reader.enabled) {
    for (const url of urls) opened.add(url);
    progress("researching", { stage: "researching", preview: market });
    await reportPhase(
      Math.min(READ_MS, remaining() - WRITE_RESERVE_MS),
      async () => {
        await Promise.allSettled(
          urls.map(async (url) => {
            const result = await reader.readWeb(
              url,
              input,
              operationContext.getStore()!.signal!,
            );
            if (reading) {
              reads.push(result.read);
              pages.push(
                ...result.sources.map((s) => ({
                  ...s,
                  searchIntent: candidates.find((c) => c.url === url)
                    ?.searchIntent,
                })),
              );
              progress("researching", {
                stage: "researching",
                preview: market,
              });
            }
          }),
        );
      },
    ).catch(() => {});
  }
  reading = false;
  for (const url of urls)
    if (!reads.some((read) => read.url === url))
      reads.push({ url, status: "limit", observedAt: stamp() });
  market.documents = { version: DOCUMENT_VERSION, sources: pages, reads };
  const metricSources: ResearchSource[] = [
    {
      label: "Google Trends observation (relative search interest, not sales)",
      url: demand.sourceUrl,
      fetchedAt: demand.fetchedAt,
      excerpt: JSON.stringify({
        keyword: demand.keyword,
        geo: demand.geo,
        trend: market.metrics.trend,
        growth: market.metrics.growth,
        completeWeeks: market.metrics.points,
        comparison:
          "last 8 complete weeks versus previous 8; completeWeeks is coverage, NOT the change interval",
        error: demand.error || demand.collectionError || null,
      }),
    },
  ];
  const repos: ResearchSource[] = supply.repositories
    .filter((r) => !r.relevance || r.relevance.role === "direct")
    .slice(0, 3)
    .map((r) => ({
      label: r.name,
      url: r.url,
      fetchedAt: r.fetchedAt,
      kind: "project",
      excerpt: `${r.description}\nLicense: ${r.license || "unknown"}; last push: ${r.pushedAt}; stars: ${r.stars}. Repository metadata only; stars do not establish usage or buying demand.`,
    }));
  const snippets = [
    commercial[0],
    needs[0],
    commercial[1],
    needs[1],
    candidates.find((s) => s.searchIntent === "opensource"),
  ].filter((s): s is ResearchSource => !!s);
  // A forum result that was not read still carries the poster's opening words.
  const forum = needs
    .filter(
      (s) =>
        FORUM.test(new URL(s.url).hostname) &&
        !pages.some((p) => p.url === s.url),
    )
    .slice(0, 8)
    .map((s): ResearchSource => ({
      ...s,
      documentType: "forum-snippet",
      ...forumWords(s),
    }))
    .filter((s) => s.excerpt);
  const seen = new Set<string>();
  const sources = [
    ...metricSources,
    ...voices.slice(0, 9),
    ...forum,
    ...pages,
    ...repos,
    ...snippets,
  ]
    .filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    })
    .slice(0, 24)
    .map((s, i) => ({
      ...s,
      id: `S${i + 1}`,
      excerpt: (s.excerpt || "").slice(0, 1200),
      excerptTruncated: !!s.excerptTruncated || (s.excerpt?.length || 0) > 1200,
    }));
  progress("brief", { stage: "brief", preview: market });
  const citations = reportCitations(sources);
  let attempts = 0;
  const failures: ReturnType<typeof reportFailure>[] = [];
  const diagnosticId = operationContext.getStore()?.runId || randomUUID();
  const request = {
    input,
    search: {
      keyword: demand.keyword,
      region: options.geo || "WORLDWIDE",
      trend: market.metrics.trend,
    },
    coverage: {
      trends: demand.error || demand.collectionError || "collected",
      repositories: supply.error || "sample only",
      search: web.state,
      pageReads: reads,
    },
    sources: sources.map(({ excerpt: _excerpt, ...source }) => ({
      ...source,
      citations: Object.entries(citations)
        .filter(([, ref]) => ref.id === source.id)
        .map(([id, ref]) => ({ id, text: ref.quote })),
    })),
    outputSchema: zodToJsonSchema(decisionDraftSchema, {
      $refStrategy: "none",
    }),
  };
  try {
    if (!pages.length && !repos.length && !snippets.length && !voices.length)
      throw new Error("No topic evidence available.");
    const written = await reportPhase(remaining(), async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        // Reserve time for one recovery without extending the original deadline.
        const budget = Math.min(
          WRITE_MS,
          remaining() -
            (attempt === 0 && remaining() >= RECOVERY_RESERVE_MS * 2
              ? RECOVERY_RESERVE_MS
              : 0),
        );
        if (budget <= 0) throw new Error("report_deadline");
        attempts++;
        try {
          const raw = await reportPhase(budget, () =>
            engine.research.json(
              DECISION_PROMPT +
                (attempt
                  ? "\nThe previous attempt was rejected. Generate a fresh concise report from the ORIGINAL sources and schema. Use valid JSON with escaped string values and only supplied citation IDs. Do not invent evidence to fill missing sections."
                  : ""),
              attempt
                ? { ...request, previousFailure: failures.at(-1)?.detail }
                : request,
              6500,
              attempt ? "report-recover" : "report-write",
              false,
            ),
          );
          let incomplete: string[] = [];
          const decision = finalizeDecision(
            parseDecisionDraft(raw, citations, (sections) => {
              incomplete = sections;
            }),
            market,
            sources,
          );
          // Older exports read the previous shape; it is checked the same way.
          const result = {
            decision,
            report: parseReport(
              finalizeReport(legacyReport(decision), market, sources),
              sources,
            ),
          };
          if (incomplete.length) {
            market.aiError =
              "Some analysis sections are incomplete. Collected evidence is retained; this attempt's credit is returned.";
            console.warn("Report sections incomplete", {
              runId: diagnosticId,
              sections: incomplete,
            });
          }
          return result;
        } catch (error) {
          const failure = reportFailure(error);
          failures.push(failure);
          console.warn("Report attempt rejected", {
            runId: diagnosticId,
            attempt: attempts,
            ...failure,
          });
          if (
            attempt === 1 ||
            !failure.retryable ||
            remaining() < 1500 ||
            operationContext.getStore()?.signal?.aborted
          )
            throw error;
          progress("brief", { stage: "brief", preview: market });
        }
      }
      throw new Error("report_deadline");
    });
    const { decision, report } = written;
    market.brief = {
      report,
      decision,
      model: engine.research.model,
      generatedAt: stamp(),
      strategyVersion: STRATEGY_VERSION,
      en: {
        headline: report.headline.en,
        summary: report.overview.en,
        nextSteps: [report.nextStep.en],
      },
      zh: {
        headline: report.headline.zh,
        summary: report.overview.zh,
        nextSteps: [report.nextStep.zh],
      },
      sources,
      reviewed: false,
      basis: "source-led",
    };
  } catch (error) {
    const reason = reportFailure(error);
    console.warn("Report delivery rejected", {
      runId: operationContext.getStore()?.runId,
      reason: reason.code,
    });
    market.analysisError = { code: reason.code, attempts };
    market.aiError =
      reason.code === "model_timeout"
        ? "Analysis did not finish within the time limit. Collected sources are retained; this attempt's credit is returned."
        : "Analysis could not produce a validated report. Collected sources are retained; this attempt's credit is returned.";
  }
  // Unique snapshots never overwrite a historical report or its ownership.
  market.id =
    options.reportId ||
    createHash("sha256")
      .update(`${REPORT_VERSION}:${options.owner || ""}:${randomUUID()}`)
      .digest("hex")
      .slice(0, 16);
  try {
    engine.store.recordModelDiagnostic(`${diagnosticId}:delivery`, {
      runId: diagnosticId,
      reportId: market.id,
      attempts,
      failures,
      delivered: !!market.brief?.report,
      error: market.analysisError,
    });
  } catch {
    console.warn("Report diagnostic could not be saved", {
      runId: diagnosticId,
    });
  }
  engine.store.saveMarket(market, !options.private, options.owner);
  if (options.owner) engine.store.addHistory(options.owner, market.id, input);
  return market;
}

/**
 * Judge again after the owner changed the evidence. The owner can remove a
 * quote or add a supplier; conclusions still come only from what remains.
 */
export async function rejudgeReport(
  engine: Engine,
  market: Market,
  revision: Revision,
  note = "",
): Promise<{ decision: Decision; excluded: string[] }> {
  const brief = market.brief;
  if (!brief?.decision) throw new Error("report_not_decision");
  const sources = [...brief.sources, ...(revision.sources || [])];
  const excluded = [
    ...new Set([
      ...(revision.excluded || []),
      ...revision.dismissed.map((key) => key.slice(key.indexOf(":") + 1)),
    ]),
  ];
  const citations = reportCitations(sources);
  for (const cid of excluded) delete citations[cid];
  const request = {
    input: market.topic.plan?.input || market.topic.name,
    search: {
      keyword: market.demand.keyword,
      region: market.geo || "WORLDWIDE",
      trend: market.metrics.trend,
    },
    readerCorrections: {
      removedAsIrrelevant: excluded.length,
      addedSuppliers: (revision.sources || []).map((s) => s.label),
      note,
    },
    sources: sources.map(({ excerpt: _excerpt, ...source }) => ({
      ...source,
      citations: Object.entries(citations)
        .filter(([, ref]) => ref.id === source.id)
        .map(([id, ref]) => ({ id, text: ref.quote })),
    })),
    outputSchema: zodToJsonSchema(decisionDraftSchema, {
      $refStrategy: "none",
    }),
  };
  const raw = await reportPhase(WRITE_MS, () =>
    engine.research.json(
      DECISION_PROMPT +
        "\nThe reader corrected the evidence of an earlier report. Quotes they removed as irrelevant are absent from the citations; do not reconstruct them. Suppliers they added are included as sources; list one only when its source supports it. Judge again from what remains.",
      request,
      6500,
      "report-rejudge",
      false,
    ),
  );
  const decision = finalizeDecision(
    parseDecisionDraft(raw, citations),
    market,
    sources,
  );
  const added = new Set((revision.sources || []).map((s) => s.id));
  for (const row of decision.commercial)
    if (row.evidence.some((q) => added.has(q.id))) row.added = true;
  return { decision, excluded };
}
