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
