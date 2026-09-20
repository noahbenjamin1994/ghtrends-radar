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

| Landscape         | Search direction                   | Observed competition                  | Starting strategy                                                  |
| ----------------- | ---------------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Blue ocean        | Rising                             | Limited, covered search results       | Validate a focused use case                                        |
| Growing red ocean | Rising                             | Established alternatives              | Find a specific audience or advantage                              |
| Red ocean         | Stable / falling / mixed / pending | Established alternatives              | Find a reason users would switch; inspect search status separately |
| Quiet ocean       | Stable / falling                   | Limited, covered search results       | Validate a focused niche                                           |
| Needs validation  | Any                                | Coverage or project roles need review | Inspect measured facts and complete the highlighted evidence       |
| Field overview    | Measured separately                | Several workflows or a broader market | Choose one software task for the next scan                         |

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
npm install -g https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.21.1/ghtrends-radar-0.21.1.tgz

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

| Capability                                    | Hosted guest                | Hosted signed in            | Self-hosted                       |
| --------------------------------------------- | --------------------------- | --------------------------- | --------------------------------- |
| Public radar, reports, gaps, public exports   | Yes                         | Yes                         | Yes                               |
| New scans and uncached repository comparisons | —                           | Yes, daily allowance        | Yes, own provider limits          |
| Persistent history and watchlist              | —                           | Per account, across devices | Local SQLite workspace            |
| Input normalization and brief                 | View existing public briefs | Server DeepSeek key         | Optional own DeepSeek key         |
| Private reports and opt-in public links       | —                           | Yes                         | Access limited to your deployment |
| Personal direction ranking                    | —                           | Free, with request limits   | Own DeepSeek key                  |

**One codebase.** Self-hosting needs no login provider and no external database. Hosted mode requires sign-in for resource-consuming research and stores user/report ownership, history, watchlists, sessions and daily usage in SQLite. Single instance with a persistent data volume; back up with SQLite's backup API or while stopped, rather than copying a live WAL database file alone.

**Upgrade/rollback:** back up SQLite before upgrading. Versions before 0.3 do not enforce private-report ownership; never run them against a database containing private reports. Restore the pre-upgrade backup before such a rollback, and preserve the newer database separately.

Optional self-hosted AI configuration (server environment only):

```sh
export DEEPSEEK_API_KEY=your_deepseek_key
export DEEPSEEK_MODEL=deepseek-flash
ghtrends ui
```

The model proposes one primary Trends phrase, up to two genuine synonyms, and bounded GitHub topic/phrase queries. It also reviews project roles using quoted repository metadata; deterministic code calculates pressure and search direction. Ambiguous acronyms request clarification. It then maps **3–5 distinct opportunity directions** in English and Chinese, with one prioritized strategy to test. Market metrics remain a separate, deterministic layer. Use public research inputs: queries and bounded public-source excerpts go to DeepSeek, Google, DuckDuckGo and GitHub as needed. Collected evidence remains readable during model recovery.

**Find the directions that fit you.** On a report with researched directions, choose your experience, available time and goal. The model ranks the existing directions and explains the fit plus a small first step for each. This uses zero research credits and shares the scope-preparation request budget. The selected profile and recommendations stay private, are restored on return, and are retained for 30 days; Markdown export is available. Public reports and their demand/competition evidence keep their original content. The configured research model receives the profile and relevant report proposals; use research-appropriate context. Generation uses disabled thinking and bounded, targeted repairs; admin records it as personal direction ranking.

**The strategy process**

