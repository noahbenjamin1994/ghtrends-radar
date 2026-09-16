import type { Market } from "./types.js";
import { text, type Locale } from "./i18n.js";
import { marketAssessment, competitionPressure } from "./assessment.js";
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function marketCard(m: Market, url: string, locale: Locale = "en") {
  const t = (s: string) => text(s, locale),
    assessment = marketAssessment(m, locale);
  const value = m.metrics.emerging
    ? t("Low-base rise")
    : m.metrics.fast === null || m.metrics.growth === null
      ? t("Not established")
      : `${m.metrics.growth >= 0 ? "+" : ""}${(m.metrics.growth * 100).toFixed(0)}%`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#ffffff"/><circle cx="1120" cy="60" r="260" fill="none" stroke="#315f9c" stroke-opacity=".08" stroke-width="90"/><text x="64" y="76" fill="#315f9c" font-family="sans-serif" font-size="30" font-weight="700">ghtrends ↗</text><text x="64" y="175" fill="#666666" font-family="sans-serif" font-size="19">${xml(assessment.landscape)} · ${xml(t("THE OPEN-SOURCE OPPORTUNITY RADAR"))}</text><text x="64" y="250" fill="#1c1c1c" font-family="sans-serif" font-size="62" font-weight="700">${xml(t(m.topic.name).slice(0, 29))}</text><text x="66" y="305" fill="#315f9c" font-family="sans-serif" font-size="28">${xml(assessment.title)}</text><line x1="64" x2="1136" y1="345" y2="345" stroke="#e4e4e4"/><text x="64" y="410" fill="#1c1c1c" font-family="sans-serif" font-size="42">${xml(value)}</text><text x="64" y="445" fill="#666666" font-family="sans-serif" font-size="19">${xml(t("Search growth · 8 weeks vs prior 8"))}</text><text x="645" y="410" fill="#1c1c1c" font-family="sans-serif" font-size="42">${m.competition ? competitionPressure(m) + " / 100" : m.supply.error ? "—" : (m.supply.complete ? "" : "≥") + m.supply.total.toLocaleString("en-US")}</text><text x="645" y="445" fill="#666666" font-family="sans-serif" font-size="19">${xml(t(m.competition ? "Competition pressure" : "Matching active GitHub projects"))}</text><text x="64" y="523" fill="#666666" font-family="sans-serif" font-size="17">${xml(t(m.geo || "Worldwide"))} · ${m.asOf.slice(0, 10)} · ${xml(t(m.confidence))} ${xml(t("evidence confidence"))}</text><text x="64" y="558" fill="#666666" font-family="sans-serif" font-size="16">${xml(t(assessment.level === "provisional" ? "Preliminary recommendation · quadrant not yet established" : "Search attention is a demand signal, not proven market demand."))}</text><text x="64" y="599" fill="#315f9c" font-family="sans-serif" font-size="16">${xml(url)}</text></svg>`;
}
