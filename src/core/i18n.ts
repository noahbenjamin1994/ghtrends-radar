import { zh, en } from "./translations.js";
import type { Market } from "./types.js";

export type Locale = "en" | "zh";

/** Catch clear language swaps, while allowing names, identifiers and quoted errors.
 * This is a delivery check, not a test of translation equivalence. */
export function proseLanguageMismatch(value: string, language: Locale) {
  const han = value.match(/\p{Script=Han}/gu)?.length || 0;
  const latin = value.match(/[a-z]/gi)?.length || 0;
  if (language === "en") return han >= 6 && han > latin / 2;
  const words = value.match(/\b[a-z][a-z'-]*\b/gi) || [];
  if (han === 0) return words.length >= 4;
  const grammar =
    value.match(
      /\b(?:the|a|an|and|with|for|to|of|from|their|who|should|which)\b/gi,
    )?.length || 0;
  return words.length >= 10 && grammar >= 4 && han < (han + latin) * 0.15;
}

/** A read-only paired meaning for prose edits; source quotes have no language path. */
export function proseCounterpart(
  raw: unknown,
  path: string,
): { language: Locale; value: string } | undefined {
  const keys = path.split(".");
  const languages = keys.filter((key) => key === "en" || key === "zh");
  if (languages.length !== 1) return;
  const language: Locale = languages[0] === "en" ? "zh" : "en";
  const value = keys.reduce(
    (node: any, key) => node?.[key === languages[0] ? language : key],
    raw,
  );
  if (typeof value === "string") return { language, value };
}

export const COPY_MEANING_RULES = `Preserve the exact claim: actor, action, conditions, certainty, source attribution, numbers, comparisons, logical AND/OR, and outcome. An observed zero is a measured result; pending confirmation is an information gap. Keep those meanings distinct. Role exclusions become precise positive role descriptions; never promote a reviewer, comment or public contact into a user-demand signal or confirmed participant. Proposed invitations stay proposed. An absent capability and an unchecked capability have different meanings; preserve which the original says.
Use affirmative ordinary language. Chinese excludes every 不/无/未/没 character and 并非/而非, including compound terms. English excludes not/no/never/cannot/without/unknown/unconfirmed. Preserve exact meaning while changing wording: 无人使用队列 → 队列使用人数为0; 不超过两人 → 至多两人; 不是需求证据，只适合评审 → 仅作为评审线索; 尚未核实 → 有待核实; 不可变 → 写入后保持原样. An observed zero must stay zero; a maximum must stay a maximum. If users return to their original workflow, describe that behavior instead of saying evidence is pending.`;

export function hasRecoveryTimeReference(value: string) {
  return /(?:time (?:shown|displayed)(?: on (?:this|the) page| below)|(?:shown|displayed) recovery time|页面提示.{0,4}时间|(?:显示|提示)的恢复时间)/i.test(
    value,
  );
}
export const MARKET_LABELS: Record<Market["kind"], string> = {
  blue: "Blue ocean",
  expanding: "Growing red ocean",
  contested: "Red ocean",
  quiet: "Quiet ocean",
  uncertain: "Needs validation",
};
export function text(
  value: string,
  locale: Locale = "en",
  vars: Record<string, string | number> = {},
): string {
  const key = value.replace(/\s+/g, " ").trim();
  const english: Record<string, string> = {
    "trend.rising": "Rising",
    "trend.falling": "Falling",
    "trend.stable": "Stable",
    "trend.mixed": "Mixed signals",
    "trend.unknown": "Pending",
  };
  let result =
    locale === "zh"
      ? (zh[key] ?? translateEvidence(key))
      : (en[key] ?? english[key] ?? translateEvidenceEnglish(value));
  for (const [name, replacement] of Object.entries(vars))
    result = result.replaceAll(`{${name}}`, String(replacement));
  return result;
}
function translateEvidence(value: string): string {
  const patterns: [RegExp, (...groups: string[]) => string][] = [
    [
      /^Project roles: (\d+) direct alternatives, (\d+) adjacent projects, (\d+) resources, (\d+) awaiting review\.$/,
      (d, a, r, u) =>
        `项目角色：直接替代 ${d} 个、周边项目 ${a} 个、资源资料 ${r} 个、待核对 ${u} 个。`,
    ],
    [
      /^Competition pressure: (\d+)–(\d+)\/100; breadth (\d+), established alternatives (\d+), leading project strength (\d+)\.$/,
      (l, u, b, i, d) =>
        `竞争压力：${l}–${u}/100；独立替代项目 ${b} 分、成熟替代项目 ${i} 分、头部项目实力 ${d} 分。`,
    ],
    [
      /^Google Trends (?:returned|refresh returned HTTP) (\d+).*$/,
      (status) =>
        `Google Trends 刷新状态：HTTP ${status}。可查看来源，或稍后刷新。`,
    ],
    [
      /^([≥\d,]+) matching active repositories; this is search coverage, not a count of direct competitors\.$/,
      (count) =>
        `当前检索范围内匹配到 ${count} 个活跃仓库。可结合具体产品与用户场景继续研究。`,
    ],
    [
      /^Four-week search change: (-?\d+)%; thirteen-week change: (-?\d+)%\. These windows check the direction of the eight-week comparison\.$/,
      (a, b) =>
        `4 周搜索变化：${a}%；13 周变化：${b}%。这两个周期用于核对 8 周比较的方向。`,
    ],
    [
      /^Median weekly search interest (rose|fell) (\d+)% across two consecutive eight-week windows\.$/,
      (direction, amount) =>
        `相邻两个 8 周窗口的搜索热度中位数${direction === "rose" ? "上升" : "下降"} ${amount}%。`,
    ],
    [
      /^([\d,]+) matching active repositories; the published dense-supply threshold is (\d+)\.$/,
      (count, limit) =>
        `匹配到 ${count} 个活跃仓库；公开的供给密集门槛为 ${limit} 个。`,
    ],
    [
      /^(\d+) of the last eight weeks stayed above the prior baseline; growth survives resampling\.$/,
      (count) =>
        `最近 8 周中有 ${count} 周持续高于原基线，增长通过重采样检验。`,
    ],
    [
      /^Only (\d+) of the last eight complete weeks stayed above the prior baseline; at least six are required\.$/,
      (count) =>
        `最近 8 个完整周只有 ${count} 周持续高于原基线，至少需要 6 周。`,
    ],
    [
      /^Search growth is below the (\d+)% fast-growth threshold\.$/,
      (count) => `搜索增速低于 ${count}% 的快速增长门槛。`,
    ],
    [
      /^At least (\d+) complete weekly observations are required\.$/,
      (count) => `至少需要 ${count} 个完整周的观测。`,
    ],
    [
      /^Showing the last successful search snapshot from (.+)\. Refresh failed: (.+)$/,
      (date, error) =>
        `当前使用 ${date} 的最近成功快照。刷新状态：${text(error, "zh")}`,
    ],
    [
      /^Search-demand collection: (.+)$/,
      (error) => `搜索需求采集：${text(error, "zh")}`,
    ],
    [
      /^GitHub collection: (.+)$/,
      (error) => `GitHub 采集：${text(error, "zh")}`,
    ],
  ];
  for (const [pattern, render] of patterns) {
    const match = value.match(pattern);
    if (match) return render(...match.slice(1));
  }
  return value;
}
export function localeUrl(input: string, locale: Locale): string {
  const absolute = /^https?:\/\//i.test(input);
  const url = new URL(input, "https://ghtrends.invalid");
  if (locale === "zh") url.searchParams.set("lang", "zh");
  else url.searchParams.delete("lang");
  return absolute ? url.href : url.pathname + url.search + url.hash;
}
export function requestLocale(
  query: unknown,
  cookie = "",
  accept = "",
): Locale {
  if (query === "zh" || query === "en") return query;
  const saved = cookie.match(/(?:^|;\s*)ghtrends_lang=(zh|en)(?:;|$)/)?.[1];
  if (saved) return saved as Locale;
  const preferred = accept
    .split(",")
    .map((part, index) => {
      const [language, quality] = part.trim().split(";q=");
      return {
        language: language?.toLowerCase(),
        quality: quality === undefined ? 1 : Number(quality),
        index,
      };
    })
    .filter((x) => x.quality > 0 && /^(en|zh)(-|$)/.test(x.language || ""))
    .sort((a, b) => b.quality - a.quality || a.index - b.index)[0];
  return preferred?.language?.startsWith("zh") ? "zh" : "en";
}
export function localizeMarket(m: Market, locale: Locale): Market {
  const t = (v: string) => text(v, locale);
  return {
    ...m,
    topic: {
      ...m.topic,
      name: t(m.topic.name),
      description: t(m.topic.description),
    },
    headline: t(m.headline),
    strategy: t(m.strategy),
    reasons: m.reasons.map(t),
    limitations: m.limitations.map(t),
  };
}

function translateEvidenceEnglish(value: string) {
  const status = value.match(
    /^Google Trends (?:returned|refresh returned HTTP) (\d+).*$/,
  );
  if (status)
    return `Google Trends refresh status: HTTP ${status[1]}. Open the source or refresh shortly.`;
  const collection = value.match(
    /^(Search-demand collection|GitHub collection): (.+)$/,
  );
  if (collection) return `${collection[1]}: ${text(collection[2]!, "en")}`;
  const count = value.match(
    /^([≥\d,]+) matching active repositories; this is search coverage, not a count of direct competitors\.$/,
  );
  if (count)
    return `${count[1]} active repositories match this search scope. Review their users and workflows to identify direct alternatives.`;
  const previous = value.match(
    /^Showing the last successful search snapshot from (.+)\. Refresh failed: (.+)$/,
  );
  if (previous)
    return `Using the successful snapshot from ${previous[1]}. Refresh status: ${text(previous[2]!, "en")}`;
  return value;
}

// Applied to product-authored prose; repository titles and quoted source material retain their wording.
export function negativeWordingMatches(value: string): string[] {
  if (typeof value !== "string") return [];
  return [
    ...new Set(
      value.match(
        /不|不是|不能|并非|而非|没有|无法|未|无|勿|\b(?:not|no|never|neither|cannot|can't|doesn't|don't|won't|isn't|aren't|without|unavailable|unknown|unconfirmed)\b/gi,
      ) || [],
    ),
  ];
}
export function hasNegativeWording(value: string) {
  return negativeWordingMatches(value).length > 0;
}