1. Select up to four relevant project READMEs across distinct user jobs, their latest published release notes, and three individual issue excerpts. Historical reports also filter adjacent-object Issues at display time. Request cards show who needs what, a possible contribution, source dates and the latest observed status. Expand a card to read the current workaround, desired outcome, verification step and original quote. Completed requests point to existing progress. Recent requests appear alongside highly discussed ones; repeated links and identical requests from the same identified author are merged. Broad fields retain their full original scope alongside open-source directions.
2. Use light reasoning to answer the original topic first: overall opportunity, demand drivers, competition, entry conditions and evidence coverage. Then map distinct customer jobs: typically five for a broad field and three for a narrow product. Every direction opens with a plain-language name, customer, need and offered service, followed by demand, competition, resources, a first-release estimate, upkeep and a concrete experiment. Broad consumer fields span multiple lifecycle stages; source availability guides evidence confidence while preserving the original scope.
3. The first pass produces a compact English research blueprint. Check each direction with one targeted GitHub repository search, up to one README and one issue search (up to three excerpts), using two source workers. An evidence editor then turns the blueprint and collected sources into the full bilingual report; a bounded editing pass repairs wording or citations. Directions, the priority strategy and the market overview have separate, bounded output budgets.
4. Show source signals separately from research inference. Parent-query search growth stays separate from direction-level demand. Project features establish supply; observed demand needs relevant user-request evidence. Strong demand requires multiple request sources and model review of their relevance. Limited search coverage keeps competition estimates provisional.
5. Develop the selected direction in depth with a causal mechanism, tradeoff, critical assumption and proposed continue/redirect criteria. Exact cited excerpts and direction IDs are checked. All directions appear in the interactive report, Markdown, JSON and server-rendered HTML. Old single-strategy reports remain readable.

Sparse source coverage produces a **domain hypothesis**; document-grounded recommendations are labeled **source-led hypotheses**. Both represent research proposals. The interface shows source progress and preliminary measurements while the strategy develops. AI-enabled scans can proceed with available evidence during Trends cooldown, within the same account and attempt limits. A compact reasoning blueprint is followed by separately validated bilingual directions and an overall judgment; direction writing runs with two requests at a time. Completed sections are cached. Strategy generation, direction/overall writing and corrective editing are recorded separately in admin usage. Provider reasoning text stays outside stored reports. Results use a six-hour strategy cache; deeper analysis adds latency and model usage.

`PUBLIC_URL` may include a directory, for example `https://example.com/radar`. The same build supports both directory hosting and a local root URL. Forward that prefix unchanged to the server and configure the matching Logto callback.

**Account and credits:** `/account` separates daily research, the introductory focused research and purchased packs. Hosted operators can connect Nexus with the server-only `GHTRENDS_NEXUS_URL`, `GHTRENDS_NEXUS_PROJECT_ID` and `GHTRENDS_NEXUS_PROJECT_KEY`. The account reads purchase confirmations, per-purchase expiry and credit activity through the authenticated backend. Entries distinguish reservation, completion, release, expiry and purchase adjustments. A temporary connection issue shows a sync message and the previous record timestamp. Purchased-task admission uses its own deployment flag, described below; set `GHTRENDS_CASHIER_URL` and `GHTRENDS_RESEARCH_PLAN_ID` to show the server-configured purchase link.

**Focused research preview**

Set `GHTRENDS_DEEP_RESEARCH=1` with a research model key to try the private, selected-direction workflow. Open a report direction and choose one question: compare other products, scope a first release, build on open source, or find the first users. Optional personal-fit conditions travel with the task. Targeted searches, current project requests and original documents support a compact bilingual decision brief. Facts, proposals, resource estimates and source quotes stay distinct.

Hosted accounts receive one introductory focused-research credit for the account's lifetime. Starting a task reserves it; complete delivery uses it; partial delivery or a restart returns it. This balance is separate from daily standard research. Self-hosted tasks use the operator's provider keys. Requests are idempotent and tasks survive navigation and restarts; a partial task can resume up to three total attempts. Account attempts are capped at three per UTC day; `GHTRENDS_DEEP_DAILY_REQUESTS` sets daily new-task capacity (default 20). Admitted tasks can resume within their daily attempt budget when new-task capacity is full; attempts are counted on their actual UTC date. Reading and exporting consume zero research credits. Private history supports Markdown/JSON export and content deletion; minimal usage records retain attempt counts and used-credit status. The preview remains separately configurable while quality and cost evaluation proceeds; the hosted service offers an optional one-time research pack.

