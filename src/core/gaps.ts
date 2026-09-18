import { repoRelevance } from "./competition.js";
import { issueInsightSchema, validQuote } from "./landscape.js";
import type {
  Brief,
  Market,
  ResearchSource,
  RequestEvidence,
} from "./types.js";
import type { Gap } from "./types.js";

// These rules select reading leads, not validated product opportunities. Use the
// title for intent: GitHub issue templates often put “feature” in every body.
export function selectGapSignals(gaps: Gap[], includeClosed = false): Gap[] {
  const unique = new Map<string, Gap>();
  for (const gap of gaps) {
    const title = gap.title.trim();
    if (gap.state !== "open" && !(includeClosed && gap.state === "closed"))
      continue;
    const recent =
      gap.observedAt &&
      Number.isFinite(Date.parse(gap.updatedAt)) &&
      Date.parse(gap.updatedAt) <= Date.parse(gap.observedAt) &&
      Date.parse(gap.observedAt) - Date.parse(gap.updatedAt) < 90 * 86400000;
    if (gap.reactions < 2 && !recent) continue;
    if (
      /roadmap|tracking\s*:|post v\d|gsoc|evaluation dataset|a note on|release notes|路线图|发布公告/i.test(
        title,
      )
    )
      continue;
    if (
      /\b(?:429|401|403|500|capacity issues|rate limit|installation error)\b|no such (?:table|column)|has no column/i.test(
        title,
      )
    )
      continue;
    if (
      /(?:add|latest|access to|available|not working).*(?:gemini[ -]\d|gpt[ -]\d|claude[ -]\d)|(?:latest|preview).*(?:model|sdk)|(?:model|sdk).*(?:latest|preview)/i.test(
        title,
      )
    )
      continue;
    let label: Gap["label"] | undefined;
    if (/\balternative (?:to|for)\b|\breplace\b|替代方案|替代品/i.test(title))
      label = "alternative";
    else if (
      /\b(?:feat(?:ure)?|support|integrat(?:e|ion)|allow|enable|add|export|import|offline|privacy|access controls?)\b|功能请求|支持|导出|离线/i.test(
        title,
      )
    )
      label = "feature-request";
    else if (
      /\b(?:cannot|can't|doesn't|unable|missing|frustrat\w*|slow|workflow|sycophant)\b|无法|缺少|太慢/i.test(
        title,
      )
    )
      label = "friction";
    if (label) {
      const key = requestUrl(gap.url),
        previous = unique.get(key);
      if (
        !previous ||
        Date.parse(gap.observedAt || gap.updatedAt) >=
          Date.parse(previous.observedAt || previous.updatedAt)
      )
        unique.set(key, { ...gap, url: key, label });
    }
  }
  const rows = [...unique.values()].sort(
    (a, b) =>
      Number(a.state === "closed") - Number(b.state === "closed") ||
      b.reactions - a.reactions ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  const authors = new Set<string>();
  const distinct = rows.filter((g) => {
    if (!g.authorKey) return true;
    const content = (g.title + " " + g.excerpt)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    if (content.length < 60) return true;
    const key = g.authorKey + ":" + content;
    if (authors.has(key)) return false;
    authors.add(key);
    return true;
  });
  // Keep one recently updated request in each group of three when available.
  // A young request can then be read alongside the most discussed requests.
  const recent = distinct
    .filter(
      (g) =>
        g.state === "open" &&
        g.observedAt &&
        Date.parse(g.updatedAt) <= Date.parse(g.observedAt) &&
        Date.parse(g.observedAt) - Date.parse(g.updatedAt) < 90 * 86400000,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const ordered: Gap[] = [],
    used = new Set<string>();
  while (ordered.length < distinct.length) {
    const preferred = ordered.length % 3 === 1 ? recent : distinct;
    const next =
      preferred.find((g) => !used.has(g.url)) ||
      distinct.find((g) => !used.has(g.url));
    if (!next) break;
    used.add(next.url);
    ordered.push(next);
  }
  return ordered;
}

export function requestUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.origin === "https://github.com")
      return url.origin + url.pathname.replace(/\/$/, "").toLowerCase();
  } catch {
    /* Historic evidence retains its original URL. */
  }
  return value;
}

export function mergeRequestEvidence(
  gaps: Gap[],
  sources: ResearchSource[],
): Gap[] {
  return gaps.map((g) => {
    const source = sources
      .filter(
        (s) =>
          s.kind === "request" &&
          s.request &&
          requestUrl(s.url) === requestUrl(g.url),
      )
      .sort((a, b) =>
        (b.request?.observedAt || b.fetchedAt || "").localeCompare(
          a.request?.observedAt || a.fetchedAt || "",
        ),
      )[0];
    const observed = source?.request?.observedAt || source?.fetchedAt;
    if (
      !source?.request ||
      (g.observedAt && observed && g.observedAt > observed)
    )
      return g;
    return { ...g, ...source.request };
  });
}

