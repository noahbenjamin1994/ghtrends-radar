import { repoRelevance } from "./competition.js";
import { issueInsightSchema, validQuote } from "./landscape.js";
import type { Market } from "./types.js";
import type { Gap } from "./types.js";

// These rules select reading leads, not validated product opportunities. Use the
// title for intent: GitHub issue templates often put “feature” in every body.
export function selectGapSignals(gaps: Gap[]): Gap[] {
  const unique = new Map<string, Gap>();
  for (const gap of gaps) {
    const title = gap.title.trim();
    if (gap.state !== "open" || gap.reactions < 2) continue;
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
    if (label) unique.set(gap.url, { ...gap, label });
  }
  return [...unique.values()].sort((a, b) => b.reactions - a.reactions);
}

// Apply the current object scope at read time as well as during collection.
// Old snapshots keep their raw evidence; adjacent leads stay out of the report.
export function marketGapSignals(m: Market): Gap[] {
  const eligible = new Set(
    m.supply.repositories
      .filter(
        (r) => (r.relevance || repoRelevance(r, m.topic)).role === "direct",
      )
      .map((r) => r.name.toLowerCase()),
  );
  const rejected = new Set(
    (m.brief?.issueInsights || [])
      .filter((i) => i.relevance === "adjacent")
      .map((i) => m.brief?.sources.find((s) => s.id === i.sourceId)?.url),
  );
  return selectGapSignals(m.gaps).filter(
    (g) => eligible.has(g.repo.toLowerCase()) && !rejected.has(g.url),
  );
}

/** Include researched requests with their real metadata, preserving missing counts/dates. */
export function reportIssueSignals(m: Market) {
  const rows: (Omit<Gap, "reactions" | "createdAt" | "updatedAt" | "state"> & {
    reactions?: number;
    createdAt?: string;
    updatedAt?: string;
    state?: Gap["state"];
  })[] = marketGapSignals(m);
  const seen = new Set(rows.map((g) => g.url));
  for (const raw of m.brief?.issueInsights || []) {
    const parsed = issueInsightSchema.safeParse(raw);
    if (!parsed.success || parsed.data.relevance !== "direct") continue;
    const i = parsed.data;
    const s = m.brief?.sources.find(
      (s) => s.id === i.sourceId && s.kind === "request",
    );
    if (
      !s ||
      seen.has(s.url) ||
      i.evidence.id !== s.id ||
      !validQuote(i.evidence, [s])
    )
      continue;
    const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+$/.exec(
      s.url,
    );
    if (!match) continue;
    rows.push({
      url: s.url,
      title: s.label,
      excerpt: i.evidence.quote,
      repo: match[1]!,
      label: "friction",
    });
    seen.add(s.url);
  }
  return rows;
}