Query planning, drafting and wording repair use disabled thinking. Focused semantic review uses low-effort thinking by default; set `GHTRENDS_DEEP_REVIEW_THINKING=off` for an explicit cost/quality comparison. Source statements and proposed implications are shown separately, and effort uses one numeric person-hour range in both languages. Each focused brief selects 2–4 findings that support the chosen question. New focused briefs share the numeric pilot contract with standard reports: participant and task counts generate both languages’ decision thresholds. Project-use notices from cited repositories appear beside resources and in Markdown exports. Wording edits use both language versions to preserve decision thresholds, roles and attribution; quotations retain their original wording, including when shortened. The application accepts only requested field edits. Revision review receives the previous corrections and before/after values, while exact quotes receive a separate check. A thinking review that reaches its output limit or returns a malformed response gets at most one non-thinking review with the same source and delivery checks. Provider rate limits remain recoverable task errors. Material correction proposals receive a separate source check before editing. Writing and review use the same bounded evidence set. Valid drafts persist across review interruptions; resuming reuses the draft when its sources and user constraints match. Drafts and internal review notes stay server-side. Repository license reads preserve up to 20,000 characters and identify truncated excerpts; code permissions and data reuse terms are separate checks. Original-source gaps remain visible alongside saved evidence, with the introductory credit returned. All collected excerpts and optional background are research inputs to the configured model.

**Purchased research**

Hosted operators can set `GHTRENDS_PAID_RESEARCH=1` after configuring Nexus and focused research. The UI uses the introductory credit first, then shows the purchased balance and an explicit one-credit confirmation. Each account can have one active research task. Purchased research has a separate daily new-task capacity (`GHTRENDS_PAID_DEEP_DAILY_REQUESTS`, default 20) and an account attempt budget (`GHTRENDS_PAID_DEEP_DAILY_ATTEMPTS`, default 10). Each research still allows three attempts.

Tasks are saved before admission; the credit is reserved when execution begins. Queued tasks can be canceled. Complete delivery and its settlement intent commit together in SQLite; interruptions release the original purchase reservation, retaining its expiry date. Recovery retries use the same Nexus receipt, including after a lost response or restart. Deleting research content preserves pending financial recovery. The administrator panel shows active settlements and records requiring ledger review. Execution checkpoints are bounded to 15 minutes within a one-hour reservation. This implementation targets one persistent application instance; the hosted service offers 10 focused studies for US$19.90, valid for 90 days from receipt, with tax shown at checkout. Paddle handles one-time payment. The live account flow and canceled-order callbacks have been verified; completed purchases and refunds were verified in Paddle sandbox. Research quality and same-version cost benchmarking continue separately.

**Original text and licenses**

GitHub direction searches match issue titles and bodies, ordered by relevance. README and release excerpts contain publisher text; publication dates, request states and review guidance remain separate. A repository name used as a citation ID is recoverable only when its exact quote uniquely matches a collected source from that same repository.

Focused research reads relevant Markdown sections from the selected project's README and release notes within the existing excerpt budget. Within its four-domain original-page budget, documentation links matching the selected direction take priority over general comparison articles; public discussion priority and each page's provenance remain intact. URL and term matching guide reading order; source authority and factual support still require review. Pages use gzip, Brotli or deflate when offered. Both wire traffic and decoded content are capped at 2 MB; retained excerpts stay within 6,000 characters, with truncation marked. The introduction and selected original spans retain their source URL and collection date; omission markers and truncation metadata describe partial coverage. Markdown code blocks, inline code and autolinks survive presentation cleanup, including shell redirection syntax.

Focused research also reads up to two selected GitHub issue threads. It keeps one early and two later public comment excerpts per thread, with dates, original links, account deduplication keys and project-association metadata. Thread message totals, included comments and distinct sampled accounts stay separate in saved sources. Focused writing receives the original messages, roles and dates; collection totals stay outside its evidence quotations. Large threads use the first and last reported pages (up to 30 comments each); read failures and partial coverage remain visible. Invitations are proposed from specific user experiences, while project replies provide context and capability checks.

New research selects original pages from up to four domains already observed in organic search. Publisher pages, individual Hacker News discussions and GitHub Discussions retain their source identity. Hacker News uses its official public API and reads at most three direct comments per topic. GitHub Discussions are read from observed links, with accepted answers retained; the backend GitHub credential needs the relevant read permission. Up to two selected repositories contribute their license files for checking attribution, distribution, source-disclosure and third-party conditions.

The report's “Original text and licenses” section keeps collection dates, excerpts and reading status, also included in Markdown, JSON and static HTML. Publisher pages describe publisher claims; discussions describe individual experiences. Page reads respect robots.txt, bound redirects, time and size, and pin connections to checked public addresses. Transient connection failures receive one retry within the shared 20-second collection deadline, respecting crawl delays. Every attempt appears in provider usage; access, size, certificate and format failures retain their reading status. Original text is cached for one hour; restricted pages retain the search excerpt and reading status. Public-page requests use a separate transport; backend identity credentials go only to the fixed GitHub API. Set `GHTRENDS_SOURCE_DOCUMENTS=0` to disable this layer. Reddit and X body integrations follow each platform's authorization requirements.

