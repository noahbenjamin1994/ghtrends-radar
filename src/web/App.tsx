import { t, locale, localUrl, switchLanguage } from "./i18n.js";
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
import { marketAssessment } from "../core/assessment.js";
import { resolveTopic } from "../core/topics.js";
import type { ScanProgress } from "../core/engine.js";
import { completeWeeklySeries } from "../core/evidence.js";
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
      input?: string;
      keyword?: string;
      created?: number;
      queuePosition?: number;
      progress?: ScanProgress;
    } | null>(null),
    [scanning, setScanning] = useState(false),
    [scanError, setScanError] = useState(""),
    [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!scanning) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [scanning]);
  const navigate = (input: string) => {
    const destination =
      geo && input.startsWith("/market/") && !input.includes("?")
        ? input + "?geo=" + geo
        : input;
    const url = localUrl(destination);
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
  const scan = async (input: string, demandKeyword?: string) => {
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
          keyword: demandKeyword || keyword.trim() || undefined,
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
        setJob(d);
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
  const pendingAssessment = job?.progress?.preview
    ? marketAssessment(job.progress.preview, locale)
    : null;
  const scanTopic = job ? resolveTopic(job.topic) : null;
  const stageLabels = {
    sources: "Collecting source evidence",
    github: "GitHub supply received",
    demand: "Search history received",
    details: "Core evidence ready; adding project details",
  };
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
        (!query ||
          `${m.topic.name} ${t(m.topic.name)}`
            .toLowerCase()
            .includes(query.toLowerCase())),
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
          aria-label={t("ghtrends home")}
        >
          <Logo />
        </button>
        <nav
          className={mobileMenu ? "is-open" : ""}
          aria-label={t("Main navigation")}
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
                {t(String(label))}
                {key === "watch" && watch.length > 0 && (
                  <span className="nav-count">{watch.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="header-end">
          <button
            className="language-switch"
            onClick={switchLanguage}
            aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
          >
            <Globe2 size={14} />
            {locale === "zh" ? "EN" : "中文"}
          </button>
          <a
            className="github-button"
            href={SOURCE}
            target="_blank"
            rel="noreferrer"
          >
            <Star size={15} />
            <span className="github-label">{t("Star on GitHub")}</span>
            <span className="github-short">Star</span>
            <ArrowUpRight size={14} />
          </a>
          <button
            className="icon-button mobile-menu"
            aria-label={t("Toggle navigation")}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Menu size={22} />
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          {t(error)}
          <button onClick={() => void refresh()}>{t("Try again")}</button>
        </div>
      )}
      <main>
        {route === "/" ? (
          <>
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="live-dot" />
                  {t("THE OPEN-SOURCE OPPORTUNITY RADAR")}
                </div>
                <h1>
                  {t("Know where")}
                  <br />
                  {t("to build")}
                  <span className="lime">.</span>
                </h1>
              </div>
              <div className="heading-aside">
                <p>
                  {t("Spot growing demand.")}
                  <br />
                  {t("Find the gaps in open source.")}
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
                <div className="section-kicker">
                  {t("01 / THE BIG PICTURE")}
                </div>
                <h2>
                  {t("Follow the")}
                  <br />
                  <span className="serif-word">{t("opportunity.")}</span>
                </h2>
                <p>
                  {t(
                    "Every signal puts search demand against active open-source supply. Explore a category to see what’s behind it.",
                  )}
                </p>
                <div className="overview-numbers">
                  <div>
                    <strong>
                      {markets.length.toString().padStart(2, "0")}
                    </strong>
                    <span>{t("categories scanned")}</span>
                  </div>
                  <div>
                    <strong>{number(total)}</strong>
                    <span>{t("matching active projects*")}</span>
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
                  {t("Understand the methodology")}
                  <ArrowUpRight size={15} />
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
                    {t("02 / EXPLORE THE LANDSCAPE")}
                  </div>
                  <h2>
                    {t("Your next starting point")}
                    <span className="lime">↗</span>
                  </h2>
                </div>
                <span className="updated">
                  {latest
                    ? t("Updated {date}", {
                        date: new Date(latest).toLocaleDateString(
                          locale === "zh" ? "zh-CN" : "en",
                          { month: "short", day: "numeric" },
                        ),
                      })
                    : t("Ready for your first scan")}
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
                    placeholder={t("Explore a topic, e.g. agent memory")}
                    aria-label={t("Search or scan a topic")}
                  />
                  <button disabled={scanning || !query.trim()} type="submit">
                    {t("Scan")}
                    <ArrowUpRight size={15} />
                  </button>
                </form>
                <label className="select-field">
                  <Globe2 size={15} />
                  <select
                    value={geo}
                    onChange={(e) => {
                      const value = e.target.value;
                      setGeo(value);
                      const url = new URL(location.href);
                      if (value) url.searchParams.set("geo", value);
                      else url.searchParams.delete("geo");
                      history.replaceState({}, "", url.pathname + url.search);
                      setPath(url.pathname + url.search);
                    }}
                    aria-label={t("Search-demand region")}
                  >
                    <option value="">{t("Worldwide")}</option>
                    <option value="US">{t("United States")}</option>
                    <option value="GB">{t("United Kingdom")}</option>
                    <option value="DE">{t("Germany")}</option>
                    <option value="JP">{t("Japan")}</option>
                    <option value="IN">{t("India")}</option>
                  </select>
                  <ChevronDown size={13} />
                </label>
                <label className="select-field">
                  <SlidersHorizontal size={15} />
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    aria-label={t("Sort categories")}
                  >
                    <option value="opportunity">{t("Opportunity")}</option>
                    <option value="growth">{t("Search growth")}</option>
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>
              <details className="keyword-options">
                <summary>{t("Choose a different Google search term")}</summary>
                <label>
                  {t("Demand keyword")}
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    maxLength={100}
                    placeholder={t("Optional — e.g. AI agent memory")}
                  />
                </label>
                <p>
                  {t(
                    "Keep the GitHub topic above; use this field to measure a more familiar phrase people search for.",
                  )}
                </p>
              </details>
              <div className="filter-tabs">
                <button
                  className={filter === "all" ? "active" : ""}
                  onClick={() => setFilter("all")}
                >
                  {t("All categories")}
                  <span>{markets.length}</span>
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
                        {t(m.topic.name)}
                        <ArrowUpRight size={20} />
                      </h3>
                      <p>{t(m.topic.description)}</p>
                      <Sparkline
                        values={completeWeeklySeries(m.demand, m.asOf)
                          .points.slice(-26)
                          .map((p) => p.value)}
                        color={m.topic.color}
                        height={49}
                        fill
                      />
                      <div className="card-metrics">
                        <div>
                          <small>{t("Search growth")}</small>
                          <Growth
                            value={
                              m.metrics.fast === null ? null : m.metrics.growth
                            }
                          />
                        </div>
                        <div>
                          <small>{t("Active projects")}</small>
                          <strong>
                            {m.supply.error
                              ? "—"
                              : (m.supply.complete ? "" : "≥") +
                                number(m.supply.total)}
                          </strong>
                        </div>
                        <div>
                          <small>{t("Evidence")}</small>
                          <span className="evidence-level">
                            {t(m.confidence)}
                          </span>
                        </div>
                      </div>
                      <div className="card-bottom">
                        <span>{t("Explore the evidence")}</span>
                        <ArrowRight size={17} />
                      </div>
                    </button>
                  ))}
                  {!shown.length && !unscanned.length && (
                    <Empty
                      title={t("No matching signals")}
                      description={t(
                        "Try another topic or clear the category filter.",
                      )}
                      action={
                        <button
                          className="button"
                          onClick={() => {
                            setFilter("all");
                            setQuery("");
                          }}
                        >
                          {t("Clear filters")}
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
                    <strong>{t("Explore a new category")}</strong>
                    <span>{t("Fresh evidence takes a moment.")}</span>
                  </div>
                  <div className="topic-chips">
                    {unscanned.map((topic) => (
                      <button
                        key={topic.slug}
                        disabled={scanning}
                        onClick={() => void scan(topic.slug)}
                      >
                        {t(topic.name)}
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
                <h3>{t("Take the radar into your workflow.")}</h3>
                <p>
                  {t("The same evidence. In your terminal or your AI agent.")}
                </p>
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
              {t(
                "* Category counts can overlap. Search interest is a demand signal, not a measure of paying customers. All classifications include their evidence and limitations.",
              )}
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
            title={t("This page has drifted off the map")}
            description={t(
              "Return to the radar to find a category or project.",
            )}
            action={
              <button className="button" onClick={() => navigate("/")}>
                {t("Back to radar")}
              </button>
            }
          />
        )}
      </main>
      <footer>
        <Logo />
        <span>{t("Built for the curious. Open for everyone.")}</span>
        <div>
          <a href={SOURCE}>
            {t("Source code")}
            <ArrowUpRight size={12} />
          </a>
          <a href="https://ghtrends.dev">
            {t("Daily discoveries")}
            <ArrowUpRight size={12} />
          </a>
          <button onClick={() => navigate("/docs")}>{t("Methodology")}</button>
        </div>
        <small>{t("Not affiliated with GitHub, Inc.")}</small>
      </footer>
      {(scanning || scanError) && (
        <div className="scan-status" role={scanError ? "alert" : "status"}>
          {scanError ? (
            <>
              <Info size={20} />
              <div>
                <strong>{t("Scan needs attention")}</strong>
                <p>{t(scanError)}</p>
              </div>
              <button
                className="icon-button"
                aria-label={t("Dismiss scan error")}
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
                    ? t("Your scan is queued")
                    : t(stageLabels[job?.progress?.stage || "sources"])}
                </strong>
                <p>
                  {t("Elapsed {seconds}s", { seconds: elapsed })}
                  {job?.queuePosition
                    ? " · " +
                      t("Waiting behind {count} scan(s)", {
                        count: job.queuePosition,
                      })
                    : ""}
                </p>
                {scanTopic && (
                  <p>
                    {t(
                      "Interpreting “{input}” as {name}; search term: “{keyword}”.",
                      {
                        input: job!.input || job!.topic,
                        name: t(scanTopic.name),
                        keyword: job?.keyword || scanTopic.keyword,
                      },
                    )}
                  </p>
                )}
                <div className="scan-facts">
                  {job?.progress?.supplyCount !== undefined && (
                    <span>
                      <Check size={13} />
                      {t("{count} active projects found", {
                        count: job.progress.supplyCount,
                      })}
                    </span>
                  )}
                  {job?.progress?.weeklyPoints !== undefined && (
                    <span>
                      <Check size={13} />
                      {t("{count} complete weeks received", {
                        count: job.progress.weeklyPoints,
                      })}
                    </span>
                  )}
                </div>
                {pendingAssessment && (
                  <div className="scan-preview">
                    <small>{t("Preliminary result")}</small>
                    <strong>{pendingAssessment.title}</strong>
                    <p>{pendingAssessment.summary}</p>
                  </div>
                )}
                <p>
                  {t(
                    "You can keep exploring. Source rate limits may delay a fresh scan.",
                  )}
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
  onScan: (s: string, keyword?: string) => void;
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
  if (loading) return <Loading text={t("Opening the evidence…")} />;
  if (!m || error)
    return (
      <Empty
        title={
          path.startsWith("/report/")
            ? t("This report is unavailable")
            : t("This category is waiting for its first scan")
        }
        description={t(error)}
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
              ? t("Back to the radar")
              : t("Scan this category")}{" "}
            <ArrowUpRight size={16} />
          </button>
        }
      />
    );
  const assessment = marketAssessment(m, locale);
  const share = location.origin + localUrl("/report/" + m.id);
  const demandPoints = completeWeeklySeries(m.demand, m.asOf).points;
  return (
    <div className="detail-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={16} />
        {t("Back to the radar")}
      </button>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">
            {t("CATEGORY INTELLIGENCE /")}
            {m.geo || t("WORLDWIDE")}
          </div>
          <h1>
            {t(m.topic.name)}
            <span className="lime">.</span>
          </h1>
          <p>{t(m.topic.description)}</p>
        </div>
        <div className="detail-actions">
          <CopyButton value={share} label={t("Share report")} />
          <a
            className="button subtle"
            href={localUrl(`/api/reports/${m.id}?format=md&v=2`)}
            download={`ghtrends-${m.topic.slug}.md`}
          >
            <Download size={15} />
            Markdown
          </a>
          <button
            className="button"
            onClick={() =>
              void downloadCard(m, share, locale).catch((e) =>
                setError(e.message),
              )
            }
          >
            <Download size={15} />
            {t("Save image")}
          </button>
        </div>
      </div>
      <section className={`verdict ${m.kind}`}>
        <div className="verdict-icon">
          <Radio size={30} />
        </div>
        <div>
          <Pill kind={m.kind} />
          <h2>{assessment.title}</h2>
          <p>{assessment.summary}</p>
          {assessment.level === "provisional" && (
            <small className="verdict-qualification">
              {t("Preliminary recommendation")} ·{" "}
              {t("Quadrant not yet established")}
            </small>
          )}
        </div>
        <div className="verdict-evidence">
          <span>{t(m.confidence)}</span>
          <small>{t("evidence confidence")}</small>
          <small>
            {new Date(m.asOf).toLocaleDateString(
              locale === "zh" ? "zh-CN" : "en",
              {
                month: "short",
                day: "numeric",
                year: "numeric",
              },
            )}
          </small>
        </div>
      </section>
      {assessment.level === "provisional" && (
        <section className="panel next-move">
          <div className="panel-title">
            <h3>{t("Your next move")}</h3>
            <span className="method-tag">{t("Partial evidence")}</span>
          </div>
          <div className="assessment-columns">
            <div>
              <h4>{t("What we know")}</h4>
              <ul>
                {assessment.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>{t("What to do next")}</h4>
              <ol>
                {assessment.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          </div>
          {assessment.suggestedScan && (
            <button
              className="button"
              onClick={() =>
                onScan(
                  assessment.suggestedScan!.topic,
                  assessment.suggestedScan!.keyword,
                )
              }
            >
              <RefreshCw size={15} />
              {t("Rescan with “{keyword}”", {
                keyword: assessment.suggestedScan.keyword,
              })}
            </button>
          )}
          {assessment.contextSources?.map((source) => (
            <a
              className="text-link context-source"
              href={source.url}
              target="_blank"
              rel="noreferrer"
              key={source.url}
            >
              {t("Field context")}: {source.title}
              <ExternalLink size={13} />
            </a>
          ))}
        </section>
      )}
      <div className="metric-grid">
        <div>
          <span>{t("Search demand growth")}</span>
          <strong>
            <Growth value={m.metrics.fast === null ? null : m.metrics.growth} />
          </strong>
          <small>
            {t(
              m.metrics.fast === null
                ? "Search volume is too weak for a stable estimate"
                : "Last 8 complete weeks vs previous 8",
            )}
          </small>
        </div>
        <div>
          <span>{t("Active project supply")}</span>
          <strong>
            {m.supply.error
              ? "—"
              : (m.supply.complete ? "" : "≥") + number(m.supply.total)}
          </strong>
          <small>{t("≥5 stars · pushed within 180 days")}</small>
        </div>
        <div>
          <span>{t("Year-over-year demand")}</span>
          <strong>
            <Growth value={m.metrics.yearOverYear} />
          </strong>
          <small>{t("Same 8-week window, one year apart")}</small>
        </div>
        <div>
          <span>{t("Top 3 attention share")}</span>
          <strong>
            {m.concentration === null
              ? "—"
              : (m.concentration * 100).toFixed(0) + "%"}
          </strong>
          <small>{t("Share of stars within returned projects")}</small>
        </div>
      </div>
      <div className="detail-columns">
        <section className="panel demand-panel">
          <div className="panel-title">
            <h3>{t("What demand looks like")}</h3>
            <a href={m.demand.sourceUrl} target="_blank" rel="noreferrer">
              Google Trends <ExternalLink size={13} />
            </a>
          </div>
          <div className="chart-caption">
            <span>
              {t("Relative search interest for “")}
              {m.demand.keyword}”
            </span>
            <span>
              {demandPoints.length}
              {t("complete observations")}
            </span>
          </div>
          <div className="large-chart">
            <div className="chart-grid">
              <span>100</span>
              <span>50</span>
              <span>0</span>
            </div>
            <Sparkline
              values={demandPoints.map((p) => p.value)}
              color={m.topic.color}
              height={180}
              fill
              domain={[0, 100]}
            />
          </div>
          <div className="chart-dates">
            <span>{demandPoints[0]?.date.slice(0, 10) || t("No history")}</span>
            <span>{demandPoints.at(-1)?.date.slice(0, 10)}</span>
          </div>
          <p className="footnote">
            {t(
              "Original values are relative Google Trends indices on a 0–100 scale, not search counts.",
            )}
          </p>
        </section>
        <section className="panel reasoning-panel">
          <div className="panel-title">
            <h3>{t("Behind the classification")}</h3>
            <span className="method-tag">v{m.version}</span>
          </div>
          {m.reasons.map((r, i) => (
            <div className="reason" key={r}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <p>{t(r)}</p>
            </div>
          ))}
          <button className="text-link" onClick={() => navigate("/docs")}>
            {t("Read the full method")}
            <ArrowUpRight size={15} />
          </button>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h3>{t("The projects shaping this space")}</h3>
            <p>
              {t("Leading repositories by stars within the selected topic.")}
            </p>
          </div>
          <a href={m.supply.sourceUrl} target="_blank" rel="noreferrer">
            {t("View search")}
            <ExternalLink size={13} />
          </a>
        </div>
        {(m.supply.searches?.length || 0) > 1 && (
          <div className="search-scopes">
            <p>
              {t(
                "Counts are deduplicated across topic searches; incomplete searches show a lower bound.",
              )}
            </p>
            {m.supply.searches!.map((source) => (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                key={source.query}
              >
                <code>{source.query.split(" fork:")[0]}</code>
                <ExternalLink size={12} />
              </a>
            ))}
          </div>
        )}
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
            title={t("No matching projects returned")}
            description={t(
              "A narrow topic or unavailable source can leave this view empty. Check the evidence notes below.",
            )}
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
            {t("Compare the leading projects")}
            <GitCompareArrows size={16} />
          </button>
          <span className="footnote">
            {t("Star windows follow GitHub’s calendar buckets.")}
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h3>{t("Listen to what’s missing")}</h3>
            <p>
              {t(
                "Open issues with community reactions. These are leads to investigate, not proven product opportunities.",
              )}
            </p>
          </div>
          <span className="method-tag">
            {m.gaps.length}
            {t("signals")}
          </span>
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
                    {t(g.label.replaceAll("-", " "))}
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
            {t(
              "No issue signals were returned for this scan. This does not establish the absence of unmet demand.",
            )}
          </p>
        )}
      </section>
      <section className="panel limits-panel">
        <div className="panel-title">
          <h3>
            <Info size={18} />
            {t("Know the boundaries")}
          </h3>
          <a href={`/api/reports/${m.id}`} target="_blank" rel="noreferrer">
            {t("Download evidence JSON")}
            <ExternalLink size={13} />
          </a>
        </div>
        <ul>
          {m.limitations.map((l) => (
            <li key={l}>{t(l)}</li>
          ))}
        </ul>
        <div className="embed-box">
          <div>
            <strong>
              {t("Put this finding where others can discover it.")}
            </strong>
            <p>{t("Share a permanent snapshot of the evidence.")}</p>
          </div>
          <CopyButton
            value={`[![${t(m.topic.name)}: ${t(m.headline)}](${location.origin}${localUrl(`/api/cards/${m.id}.png?v=2`)})](${share})`}
            label={t("Copy README card")}
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
    return <Empty title={t("Repository unavailable")} description={t(error)} />;
  if (!r)
    return (
      <Loading
        text={t("Reading repository history and maintenance signals…")}
      />
    );
  return (
    <div className="detail-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={16} />
        {t("Back to radar")}
      </button>
      <div className="detail-heading">
        <div>
          <div className="eyebrow">{t("REPOSITORY INTELLIGENCE")}</div>
          <h1 className="repo-title">{r.name}</h1>
          <p>{r.description}</p>
        </div>
        <button className="button" onClick={() => onWatch(r.name)}>
          <Bookmark size={15} />
          {watch.includes(r.name) ? t("Watching") : t("Add to watchlist")}
        </button>
      </div>
      <div className="metric-grid">
        <div>
          <span>{t("Total stars")}</span>
          <strong>{number(r.stars)}</strong>
        </div>
        <div>
          <span>{t("Stars / last 7 days")}</span>
          <strong className="positive">
            {r.growth7d === null ? "—" : "+" + number(r.growth7d)}
          </strong>
        </div>
        <div>
          <span>{t("Stars / last 30 days")}</span>
          <strong>
            {r.growth30d === null ? "—" : "+" + number(r.growth30d)}
          </strong>
        </div>
        <div>
          <span>{t("License")}</span>
          <strong className="small-value">
            {r.license || t("Not specified")}
          </strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h3>{t("Daily new stars")}</h3>
          <div className="segmented">
            {[7, 30, 90].map((d) => (
              <button
                className={days === d ? "active" : ""}
                key={d}
                onClick={() => setDays(d)}
              >
                {d}
                {t("d")}
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
          {t(
            "GitHub calendar-bucket counts; not rolling 24-hour net growth. Each chart is scaled to its visible range.",
          )}
        </p>
      </section>
      <div className="detail-columns">
        <section className="panel">
          <h3>{t("Maintenance in context")}</h3>
          <dl className="facts">
            <dt>{t("Last push")}</dt>
            <dd>{r.pushedAt.slice(0, 10)}</dd>
            <dt>{t("Repository created")}</dt>
            <dd>{r.createdAt.slice(0, 10)}</dd>
            <dt>{t("Primary language")}</dt>
            <dd>{r.language || t("Not specified")}</dd>
            <dt>{t("Archived")}</dt>
            <dd>{r.archived ? t("Yes") : t("No")}</dd>
            <dt>{t("Forks")}</dt>
            <dd>{number(r.forks)}</dd>
          </dl>
        </section>
        <section className="panel">
          <h3>{t("The people behind the project")}</h3>
          <dl className="facts">
            <dt>{t("Maintainer response median")}</dt>
            <dd>
              {r.issueResponseHours === null
                ? t("Unavailable")
                : t("{hours} hours", {
                    hours: r.issueResponseHours.toFixed(1),
                  })}
            </dd>
            <dt>{t("Issues sampled")}</dt>
            <dd>{r.issueSampleSize}</dd>
            <dt>{t("No maintainer response found")}</dt>
            <dd>{r.unansweredIssues}</dd>
            <dt>{t("Contributors returned")}</dt>
            <dd>{number(r.contributors)}</dd>
            <dt>{t("Top contributor commit share")}</dt>
            <dd>
              {r.topContributorShare === null
                ? t("Unavailable")
                : (r.topContributorShare * 100).toFixed(0) + "%"}
            </dd>
          </dl>
          <p className="footnote">
            {t(
              "Recent issue sample; bots and self-replies excluded. Unanswered issues are reported separately. Contributor share reflects returned commit counts.",
            )}
          </p>
        </section>
      </div>
      {r.errors.length > 0 && (
        <section className="panel">
          <h3>{t("Data notes")}</h3>
          <ul>
            {r.errors.map((e, i) => (
              <li key={i}>{t(e)}</li>
            ))}
          </ul>
        </section>
      )}
      <a className="button" href={r.url} target="_blank" rel="noreferrer">
        {t("Explore on GitHub")}
        <ArrowUpRight size={16} />
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
      <div className="eyebrow">{t("SIDE BY SIDE")}</div>
      <h1>
        {t("Compare the contenders")}
        <span className="lime">.</span>
      </h1>
      <p className="page-intro">
        {t(
          "A shared view of growth, activity and maintenance. Choose what deserves a closer look.",
        )}
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
          aria-label={t("Repositories to compare")}
        />
        <button className="button" disabled={loading}>
          {t("Compare")}
          <ArrowRight size={16} />
        </button>
      </form>
      {error && (
        <p role="alert" className="error-text">
          {t(error)}
        </p>
      )}
      {loading ? (
        <Loading text={t("Gathering comparable repository evidence…")} />
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
                  <dt>{t("Stars")}</dt>
                  <dd>{number(r.stars)}</dd>
                  <dt>{t("7-day new stars")}</dt>
                  <dd>{number(r.growth7d)}</dd>
                  <dt>{t("30-day new stars")}</dt>
                  <dd>{number(r.growth30d)}</dd>
                  <dt>{t("Forks")}</dt>
                  <dd>{number(r.forks)}</dd>
                  <dt>{t("Last push")}</dt>
                  <dd>{r.pushedAt.slice(0, 10)}</dd>
                  <dt>{t("License")}</dt>
                  <dd>{r.license || t("Not specified")}</dd>
                  <dt>{t("Maintainer response")}</dt>
                  <dd>
                    {r.issueResponseHours === null
                      ? t("Unavailable")
                      : r.issueResponseHours.toFixed(1) + "h"}
                  </dd>
                </dl>
              </section>
            ))}
          </div>
          <div className="compare-foot">
            <p className="footnote">
              {t(
                "Sparklines use independent vertical scales. Compare numeric values for magnitude; star windows follow GitHub calendar buckets.",
              )}
            </p>
            <CopyButton
              value={
                location.origin +
                localUrl("/compare?repos=" + repos.map((r) => r.name).join(","))
              }
              label={t("Share comparison")}
            />
          </div>
        </>
      ) : (
        <Empty
          title={t("Bring your shortlist")}
          description={t(
            "Compare two to six public repositories. Start with a category on the radar, or paste repository names above.",
          )}
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
      <div className="eyebrow">{t("YOUR PERSONAL SIGNALS")}</div>
      <h1>
        {t("Keep the good ones close")}
        <span className="lime">.</span>
      </h1>
      <p className="page-intro">
        {t(
          "Follow projects worth returning to. Your list stays in this browser.",
        )}
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
          aria-label={t("Add repository to watchlist")}
        />
        <button className="button">
          {t("Add project")}
          <ArrowUpRight size={15} />
        </button>
      </form>
      {errors.map((e) => (
        <p className="error-text" key={e}>
          {t(e)}
        </p>
      ))}
      {loading ? (
        <Loading text={t("Refreshing your watchlist…")} />
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
          title={t("Make room for your next discovery")}
          description={t(
            "Save a project from any category or add a repository above. No account required.",
          )}
          action={
            <button className="button" onClick={() => navigate("/")}>
              {t("Explore the radar")}
              <ArrowUpRight size={15} />
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
      <div className="eyebrow">{t("OPEN DATA. OPEN METHOD.")}</div>
      <h1>
        {t("A signal you can inspect")}
        <span className="lime">.</span>
      </h1>
      <p className="page-intro">
        {t(
          "ghtrends puts two independent questions together: how much active open-source supply exists, and whether search demand is growing.",
        )}
      </p>
      <section className="panel">
        <h2>{t("The four landscapes")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t("Landscape")}</th>
              <th>{t("Supply")}</th>
              <th>{t("Sustained demand growth")}</th>
              <th>{t("Starting strategy")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Pill kind="blue" />
              </td>
              <td>{t("Under 50 projects")}</td>
              <td>{t("Fast")}</td>
              <td>{t("Validate an underserved use case.")}</td>
            </tr>
            <tr>
              <td>
                <Pill kind="expanding" />
              </td>
              <td>{t("50+ projects")}</td>
              <td>{t("Fast")}</td>
              <td>{t("Find a specific audience or advantage.")}</td>
            </tr>
            <tr>
              <td>
                <Pill kind="contested" />
              </td>
              <td>{t("50+ projects")}</td>
              <td>{t("Not fast")}</td>
              <td>{t("Identify a reason people would switch.")}</td>
            </tr>
            <tr>
              <td>
                <Pill kind="quiet" />
              </td>
              <td>{t("Under 50 projects")}</td>
              <td>{t("Not fast")}</td>
              <td>{t("Check if the market is early, niche or inactive.")}</td>
            </tr>
          </tbody>
        </table>
        <p>
          {t(
            "“Uncharted” means the evidence is missing, stale or too weak. Zero search values can be rounded or below Google’s reporting threshold; they never establish that demand does not exist.",
          )}
        </p>
      </section>
      <div className="detail-columns">
        <section className="panel">
          <span className="section-kicker">{t("01 / DEMAND")}</span>
          <h2>{t("Look past the spike.")}</h2>
          <p>
            {t(
              "We compare median search interest across the last eight complete weeks and the previous eight. Fast growth requires at least 25% growth, positive growth in the lower resampling band, and at least six recent weeks above the prior baseline.",
            )}
          </p>
          <p>
            {t(
              "A weekly observation is usable only after that week ended at collection time. Invalid rows cannot refresh old evidence, and conflicting values for the same week prevent classification.",
            )}
          </p>
          <p>
            {t(
              "Two-week block resampling tests sensitivity to individual observations. A year-over-year comparison checks recurring seasonal rebounds. These diagnostics are not probabilities of business success.",
            )}
          </p>
          <p>
            {t(
              "Search terms are measured alongside a shared “github trending” reference in the same region and time range. Google Trends is normalized, sampled search attention, not absolute demand.",
            )}
          </p>
          <a
            className="text-link"
            href="https://support.google.com/trends/answer/4365533"
            target="_blank"
            rel="noreferrer"
          >
            {t("How Google Trends works")}
            <ArrowUpRight size={14} />
          </a>
        </section>
        <section className="panel">
          <span className="section-kicker">{t("02 / SUPPLY")}</span>
          <h2>{t("Count active alternatives.")}</h2>
          <p>
            {t(
              "A matching repository must carry the selected GitHub topic, have at least five stars, have been pushed to in the last 180 days, and be neither a fork nor archived.",
            )}
          </p>
          <p>
            {t(
              "Fifty qualifying repositories is the published dense-supply threshold. This is a transparent operational rule, not a universal economic law. Topic labels are imperfect; untagged projects and commercial competitors are outside this sample.",
            )}
          </p>
          <p>
            {t(
              "Repository charts use GitHub’s official star-history calendar buckets. Issue-response times cover a recent sample, separating unanswered issues. All raw evidence is exportable.",
            )}
          </p>
          <a
            className="text-link"
            href={SOURCE + "/tree/main/src/core"}
            target="_blank"
            rel="noreferrer"
          >
            {t("Inspect the algorithm")}
            <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
      <section className="panel">
        <h2>{t("Your terminal. Your agent.")}</h2>
        <p>
          {t(
            "Node.js 22.13 or newer. Public queries work without credentials within GitHub’s unauthenticated limits. Configure your own token or GitHub App for larger scans.",
          )}
        </p>
        <div className="code-block">
          <pre>{`npm install -g https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.2.0/ghtrends-radar-0.2.0.tgz\n\nghtrends scan --topic mcp-servers --json\nghtrends repo facebook/react\nghtrends compare facebook/react vuejs/core --format md\nghtrends watch add facebook/react\nghtrends watch run\nghtrends report --topic agent-memory --format md\nghtrends ui --port 3721\nghtrends mcp`}</pre>
          <CopyButton value="ghtrends scan --topic mcp-servers --json" />
        </div>
        <h3>{t("Connect an MCP client")}</h3>
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
          {t("Tools:")}
          <code>ghtrends_scan</code>, <code>ghtrends_repo</code>,{" "}
          <code>ghtrends_compare</code>, <code>ghtrends_watch_list</code>
          {t(
            ". Results include data sources, time windows, confidence and limitations.",
          )}
        </p>
      </section>
      <section className="panel">
        <h2>{t("How to use a classification")}</h2>
        <p>
          {t(
            "Use it to decide where to investigate next. Validate real workflows with people, inspect existing alternatives and account for commercial products. The opportunity score ranks the measured signals; it does not predict revenue, investment outcomes or GitHub stars.",
          )}
        </p>
        <p>
          {t(
            "Reports are immutable snapshots. A fresh scan can produce a different classification while the original evidence stays available at its permanent link.",
          )}
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
      <div className="eyebrow">{t("LISTEN BEFORE YOU BUILD")}</div>
      <h1>
        {t("Find the friction")}
        <span className="lime">.</span>
      </h1>
      <p className="page-intro">
        {t(
          "Open issues people care enough to react to. Follow the source, understand the workflow, and validate the need.",
        )}
      </p>
      <div className="search-field">
        <Search size={18} />
        <input
          aria-label={t("Search demand gaps")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search alternative, frustrated, how to…")}
        />
      </div>
      <div className="filter-tabs">
        {["all", "feature-request", "alternative", "friction"].map((f) => (
          <button
            className={filter === f ? "active" : ""}
            key={f}
            onClick={() => setFilter(f)}
          >
            {t(f.replaceAll("-", " "))}
          </button>
        ))}
      </div>
      {error && (
        <p className="error-text" role="alert">
          {t(error)}
        </p>
      )}
      {loading ? (
        <Loading />
      ) : visible.length ? (
        <>
          <p className="footnote">
            {visible.length}
            {t(
              "signals · sorted by reactions · sampled from leading projects in scanned categories",
            )}
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
                    {t(g.label.replaceAll("-", " "))}
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
          title={t("No matching issue signals")}
          description={t(
            "Try a broader keyword. An empty result does not prove that demand is absent.",
          )}
        />
      )}
      <p className="footnote">
        {t(
          "Issue labels are keyword-based suggestions. Reactions do not establish a market, and issue text may be incomplete. Always read the original discussion.",
        )}
      </p>
    </div>
  );
}
