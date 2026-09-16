import { selectGapSignals } from "../core/gaps.js";
import { ALGORITHM_VERSION, POLICY } from "../core/analyze.js";
import { marketAssessment } from "../core/assessment.js";
import { text, localeUrl, type Locale } from "../core/i18n.js";
import type { Market } from "../core/types.js";

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
  const t = (v: string, vars: Record<string, string | number> = {}) =>
    text(v, locale, vars);
  const e = (v: string) => escapeHtml(t(v));
  const number = (n: number) =>
    n.toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
  const growth = (market: Market) =>
    market.metrics.fast === null || market.metrics.growth === null
      ? t("Unavailable")
      : `${market.metrics.growth >= 0 ? "+" : ""}${(market.metrics.growth * 100).toFixed(0)}%`;
  const link = (url: string, label: string) => {
    try {
      const parsed = new URL(url, base);
      if (!["https:", "http:"].includes(parsed.protocol)) return e(label);
      const target = url.startsWith("/") ? localeUrl(url, locale) : url;
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
  const title =
    status === 404
      ? t("Page not found · ghtrends")
      : m
        ? `${t(m.topic.name)}: ${assessment!.title} · ghtrends`
        : t(titles[path] || "Repository intelligence · ghtrends");
  const description = m
    ? `${assessment!.title}. ${t("{count} active projects match the published GitHub search scope.", { count: m.supply.complete ? m.supply.total : "≥" + m.supply.total })} ${t("Evidence dated {date}.", { date: m.asOf.slice(0, 10) })}`
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
    const sources = m.supply.searches?.length
      ? m.supply.searches
      : [{ url: m.supply.sourceUrl, query: m.supply.query }];
    content = `<p class="eyebrow">${e("CATEGORY INTELLIGENCE /")} ${e(m.geo || "WORLDWIDE")}</p><h1>${e(m.topic.name)}<span class="lime">.</span></h1><p>${e(m.topic.description)}</p>
      <section><p>${e(assessment.level === "provisional" ? "Preliminary recommendation" : "Measured classification")}</p><h2>${escapeHtml(assessment.title)}</h2><p>${escapeHtml(assessment.summary)}</p><p>${e("Report dated")} <time datetime="${escapeHtml(m.asOf)}">${escapeHtml(m.asOf.slice(0, 10))}</time> · ${e("Method")} ${escapeHtml(m.version)} · ${e(m.confidence)} ${e("evidence confidence")}</p>
      ${list(assessment.facts)}${m.kind === "uncertain" ? `<p>${e("Quadrant not yet established")}</p><h3>${e("What to do next")}</h3>${list(assessment.nextSteps)}` : ""}
      <dl><dt>${e("Matching active GitHub projects")}</dt><dd>${m.supply.error ? "—" : (m.supply.complete ? "" : "≥") + number(m.supply.total)}</dd><dt>${e("Search-interest growth")}</dt><dd>${growth(m)} · ${e("Last 8 complete weeks vs previous 8")}</dd><dt>${e("Search term and region")}</dt><dd>${escapeHtml(m.demand.keyword)} · ${e(m.geo || "Worldwide")}</dd><dt>${e("Complete weekly observations")}</dt><dd>${m.metrics.points}</dd></dl></section>
      ${m.brief ? `<section><h2>${e("Research brief")}</h2><p>${escapeHtml(m.brief[locale].summary)}</p>${list(m.brief[locale].nextSteps)}<p>${e("AI interpretation of the evidence below. Verify the sources before acting.")}</p></section>` : ""}
      <section><h2>${e("Why this classification")}</h2>${list(m.reasons)}</section>
      <section><h2>${e("Source evidence")}</h2>${sources.map((s) => `<p>${link(s.url, "GitHub repository search")} · <code>${escapeHtml(s.query)}</code></p>`).join("")}<p>${e("Collected")} ${escapeHtml(m.supply.fetchedAt)}</p><p>${link(m.demand.sourceUrl, "Google Trends search interest")} · ${e("Collected")} ${escapeHtml(m.demand.fetchedAt)}</p></section>
      <section><h2>${e("Leading repositories")}</h2><div class="snapshot-table"><table><thead><tr>${["Repository", "Stars", "Description"].map((s) => `<th scope="col">${e(s)}</th>`).join("")}</tr></thead><tbody>${m.supply.repositories
        .slice(0, 10)
        .map(
          (r) =>
            `<tr><th scope="row">${link(r.url, r.name)}</th><td>${number(r.stars)}</td><td>${escapeHtml(r.description)}</td></tr>`,
        )
        .join("")}</tbody></table></div></section>
      <section><h2>${e("Limits of this result")}</h2>${list(m.limitations)}<p>${e("Search interest measures attention, not paying customers. Classification thresholds are published heuristics and still require empirical calibration.")}</p></section>
      <section><h2>${e("Use and share the evidence")}</h2><p>${link(`/report/${m.id}`, "Permanent report")} · ${link(`/api/reports/${m.id}?format=md&v=2`, "Markdown")} · ${link(`/api/reports/${m.id}`, "JSON")} · ${link(`/api/cards/${m.id}.png?v=2`, "PNG card")}</p><p>${link(SOURCE, "Use the open-source CLI and MCP server on GitHub")}</p></section>`;
  } else if (status === 404) {
    content = `<h1>${e("Page not found.")}</h1><p>${e("This report or page is unavailable.")} ${link("/", "Explore the radar")}</p>`;
  } else if (path === "/") {
    content = `<p class="eyebrow">${e("GITHUB SUPPLY × GOOGLE SEARCH DEMAND")}</p><h1>${e("Know where to build")}<span class="lime">.</span></h1><p>${e("Explore active open-source supply and sustained search growth. Every category links to its evidence, dates and limitations.")}</p>${table()}<p>${e("Search growth compares the last eight complete weeks with the previous eight. Counts can overlap; GitHub topic labels do not cover every competitor.")}</p>`;
  } else if (path === "/start") {
    content = `<h1>${e("Research in your own workflow")}</h1><p>${e("Use the hosted website, or run the same open-source engine with your own keys.")}</p><h2>${e("Hosted website")}</h2><p>${e("Read public reports freely. Sign in for private scans, saved reports and projects across devices.")}</p><h2>CLI / MCP</h2><p>${e("CLI, MCP and local Web share your SQLite workspace. Configure your GitHub key and an optional DeepSeek key. Hosted account history is separate.")}</p><pre>npm install -g https://radar.ghtrends.dev/ghtrends.tgz\nghtrends scan --topic ai4s --json\nghtrends mcp</pre><p>${link(SOURCE, "Source and setup instructions")}</p>`;
  } else if (path === "/docs") {
    content = `<h1>${e("Read the signals.")}</h1><section><h2>${e("The four landscapes")}</h2>${list(["Rising · limited supply", "Rising · established supply", "Established supply", "Limited observed supply"])}<p>${e("Partial evidence")}: ${e("This recommendation uses the evidence already available. It is not an LLM-generated forecast.")}</p></section>
      <section><h2>${e("Method")} ${ALGORITHM_VERSION}</h2><p>${e("GitHub searches use relevant topics and specific repository-name or description phrases. Results are deduplicated and require at least five stars, a push within 180 days, and no forks or archived projects.")}</p><p>${e("Counts are deduplicated across topic searches; incomplete searches show a lower bound.")}</p><p>${e("We compare the last 8 complete weeks with the previous 8, alongside 4-week and 13-week changes. Rising or falling requires a 10% change, a resampling band on the same side of zero, and no opposing short or longer trend. Conflicting windows and opposite-moving synonyms are marked mixed.")}</p><p>${e(`At least ${POLICY.minWeeks} complete weekly observations are required.`)}</p><p>${e("A weekly observation is usable only after that week ended at collection time. Invalid rows cannot refresh old evidence, and conflicting values for the same week prevent classification.")}</p><p>${link("https://support.google.com/trends/answer/4365533", "How Google Trends works")}</p></section>
      <section><h2>CLI / MCP</h2><p>${e("Node.js 22.13 or newer. Public queries work without credentials within GitHub’s unauthenticated limits. Configure your own token or GitHub App for larger scans.")}</p><pre>npx --yes --package=https://radar.ghtrends.dev/ghtrends.tgz ghtrends ui</pre><pre>ghtrends scan --topic ai4s --json\nghtrends mcp</pre><p>ghtrends_scan · ghtrends_repo · ghtrends_compare · ghtrends_watch_list</p>${link(SOURCE, "Full installation and configuration instructions")}</section>`;
  } else if (path === "/gaps") {
    const gaps = selectGapSignals([
      ...new Map(
        markets.flatMap((m) => m.gaps).map((g) => [g.url, g]),
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
