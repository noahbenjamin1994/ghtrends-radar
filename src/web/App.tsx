import React, { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Search,
  SlidersHorizontal,
  Download,
  Star,
  Terminal,
  ChevronDown,
  Globe2,
  Radio,
  ScanLine,
  GitCompareArrows,
  Bookmark,
  BookOpen,
  X,
  ExternalLink,
  Check,
  RefreshCw,
  Activity,
  Info,
  Menu,
} from "lucide-react";
import type { Market, Repo, Topic, Gap } from "../core/types.js";
import {
  Logo,
  Radar,
  ComparisonChart,
  Pill,
  Growth,
  Sparkline,
  CopyButton,
  RepoRow,
  Empty,
  Loading,
  number,
  pct,
  kindLabels,
  kindColors,
} from "./components.js";
import { downloadCard } from "./export.js";
const SOURCE = "https://github.com/noahbenjamin1994/ghtrends-radar";
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const r = await fetch(url, options);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "The request could not be completed.");
  return d as T;
}
function readWatch(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem("ghtrends:watch") || "[]");
    return Array.isArray(v)
      ? v.filter((x) => typeof x === "string").slice(0, 50)
      : [];
  } catch {
    return [];
  }
}
export function App() {
  const [path, setPath] = useState(location.pathname + location.search),
    [markets, setMarkets] = useState<Market[]>([]),
    [topics, setTopics] = useState<Topic[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [keyword, setKeyword] = useState(""),
    [geo, setGeo] = useState(
      new URLSearchParams(location.search).get("geo") || "",
    ),
    [sort, setSort] = useState("opportunity"),
    [filter, setFilter] = useState("all"),
    [watch, setWatch] = useState(readWatch),
    [mobileMenu, setMobileMenu] = useState(false);
  const [job, setJob] = useState<{
      id: string;
      state: string;
      topic: string;
    } | null>(null),
    [scanning, setScanning] = useState(false),
    [scanError, setScanError] = useState("");
  const navigate = (input: string) => {
    const url =
      geo && input.startsWith("/market/") && !input.includes("?")
        ? input + "?geo=" + geo
        : input;
    history.pushState({}, "", url);
    setPath(url);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const pop = () => {
      setPath(location.pathname + location.search);
      setGeo(new URLSearchParams(location.search).get("geo") || "");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const refresh = () => {
    setLoading(true);
    return api<{ markets: Market[]; topics: Topic[] }>(
      "/api/markets?geo=" + geo,
    )
      .then((d) => {
        setMarkets(d.markets);
        setTopics(d.topics);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden)
        api<{ markets: Market[]; topics: Topic[] }>("/api/markets?geo=" + geo)
          .then((d) => {
            setMarkets(d.markets);
            setTopics(d.topics);
          })
          .catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [geo]);
  const toggleWatch = (name: string) =>
    setWatch((previous) => {
      const next = previous.includes(name)
        ? previous.filter((x) => x !== name)
        : [...previous, name].slice(-50);
      localStorage.setItem("ghtrends:watch", JSON.stringify(next));
      return next;
    });
  const scan = async (input: string) => {
    if (!input.trim()) return;
    setScanning(true);
    setScanError("");
    try {
      const d = await api<any>("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: input,
          geo,
          keyword: keyword.trim() || undefined,
        }),
      });
      if (d.state === "complete") {
        await refresh();
        navigate("/report/" + d.market.id);
        setScanning(false);
      } else setJob(d);
    } catch (e) {
      setScanError((e as Error).message);
      setScanning(false);
    }
  };
  useEffect(() => {
    if (!job) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api<any>("/api/jobs/" + job.id);
        if (stop) return;
        if (d.state === "complete") {
          setJob(null);
          setScanning(false);
          await refresh();
          navigate("/report/" + d.market.id);
          return;
        }
        if (d.state === "failed") {
          setScanError(d.error || "Scan failed.");
          setJob(null);
          setScanning(false);
          return;
        }
        setJob((j) => (j ? { ...j, state: d.state } : null));
        timer = setTimeout(poll, 3000);
      } catch (e) {
        if (!stop) {
          setScanError((e as Error).message);
          setJob(null);
          setScanning(false);
        }
      }
    };
    timer = setTimeout(poll, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [job?.id]);
  const route = path.split("?")[0]!;
  const active = route.startsWith("/compare")
    ? "compare"
    : route.startsWith("/watch")
      ? "watch"
      : route.startsWith("/docs")
        ? "docs"
        : route.startsWith("/gaps")
          ? "gaps"
          : "radar";
  const shown = markets
    .filter(
      (m) =>
        (filter === "all" || m.kind === filter) &&
        (!query || m.topic.name.toLowerCase().includes(query.toLowerCase())),
    )
    .sort((a, b) =>
      sort === "growth"
        ? (b.metrics.growth ?? -Infinity) - (a.metrics.growth ?? -Infinity)
        : (b.score ?? -1) - (a.score ?? -1),
    );
  const unscanned = topics.filter(
    (t) => !markets.some((m) => m.topic.slug === t.slug),
  );
  const total = markets.reduce((s, m) => s + m.supply.total, 0),
    latest = markets
      .map((m) => m.asOf)
      .sort()
      .at(-1);
  return (
    <div className="app-shell">
      <header className="site-header">
        <button
          className="brand-link"
          onClick={() => navigate("/")}
          aria-label="ghtrends home"
        >
          <Logo />
        </button>
        <nav
          className={mobileMenu ? "is-open" : ""}
          aria-label="Main navigation"
        >
          {[
            ["radar", "Radar", Radio, "/"],
            ["compare", "Compare", GitCompareArrows, "/compare"],
            ["watch", "Watchlist", Bookmark, "/watch"],
            ["gaps", "Demand gaps", ScanLine, "/gaps"],
            ["docs", "How it works", BookOpen, "/docs"],
          ].map(([key, label, Icon, href]) => {
            const I = Icon as typeof Radio;
            return (
              <button
                key={String(key)}
                className={active === key ? "active" : ""}
                onClick={() => navigate(String(href))}
              >
                <I size={15} />
                {String(label)}
                {key === "watch" && watch.length > 0 && (
                  <span className="nav-count">{watch.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="header-end">
          <a
            className="github-button"
            href={SOURCE}
            target="_blank"
            rel="noreferrer"
          >
            <Star size={15} />
            Star on GitHub <ArrowUpRight size={14} />
          </a>
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu size={22} />
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => void refresh()}>Try again</button>
        </div>
      )}
      <main>
        {route === "/" ? (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  THE OPEN-SOURCE OPPORTUNITY RADAR
                </div>
                <h1>
                  Know where
                  <br />
                  to build<span className="lime">.</span>
                </h1>
              </div>
              <div className="heading-aside">
                <p>
                  Spot growing demand.
                  <br />
                  Find the gaps in open source.
                </p>
                <div className="source-chips">
                  <span>
                    <svg viewBox="0 0 16 16" width="13" height="13">
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        fill="none"
                        stroke="currentColor"
                      />
                      <path
                        d="M3 11 6 7 9 9 13 4"
                        fill="none"
                        stroke="currentColor"
                      />
                    </svg>
                    GitHub
                  </span>
                  <span>＋</span>
                  <span>
                    <Activity size={13} />
                    Google Trends
                  </span>
                </div>
              </div>
            </section>
            <section className="radar-section">
              <div className="radar-sidebar">
                <div className="section-kicker">01 / THE BIG PICTURE</div>
                <h2>
                  Follow the
                  <br />
                  <span className="serif-word">opportunity.</span>
                </h2>
                <p>
                  Every signal puts search demand against active open-source
                  supply. Explore a category to see what’s behind it.
                </p>
                <div className="overview-numbers">
                  <div>
                    <strong>
                      {markets.length.toString().padStart(2, "0")}
                    </strong>
                    <span>categories scanned</span>
                  </div>
                  <div>
                    <strong>{number(total)}</strong>
                    <span>matching active projects*</span>
                  </div>
                </div>
                <div className="radar-legend">
                  {(["blue", "expanding", "contested", "quiet"] as const).map(
                    (k) => (
                      <button
                        key={k}
                        onClick={() => setFilter(filter === k ? "all" : k)}
                        className={filter === k ? "selected" : ""}
                      >
                        <i style={{ background: kindColors[k] }} />
                        {kindLabels[k]}
                        <span>
                          {markets.filter((m) => m.kind === k).length}
                        </span>
                      </button>
                    ),
                  )}
                </div>
                <button className="text-link" onClick={() => navigate("/docs")}>
                  Understand the methodology <ArrowUpRight size={15} />
                </button>
              </div>
              <Radar
                markets={markets}
                onSelect={(m) => navigate("/market/" + m.topic.slug)}
              />
            </section>
            <section className="market-section">
              <div className="section-header">
                <div>
                  <div className="section-kicker">
                    02 / EXPLORE THE LANDSCAPE
                  </div>
                  <h2>
                    Your next starting point<span className="lime">↗</span>
                  </h2>
                </div>
                <span className="updated">
                  {latest
                    ? `Updated ${new Date(latest).toLocaleDateString("en", { month: "short", day: "numeric" })}`
                    : "Ready for your first scan"}
                </span>
              </div>
              <div className="toolbar">
                <form
                  className="search-field"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void scan(query);
                  }}
                >
                  <Search size={18} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Explore a topic, e.g. agent memory"
                    aria-label="Search or scan a topic"
                  />
                  <button disabled={scanning || !query.trim()} type="submit">
                    Scan <ArrowUpRight size={15} />
                  </button>
                </form>
                <label className="select-field">
                  <Globe2 size={15} />
                  <select
                    value={geo}
                    onChange={(e) => setGeo(e.target.value)}
                    aria-label="Search-demand region"
                  >
                    <option value="">Worldwide</option>
                    <option value="US">United States</option>
                    <option value="GB">United Kingdom</option>
                    <option value="DE">Germany</option>
                    <option value="JP">Japan</option>
                    <option value="IN">India</option>
                  </select>
                  <ChevronDown size={13} />
                </label>
                <label className="select-field">
                  <SlidersHorizontal size={15} />
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    aria-label="Sort categories"
                  >
                    <option value="opportunity">Opportunity</option>
                    <option value="growth">Search growth</option>
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>
              <details className="keyword-options">
                <summary>Choose a different Google search term</summary>
                <label>
                  Demand keyword
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    maxLength={100}
                    placeholder="Optional — e.g. AI agent memory"
                  />
                </label>
                <p>
                  Keep the GitHub topic above; use this field to measure a more
                  familiar phrase people search for.
                </p>
              </details>
              <div className="filter-tabs">
                <button
                  className={filter === "all" ? "active" : ""}
                  onClick={() => setFilter("all")}
                >
                  All categories <span>{markets.length}</span>
                </button>
                {(
                  [
                    "blue",
                    "expanding",
                    "contested",
                    "quiet",
                    "uncertain",
                  ] as const
                ).map((k) => (
                  <button
                    className={filter === k ? "active" : ""}
                    key={k}
                    onClick={() => setFilter(k)}
                  >
                    {kindLabels[k]}
                  </button>
                ))}
              </div>
              {loading ? (
                <Loading />
              ) : (
                <div className="market-grid">
                  {shown.map((m, i) => (
                    <button
                      className="market-card"
                      key={m.id}
                      onClick={() => navigate("/market/" + m.topic.slug)}
                      style={
                        {
                          "--accent": m.topic.color,
                          "--delay": `${i * 45}ms`,
                        } as React.CSSProperties
                      }
                    >
                      <div className="card-top">
                        <span className="category-mark">
                          {m.topic.name.slice(0, 1)}
                          <sup>↗</sup>
                        </span>
                        <Pill kind={m.kind} />
                      </div>
                      <h3>
                        {m.topic.name}
                        <ArrowUpRight size={20} />
                      </h3>
                      <p>{m.topic.description}</p>
                      <Sparkline
                        values={m.demand.points
                          .filter((p) => !p.partial)
                          .slice(-26)
                          .map((p) => p.value)}
                        color={m.topic.color}
                        height={49}
                        fill
                      />
                      <div className="card-metrics">
                        <div>
                          <small>Search growth</small>
                          <Growth value={m.metrics.growth} />
                        </div>
                        <div>
                          <small>Active projects</small>
                          <strong>{number(m.supply.total)}</strong>
                        </div>
                        <div>
                          <small>Evidence</small>
                          <span className="evidence-level">{m.confidence}</span>
                        </div>
                      </div>
                      <div className="card-bottom">
                        <span>Explore the evidence</span>
                        <ArrowRight size={17} />
                      </div>
                    </button>
                  ))}
                  {!shown.length && !unscanned.length && (
                    <Empty
                      title="No matching signals"
                      description="Try another topic or clear the category filter."
                      action={
                        <button
                          className="button"
                          onClick={() => {
                            setFilter("all");
                            setQuery("");
                          }}
                        >
                          Clear filters
                        </button>
                      }
                    />
                  )}
                </div>
              )}
              {unscanned.length > 0 && (
                <div className="unscanned">
                  <div>
                    <ScanLine size={18} />
                    <strong>Explore a new category</strong>
                    <span>Fresh evidence takes a moment.</span>
                  </div>
                  <div className="topic-chips">
                    {unscanned.map((t) => (
                      <button
                        key={t.slug}
                        disabled={scanning}
                        onClick={() => void scan(t.slug)}
                      >
                        {t.name}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
            <section className="cli-strip">
              <span className="terminal-icon">
                <Terminal size={25} />
              </span>
              <div>
                <h3>Take the radar into your workflow.</h3>
                <p>The same evidence. In your terminal or your AI agent.</p>
              </div>
              <code>ghtrends scan --topic mcp-servers</code>
              <button
                className="button subtle"
                onClick={() => navigate("/docs")}
              >
                CLI & MCP <ArrowUpRight size={15} />
              </button>
            </section>
            <p className="footnote">
              * Category counts can overlap. Search interest is a demand signal,
              not a measure of paying customers. All classifications include
              their evidence and limitations.
            </p>
          </>
        ) : route.startsWith("/market/") || route.startsWith("/report/") ? (
          <MarketView
            path={route}
            geo={geo}
            navigate={navigate}
            watch={watch}
            onWatch={toggleWatch}
            onScan={scan}
          />
        ) : route.startsWith("/repo/") ? (
          <RepoView
            name={decodeURIComponent(route.slice(6))}
            watch={watch}
            onWatch={toggleWatch}
            navigate={navigate}
          />
        ) : route === "/compare" ? (
          <CompareView path={path} navigate={navigate} />
        ) : route === "/watch" ? (
          <WatchView names={watch} onWatch={toggleWatch} navigate={navigate} />
        ) : route === "/gaps" ? (
          <GapView />
        ) : route === "/docs" ? (
          <Docs />
        ) : (
          <Empty
            title="This page has drifted off the map"
            description="Return to the radar to find a category or project."
            action={
              <button className="button" onClick={() => navigate("/")}>
                Back to radar
              </button>
            }
          />
        )}
      </main>
      <footer>
        <Logo />
        <span>Built for the curious. Open for everyone.</span>
        <div>
          <a href={SOURCE}>
            Source code <ArrowUpRight size={12} />
          </a>
          <a href="https://ghtrends.dev">
            Daily discoveries <ArrowUpRight size={12} />
          </a>
          <button onClick={() => navigate("/docs")}>Methodology</button>
        </div>
        <small>Not affiliated with GitHub, Inc.</small>
      </footer>
      {(scanning || scanError) && (
        <div className="scan-status" role={scanError ? "alert" : "status"}>
          {scanError ? (
            <>
              <Info size={20} />
              <div>
                <strong>Scan needs attention</strong>
                <p>{scanError}</p>
              </div>
              <button
                className="icon-button"
                aria-label="Dismiss scan error"
                onClick={() => setScanError("")}
              >
                <X size={18} />
              </button>
            </>
          ) : (
            <>
              <span className="spinner" />
              <div>
                <strong>
                  {job?.state === "queued"
                    ? "Your scan is queued"
                    : "Reading the landscape"}
                </strong>
                <p>
                  Checking GitHub supply and Google search demand. You can keep
                  exploring.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function MarketView({
  path,
  geo,
  navigate,
  watch,
  onWatch,
  onScan,
}: {
  path: string;
  geo: string;
  navigate: (s: string) => void;
  watch: string[];
  onWatch: (s: string) => void;
  onScan: (s: string) => void;
}) {
  const [m, setM] = useState<Market | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    setError("");
    const url = path.startsWith("/report/")
      ? "/api/reports/" + path.slice(8)
      : "/api/markets/" + path.slice(8) + "?geo=" + geo;
    api<Market>(url)
      .then(setM)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path, geo]);
  if (loading) return <Loading text="Opening the evidence…" />;
  if (!m || error)
    return (
      <Empty
        title={
          path.startsWith("/report/")
            ? "This report is unavailable"
            : "This category is waiting for its first scan"
        }
        description={error}
        action={
          <button
            className="button"
            onClick={() =>
              path.startsWith("/report/")
                ? navigate("/")
                : onScan(path.slice(8))
            }
          >
            {path.startsWith("/report/")
              ? "Back to the radar"
              : "Scan this category"}{" "}
            <ArrowUpRight size={16} />
          </button>
        }
      />
    );
  const share = location.origin + "/report/" + m.id;
  return (
    <div className="detail-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={16} />
        Back to the radar
      </button>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">
            CATEGORY INTELLIGENCE / {m.geo || "WORLDWIDE"}
          </div>
          <h1>
            {m.topic.name}
            <span className="lime">.</span>
          </h1>
          <p>{m.topic.description}</p>
        </div>
        <div className="detail-actions">
          <CopyButton value={share} label="Share report" />
          <a
            className="button subtle"
            href={`/api/reports/${m.id}?format=md`}
            download={`ghtrends-${m.topic.slug}.md`}
          >
            <Download size={15} />
            Markdown
          </a>
          <button
            className="button"
            onClick={() =>
              void downloadCard(m, share).catch((e) => setError(e.message))
            }
          >
            <Download size={15} />
            Save image
          </button>
        </div>
      </div>
      <section className={`verdict ${m.kind}`}>
        <div className="verdict-icon">
          <Radio size={30} />
        </div>
        <div>
          <Pill kind={m.kind} />
          <h2>{m.headline}</h2>
          <p>{m.strategy}</p>
        </div>
        <div className="verdict-evidence">
          <span>{m.confidence}</span>
          <small>evidence confidence</small>
          <small>
            {new Date(m.asOf).toLocaleDateString("en", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </small>
        </div>
      </section>
      <div className="metric-grid">
        <div>
          <span>Search demand growth</span>
          <strong>
            <Growth value={m.metrics.growth} />
          </strong>
          <small>Last 8 complete weeks vs previous 8</small>
        </div>
        <div>
          <span>Active project supply</span>
          <strong>{number(m.supply.total)}</strong>
          <small>≥5 stars · pushed within 180 days</small>
        </div>
        <div>
          <span>Year-over-year demand</span>
          <strong>
            <Growth value={m.metrics.yearOverYear} />
          </strong>
          <small>Same 8-week window, one year apart</small>
        </div>
        <div>
          <span>Top 3 attention share</span>
          <strong>
            {m.concentration === null
              ? "—"
              : (m.concentration * 100).toFixed(0) + "%"}
          </strong>
          <small>Share of stars within returned projects</small>
        </div>
      </div>
      <div className="detail-columns">
        <section className="panel demand-panel">
          <div className="panel-title">
            <h3>What demand looks like</h3>
            <a href={m.demand.sourceUrl} target="_blank" rel="noreferrer">
              Google Trends <ExternalLink size={13} />
            </a>
          </div>
          <div className="chart-caption">
            <span>Relative search interest for “{m.demand.keyword}”</span>
            <span>{m.metrics.points} complete observations</span>
          </div>
          <div className="large-chart">
            <div className="chart-grid">
              <span>100</span>
              <span>50</span>
              <span>0</span>
            </div>
            <Sparkline
              values={m.demand.points
                .filter((p) => !p.partial)
                .map((p) => p.value)}
              color={m.topic.color}
              height={180}
              fill
              domain={[0, 100]}
            />
          </div>
          <div className="chart-dates">
            <span>{m.demand.points[0]?.date.slice(0, 10) || "No history"}</span>
            <span>{m.demand.points.at(-1)?.date.slice(0, 10)}</span>
          </div>
          <p className="footnote">
            Original values are relative Google Trends indices on a 0–100 scale,
            not search counts.
          </p>
        </section>
        <section className="panel reasoning-panel">
          <div className="panel-title">
            <h3>Behind the classification</h3>
            <span className="method-tag">v{m.version}</span>
          </div>
          {m.reasons.map((r, i) => (
            <div className="reason" key={r}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <p>{r}</p>
            </div>
          ))}
          <button className="text-link" onClick={() => navigate("/docs")}>
            Read the full method <ArrowUpRight size={15} />
          </button>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h3>The projects shaping this space</h3>
            <p>Leading repositories by stars within the selected topic.</p>
          </div>
          <a href={m.supply.sourceUrl} target="_blank" rel="noreferrer">
            View search <ExternalLink size={13} />
          </a>
        </div>
        {m.supply.repositories.slice(0, 10).map((r) => (
          <RepoRow
            key={r.name}
            repo={r}
            watched={watch.includes(r.name)}
            onWatch={() => onWatch(r.name)}
            onView={() => navigate("/repo/" + r.name)}
          />
        ))}
        {!m.supply.repositories.length && (
          <Empty
            title="No matching projects returned"
            description="A narrow topic or unavailable source can leave this view empty. Check the evidence notes below."
          />
        )}
        <div className="panel-bottom">
          <button
            className="text-link"
            disabled={m.supply.repositories.length < 2}
            onClick={() =>
              navigate(
                "/compare?repos=" +
                  m.supply.repositories
                    .slice(0, 3)
                    .map((r) => r.name)
                    .join(","),
              )
            }
          >
            Compare the leading projects <GitCompareArrows size={16} />
          </button>
          <span className="footnote">
            Star windows follow GitHub’s calendar buckets.
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h3>Listen to what’s missing</h3>
            <p>
              Open issues with community reactions. These are leads to
              investigate, not proven product opportunities.
            </p>
          </div>
          <span className="method-tag">{m.gaps.length} signals</span>
        </div>
        {m.gaps.length ? (
          <div className="gap-grid">
            {m.gaps.slice(0, 9).map((g) => (
              <a
                className="gap-card"
                href={g.url}
                target="_blank"
                rel="noreferrer"
                key={g.url}
              >
                <div>
                  <span className="gap-label">
                    {g.label.replaceAll("-", " ")}
                  </span>
                  <span>↑ {g.reactions}</span>
                </div>
                <h4>
                  {g.title}
                  <ArrowUpRight size={15} />
                </h4>
                <p>{g.excerpt}</p>
                <small>
                  {g.repo} · {g.createdAt.slice(0, 10)}
                </small>
              </a>
            ))}
          </div>
        ) : (
          <p className="muted">
            No issue signals were returned for this scan. This does not
            establish the absence of unmet demand.
          </p>
        )}
      </section>
      <section className="panel limits-panel">
        <div className="panel-title">
          <h3>
            <Info size={18} />
            Know the boundaries
          </h3>
          <a href={`/api/reports/${m.id}`} target="_blank" rel="noreferrer">
            Download evidence JSON <ExternalLink size={13} />
          </a>
        </div>
        <ul>
          {m.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="embed-box">
          <div>
            <strong>Put this finding where others can discover it.</strong>
            <p>Share a permanent snapshot of the evidence.</p>
          </div>
          <CopyButton
            value={`[![${m.topic.name}: ${m.headline}](${location.origin}/api/cards/${m.id}.png)](${share})`}
            label="Copy README card"
          />
        </div>
      </section>
    </div>
  );
}
function RepoView({
  name,
  watch,
  onWatch,
  navigate,
}: {
  name: string;
  watch: string[];
  onWatch: (s: string) => void;
  navigate: (s: string) => void;
}) {
  const [r, setR] = useState<Repo | null>(null),
    [error, setError] = useState(""),
    [days, setDays] = useState(30);
  useEffect(() => {
    setR(null);
    setError("");
    api<Repo>("/api/repo?name=" + encodeURIComponent(name))
      .then(setR)
      .catch((e) => setError(e.message));
  }, [name]);
  if (error)
    return <Empty title="Repository unavailable" description={error} />;
  if (!r)
    return (
      <Loading text="Reading repository history and maintenance signals…" />
    );
  return (
    <div className="detail-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={16} />
        Back to radar
      </button>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">REPOSITORY INTELLIGENCE</div>
          <h1 className="repo-title">{r.name}</h1>
          <p>{r.description}</p>
        </div>
        <button className="button" onClick={() => onWatch(r.name)}>
          <Bookmark size={15} />
          {watch.includes(r.name) ? "Watching" : "Add to watchlist"}
        </button>
      </div>
      <div className="metric-grid">
        <div>
          <span>Total stars</span>
          <strong>{number(r.stars)}</strong>
        </div>
        <div>
          <span>Stars / last 7 days</span>
          <strong className="positive">
            {r.growth7d === null ? "—" : "+" + number(r.growth7d)}
          </strong>
        </div>
        <div>
          <span>Stars / last 30 days</span>
          <strong>
            {r.growth30d === null ? "—" : "+" + number(r.growth30d)}
          </strong>
        </div>
        <div>
          <span>License</span>
          <strong className="small-value">
            {r.license || "Not specified"}
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h3>Daily new stars</h3>
          <div className="segmented">
            {[7, 30, 90].map((d) => (
              <button
                className={days === d ? "active" : ""}
                key={d}
                onClick={() => setDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        <div className="repo-chart">
          <Sparkline
            values={r.starHistory.slice(-days).map((p) => p.count)}
            height={220}
            fill
          />
        </div>
        <div className="chart-dates">
          <span>{r.starHistory.slice(-days)[0]?.date}</span>
          <span>{r.growthWindowEnd}</span>
        </div>
        <p className="footnote">
          GitHub calendar-bucket counts; not rolling 24-hour net growth. Each
          chart is scaled to its visible range.
        </p>
      </section>
      <div className="detail-columns">
        <section className="panel">
          <h3>Maintenance in context</h3>
          <dl className="facts">
            <dt>Last push</dt>
            <dd>{r.pushedAt.slice(0, 10)}</dd>
            <dt>Repository created</dt>
            <dd>{r.createdAt.slice(0, 10)}</dd>
            <dt>Primary language</dt>
            <dd>{r.language || "Not specified"}</dd>
            <dt>Archived</dt>
            <dd>{r.archived ? "Yes" : "No"}</dd>
            <dt>Forks</dt>
            <dd>{number(r.forks)}</dd>
          </dl>
        </section>
        <section className="panel">
          <h3>The people behind the project</h3>
          <dl className="facts">
            <dt>Maintainer response median</dt>
            <dd>
              {r.issueResponseHours === null
                ? "Unavailable"
                : r.issueResponseHours.toFixed(1) + " hours"}
            </dd>
            <dt>Issues sampled</dt>
            <dd>{r.issueSampleSize}</dd>
            <dt>No maintainer response found</dt>
            <dd>{r.unansweredIssues}</dd>
            <dt>Contributors returned</dt>
            <dd>{number(r.contributors)}</dd>
            <dt>Top contributor commit share</dt>
            <dd>
              {r.topContributorShare === null
                ? "Unavailable"
                : (r.topContributorShare * 100).toFixed(0) + "%"}
            </dd>
          </dl>
          <p className="footnote">
            Recent issue sample; bots and self-replies excluded. Unanswered
            issues are reported separately. Contributor share reflects returned
            commit counts.
          </p>
        </section>
      </div>
      {r.errors.length > 0 && (
        <section className="panel">
          <h3>Data notes</h3>
          <ul>
            {r.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </section>
      )}
      <a className="button" href={r.url} target="_blank" rel="noreferrer">
        Explore on GitHub <ArrowUpRight size={16} />
      </a>
    </div>
  );
}
function CompareView({
  path,
  navigate,
}: {
  path: string;
  navigate: (s: string) => void;
}) {
  const initial =
      new URLSearchParams(path.split("?")[1] || "").get("repos") || "",
    [input, setInput] = useState(initial.replaceAll(",", " ")),
    [repos, setRepos] = useState<Repo[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const compare = async (value: string) => {
    const names = value
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (names.length < 2 || names.length > 6) {
      setError("Enter two to six repositories in owner/repo format.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      setRepos(
        await api<Repo[]>(
          "/api/compare?repos=" + encodeURIComponent(names.join(",")),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (initial) void compare(initial);
  }, [initial]);
  return (
    <div className="detail-page">
      <div className="eyebrow">SIDE BY SIDE</div>
      <h1>
        Compare the contenders<span className="lime">.</span>
      </h1>
      <p className="page-intro">
        A shared view of growth, activity and maintenance. Choose what deserves
        a closer look.
      </p>
      <form
        className="compare-form"
        onSubmit={(e) => {
          e.preventDefault();
          void compare(input);
        }}
      >
        <GitCompareArrows size={20} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="facebook/react vuejs/core sveltejs/svelte"
          aria-label="Repositories to compare"
        />
        <button className="button" disabled={loading}>
          Compare <ArrowRight size={16} />
        </button>
      </form>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {loading ? (
        <Loading text="Gathering comparable repository evidence…" />
      ) : repos.length ? (
        <>
          <ComparisonChart repos={repos} />
          <div
            className="comparison-grid"
            style={{
              gridTemplateColumns: `repeat(${repos.length},minmax(230px,1fr))`,
            }}
          >
            {repos.map((r) => (
              <section className="panel" key={r.name}>
                <span className="repo-avatar">
                  {r.name.slice(0, 2).toUpperCase()}
                </span>
                <button
                  className="comparison-name"
                  onClick={() => navigate("/repo/" + r.name)}
                >
                  {r.name}
                  <ArrowUpRight size={16} />
                </button>
                <p className="comparison-description">{r.description}</p>
                <Sparkline
                  values={r.starHistory.slice(-30).map((p) => p.count)}
                  height={100}
                  fill
                />
                <dl className="facts">
                  <dt>Stars</dt>
                  <dd>{number(r.stars)}</dd>
                  <dt>7-day new stars</dt>
                  <dd>{number(r.growth7d)}</dd>
                  <dt>30-day new stars</dt>
                  <dd>{number(r.growth30d)}</dd>
                  <dt>Forks</dt>
                  <dd>{number(r.forks)}</dd>
                  <dt>Last push</dt>
                  <dd>{r.pushedAt.slice(0, 10)}</dd>
                  <dt>License</dt>
                  <dd>{r.license || "Not specified"}</dd>
                  <dt>Maintainer response</dt>
                  <dd>
                    {r.issueResponseHours === null
                      ? "Unavailable"
                      : r.issueResponseHours.toFixed(1) + "h"}
                  </dd>
                </dl>
              </section>
            ))}
          </div>
          <div className="compare-foot">
            <p className="footnote">
              Sparklines use independent vertical scales. Compare numeric values
              for magnitude; star windows follow GitHub calendar buckets.
            </p>
            <CopyButton
              value={
                location.origin +
                "/compare?repos=" +
                repos.map((r) => r.name).join(",")
              }
              label="Share comparison"
            />
          </div>
        </>
      ) : (
        <Empty
          title="Bring your shortlist"
          description="Compare two to six public repositories. Start with a category on the radar, or paste repository names above."
        />
      )}
    </div>
  );
}
function WatchView({
  names,
  onWatch,
  navigate,
}: {
  names: string[];
  onWatch: (s: string) => void;
  navigate: (s: string) => void;
}) {
  const [repos, setRepos] = useState<Repo[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [input, setInput] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrors([]);
    Promise.all(
      names.map((name) =>
        api<Repo>("/api/repo?name=" + encodeURIComponent(name)).catch((e) => ({
          error: name + ": " + e.message,
        })),
      ),
    )
      .then((results) => {
        if (cancelled) return;
        setRepos(results.filter((r) => !("error" in r)) as Repo[]);
        setErrors(
          results
            .filter((r) => "error" in r)
            .map((r) => (r as { error: string }).error),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [names.join(",")]);
  return (
    <div className="detail-page">
      <div className="eyebrow">YOUR PERSONAL SIGNALS</div>
      <h1>
        Keep the good ones close<span className="lime">.</span>
      </h1>
      <p className="page-intro">
        Follow projects worth returning to. Your list stays in this browser.
      </p>
      <form
        className="compare-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[\w.-]+\/[\w.-]+$/.test(input.trim())) {
            if (!names.includes(input.trim())) onWatch(input.trim());
            setInput("");
          } else setErrors(["Use owner/repo format."]);
        }}
      >
        <Bookmark size={19} />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="owner/repository"
          aria-label="Add repository to watchlist"
        />
        <button className="button">
          Add project <ArrowUpRight size={15} />
        </button>
      </form>
      {errors.map((e) => (
        <p className="error-text" key={e}>
          {e}
        </p>
      ))}
      {loading ? (
        <Loading text="Refreshing your watchlist…" />
      ) : repos.length ? (
        <section className="panel">
          {repos.map((r) => (
            <RepoRow
              key={r.name}
              repo={r}
              watched
              onWatch={() => onWatch(r.name)}
              onView={() => navigate("/repo/" + r.name)}
            />
          ))}
        </section>
      ) : (
        <Empty
          title="Make room for your next discovery"
          description="Save a project from any category or add a repository above. No account required."
          action={
            <button className="button" onClick={() => navigate("/")}>
              Explore the radar <ArrowUpRight size={15} />
            </button>
          }
        />
      )}
    </div>
  );
}
function Docs() {
  return (
    <div className="docs-page">
      <div className="eyebrow">OPEN DATA. OPEN METHOD.</div>
      <h1>
        A signal you can inspect<span className="lime">.</span>
      </h1>
      <p className="page-intro">
        ghtrends puts two independent questions together: how much active
        open-source supply exists, and whether search demand is growing.
      </p>
      <section className="panel">
        <h2>The four landscapes</h2>
        <table>
          <thead>
            <tr>
              <th>Landscape</th>
              <th>Supply</th>
              <th>Sustained demand growth</th>
              <th>Starting strategy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Pill kind="blue" />
              </td>
              <td>Under 50 projects</td>
              <td>Fast</td>
              <td>Validate an underserved use case.</td>
            </tr>
            <tr>
              <td>
                <Pill kind="expanding" />
              </td>
              <td>50+ projects</td>
              <td>Fast</td>
              <td>Find a specific audience or advantage.</td>
            </tr>
            <tr>
              <td>
                <Pill kind="contested" />
              </td>
              <td>50+ projects</td>
              <td>Not fast</td>
              <td>Identify a reason people would switch.</td>
            </tr>
            <tr>
              <td>
                <Pill kind="quiet" />
              </td>
              <td>Under 50 projects</td>
              <td>Not fast</td>
              <td>Check if the market is early, niche or inactive.</td>
            </tr>
          </tbody>
        </table>
        <p>
          “Uncharted” means the evidence is missing, stale or too weak. Zero
          search values can be rounded or below Google’s reporting threshold;
          they never establish that demand does not exist.
        </p>
      </section>
      <div className="detail-columns">
        <section className="panel">
          <span className="section-kicker">01 / DEMAND</span>
          <h2>Look past the spike.</h2>
          <p>
            We compare median search interest across the last eight complete
            weeks and the previous eight. Fast growth requires at least 25%
            growth, positive growth in the lower resampling band, and at least
            six recent weeks above the prior baseline.
          </p>
          <p>
            Two-week block resampling tests sensitivity to individual
            observations. A year-over-year comparison checks recurring seasonal
            rebounds. These diagnostics are not probabilities of business
            success.
          </p>
          <p>
            Search terms are measured alongside a shared “github trending”
            reference in the same region and time range. Google Trends is
            normalized, sampled search attention, not absolute demand.
          </p>
          <a
            className="text-link"
            href="https://support.google.com/trends/answer/4365533"
            target="_blank"
            rel="noreferrer"
          >
            How Google Trends works <ArrowUpRight size={14} />
          </a>
        </section>
        <section className="panel">
          <span className="section-kicker">02 / SUPPLY</span>
          <h2>Count active alternatives.</h2>
          <p>
            A matching repository must carry the selected GitHub topic, have at
            least five stars, have been pushed to in the last 180 days, and be
            neither a fork nor archived.
          </p>
          <p>
            Fifty qualifying repositories is the published dense-supply
            threshold. This is a transparent operational rule, not a universal
            economic law. Topic labels are imperfect; untagged projects and
            commercial competitors are outside this sample.
          </p>
          <p>
            Repository charts use GitHub’s official star-history calendar
            buckets. Issue-response times cover a recent sample, separating
            unanswered issues. All raw evidence is exportable.
          </p>
          <a
            className="text-link"
            href={SOURCE + "/tree/main/src/core"}
            target="_blank"
            rel="noreferrer"
          >
            Inspect the algorithm <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
      <section className="panel">
        <h2>Your terminal. Your agent.</h2>
        <p>
          Node.js 22.13 or newer. Public queries work without credentials within
          GitHub’s unauthenticated limits. Configure your own token or GitHub
          App for larger scans.
        </p>
        <div className="code-block">
          <pre>{`npm install -g https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.1.4/ghtrends-radar-0.1.4.tgz\n\nghtrends scan --topic mcp-servers --json\nghtrends repo facebook/react\nghtrends compare facebook/react vuejs/core --format md\nghtrends watch add facebook/react\nghtrends watch run\nghtrends report --topic agent-memory --format md\nghtrends ui --port 3721\nghtrends mcp`}</pre>
          <CopyButton value="ghtrends scan --topic mcp-servers --json" />
        </div>
        <h3>Connect an MCP client</h3>
        <div className="code-block">
          <pre>
            {JSON.stringify(
              {
                mcpServers: {
                  ghtrends: { command: "ghtrends", args: ["mcp"] },
                },
              },
              null,
              2,
            )}
          </pre>
        </div>
        <p>
          Tools: <code>ghtrends_scan</code>, <code>ghtrends_repo</code>,{" "}
          <code>ghtrends_compare</code>, <code>ghtrends_watch_list</code>.
          Results include data sources, time windows, confidence and
          limitations.
        </p>
      </section>
      <section className="panel">
        <h2>How to use a classification</h2>
        <p>
          Use it to decide where to investigate next. Validate real workflows
          with people, inspect existing alternatives and account for commercial
          products. The opportunity score ranks the measured signals; it does
          not predict revenue, investment outcomes or GitHub stars.
        </p>
        <p>
          Reports are immutable snapshots. A fresh scan can produce a different
          classification while the original evidence stays available at its
          permanent link.
        </p>
      </section>
    </div>
  );
}

function GapView() {
  const [gaps, setGaps] = useState<Gap[]>([]),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    api<Gap[]>("/api/gaps")
      .then(setGaps)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  const visible = gaps.filter(
    (g) =>
      (filter === "all" || g.label === filter) &&
      (!query ||
        `${g.title} ${g.excerpt} ${g.repo}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  return (
    <div className="detail-page">
      <div className="eyebrow">LISTEN BEFORE YOU BUILD</div>
      <h1>
        Find the friction<span className="lime">.</span>
      </h1>
      <p className="page-intro">
        Open issues people care enough to react to. Follow the source,
        understand the workflow, and validate the need.
      </p>
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label="Search demand gaps"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search alternative, frustrated, how to…"
        />
      </div>
      <div className="filter-tabs">
        {["all", "feature-request", "alternative", "friction"].map((f) => (
          <button
            className={filter === f ? "active" : ""}
            key={f}
            onClick={() => setFilter(f)}
          >
            {f.replaceAll("-", " ")}
          </button>
        ))}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <Loading />
      ) : visible.length ? (
        <>
          <p className="footnote">
            {visible.length} signals · sorted by reactions · sampled from
            leading projects in scanned categories
          </p>
          <div className="gap-grid">
            {visible.map((g) => (
              <a
                key={g.url}
                className="gap-card"
                href={g.url}
                target="_blank"
                rel="noreferrer"
              >
                <div>
                  <span className="gap-label">
                    {g.label.replaceAll("-", " ")}
                  </span>
                  <span>↑ {g.reactions}</span>
                </div>
                <h4>
                  {g.title}
                  <ArrowUpRight size={15} />
                </h4>
                <p>{g.excerpt}</p>
                <small>
                  {g.repo} · {g.updatedAt.slice(0, 10)}
                </small>
              </a>
            ))}
          </div>
        </>
      ) : (
        <Empty
          title="No matching issue signals"
          description="Try a broader keyword. An empty result does not prove that demand is absent."
        />
      )}
      <p className="footnote">
        Issue labels are keyword-based suggestions. Reactions do not establish a
        market, and issue text may be incomplete. Always read the original
        discussion.
      </p>
    </div>
  );
}
