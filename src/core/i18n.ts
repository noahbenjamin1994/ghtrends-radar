import { zh } from "./translations.js";
import type { Market } from "./types.js";

export type Locale = "en" | "zh";
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
    "trend.unknown": "Unconfirmed",
  };
  let result =
    locale === "zh"
      ? (zh[key] ?? translateEvidence(key))
      : (english[key] ?? value);
  for (const [name, replacement] of Object.entries(vars))
    result = result.replaceAll(`{${name}}`, String(replacement));
  return result;
}
function translateEvidence(value: string): string {
  const patterns: [RegExp, (...groups: string[]) => string][] = [
    [
      /^([≥\d,]+) matching active repositories; this is search coverage, not a count of direct competitors\.$/,
      (count) =>
        `匹配到 ${count} 个活跃仓库；这是检索覆盖量，不是直接竞品数量。`,
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
      (date, error) => `当前使用 ${date} 的最近成功快照。刷新失败：${error}`,
    ],
    [/^Search-demand collection: (.+)$/, (error) => `搜索需求采集：${error}`],
    [/^GitHub collection: (.+)$/, (error) => `GitHub 采集：${error}`],
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
