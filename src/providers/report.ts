import { createHash, randomUUID } from "node:crypto";
import type { Engine, ScanProgress } from "../core/engine.js";
import { analyze } from "../core/analyze.js";
import { operationContext } from "../core/operations.js";
import {
  REPORT_DEADLINE_MS,
  REPORT_PROMPT,
  REPORT_VERSION,
  parseReport,
  type ReportContent,
} from "../core/report-contract.js";
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

/** Measurements are rendered by code, not rewritten into a different time window. */
export function finalizeReport(
  report: ReportContent,
  market: Market,
  sources: ResearchSource[],
) {
  const value = structuredClone(report);
  const growth = market.metrics.growth;
  const missing =
    !!market.demand.error || !!market.demand.collectionError || growth === null;
  const change = growth === null ? "" : `${Math.abs(growth * 100).toFixed(1)}%`;
  value.demandTrend = {
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
  };
  const userEvidence = (id: string) => {
    const source = sources.find((s) => s.id === id);
    return (
      source?.kind === "request" ||
      (source?.documentType === "page" && source.searchIntent === "demand")
    );
  };
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
    onProgress?: (p: ScanProgress) => void;
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
  options.onProgress?.({ stage: "sources", topic });
  let collecting = true;
  await reportPhase(Math.min(18000, remaining()), async () => {
    await Promise.allSettled([
      engine.trends
        .demand(topic.keyword, options.geo, (d) => {
          if (collecting) demand = structuredClone(d);
        })
        .then((d) => {
          if (collecting) demand = d;
        }),
      engine.github
        .supply(
          { ...topic, queries: (topic.queries || [topic.query]).slice(0, 2) },
          undefined,
          true,
        )
        .then((s) => {
          if (collecting) supply = s;
        }),
      engine.search
        .collect(topic, options.geo, scopedWebQueries(topic), 16000)
        .then((w) => {
          if (collecting) web = w;
        }),
    ]);
  }).catch(() => {});
  collecting = false;
  const market = analyze(topic, demand, supply, []);
  market.web = web;
  options.onProgress?.({
    stage: "details",
    preview: market,
    supplyCount: supply.repositories.length,
    weeklyPoints: market.metrics.points,
  });
  // Keep source roles and dates explicit. A search snippet is never a read page.
  const candidates = searchSources(web);
  const pages: ResearchSource[] = [];
  const reads: NonNullable<Market["documents"]>["reads"] = [];
  const reader = engine.documents;
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
      if (!source || urls.length >= 4) continue;
      const host = new URL(source.url).hostname;
      if (!hosts.has(host)) {
        hosts.add(host);
        urls.push(source.url);
      }
    }
  }
  let reading = true;
  if (remaining() > 24000 && reader.enabled)
    await reportPhase(Math.min(9000, remaining() - 24000), async () => {
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
          }
        }),
      );
    }).catch(() => {});
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
  const seen = new Set<string>();
  const sources = [...metricSources, ...pages, ...repos, ...snippets]
    .filter((s) => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    })
    .slice(0, 13)
    .map((s, i) => ({
      ...s,
      id: `S${i + 1}`,
      excerpt: (s.excerpt || "").slice(0, 1200),
      excerptTruncated: !!s.excerptTruncated || (s.excerpt?.length || 0) > 1200,
    }));
  options.onProgress?.({ stage: "brief", preview: market });
  try {
    if (!pages.length && !repos.length && !snippets.length)
      throw new Error("No topic evidence available.");
    const report = await reportPhase(Math.min(25000, remaining()), async () => {
      const raw = await engine.research.json(
        REPORT_PROMPT,
        {
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
          sources,
        },
        3600,
        "report-write",
        false,
      );
      return finalizeReport(parseReport(raw, sources), market, sources);
    });
    market.brief = {
      report,
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
  } catch {
    market.aiError =
      "The report could not be completed within the time and evidence limits. This attempt's credit is returned.";
  }
  // Unique snapshots never overwrite a historical report or its ownership.
  market.id = createHash("sha256")
    .update(`${REPORT_VERSION}:${options.owner || ""}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 16);
  engine.store.saveMarket(market, !options.private, options.owner);
  if (options.owner) engine.store.addHistory(options.owner, market.id, input);
  return market;
}
