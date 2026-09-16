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

| Search direction | Active open-source supply | Interpretation |
|---|---|---|
| Rising | Few matching projects | Investigate a specific underserved use case |
| Rising | Established supply | Compare workflows, audiences and switching costs |
| Stable / falling | Any | State the measured direction; do not infer a commercial “red ocean” |
| Conflicting / insufficient | Any | Explain the known facts and the next validation step |

Every result includes its source queries, dates, methodology version and limitations. Category and report pages include readable HTML evidence before JavaScript loads, and shared links show the specific report in their previews. Search interest measures attention, not paying customers. A quadrant is a research starting point, not a prediction of commercial success.

## A useful answer when the data is thin

A scan gives an evidence-based recommendation even when a reliable quadrant cannot be established. It separates known facts, an initial recommendation, and the next validation steps. Sparse search data is never turned into a confident “blue ocean” or “dead market” verdict.

For example, `ai4s` resolves to **AI for Science**. GitHub searches `ai4science`, `ai-for-science`, and `ai4s` separately and deduplicates returned repositories. Incomplete unions report a lower bound. Google Trends measures the full field name. Existing abbreviation-only reports keep their original evidence and offer a one-click rescan.

Scans show source progress and a preliminary result before optional project details finish. Interactive scans have priority over scheduled refreshes, and repository enrichment uses three bounded workers. Source rate limits can still increase latency. Without a model key, self-hosted scans use the built-in topic mappings. With a DeepSeek key, input normalization and a short evidence-based brief are enabled.

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
npm install -g https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.6.0/ghtrends-radar-0.6.0.tgz

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
- `GOOGLE_TRENDS_PROXY` optionally configures an HTTP proxy for the public Trends collector.
- Google Trends web endpoints are unofficial and may rate-limit requests or change. Failed collection is shown explicitly. A previous successful snapshot keeps its original timestamp; stale or insufficient evidence cannot produce a fresh classification.
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

The model proposes one primary Trends phrase, up to two genuine synonyms, and bounded GitHub topic/phrase queries. Ambiguous acronyms request clarification. It then summarizes **collected evidence** in English and Chinese; it does not calculate or override metrics. Queries go to DeepSeek, Google and GitHub as needed. Do not enter secrets. A failed brief leaves the source report usable.

`PUBLIC_URL` may include a directory, for example `https://example.com/radar`. The same build supports both directory hosting and a local root URL. Forward that prefix unchanged to the server and configure the matching Logto callback.

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

## How the method works

**Supply:** GitHub topic and repository-name/description phrase searches (each query is displayed); non-fork, non-archived repositories with at least 5 stars and a push in the last 180 days. At least 50 qualifying repositories is the current dense-supply rule. Counts refer to the displayed search scope, not a census of every competing product. We use the search count and display up to 100 leaders; we do not claim to enumerate beyond GitHub's search result limit.

**Search interest (method 1.2.0):** two years of Google Trends data. Compare the median of the last 8 complete weeks with the previous 8; check 4-week and 13-week comparisons as well. Each term is independently normalized in the same region/time range, preventing a popular synonym from rounding a niche one to zero in a comparison. If the primary has unusable evidence, select the first usable same-intent variant in the planned order and show the reason. We never sum indices or select by growth direction.

- Require the most recent 26 weeks to be consecutive and complete (older gaps do not invalidate this window), at least 60% nonzero values in the most recent 26 weeks, and a prior median of at least 3.
- Rising/falling requires at least ±10% eight-week change, a resampling band entirely on the same side of zero, and no opposing short or longer change of more than 10%.
- Stable requires less than 10% eight-week change and less than 20% four/thirteen-week change. Other usable cases or fresh, opposite-moving synonyms are **mixed**.
- Missing, stale, irregular, near-zero or failed evidence stays **uncertain**. A week must have ended when collected; conflicting values prevent classification. The resampling band is a stability diagnostic, not a probability of success.

The raw legacy `fast` field still describes a stricter 25% breakout diagnostic; the displayed direction and classification use `metrics.trend`. “50 repositories” is a published scope-dependent heuristic, **not proof of commercial competition**. Google search attention is **not customer demand growth**. Source dates, the actual terms and limits are shown alongside every result.

The same-period comparison uses timestamps 52 weeks apart, rather than row positions. A recent pullback above last year's level and a recovery below last year's level receive distinct context. Neither proves seasonality. The uncalibrated opportunity score has been removed (`score: null`); results sort by measured search change or update date. Confidence is capped at moderate because data coverage cannot establish intent match or customer demand. Older report links retain their snapshot and show an upgrade prompt.

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