**Web search (optional)**

The default `GHTRENDS_SEARCH_MODE=direct` reuses `GOOGLE_TRENDS_PROXY` and its fallback. A lightweight Google mobile-page request uses `curl_cffi` with a matching browser connection profile. Docker bundles the Python transport; source/npm installs can use `python3 -m venv .venv-search`, `.venv-search/bin/pip install curl_cffi==0.16.3`, then set `GHTRENDS_SEARCH_PYTHON` to that environment’s Python path. `GOOGLE_SEARCH_PROXY` and `GOOGLE_SEARCH_PROXY_FALLBACK` optionally select dedicated routes. Each search fetches a single page. Decodo’s port 7000 uses rotating exits for these requests while preserving country targeting; Trends retains its sticky sessions. Search sends only a fixed consent preference and uses the existing residential traffic balance. The optional `api` mode uses `DECODO_SCRAPER_TOKEN` and a separate managed-search entitlement; `off` disables search.

A scan runs up to three first-page queries: commercial alternatives, user problems and open-source assets. Direct mode gives Google one fresh-exit retry, then uses DuckDuckGo Lite with one bounded retry. Fixed routes are attempted once per engine; rotating exits retain configured country targeting. Up to four requests share a 45-second query budget, with an 18-second maximum per request. A challenged engine pauses for five minutes independently of the other engine. Google results are cached for six hours; fallback results for 30 minutes. Each query keeps its actual engine and original collection time, including cached results. DuckDuckGo contributes organic results; Google ad coverage stays separate. Query, region, collection date, links, snippets and organic/ad labels are retained. Worldwide reports request US search settings; other regions use the selected engine’s supported market settings or worldwide results. Only bounded excerpts enter AI research, while credentials remain on the server. Admin records search calls, cache reuse, latency and failures separately; measured direct-request HTTP bytes join residential usage. Lightweight Google pages have limited ad-slot coverage. Reports distinguish this from a captured full ad sample with zero observed ads, including older saved reports. A collapsible, dated CRM browser example shows real HubSpot and Zendesk ad cards separately from each topic’s evidence and scoring. Google Search and Ads Transparency Center links support manual checks; advertised brands, legal payer identities and keyword appearances remain separate facts. Automated full-browser ad collection remains a separate integration.

Reports separate open-source projects, commercial competitors and observed ads. Projects show activity, age and community data. Competitors show who they serve, source-backed pricing or buyback quotes, existing advantages and possible openings. Audience and pricing facts carry individual quotes; trade-in payouts keep their eligibility and device scope. Ads show the destination website, copy, landing page, query and region. Advertiser identity, spend, clicks and conversions require additional evidence. Model inputs prioritize independent websites, then fill remaining slots with same-site pages, with up to four organic and two ad sources per query, plus up to two pricing pages for the competition query.

The report combines Trends, commercial alternatives and the open-source ecosystem. The **research landscape** adds blue-ocean candidates, growing red oceans, red oceans, quiet oceans and an opportunity watch. This qualitative assessment keeps the measured GitHub quadrant intact. Ads indicate marketing intent; direct user behavior supports demand judgments. Incumbent analysis explains data, distribution, ecosystem or switching barriers. Search ranks and project stars describe their own sample. Open-source directions cite a concrete project and explain the complementary contribution and license check.

Light reasoning produces a compact blueprint; direct generation writes concise bilingual direction, priority and overall sections. Each section is validated and cached. A final review checks source scope, actual capabilities, proposed services and bilingual meaning; oversized passages receive targeted edits. Issue interpretations use only supplied request sources. Admin records the usage of each step.

Community readings distinguish specific requests and user experiences from existing-workaround advice and author promotion. Advice and promotion remain source context and contribute zero demand votes or demand cards, including duplicate retrievals of the same comment. Research proposals state skills, permissions, recruiting access and participants as requirements, preserving source dates, versions and testing restrictions.

A mistaken citation ID can be repaired by selecting from supplied sources containing its exact quotation; valid citations and source text stay fixed. Unsupported references continue through quality checks.

