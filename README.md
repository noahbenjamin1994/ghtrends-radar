<div align="center">

# ghtrends ↗

**English · [简体中文](README.zh-CN.md)**

### Know where to build.

**GitHub supply × Google search demand.**
Find growing categories, inspect the competition, and share the evidence.

[Open the radar](https://ghtrends.dev/radar) · [Methodology](https://ghtrends.dev/radar/docs) · [Report a bug](https://github.com/noahbenjamin1994/ghtrends-radar/issues)

</div>

[![Build checks](https://github.com/noahbenjamin1994/ghtrends-radar/actions/workflows/check.yml/badge.svg)](https://github.com/noahbenjamin1994/ghtrends-radar/actions/workflows/check.yml)

[![The live ghtrends opportunity radar](.github/assets/radar-preview.png)](https://ghtrends.dev/radar)

## What does it tell you?

| Landscape | Search direction | Observed competition | Starting strategy |
|---|---|---|---|
| Blue ocean | Rising | Limited, covered search results | Validate a focused use case |
| Growing red ocean | Rising | Established alternatives | Find a specific audience or advantage |
| Red ocean | Stable / falling / mixed / pending | Established alternatives | Find a reason users would switch; inspect search status separately |
| Quiet ocean | Stable / falling | Limited, covered search results | Validate a focused niche |
| Needs validation | Any | Coverage or project roles need review | Inspect measured facts and complete the highlighted evidence |
| Field overview | Measured separately | Several workflows or a broader market | Choose one software task for the next scan |

Ocean names summarize the observed search and open-source signals; they do not establish commercial competition. A quiet ocean can still be a valuable niche.

Every result includes its source queries, dates, methodology version and limitations. Category and report pages include readable HTML evidence before JavaScript loads, and shared links show the specific report in their previews. Search interest measures attention, not paying customers. A quadrant is a research starting point, not a prediction of commercial success.

## A useful answer when the data is thin

A scan gives an evidence-based recommendation even when a reliable quadrant cannot be established. It separates known facts, an initial recommendation, and the next validation steps. Sparse search data is never turned into a confident “blue ocean” or “dead market” verdict.

For example, `ai4s` resolves to **AI for Science**. GitHub searches `ai4science`, `ai-for-science`, and `ai4s` separately and deduplicates returned repositories. Incomplete unions report a lower bound. Google Trends measures the full field name. Existing abbreviation-only reports keep their original evidence and offer a one-click rescan.

Scans show source progress and a preliminary result before optional project details finish. Interactive scans have priority over scheduled refreshes, and repository enrichment uses three bounded workers. Source rate limits can still increase latency. Without a model key, self-hosted scans use the built-in topic mappings. With a DeepSeek key, input normalization and a source-grounded product strategy are enabled.

The website supports **English and Simplified Chinese**, including report text, Markdown and PNG exports. It follows the browser language on first visit; the header switch saves your preference and preserves the current page. Add `?lang=zh` or `?lang=en` to open a specific language.

## Try it in 60 seconds

**No installation:** [ghtrends.dev/radar/](https://ghtrends.dev/radar). Browse public reports without signing in.

**CLI, local UI and MCP:** Node.js 22.13 or newer.

Launch without a global installation:

```sh
npx --yes --package=https://ghtrends.dev/radar/ghtrends.tgz ghtrends ui
```

Or install the CLI:

```sh
npm install -g https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.13.0/ghtrends-radar-0.13.0.tgz

ghtrends ui
ghtrends scan --topic mcp-server --json
ghtrends repo facebook/react
ghtrends compare facebook/react vuejs/core --format md
```

The release package is **ghtrends-radar**; the executable is **ghtrends**. The existing npm package named `ghtrends` belongs to a different project. This release is distributed through GitHub Releases.

## One engine, three ways to use it

- **Web:** search first, read public examples, and save reports and projects in **My research**. Select two to six repositories inside a report to compare them. The category map and detailed method are optional views. Saved projects refresh when opened; they do not send alerts. Share a report or export PNG, Markdown or JSON.
- **CLI:** scan a category, inspect a repository, maintain a persistent watchlist, compare repositories and generate a report.
- **MCP:** give your agent structured GitHub and search-demand evidence without leaving its workflow.

```sh
ghtrends scan --topic agent-memory --keyword "ai agent memory" --geo US
ghtrends scan --topic mcp-servers --report findings.md
ghtrends watch add facebook/react
ghtrends watch list
ghtrends watch run
ghtrends watch remove facebook/react
ghtrends report --topic coding-agents --format md
ghtrends compare facebook/react vuejs/core sveltejs/svelte --format json
ghtrends collect
ghtrends ui --port 3721 --no-open
ghtrends mcp
```

`scan` is a category scan. `report` formats the full available evidence, leading repositories, issue signals and limitations into a document. `watch run` performs one refresh; an external scheduler can run it periodically.

### MCP configuration

Install the release first, then add to your client's MCP configuration:

```json
{
  "mcpServers": {
    "ghtrends": {
      "command": "ghtrends",
      "args": ["mcp"]
    }
  }
}
```

Tools: `ghtrends_scan`, `ghtrends_repo`, `ghtrends_compare`, `ghtrends_watch_list`. Transport: stdio. Ask your agent: **“Compare active GitHub supply and search demand for agent memory. Show the evidence and its limits.”**

### Credentials and storage

Public GitHub requests work without credentials within GitHub's unauthenticated limits. For larger scans, configure **either** a token **or** your own GitHub App:

```sh
export GITHUB_TOKEN=your_token
# Or:
export GITHUB_APP_ID=your_app_id
export GITHUB_INSTALLATION_ID=your_installation_id
export GITHUB_PRIVATE_KEY_PATH=/secure/path/github-app.pem
```

The App installation token refreshes automatically. Only public repositories are returned. Never put credentials in source control or expose them in a browser.

- The release includes dated public starter snapshots so the local radar is useful on first launch. They retain their source dates; snapshots older than 14 days are reclassified as insufficient evidence until refreshed.
- SQLite defaults to `~/.ghtrends`; override with `GHTRENDS_DATA_DIR`.
- Hosted history and watchlists are saved by account in SQLite; self-hosted CLI, MCP and Web share the local workspace. Completed scans appear in My research.
- Anonymous Trends sessions first visit the Trends home page to obtain a session cookie, then use the JSON endpoints on the same proxy route. Session renewal happens every ten minutes; a sticky residential session of at least thirty minutes is suitable.
- `GOOGLE_TRENDS_PROXY` configures the primary HTTP(S) proxy. Optional `GOOGLE_TRENDS_PROXY_FALLBACK` adds one fixed backup in the same region. Each route keeps its own anonymous cookies, paced queue and persistent recovery window. A limited primary route triggers one complete attempt through the backup. Both routes cooling down yields the earliest recovery time; successful cached evidence remains available. Admin shows the route and cooling counts.
- Google Trends collection shares a paced queue (1.5 seconds between requests; `GHTRENDS_TRENDS_INTERVAL_MS` configures 1–10 seconds), and concurrent identical queries share a request. HTTP 429/403 pauses collection until `Retry-After` or a default 15-minute recovery window. Cooldown survives restarts, successful cached queries stay available, and a prior successful snapshot keeps its original date. The report displays the next refresh time.
- Google Trends web endpoints may rate-limit requests or change. Temporary connection/5xx errors get one bounded retry. Classification requires fresh, usable weekly evidence. Collection state and measured zero values have separate meanings; baseline claims require observed weekly data.
- Product copy and AI briefs use affirmative facts, current status and specific next actions. Saved narrative text is checked at display time; source evidence retains its original record.
- New signed-in hosted scans are private by default. Explicitly publish a report to share it; stop sharing to revoke future access. Someone who already downloaded a public report may keep their copy. Older anonymous reports remain public and cannot be assigned to an account automatically; save any accessible report to My research.

For reproducible imports:

```sh
ghtrends scan --topic mcp-servers --trends-file demand.json --json
```

`demand.json` follows `DemandEvidence` in `src/core/types.ts`: matching keyword and region, original Google Trends source URL, collection timestamp, weekly 0–100 observations, and optional anchor values. Partial weeks must be marked. Inputs are validated; daily data and missing weeks are not treated as weekly evidence.

## Hosted and self-hosted

| Capability | Hosted guest | Hosted signed in | Self-hosted |
|---|---|---|---|
| Public radar, reports, gaps, public exports | Yes | Yes | Yes |
| New scans and uncached repository comparisons | — | Yes, daily allowance | Yes, own provider limits |
| Persistent history and watchlist | — | Per account, across devices | Local SQLite workspace |
| Input normalization and brief | View existing public briefs | Server DeepSeek key | Optional own DeepSeek key |
| Private reports and opt-in public links | — | Yes | Access limited to your deployment |

**One codebase.** Self-hosting needs no login provider and no external database. Hosted mode requires sign-in for resource-consuming research and stores user/report ownership, history, watchlists, sessions and daily usage in SQLite. Single instance with a persistent data volume; back up with SQLite's backup API or while stopped, rather than copying a live WAL database file alone.

**Upgrade/rollback:** back up SQLite before upgrading. Versions before 0.3 do not enforce private-report ownership; never run them against a database containing private reports. Restore the pre-upgrade backup before such a rollback, and preserve the newer database separately.

Optional self-hosted AI configuration (server environment only):

```sh
export DEEPSEEK_API_KEY=your_deepseek_key
export DEEPSEEK_MODEL=deepseek-flash
ghtrends ui
```

The model proposes one primary Trends phrase, up to two genuine synonyms, and bounded GitHub topic/phrase queries. It also reviews project roles using quoted repository metadata; deterministic code calculates pressure and search direction. Ambiguous acronyms request clarification. It then develops one **product strategy to test** in English and Chinese. Market metrics remain a separate, deterministic layer. Use public research inputs: queries and bounded public-source excerpts go to DeepSeek, Google and GitHub as needed. Collected evidence remains readable during model recovery.

**The strategy process**

1. Read up to three relevant project READMEs and three individual issue excerpts.
2. Enable DeepSeek Flash thinking at high effort to identify a specific audience, causal mechanism, first useful artifact, deliberate tradeoff and critical assumption.
3. Check up to two targeted GitHub searches and two additional READMEs for existing implementations of the proposed idea. A second reasoning pass challenges duplication, factual support and the proposed adoption advantage. A bounded editing pass repairs wording or citation problems when needed.
4. Deliver one feasible experiment with proposed continue/redirect thresholds and links to the premise sources. Exact cited excerpts are checked against the supplied source text.

Sparse source coverage produces a **domain hypothesis**; document-grounded recommendations are labeled **source-led hypotheses**. Both represent research proposals. The interface shows source progress and preliminary measurements while the strategy develops. AI-enabled scans can proceed with available evidence during Trends cooldown, within the same account and attempt limits. Strategy generation, review and corrective editing are recorded separately in admin usage. Provider reasoning text stays outside stored reports. Results use a six-hour strategy cache; deeper analysis adds latency and model usage.

`PUBLIC_URL` may include a directory, for example `https://example.com/radar`. The same build supports both directory hosting and a local root URL. Forward that prefix unchanged to the server and configure the matching Logto callback.

**Access and research credits**

| Access | Included |
| --- | --- |
| Guest | Public reports, examples, methodology, and cached project evidence |
| Signed in | 10 research credits per UTC day, private saved history, sharing, and saved projects |
| Self-hosted | Own credentials and database; locally managed usage |

A fresh scan, project analysis, or comparison uses one credit. Cached results are free. The header, research form, and account menu show the balance and reset time in your timezone. A credit is reserved while research runs; collection issues and interrupted work return it exactly once, including after a server restart. Project and comparison collection starts through an explicit action protected by the session and CSRF token; opening a saved page reads cached evidence.

`GHTRENDS_DAILY_REQUESTS` bounds hosted collection attempts across accounts (default 200/day, including returned credits). Each account can attempt up to three times its daily credit allowance. One fresh research job per account runs at a time. Admin shows today's reserved, used and returned credits, the service budget, and the Trends connection/recovery status. `GOOGLE_TRENDS_PROXY` supports authenticated HTTP(S) proxies; `GHTRENDS_TRENDS_PROXY_REGION` supplies a safe region label. Proxy credentials stay server-side, and provider recovery windows apply to the fixed route.

For a public hosted instance configure `GHTRENDS_HOSTED=1`, HTTPS `PUBLIC_URL`, `LOGTO_ENDPOINT`, `LOGTO_APP_ID`, `LOGTO_APP_SECRET` and optionally `GHTRENDS_DAILY_SCANS` (default 10). Create a Traditional Logto application with `${PUBLIC_URL}/auth/callback` as its redirect. Keep GitHub/DeepSeek credentials in server secrets, never `VITE_*` or browser storage. OIDC uses PKCE, nonce/state and signed-token validation; the browser gets an HttpOnly, Secure session cookie. Personal mutations also require CSRF validation.

## Administration

The account menu contains the administrator entry. Anonymous daily counters show report reads, shares, exports and open-source entry clicks; completed user scans exclude scheduled collection. These are action counts, not unique visitors, installations or GitHub stars. Counters contain no query text or visitor identifiers, respect browser Do Not Track, share the operational retention period, and can be disabled with `GHTRENDS_ANALYTICS=0`. They are enabled only in hosted mode. Historical activity before this upgrade is unavailable.

`/admin` shows scan status, queue, source errors/latency, GitHub quota snapshots, accounts, and actual DeepSeek input/output/cache-token usage. Operational logs survive restarts; interrupted scans are marked interrupted. They retain 30 days by default (`GHTRENDS_LOG_RETENTION_DAYS`, 1–365). Saved reports have separate retention. No credential values, session tokens or private report bodies are returned by the admin API.

```sh
# Deployment-specific Logto user IDs, copied from the user's profile in Logto.
# These are immutable sub IDs, not usernames, emails or display names.
export GHTRENDS_ADMIN_USER_IDS=your_logto_user_id,another_logto_user_id
```

Restart after changing deployment configuration. There is no hosted administrator by default; the server checks the allowlist on every request. In local mode without Logto, the workspace owner has admin access—keep that unauthenticated server on loopback, or enable hosted authentication before publishing it.

AI usage recording begins at upgrade: earlier consumption is **unknown**. Missing usage on failed responses also stays unknown. Optional `GHTRENDS_LLM_PRICING_JSON` maps each requested model to USD per million token rates: `{"your-model":{"input":0.3,"cachedInput":0.006,"output":1.2}}` (illustration only, verify your provider's current prices). An optional `offPeakMultiplier` follows DeepSeek's Monday–Friday 01:00–04:00 / 06:00–10:00 UTC peak schedule. Omit it for flat pricing. Per-call estimates are saved at request time, exclude unpriced calls, and are **not invoices**. [Provider pricing](https://api-docs.deepseek.com/quick_start/pricing/) and [usage fields](https://api-docs.deepseek.com/api/create-chat-completion/).

With `DECODO_API_KEY` configured on the server, administration also shows the official residential plan balance, expiry and daily billed traffic. It refreshes every 15 minutes and retains the last successful reading during provider recovery. Separate HTTP measurements show compressed traffic per research run, request success and 429 counts by primary/backup route. These measurements begin at upgrade and cover HTTP payloads and headers; official provider accounting includes its own overhead and remains the billing reference. Proxy credentials and the management API key stay on the server.

## How the method works

### Competition pressure · method 2.0.0

GitHub searches use topics and specific name/description phrases. Initial coverage includes original, active repositories with at least **1 star and a push within 365 days**. Each query returns up to 100 leaders; overlapping results are deduplicated. An exact search count and an enumerated project sample are separate properties. Known categories keep their published query scope; compound requirements use topic intersections.

Projects are classified as **direct alternatives, adjacent integrations, resources, or awaiting review**. An optional model reviews the top 60 project descriptions in three bounded batches, with a verified verbatim source quotation for each accepted result. Successful batches remain useful when another batch needs source review. Invalid or ambiguous review items retain local metadata rules. Reports show every project's role, quote and review method. Direct alternatives are grouped by GitHub owner as a proxy for independent teams; each owner's strongest project contributes to three components:

- **Breadth, up to 50 points:** `50 × (1 − exp(−effectiveTeams / 12))`. Team weights combine log-scaled stars, forks and maintenance.
- **Established alternatives, up to 30 points:** `30 × (1 − exp(−2 × sum(maturity)))`. Maturity combines project age, stars, forks and maintenance.
- **Leading project strength, up to 20 points:** `20 × max(maturity)`. Top-three owner star share provides separate descriptive context.

The operational reference line is **45/100**, with lower confidence within 5 points. A lower bound at or above 45 supports established competition even from a partial sample. Limited competition requires complete enumeration of the displayed scope, at least one direct alternative, and an upper bound below 45 after including projects awaiting review. Truncated samples show `≥ score`; complete samples can show a role-uncertainty interval. Zero direct matches prompt further research. See [the exact weights and equations](src/core/competition.ts).

These versioned heuristics describe **observed open-source competition**. Stars indicate developer attention, forks indicate reuse, and owners approximate teams. Commercial products, customer adoption and willingness to pay deserve separate evidence. Broad fields and physical-product markets receive a field overview and guidance toward a concrete software workflow.

For sparse candidate results, DeepSeek can refine the search once using equivalent product names within the original task. Generic delivery words such as “app” can be omitted from exact GitHub phrases; subject and feature requirements remain explicit. The report retains original and added queries. Search evidence, competition coverage and the recommendation appear separately, so a useful observed signal leads to a concrete next step even while the landscape remains provisional.

### Search direction

Two years of Google Trends data provide 4-, 8- and 13-week comparisons. Each phrase is independently normalized for the same region and period. Primary-term fallback follows the planned synonym order and data quality. Values stay separate; opposite measured synonym directions display as mixed.

- Percentage direction requires 26 consecutive complete weeks, at least 60% positive values in that window, and a baseline median of at least 3. Completed weeks are checked against the source collection time.
- Rising/falling normally requires an 8-week median change of at least ±10%, an absolute change of at least 2 index points, a two-week-block resampling band on the same side of zero, and supporting 4-/13-week checks.
- Gradual change can qualify over 13 weeks when its percentage, absolute change and resampling band pass the same checks and shorter windows agree. The report names the direction basis.
- Recurring annual shapes require at least 40 date-paired weeks, correlation ≥0.75, and material rises and falls in both annual profiles using four-week block medians. Direction then uses the same eight weeks a year earlier. The recent-window percentage remains visible separately.
- A baseline below 3 can produce an **early rise** when at least six of eight weeks reach 10 and the final four-week median retains 80% of the preceding four. Its percentage stays empty and confidence stays low.
- Conflicting, rounded or sparse measurements retain a qualified direction. Collection gaps display recovery actions. Established competition can still support red-ocean guidance with a separate pending/mixed search status; growing-red and blue labels require usable rising search evidence.

The resampling bands diagnose stability. The overall opportunity score stays `null`; competition pressure has its own named scale. Confidence is capped at moderate; low evidence, boundary cases and early signals receive low confidence. Every report retains source dates, queries, roles and method version. Refreshing creates a new snapshot.

**Repository evidence:** official GitHub star-history calendar buckets, a bounded recent issue sample, human maintainer responses, and returned contributor commit counts. Calendar buckets are not rolling 24-hour net star changes. Contributor and issue sample limits appear beside the results. Open issues are leads for research, not proven market gaps.

**Reproducibility:** source evidence, analysis date and method version determine each report ID. Hosted report links are immutable snapshots. Local reports stay local unless you deliberately share them.

## Development

```sh
git clone https://github.com/noahbenjamin1994/ghtrends-radar.git
cd ghtrends-radar
npm ci
npm run check
npm run build
npm test
npm start
```

React + TypeScript + Vite for the UI; TypeScript core, Express, SQLite, Commander and the official MCP SDK. One package, no required database service, no required LLM key.

```sh
docker build -t ghtrends .
docker run --rm -p 3721:3721 -v ghtrends-data:/app/data \
  -e HOST=0.0.0.0 ghtrends
```

For a shared public instance, set `GHTRENDS_HOSTED=1` to keep the homepage restricted to curated categories; custom scans require sign-in and are saved as private personal reports. Search-term variants are stored separately and cannot replace canonical category evidence. Set `PUBLIC_URL` and optionally `GHTRENDS_AUTO_COLLECT=1`. Set `TRUST_PROXY` only to your actual trusted reverse-proxy network. The collector and public scan queue share a bounded, paced workflow. Public scans are rate limited; scheduled collection refreshes curated categories daily using source collection times. Recalculating a report does not postpone collection. Method upgrades invalidate old analysis caches.

## Contributing

Useful first contributions: improve keyword/topic mappings with evidence, add adversarial algorithm tests, document actual collection failures, and improve accessibility. Open an issue with the original source URLs and timestamps when a classification looks wrong. Run the checks above before submitting changes.

If ghtrends helps you find something worth building, share the report and star the project so you can find it again.

MIT. Not affiliated with GitHub or Google. Built with lessons from the existing trendscout project's Google Trends collection workflow.
