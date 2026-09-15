import { ALGORITHM_VERSION, POLICY } from "../core/analyze.js";
import type { Market } from "../core/types.js";

const SOURCE = "https://github.com/noahbenjamin1994/ghtrends-radar";
export const escapeHtml = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );
const number = (n: number) => n.toLocaleString("en-US");
const growth = (m: Market) =>
  m.metrics.growth === null
    ? "Unavailable"
    : `${m.metrics.growth >= 0 ? "+" : ""}${(m.metrics.growth * 100).toFixed(0)}%`;
const link = (url: string, label: string) => {
  try {
    const parsed = new URL(url, "https://radar.ghtrends.dev");
    if (!["https:", "http:"].includes(parsed.protocol))
      return escapeHtml(label);
    return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
  } catch {
    return escapeHtml(label);
  }
};
const list = (values: string[]) =>
  `<ul>${values.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`;
const marketPath = (m: Market) =>
  `/market/${m.topic.slug}${m.geo ? `?geo=${m.geo}` : ""}`;
const marketTable = (markets: Market[]) =>
  `<div class="snapshot-table"><table><caption>Measured open-source categories</caption><thead><tr><th scope="col">Category</th><th scope="col">Landscape</th><th scope="col">Active projects</th><th scope="col">Search growth</th></tr></thead><tbody>${markets.map((m) => `<tr><th scope="row">${link(marketPath(m), m.topic.name)}</th><td>${escapeHtml(m.headline)}</td><td>${number(m.supply.total)}</td><td>${growth(m)}</td></tr>`).join("")}</tbody></table></div>`;