Section format or output-budget errors get one bounded direct-generation recovery for that section; completed sections retain their cached results. Evidence review and community reading may recover once with thinking disabled after an output-budget or format failure. Provider throttling and network failures keep their existing recovery path. Citation length repair preserves source identities and verbatim quotations with the actual field limit.

Authored prose is checked for clear English/Chinese language swaps and repaired with its paired meaning; source quotes retain their original language. Request interpretations preserve the author’s stated workaround and treat vendor code, permissions and device access as prerequisites for proposed contributions.

The recommended direction has one shared pilot definition: recruitment, task, time window, measurement and proposed continue/redirect criteria. The report summary, direction card and exports derive their experiment text from that definition. Review edits apply to the shared fields; source quotations and other directions stay independent.

The recommended pilot uses shared numeric counts for people, tasks per person and qualifying outcomes. The application checks the denominators and generates equivalent continue/redirect criteria in both languages, with an intermediate range for further evidence. Pilot authoring uses a separate short call with bounded original evidence and thinking disabled. Source-backed project-use notices also appear beside resources and first-release scope, and in text/Markdown exports. These observations support checking the actual license and permissions for the proposed reuse.

Before writing directions, a compact capability audit checks original project/product documents. It retains exact feature and constraint quotes, separates proposed additions from existing functions, and records code/data permissions, compatibility and access checks. Search snippets remain discovery leads. The audit runs with thinking disabled, allows one bounded correction and is stored with the report for inspection. A pending evidence review keeps delivery in the source-recovery flow.


Community-request readings, extraction and report writing use direct generation. Direction selection and final evidence review retain light reasoning; configure it separately with `GHTRENDS_RESEARCH_REVIEW_THINKING=low|off`. `GHTRENDS_RESEARCH_THINKING=low` is the default for blueprints; setting it to `off` also turns review off when its separate setting is omitted. Independent report sections run two at a time. Both report types stream live research activity, with polling recovery through proxies; the feed shows actual request/output/completion states while prompts, draft JSON and reasoning text stay on the server. Complete quotations, scope checks and bilingual validation remain in the delivery gate. Admin shows the final-review policy and reasoning tokens as part of total output.

Reports include an optional progress check-in: useful insight, a request for more detail, a chosen direction, a changed plan or a completed validation. Signed-in users can save a note (up to 500 characters), edit or delete it, and export their feedback from Account. These records stay separate from shared reports and model inputs; only the author and deployment administrators can read them. Removing a report from history or deleting focused research also removes that author’s related feedback. Admin counts unique people separately from responses and internal testing; feedback timestamps record submission, with user interviews and observed behavior providing additional validation.

**Access and research credits**

| Access      | Included                                                                            |
| ----------- | ----------------------------------------------------------------------------------- |
| Guest       | Public reports, examples, methodology, and cached project evidence                  |
| Signed in   | 10 research credits per UTC day, private saved history, sharing, and saved projects |
| Self-hosted | Own credentials and database; locally managed usage                                 |

A fresh scan, project analysis, or comparison uses one credit. Cached results are free. The header, research form, and account menu show the balance and reset time in your timezone. A credit is reserved while research runs; collection issues and interrupted work return it exactly once, including after a server restart. Project and comparison collection starts through an explicit action protected by the session and CSRF token; opening a saved page reads cached evidence.

`GHTRENDS_DAILY_REQUESTS` bounds hosted collection attempts across accounts (default 200/day, including returned credits). Each account can attempt up to three times its daily credit allowance. One fresh research job per account runs at a time. Admin shows today's reserved, used and returned credits, the service budget, and the Trends connection/recovery status. `GOOGLE_TRENDS_PROXY` supports authenticated HTTP(S) proxies; `GHTRENDS_TRENDS_PROXY_REGION` supplies a safe region label. Proxy credentials stay server-side, and provider recovery windows apply to the fixed route.

Before collection, the web app prepares a research scope for confirmation. Greetings and placeholder text receive immediate guidance; ambiguous terms offer specific meanings. Scope preparation is free and has its own request budget. Confirmed scopes are bound to the account, input, region and search phrase for ten minutes. A temporary model outage offers an original-phrase scope for explicit confirmation. Brief connection interruptions keep the research task open and reconnect automatically. Administrators can identify preparation requests separately from research runs.

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
