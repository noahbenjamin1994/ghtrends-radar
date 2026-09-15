<div align="center">

# ghtrends ↗

### Know where to build.

**GitHub supply × Google search demand.**
Find growing categories, inspect the competition, and share the evidence.

[Open the radar](https://radar.ghtrends.dev) · [Methodology](https://radar.ghtrends.dev/docs) · [Report a bug](https://github.com/noahbenjamin1994/ghtrends-radar/issues)

</div>

[![Build checks](https://github.com/noahbenjamin1994/ghtrends-radar/actions/workflows/check.yml/badge.svg)](https://github.com/noahbenjamin1994/ghtrends-radar/actions/workflows/check.yml)

[![The live ghtrends opportunity radar](.github/assets/radar-preview.png)](https://radar.ghtrends.dev)

## What does it tell you?

| Active open-source supply | Sustained search growth | Landscape |
|---|---|---|
| Few projects | Fast | **Early blue ocean** — investigate an underserved use case |
| Many projects | Fast | **Growth red ocean** — find a specific audience or advantage |
| Many projects | Not fast | **Established red ocean** — identify a reason people would switch |
| Few projects | Not fast | **Quiet waters** — validate whether it is early, niche or inactive |
| Missing or weak evidence | Unknown | **Uncharted** — gather evidence before classifying |

Every result includes its source queries, dates, methodology version and limitations. Category and report pages include readable HTML evidence before JavaScript loads, and shared links show the specific report in their previews. Search interest measures attention, not paying customers. A quadrant is a research starting point, not a prediction of commercial success.

## Try it in 60 seconds

**No installation:** [radar.ghtrends.dev](https://radar.ghtrends.dev).

**CLI, local UI and MCP:** Node.js 22.13 or newer.

Launch without a global installation:

```sh
npx --yes --package=https://radar.ghtrends.dev/ghtrends.tgz ghtrends ui
```

Or install the CLI:

```sh
npm install -g https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.1.4/ghtrends-radar-0.1.4.tgz

ghtrends ui
ghtrends scan --topic mcp-server --json
ghtrends repo facebook/react
ghtrends compare facebook/react vuejs/core --format md
```

The release package is **ghtrends-radar**; the executable is **ghtrends**. The existing npm package named `ghtrends` belongs to a different project. This release is distributed through GitHub Releases.

## One engine, three ways to use it

- **Web:** interactive opportunity map, category evidence, repository history, comparisons and browser-local watchlists. Export PNG, Markdown or JSON. Embed a permanent report card in a README.
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
- CLI watchlists are stored in SQLite. Hosted Web watchlists are stored only in the current browser; they are not synchronized with the CLI.
- `GOOGLE_TRENDS_PROXY` optionally configures an HTTP proxy for the public Trends collector.
- Google Trends web endpoints are unofficial and may rate-limit requests or change. Failed collection is shown explicitly. A previous successful snapshot keeps its original timestamp; stale or insufficient evidence cannot produce a fresh classification.
- Queries made through the public website are shared public reports. Do not put secrets into search terms.

For reproducible imports:

```sh
ghtrends scan --topic mcp-servers --trends-file demand.json --json
```

`demand.json` follows `DemandEvidence` in `src/core/types.ts`: matching keyword and region, original Google Trends source URL, collection timestamp, weekly 0–100 observations, and optional anchor values. Partial weeks must be marked. Inputs are validated; daily data and missing weeks are not treated as weekly evidence.

## How the method works

**Supply:** GitHub topic search; non-fork, non-archived repositories with at least 5 stars and a push in the last 180 days. At least 50 qualifying repositories is the current dense-supply rule. Counts refer to a topic-defined category, not a census of every competing product. We use the search count and display up to 100 leaders; we do not claim to enumerate beyond GitHub's search result limit.

**Demand:** two years of Google Trends data, measured alongside `github trending` in the same request. The last 8 complete weeks are compared with the preceding 8 using medians. Fast growth requires all of:

1. At least 26 consecutive weekly observations and sufficient nonzero data.
2. A prior median of at least 3 to avoid division by a near-zero baseline.
3. At least 25% median growth.
4. A positive lower bound under deterministic two-week block resampling.
5. At least 6 of 8 recent weeks above 112.5% of the prior median.
6. No identified repeat of the previous year's seasonal level.

Missing, stale, irregular, near-zero or failed evidence produces **Uncharted**. A single spike cannot establish fast growth. The resampling band tests stability; it is not a calibrated probability. The 50-project threshold and opportunity-score weights are published heuristics that still require empirical calibration across categories.

**Repository evidence:** official GitHub star-history calendar buckets, a bounded recent issue sample, human maintainer responses, and returned contributor commit counts. Calendar buckets are not rolling 24-hour net star changes. Contributor and issue sample limits appear beside the results. Open issues are leads for research, not proven market gaps.

**Reproducibility:** source evidence and the method version determine each report ID. Hosted report links are immutable snapshots. Local reports stay local unless you deliberately share them.

## Development

```sh
git clone https://github.com/noahbenjamin1994/ghtrends-radar.git
cd ghtrends-radar
npm ci
npm run check
npm test
npm run build
npm start
```

React + TypeScript + Vite for the UI; TypeScript core, Express, SQLite, Commander and the official MCP SDK. One package, no required database service, no required LLM key.

```sh
docker build -t ghtrends .
docker run --rm -p 3721:3721 -v ghtrends-data:/app/data \
  -e HOST=0.0.0.0 ghtrends
```

For a shared public instance, set `GHTRENDS_HOSTED=1` to keep the homepage restricted to curated categories; custom scans still get permanent report URLs. Search-term variants are stored separately and cannot replace canonical category evidence. Set `PUBLIC_URL` and optionally `GHTRENDS_AUTO_COLLECT=1`. Set `TRUST_PROXY` only to your actual trusted reverse-proxy network. The collector and public scan queue share a bounded, paced workflow. Public scans are rate limited; scheduled collection refreshes curated categories daily.

## Contributing

Useful first contributions: improve keyword/topic mappings with evidence, add adversarial algorithm tests, document actual collection failures, and improve accessibility. Open an issue with the original source URLs and timestamps when a classification looks wrong. Run the checks above before submitting changes.

If ghtrends helps you find something worth building, share the report and star the project so you can find it again.

MIT. Not affiliated with GitHub or Google. Built with lessons from the existing trendscout project's Google Trends collection workflow.