function evidence(m: Market) {
  return `<p class="eyebrow">CATEGORY INTELLIGENCE / ${escapeHtml(m.geo || "WORLDWIDE")}</p>
    <h1>${escapeHtml(m.topic.name)}<span class="lime">.</span></h1>
    <p>${escapeHtml(m.topic.description)}</p>
    <section><h2>${escapeHtml(m.headline)}</h2><p>${escapeHtml(m.strategy)}</p>
    <p>Report dated <time datetime="${escapeHtml(m.asOf)}">${escapeHtml(m.asOf.slice(0, 10))}</time> · Method ${escapeHtml(m.version)} · ${escapeHtml(m.confidence)} evidence confidence.</p>
    <dl><dt>Matching active GitHub projects</dt><dd>${number(m.supply.total)}</dd><dt>Search-interest growth</dt><dd>${growth(m)} · last 8 complete weeks versus the previous 8</dd><dt>Search term and region</dt><dd>${escapeHtml(m.demand.keyword)} · ${escapeHtml(m.geo || "Worldwide")}</dd><dt>Complete weekly observations</dt><dd>${m.metrics.points}</dd></dl></section>
    <section><h2>Why this classification</h2>${list(m.reasons)}</section>
    <section><h2>Source evidence</h2><p>${link(m.supply.sourceUrl, "GitHub repository search")} · Collected ${escapeHtml(m.supply.fetchedAt)}</p><p><code>${escapeHtml(m.supply.query)}</code></p><p>${link(m.demand.sourceUrl, "Google Trends search interest")} · Collected ${escapeHtml(m.demand.fetchedAt)}</p></section>
    <section><h2>Leading repositories</h2><div class="snapshot-table"><table><caption>Top ${Math.min(10, m.supply.repositories.length)} returned projects by stars</caption><thead><tr><th scope="col">Repository</th><th scope="col">Stars</th><th scope="col">Description</th></tr></thead><tbody>${m.supply.repositories
      .slice(0, 10)
      .map(
        (r) =>
          `<tr><th scope="row">${link(r.url, r.name)}</th><td>${number(r.stars)}</td><td>${escapeHtml(r.description)}</td></tr>`,
      )
      .join("")}</tbody></table></div></section>
    <section><h2>Limits of this result</h2>${list(m.limitations)}<p>Search interest measures attention, not paying customers. Classification thresholds are published heuristics and still require empirical calibration.</p></section>
    <section><h2>Use and share the evidence</h2><p>${link(`/report/${m.id}`, "Permanent report")} · ${link(`/api/reports/${m.id}?format=md`, "Markdown")} · ${link(`/api/reports/${m.id}`, "JSON")} · ${link(`/api/cards/${m.id}.png`, "PNG card")}</p><p>${link(SOURCE, "Use the open-source CLI and MCP server on GitHub")}</p></section>`;
}

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
  },
) {
  const { base, path, geo, market: m, markets, status } = options;
  const titles: Record<string, string> = {
    "/": "ghtrends — Know where to build",
    "/docs": "GitHub opportunity analysis: methodology, CLI and MCP · ghtrends",
    "/gaps": "Open-source feature requests and friction signals · ghtrends",
    "/compare": "Compare GitHub repositories · ghtrends",
    "/watch": "Your GitHub watchlist · ghtrends",
  };
  const title =
    status === 404
      ? "Page not found · ghtrends"
      : m
        ? `${m.topic.name}: ${m.headline} · ghtrends`
        : titles[path] || "Repository intelligence · ghtrends";
  const description = m
    ? `${m.headline}. ${number(m.supply.total)} matching active GitHub projects; ${growth(m)} search-interest growth for “${m.demand.keyword}” in ${m.geo || "Worldwide"}. Evidence dated ${m.asOf.slice(0, 10)}.`
    : "GitHub supply × Google search demand. Explore category evidence, compare repositories, and use the open-source CLI and MCP server.";
  const canonical =
    base +
    path +
    (geo && (path === "/" || path.startsWith("/market/")) ? `?geo=${geo}` : "");
  const image = m ? `${base}/api/cards/${m.id}.png` : `${base}/social-card.png`;
  const noindex = status !== 200 || options.noindex;
  let content = m
    ? evidence(m)
    : status === 404
      ? `<h1>Page not found.</h1><p>This report or page is unavailable. ${link("/", "Explore the radar")} to find a current category.</p>`
      : path === "/"
        ? `<p class="eyebrow">GITHUB SUPPLY × GOOGLE SEARCH DEMAND</p><h1>Know where to build<span class="lime">.</span></h1><p>Explore active open-source supply and sustained search growth. Every category links to its evidence, dates and limitations.</p>${marketTable(markets)}<p>Search growth compares the last eight complete weeks with the previous eight. Counts can overlap; GitHub topic labels do not cover every competitor.</p>`
        : path === "/docs"
          ? `<h1>Read the signals.</h1><section><h2>Four landscapes, one evidence standard</h2><p>Few projects and fast search growth: early blue ocean. Many projects and fast growth: growth red ocean. Many projects without fast growth: established red ocean. Few projects without fast growth: quiet waters. Missing or weak evidence: uncharted.</p></section><section><h2>Published method ${ALGORITHM_VERSION}</h2><p>Supply includes non-fork, non-archived repositories with at least ${POLICY.minStars} stars and a push in the last ${POLICY.activeDays} days. ${POLICY.denseSupply} matching projects is the dense-supply threshold.</p><p>Demand compares the median of ${POLICY.windowWeeks} complete weeks with the prior ${POLICY.windowWeeks}. Fast growth requires at least ${POLICY.fastGrowth * 100}% growth, a positive lower resampling band, persistence and a seasonal check. At least ${POLICY.minWeeks} consecutive weeks are required; evidence older than ${POLICY.staleDays} days is insufficient.</p><p>Weekly intervals must have ended when collected and when analyzed. Invalid rows cannot make old evidence fresh; conflicting values for a week prevent classification. These thresholds are heuristics, not calibrated business forecasts. ${link("https://support.google.com/trends/answer/4365533", "How Google Trends measures search attention")}.</p></section><section><h2>CLI and MCP</h2><p>Requires Node.js 22.13 or newer. Start the local radar:</p><pre>npx --yes --package=https://radar.ghtrends.dev/ghtrends.tgz ghtrends ui</pre><p>Run <code>ghtrends scan --topic mcp-servers --json</code> to inspect a category, or <code>ghtrends mcp</code> to connect an MCP client over stdio.</p><p>Tools: ghtrends_scan, ghtrends_repo, ghtrends_compare, ghtrends_watch_list. ${link(SOURCE, "Full installation and configuration instructions")}.</p></section>`
          : path === "/gaps"
            ? `<h1>Listen for friction.</h1><p>Open issues from leading repositories, ranked by reactions. These are research leads, not validated market gaps.</p><ul>${[
                ...new Map(
                  markets.flatMap((m) => m.gaps).map((g) => [g.url, g]),
                ).values(),
              ]
                .sort((a, b) => b.reactions - a.reactions)
                .slice(0, 20)
                .map(
                  (g) =>
                    `<li>${link(g.url, g.title)} — ${escapeHtml(g.repo)} · ${number(g.reactions)} reactions</li>`,
                )
                .join("")}</ul>`
            : `<h1>${escapeHtml(titles[path]?.replace(" · ghtrends", "") || "Repository intelligence")}</h1><p>Enable JavaScript for repository search, interactive comparisons and your browser-local watchlist. You can also use the ${link("/docs", "CLI or MCP server")}.</p>`;
  content = `<div class="snapshot"><nav aria-label="Main navigation">${link("/", "ghtrends ↗")} ${link("/gaps", "Demand gaps")} ${link("/docs", "Method / CLI / MCP")} ${link(SOURCE, "Star on GitHub ↗")}</nav><main>${content}</main><footer>Built for the curious. Open for everyone. ${link(SOURCE, "MIT source code")}</footer></div>`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url: canonical,
    description,
    ...(m
      ? {
          dateModified: m.asOf,
          citation: [m.supply.sourceUrl, m.demand.sourceUrl],
        }
      : {}),
    isPartOf: { "@type": "WebSite", name: "ghtrends", url: base },
  };
  // Replace template metadata rather than appending conflicting Open Graph tags.
  return template
    .replace(
      /<meta\b(?=[^>]*(?:name\s*=\s*["'](?:description|twitter:[^"']+|robots)["']|property\s*=\s*["']og:[^"']+["']))[^>]*>/gi,
      "",
    )
    .replace(/<link\b(?=[^>]*rel\s*=\s*["']canonical["'])[^>]*>/gi, "")
    .replace(/<title>[^]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(
      "</head>",
      `<meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="${escapeHtml(canonical)}">${noindex ? '<meta name="robots" content="noindex,follow">' : ""}<meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="ghtrends"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:alt" content="${escapeHtml(title)}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script></head>`,
    )
    .replace('<div id="root"></div>', `<div id="root">${content}</div>`);
}
