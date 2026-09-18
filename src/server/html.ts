import {
  searchCollectionMessage,
  searchEngineLabel,
} from "../core/evidence.js";
import { landscapeRows, researchLandscape } from "../core/landscape.js";
import {
  visibleOpportunities,
  overviewRows,
  opportunityRows,
} from "../core/opportunities.js";
import { appPath, basePathFromUrl } from "../core/paths.js";
import {
  marketGapSignals,
  reportIssueSignals,
  selectGapSignals,
} from "../core/gaps.js";
import { ALGORITHM_VERSION, POLICY } from "../core/analyze.js";
import { marketAssessment, competitionPressure } from "../core/assessment.js";
import { text, localeUrl, MARKET_LABELS, type Locale } from "../core/i18n.js";
import type { Market } from "../core/types.js";
import { visibleStrategy, strategyRows } from "../core/strategy.js";

const SOURCE = "https://github.com/noahbenjamin1994/ghtrends-radar";
export const escapeHtml = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function renderDocument(
  template: string,
  options: {
    base: string;
    path: string;
    geo: string;
    market: Market | null;
    markets: Market[];
    status: number;
    noindex?: boolean;
    locale?: Locale;
  },
) {
  const { base, path, geo, market: m, markets, status } = options,
    locale = options.locale || "en";
  const basePath = basePathFromUrl(base);
  const t = (v: string, vars: Record<string, string | number> = {}) =>
    text(v, locale, vars);
  const e = (v: string) => escapeHtml(t(v));
  const number = (n: number) =>
    n.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
  const growth = (market: Market) =>
    market.metrics.emerging
      ? t("Low-base rise")
      : market.metrics.fast === null || market.metrics.growth === null
        ? t("Unavailable")
        : `${market.metrics.growth >= 0 ? "+" : ""}${(market.metrics.growth * 100).toFixed(0)}%`;
  const link = (url: string, label: string) => {
    try {
      const parsed = new URL(url, base);
      if (!["https:", "http:"].includes(parsed.protocol)) return e(label);
      const target = url.startsWith("/")
        ? localeUrl(appPath(url, basePath), locale)
        : url;
      return `<a href="${escapeHtml(target)}">${e(label)}</a>`;
    } catch {
      return e(label);
    }
  };
  const list = (values: string[]) =>
    `<ul>${values.map((s) => `<li>${e(s)}</li>`).join("")}</ul>`;
  const marketPath = (market: Market) =>
    `/market/${market.topic.slug}${market.geo ? `?geo=${market.geo}` : ""}`;
  const table = () =>
    `<div class="snapshot-table"><table><caption>${e("Measured open-source categories")}</caption><thead><tr>${["Category", "Landscape", "Active projects", "Search growth"].map((s) => `<th scope="col">${e(s)}</th>`).join("")}</tr></thead><tbody>${markets.map((market) => `<tr><th scope="row">${link(marketPath(market), market.topic.name)}</th><td>${e(marketAssessment(market, locale).title)}</td><td>${market.supply.error ? "—" : (market.supply.complete ? "" : "≥") + number(market.supply.total)}</td><td>${growth(market)}</td></tr>`).join("")}</tbody></table></div>`;
  const assessment = m ? marketAssessment(m, locale) : null;
  const titles: Record<string, string> = {
    "/": "ghtrends — Know where to build",
    "/docs": "GitHub opportunity analysis: methodology, CLI and MCP · ghtrends",
    "/start": "Use the open-source CLI and MCP server on GitHub",
    "/gaps": "Open-source feature requests and friction signals · ghtrends",
    "/compare": "Compare GitHub repositories · ghtrends",
    "/watch": "Your GitHub watchlist · ghtrends",
    "/admin": "Operations · ghtrends",
    "/history": "Your research history · ghtrends",
  };
  const reportTitle =
    assessment?.narrative.kind === "ai" && assessment.narrative.headline
      ? assessment.narrative.headline
      : assessment?.title;
  const title =
    status === 404
      ? t("Page not found · ghtrends")
      : m
        ? `${t(m.topic.name)}: ${reportTitle} · ghtrends`
        : t(titles[path] || "Repository intelligence · ghtrends");
  const description = m
    ? `${reportTitle}. ${t("{count} active projects match the published GitHub search scope.", { count: m.supply.complete ? m.supply.total : "≥" + m.supply.total })} ${t("Evidence dated {date}.", { date: m.asOf.slice(0, 10) })}`
    : t(
        "GitHub supply × Google search demand. Explore category evidence, compare repositories, and use the open-source CLI and MCP server.",
      );
  const identity =
    base +
    path +
    (geo && (path === "/" || path.startsWith("/market/")) ? `?geo=${geo}` : "");
  const canonical = localeUrl(identity, locale);
  const image = m
    ? localeUrl(`${base}/api/cards/${m.id}.png?v=2`, locale)
    : `${base}/social-card.png`;
  const noindex = status !== 200 || options.noindex;
  let content: string;
  if (m && assessment) {
    const strategy =
      assessment.narrative.kind === "ai"
        ? visibleStrategy(m.brief, locale)
        : undefined;
    const overview = researchLandscape(m)
      ? undefined
      : visibleOpportunities(m.brief)?.overview;
    const sources = m.supply.searches?.length
      ? m.supply.searches
      : [{ url: m.supply.sourceUrl, query: m.supply.query }];
    content = `<p class="eyebrow">${e("CATEGORY INTELLIGENCE /")} ${e(m.geo || "WORLDWIDE")}</p><h1>${e(m.topic.name)}</h1><p>${e(m.topic.description)}</p>
      <section><p>${escapeHtml(assessment.landscape)} · ${e(assessment.level === "provisional" ? "Preliminary recommendation" : "Measured classification")}</p><h2>${escapeHtml(assessment.title)}</h2><p>${escapeHtml(assessment.summary)}</p><p>${e("Report dated")} <time datetime="${escapeHtml(m.asOf)}">${escapeHtml(m.asOf.slice(0, 10))}</time> · ${e("Method")} ${escapeHtml(m.version)} · ${e(m.confidence)} ${e("evidence confidence")}</p>
      <p>${e("Measured search term")}: ${escapeHtml(m.demand.keyword)} · ${escapeHtml(assessment.demandNote)}</p>${m.demand.retryAt ? `<p>${e("Google Trends refresh window")}: ${escapeHtml(m.demand.retryAt)}</p>` : ""}${list(assessment.facts)}${m.kind === "uncertain" ? `<p>${e("Quadrant not yet established")}</p><h3>${e("What to do next")}</h3>${list(assessment.nextSteps)}` : ""}
      <dl>${m.competition ? `<dt>${e("Open-source competition")}</dt><dd>${escapeHtml(competitionPressure(m))} / 100 · ${e("pressure." + m.competition.level)}</dd><dt>${e("Open-source alternatives")}</dt><dd>${m.competition.direct}</dd><dt>${e("Direction basis")}</dt><dd>${e("basis." + (m.metrics.directionBasis || "recent-windows"))}</dd>` : ""}<dt>${e("Matching active GitHub projects")}</dt><dd>${m.supply.error ? "—" : (m.supply.complete ? "" : "≥") + number(m.supply.total)}</dd><dt>${e("Search-interest growth")}</dt><dd>${growth(m)} · ${e("Last 8 complete weeks vs previous 8")}</dd><dt>${e("Search term and region")}</dt><dd>${escapeHtml(m.demand.keyword)} · ${e(m.geo || "Worldwide")}</dd><dt>${e("Complete weekly observations")}</dt><dd>${m.metrics.points}</dd></dl></section>
      ${m.brief ? `<section><h2>${e("Research brief")}</h2><p>${escapeHtml(assessment.narrative.summary)}</p>${list(assessment.narrative.nextSteps)}<p>${e(assessment.narrative.kind === "ai" ? "AI interpretation of the evidence below. Verify the sources before acting." : "This recommendation follows the collected source evidence.")}</p></section>` : ""}
      ${
        overview
          ? `<section><h2>${locale === "zh" ? "原词整体机会" : "The overall opportunity"}</h2>${overviewRows(
              overview,
              locale,
            )
              .map(
                (row) =>
                  `<h3>${escapeHtml(row.label)}</h3><p>${escapeHtml(row.text)}</p>`,
              )
              .join("")}</section>`
          : ""
      }
      <section>${landscapeRows(m, locale)
        .map(
          (row) =>
            `<h3>${escapeHtml(row.label)}</h3><p>${escapeHtml(row.text)}</p>`,
        )
        .join("")}</section>
      ${
        visibleOpportunities(m.brief)
          ? `<section><h2>${locale === "zh" ? "细分方向地图" : "Opportunity map"}</h2><p>${escapeHtml(m.brief!.selection![locale])}</p>${m
              .brief!.opportunities!.map(
                (o) =>
                  `<article><h3>${escapeHtml(o[locale].title)}</h3>${opportunityRows(
                    o,
                    locale,
                  )
                    .map(
                      (r) =>
                        `<h4>${escapeHtml(r.label)}</h4><p>${escapeHtml(r.text)}</p>`,
                    )
                    .join("")}</article>`,
              )
              .join("")}</section>`
          : ""
      }
      ${
        strategy
          ? `<section><h2>${locale === "zh" ? "值得验证的产品判断" : "A product thesis to test"}</h2>${strategyRows(
              strategy,
              locale,
            )
              .map(
                (row) =>
                  `<h3>${escapeHtml(row.label)}</h3><p>${escapeHtml(row.text)}</p>`,
              )
              .join(
                "",
              )}<p>${locale === "zh" ? "策略由 AI 提出，数字门槛为建议实验标准，真实结果用于决定下一步。" : "AI strategy hypothesis. Numeric thresholds are proposed experiment criteria; actual outcomes guide the next decision."}</p></section>`
          : ""
      }
      <section><h2>${e("Why this classification")}</h2>${list(m.reasons)}</section>
      <section><h2>${e("Source evidence")}</h2>${sources.map((s) => `<p>${link(s.url, "GitHub repository search")} · <code>${escapeHtml(s.query)}</code></p>`).join("")}<p>${e("Collected")} ${escapeHtml(m.supply.fetchedAt)}</p><p>${link(m.demand.sourceUrl, "Google Trends search interest")} · ${e("Collected")} ${escapeHtml(m.demand.fetchedAt)}</p></section>
      <section><h2>${e("Leading repositories")}</h2><div class="snapshot-table"><table><thead><tr>${["Repository", "Stars", "Description"].map((s) => `<th scope="col">${e(s)}</th>`).join("")}</tr></thead><tbody>${m.supply.repositories
        .slice(0, 10)
        .map(
          (r) =>
            `<tr><th scope="row">${link(r.url, r.name)}</th><td>${number(r.stars)}</td><td>${escapeHtml(r.description)}</td></tr>`,
        )
        .join("")}</tbody></table></div></section>
      <section><h2>${e("Limits of this result")}</h2>${list(assessment.scopeNotes)}<p>${e("Search interest measures attention, not paying customers. Classification thresholds are published heuristics and still require empirical calibration.")}</p></section>
      <section><h2>${locale === "zh" ? "社区需求解读" : "Community requests"}</h2>${reportIssueSignals(
        m,
      )
        .map((g) => {
          const p = m.brief?.issueInsights?.find(
            (i) =>
              i.relevance === "direct" &&
              m.brief?.sources.find((s) => s.id === i.sourceId)?.url === g.url,
          )?.[locale];
          return `<article><h3>${link(g.url, p?.title || g.title)}</h3>${p ? list([p.audience, p.need, p.opportunity, p.check]) : `<p>${escapeHtml(g.excerpt)}</p>`}<p>${escapeHtml(g.repo)}${g.createdAt ? ` · ${escapeHtml(g.createdAt.slice(0, 10))}` : ""}</p></article>`;
        })
        .join("")}</section>
      ${m.web?.queries.length ? `<section><h2>${locale === "zh" ? "网页搜索证据" : "Web search evidence"}</h2><p>${escapeHtml(m.web.region)} · ${escapeHtml(m.web.language)} · ${escapeHtml(m.web.fetchedAt.slice(0, 10))}</p><p>${escapeHtml(searchCollectionMessage(m.web, locale))}</p>${m.web.queries.map((q) => `<h3>${escapeHtml(q.query)}</h3><p>${q.state === "ready" ? escapeHtml(searchEngineLabel(q) + " · " + (q.fetchedAt || m.web!.fetchedAt) + " · " + (q.region || m.web!.region)) : locale === "zh" ? "采集已暂停 · 可更新研究后重试" : "Collection stopped · update research to retry"}</p>${q.results.map((r) => `<p>${r.kind === "ad" ? (locale === "zh" ? "广告" : "Ad") : locale === "zh" ? "自然结果" : "Organic"} · ${link(r.url, r.title)}${r.kind === "ad" ? ` · ${escapeHtml(new URL(r.url).hostname)}` : ""}</p><p>${escapeHtml(r.excerpt)}</p>`).join("")}`).join("")}</section>` : ""}
      <section><h2>${e("Use and share the evidence")}</h2><p>${link(`/report/${m.id}`, "Permanent report")} · ${link(`/api/reports/${m.id}?format=md&v=2`, "Markdown")} · ${link(`/api/reports/${m.id}`, "JSON")} · ${link(`/api/cards/${m.id}.png?v=2`, "PNG card")}</p><p>${link(SOURCE, "Use the open-source CLI and MCP server on GitHub")}</p></section>`;
  } else if (status === 404) {
    content = `<h1>${e("Page not found.")}</h1><p>${e("This report or page is unavailable.")} ${link("/", "Explore the radar")}</p>`;
  } else if (path === "/") {
    content = `<p class="eyebrow">${e("GITHUB SUPPLY × GOOGLE SEARCH DEMAND")}</p><h1>${e("Know where to build")}</h1><p>${e("Explore active open-source supply and sustained search growth. Every category links to its evidence, dates and limitations.")}</p>${table()}<p>${e("Search growth compares the last eight complete weeks with the previous eight. Counts can overlap; GitHub topic labels do not cover every competitor.")}</p>`;
  } else if (path === "/start") {
    content = `<h1>${e("Research in your own workflow")}</h1><p>${e("Use the hosted website, or run the same open-source engine with your own keys.")}</p><h2>${e("Hosted website")}</h2><p>${e("Read public reports freely. Sign in for private scans, saved reports and projects across devices.")}</p><h2>CLI / MCP</h2><p>${e("CLI, MCP and local Web share your SQLite workspace. Configure your GitHub key and an optional DeepSeek key. Hosted account history is separate.")}</p><pre>npm install -g https://ghtrends.dev/radar/ghtrends.tgz\nghtrends scan --topic ai4s --json\nghtrends mcp</pre><p>${link(SOURCE, "Source and setup instructions")}</p>`;
  } else if (path === "/docs") {
    content = `<h1>${e("Read the signals.")}</h1><section><h2>${e("The four landscapes")}</h2>${list([MARKET_LABELS.blue, MARKET_LABELS.expanding, MARKET_LABELS.contested, MARKET_LABELS.quiet])}<p>${e("Ocean labels summarize search direction and observed open-source supply. They are research signals, not verified measures of commercial competition. A quiet ocean may still be a valuable niche.")}</p><p>${e("Partial evidence")}: ${e("This recommendation uses the evidence already available. It is not an LLM-generated forecast.")}</p></section>
      <section><h2>${e("Method")} ${ALGORITHM_VERSION}</h2><p>${e("GitHub searches use relevant topics and specific name or description phrases. Original, active projects qualify with at least one star and a push within 365 days. We review their roles, group projects by owner, and calculate pressure from direct alternatives.")}</p><p>${e("Counts are deduplicated across topic searches; incomplete searches show a lower bound.")}</p><p>${e("Search direction compares 4-, 8- and 13-week windows, sustained changes and a resampling range. Slow growth can qualify across a full quarter. A repeating annual pattern switches the direction comparison to the same period last year. Opposing synonyms keep a mixed signal.")}</p><p>${e(`At least ${POLICY.minWeeks} complete weekly observations are required.`)}</p><p>${e("A low-base rise is reported without a percentage when the prior median is below 3, at least six of the last eight weekly indices reach 10, and the last-four-week median retains at least 80% of the first four. It remains a low-confidence early signal; sparse or isolated spikes stay unconfirmed.")}</p><p>${e("Known categories retain their published query scope. Compound requirements use intersecting GitHub topics. For incomplete unions, the lower bound is the larger of the deduplicated sample and any complete individual search count.")}</p><p>${e("A weekly observation is usable only after that week ended at collection time. Invalid rows cannot refresh old evidence, and conflicting values for the same week prevent classification.")}</p><p>${link("https://support.google.com/trends/answer/4365533", "How Google Trends works")}</p></section>
      <section><h2>CLI / MCP</h2><p>${e("Node.js 22.13 or newer. Public queries work without credentials within GitHub’s unauthenticated limits. Configure your own token or GitHub App for larger scans.")}</p><pre>npx --yes --package=https://ghtrends.dev/radar/ghtrends.tgz ghtrends ui</pre><pre>ghtrends scan --topic ai4s --json\nghtrends mcp</pre><p>ghtrends_scan · ghtrends_repo · ghtrends_compare · ghtrends_watch_list</p>${link(SOURCE, "Full installation and configuration instructions")}</section>`;
  } else if (path === "/gaps") {
    const gaps = selectGapSignals([
      ...new Map(
        markets.flatMap((m) => marketGapSignals(m)).map((g) => [g.url, g]),
      ).values(),
    ]).slice(0, 20);
    content = `<h1>${e("Find the friction")}</h1><p>${e("Open issues people care enough to react to. Follow the source, understand the workflow, and validate the need.")}</p><ul>${gaps.map((g) => `<li>${link(g.url, g.title)} — ${escapeHtml(g.repo)} · ↑ ${number(g.reactions)}</li>`).join("")}</ul>`;
  } else {
    content = `<h1>${e(titles[path]?.replace(" · ghtrends", "") || "Repository intelligence")}</h1><p>${e("Browse public reports without an account. Sign in to run AI-assisted scans and keep your history and watchlist across devices.")} ${link("/docs", "CLI / MCP")}</p>`;
  }
  const other = locale === "zh" ? "en" : "zh",
    switchUrl = new URL(identity);
  switchUrl.searchParams.set("lang", other);
  content = `<div class="snapshot"><nav aria-label="${e("Main navigation")}">${link("/", "ghtrends ↗")} ${link("/start", "Use open source")} ${link("/docs", "Methodology")} ${link(SOURCE, "Star on GitHub")} <a href="${escapeHtml(switchUrl.pathname + switchUrl.search)}" lang="${other}">${other === "zh" ? "中文" : "English"}</a></nav><main>${content}</main><footer>${e("Built for the curious. Open for everyone.")} ${link(SOURCE, "MIT source code")}</footer></div>`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url: canonical,
    description,
    inLanguage: locale === "zh" ? "zh-CN" : "en",
    ...(m
      ? {
          dateModified: m.asOf,
          citation: [
            ...(m.supply.searches?.map((s) => s.url) || [m.supply.sourceUrl]),
            m.demand.sourceUrl,
          ],
        }
      : {}),
    isPartOf: { "@type": "WebSite", name: "ghtrends", url: base },
  };
  return template
    .replace(
      /((?:src|href)=["'])(?:\.\/|\/(?!\/))/g,
      (_match, start: string) => `${start}${basePath}/`,
    )
    .replace(
      "</head>",
      `<meta name="ghtrends-base-path" content="${basePath}"></head>`,
    )
    .replace(
      /<html\b[^>]*>/i,
      `<html lang="${locale === "zh" ? "zh-CN" : "en"}">`,
    )
    .replace(
      /<meta\b(?=[^>]*(?:name\s*=\s*["'](?:description|twitter:[^"']+|robots)["']|property\s*=\s*["']og:[^"']+["']))[^>]*>/gi,
      "",
    )
    .replace(
      /<link\b(?=[^>]*rel\s*=\s*["'](?:canonical|alternate)["'])[^>]*>/gi,
      "",
    )
    .replace(/<title>[^]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(
      "</head>",
      `<meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}">${(["en", "zh"] as const).map((l) => `<link rel="alternate" hreflang="${l === "zh" ? "zh-CN" : "en"}" href="${escapeHtml(localeUrl(identity, l))}">`).join("")}${noindex ? '<meta name="robots" content="noindex,follow">' : ""}<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="ghtrends"><meta property="og:locale" content="${locale === "zh" ? "zh_CN" : "en_US"}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:alt" content="${escapeHtml(title)}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script></head>`,
    )
    .replace('<div id="root"></div>', `<div id="root">${content}</div>`);
}
