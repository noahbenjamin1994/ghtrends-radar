import type { Market } from "./types.js";
import { text, type Locale } from "./i18n.js";
import {
  marketAssessment,
  competitionPressure,
  outlookPresentation,
} from "./assessment.js";
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

// SVG text has no native line wrapping. Bound both translated labels and user queries.
function lines(value: string, units: number, limit: number): string[] {
  const width = (s: string) =>
    [...s].reduce(
      (n, c) =>
        n + (/[^\x00-\xff]/.test(c) ? 1 : /[MW@]/.test(c) ? 0.85 : 0.55),
      0,
    );
  const words =
    value.trim().match(/[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*|[^a-zA-Z0-9]/g) ||
    [];
  const result: string[] = [];
  let line = "";
  for (const word of words) {
    for (const part of width(word) > units ? [...word] : [word]) {
      if (line && width(line + part) > units) {
        result.push(line.trim());
        line = "";
      }
      line += part;
    }
  }
  if (line.trim()) result.push(line.trim());
  if (result.length > limit)
    result[limit - 1] = result[limit - 1]!.slice(0, -1).trimEnd() + "…";
  return result.slice(0, limit);
}

export function marketCard(m: Market, url: string, locale: Locale = "en") {
  const t = (s: string) => text(s, locale),
    assessment = marketAssessment(m, locale),
    presentation = outlookPresentation(assessment.kind, locale);
  const value = m.metrics.emerging
    ? t("Low-base rise")
    : !assessment.searchReady ||
        m.metrics.fast === null ||
        m.metrics.growth === null
      ? t("Not established")
      : `${m.metrics.growth >= 0 ? "+" : ""}${(m.metrics.growth * 100).toFixed(0)}%`;
  const title =
    locale === "zh" ? m.topic.plan?.input || t(m.topic.name) : t(m.topic.name);
  const topicLines = lines(title, 12, 2),
    verdictLines = lines(assessment.landscape, 5.6, 3);
  const textLines = (items: string[], x: number, y: number, step: number) =>
    items
      .map(
        (line, i) => `<tspan x="${x}" y="${y + i * step}">${xml(line)}</tspan>`,
      )
      .join("");
  const qualification = assessment.basisLabel;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="sans-serif">
<rect width="1200" height="630" fill="#fff"/>
<text x="64" y="76" fill="#1c1c1c" font-size="30" font-weight="700">ghtrends ↗</text>
<text x="1136" y="74" fill="#777" font-size="16" text-anchor="end">${xml(t("THE OPEN-SOURCE OPPORTUNITY RADAR"))}</text>
<rect x="44" y="116" width="1112" height="416" rx="24" fill="${presentation.wash}"/>
<text x="76" y="164" fill="#78726c" font-size="13">${locale === "zh" ? "这次，机会在哪里" : "THE OPPORTUNITY IN FOCUS"}</text>
<text fill="#20201e" font-size="48" font-weight="700">${textLines(topicLines, 76, 231, 57)}</text>
<text fill="${presentation.color}" font-size="22">${textLines(lines(assessment.reason, 27, 2), 76, 331, 30)}</text>
<text x="76" y="427" fill="#20201e" font-size="${value.length > 8 ? 25 : 44}" font-weight="600">${xml(value)}</text>
<text x="76" y="462" fill="#74716c" font-size="15">${xml(t("Search growth · 8 weeks vs prior 8"))}</text>
<text x="397" y="427" fill="#20201e" font-size="44" font-weight="600">${m.competition ? competitionPressure(m) + " / 100" : m.supply.error ? "—" : (m.supply.complete ? "" : "≥") + m.supply.total.toLocaleString("en-US")}</text>
<text x="397" y="462" fill="#74716c" font-size="15">${xml(t(m.competition ? "Open-source competition" : "Matching active GitHub projects"))}</text>
<line x1="730" x2="730" y1="156" y2="492" stroke="${presentation.color}" stroke-opacity=".16"/>
<text x="770" y="200" fill="#78726c" font-size="15">${xml(qualification)}</text>
<text fill="${presentation.color}" font-size="64" font-weight="700" letter-spacing="-2">${textLines(verdictLines, 767, verdictLines.length === 3 ? 280 : 310, 76)}</text>
<text x="770" y="480" fill="#78726c" font-size="14">${xml(t(m.confidence))} ${xml(t("evidence confidence"))}</text>
<text x="64" y="573" fill="#74716c" font-size="15">${xml(t(m.geo || "Worldwide"))} · ${xml(m.asOf.slice(0, 10))}</text>
<text x="1136" y="573" fill="#74716c" font-size="14" text-anchor="end">${xml(url)}</text>
<text x="64" y="606" fill="#8b8781" font-size="13">${locale === "zh" ? "用趋势、竞品与开源证据，看清下一步。" : "Trends, competitors and open-source evidence. A clearer next move."}</text>
</svg>`;
}