export function requestStatus(evidence: RequestEvidence, locale: "en" | "zh") {
  if (evidence.state === "answered")
    return locale === "zh" ? "已有采纳答案" : "An answer was accepted";
  if (evidence.state === "closed")
    return evidence.stateReason === "completed"
      ? locale === "zh"
        ? "已标记完成"
        : "Marked complete"
      : locale === "zh"
        ? "已关闭 · 查看讨论说明"
        : "Closed · read the discussion";
  return evidence.state === "open"
    ? locale === "zh"
      ? "讨论中"
      : "Discussion open"
    : locale === "zh"
      ? "当前进展待核对"
      : "Current status to review";
}

export function requestAction(
  evidence: RequestEvidence,
  proposal: string,
  locale: "en" | "zh",
) {
  return evidence.state === "answered"
    ? locale === "zh"
      ? "先核对提问者采纳的答案与当前版本，再确认还需要哪些补充。"
      : "Review the accepted answer and current version, then identify any further work."
    : evidence.state === "closed"
      ? locale === "zh"
        ? "这条请求已关闭，可先结合结项说明与发布版本核对已有能力。"
        : "This request is closed. Review the closing discussion and release notes for the capabilities now available."
      : proposal;
}

export function issueReading(brief: Brief | undefined, url: string) {
  for (const raw of brief?.issueInsights || []) {
    const parsed = issueInsightSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.relevance !== "direct" ||
      parsed.data.kind === "promotion"
    )
      continue;
    const item = parsed.data,
      source = brief?.sources.find(
        (s) => s.id === item.sourceId && s.kind === "request",
      );
    if (
      source &&
      requestUrl(source.url) === requestUrl(url) &&
      item.evidence.id === source.id &&
      validQuote(item.evidence, [source])
    )
      return item;
  }
}

export type RequestSignal = Omit<
  Gap,
  "reactions" | "createdAt" | "updatedAt" | "state"
> &
  RequestEvidence;

// Apply the current object scope at read time as well as during collection.
// Old snapshots keep their raw evidence; adjacent leads stay out of the report.
export function marketGapSignals(m: Market, includeClosed = false): Gap[] {
  const eligible = new Set(
    m.supply.repositories
      .filter(
        (r) => (r.relevance || repoRelevance(r, m.topic)).role === "direct",
      )
      .map((r) => r.name.toLowerCase()),
  );
  const rejected = new Set(
    (m.brief?.issueInsights || [])
      .filter((i) => i.relevance === "adjacent" || i.kind === "promotion")
      .map((i) =>
        requestUrl(
          m.brief?.sources.find((s) => s.id === i.sourceId)?.url || "",
        ),
      ),
  );
  return selectGapSignals(
    mergeRequestEvidence(m.gaps, m.brief?.sources || []),
    includeClosed,
  ).filter(
    (g) =>
      eligible.has(g.repo.toLowerCase()) && !rejected.has(requestUrl(g.url)),
  );
}

/** Include researched requests with their real metadata, preserving missing counts/dates. */
export function reportIssueSignals(m: Market) {
  const rows: RequestSignal[] = marketGapSignals(m, true);
  const seen = new Set(rows.map((g) => requestUrl(g.url)));
  for (const raw of m.brief?.issueInsights || []) {
    const parsed = issueInsightSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.relevance !== "direct" ||
      parsed.data.kind === "promotion"
    )
      continue;
    const i = parsed.data;
    const s = m.brief?.sources.find(
      (s) => s.id === i.sourceId && s.kind === "request",
    );
    if (
      !s ||
      seen.has(requestUrl(s.url)) ||
      i.evidence.id !== s.id ||
      !validQuote(i.evidence, [s])
    )
      continue;
    const match =
      /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:issues|discussions)\/\d+$/.exec(
        s.url,
      );
    const hn = /^https:\/\/news\.ycombinator\.com\/item\?id=[1-9]\d*$/.test(
      s.url,
    );
    if (!match && !hn) continue;
    rows.push({
      ...s.request,
      url: s.url,
      title: s.label,
      excerpt: i.evidence.quote,
      repo: match?.[1] || "Hacker News",
      label: "friction",
    });
    seen.add(requestUrl(s.url));
  }
  return rows.sort(
    (a, b) => Number(a.state === "closed") - Number(b.state === "closed"),
  );
}
