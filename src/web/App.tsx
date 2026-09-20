import { ScopeReview } from "./preflight.js";
import { DeepResearchView } from "./deep.js";
import { AccountView } from "./credits.js";
import { ResearchFeedback } from "./feedback.js";
import {
  inspectInput,
  type PreflightResult,
  type ResearchScope,
} from "../core/preflight.js";
import { researchLandscape } from "../core/landscape.js";
import { OpportunityMap, TopicOverview } from "./opportunities.js";
import { visibleOpportunities } from "../core/opportunities.js";
import { COMPETITION_POLICY } from "../core/competition.js";
import { RequestCard, LandscapePanel, CompetitorPanel } from "./landscape.js";
import { reportIssueSignals, selectGapSignals } from "../core/gaps.js";
import { enableEngagement, track } from "./engagement.js";
import { SourceDocuments } from "./documents.js";
import { AdminView } from "./admin.js";
import { ALGORITHM_VERSION } from "../core/version.js";
import { ActivityFeed } from "./activity.js";
import { api, setCsrf, watchResearch } from "./api.js";
import {
  HistoryView,
  SignInGate,
  UsageSummary,
  ResearchCost,
  type Account,
} from "./account.js";
import { t, locale, localUrl, loginUrl, switchLanguage } from "./i18n.js";
import React, { useEffect, useState, useRef } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Search,
  SlidersHorizontal,
  Download,
  Terminal,
  ChevronDown,
  Globe2,
  Radio,
  ScanLine,
  GitCompareArrows,
  Bookmark,
  X,
  ExternalLink,
  Check,
  RefreshCw,
  Activity,
  Info,
  Menu,
  UserRound,
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
  topicColor,
} from "./components.js";
import { downloadCard } from "./export.js";
import {
  marketAssessment,
  competitionPressure,
  outlookPresentation,
} from "../core/assessment.js";
import { resolveTopic } from "../core/topics.js";
import type { ScanProgress } from "../core/engine.js";
import { completeWeeklySeries } from "../core/evidence.js";
import { visibleStrategy } from "../core/strategy.js";
import { appUrl, routeUrl, currentRoute } from "./paths.js";
const SOURCE = "https://github.com/noahbenjamin1994/ghtrends-radar";
export function App() {
  const [path, setPath] = useState(currentRoute()),
    [markets, setMarkets] = useState<Market[]>([]),
    [topics, setTopics] = useState<Topic[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(
      new URLSearchParams(location.search).get("q")?.slice(0, 300) || "",
    ),
    [keyword, setKeyword] = useState(""),
    [geo, setGeo] = useState(
      new URLSearchParams(location.search).get("geo") || "",
    ),
    [sort, setSort] = useState("growth"),
    [filter, setFilter] = useState("all"),
    [watch, setWatch] = useState<string[]>([]),
    [mobileMenu, setMobileMenu] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [creditNotice, setCreditNotice] = useState("");
  const preparationVersion = useRef(0);
  const [preparing, setPreparing] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preparationContext, setPreparationContext] = useState<{
    keyword?: string;
    geo: string;
  }>({ geo: "" });
  const [pollError, setPollError] = useState("");
  const [choices, setChoices] = useState<{ label: string; query: string }[]>(
    [],
  );
  const loadAccount = () =>
    api<Account>("/api/account?lang=" + locale).then((a) => {
      setCsrf(a.csrf);
      enableEngagement(a.engagementEnabled);
      setAccount(a);
      return a;
    });
  useEffect(() => {
    void loadAccount()
      .then(async (a) => {
        if (a.user) {
          const rows = await api<string[]>("/api/watch");
          setWatch(rows);
          const pending = sessionStorage.getItem("ghtrends:job");
          if (pending) {
            setJob({ id: pending, state: "running", topic: "" });
            setScanning(true);
          }
          const draft = sessionStorage.getItem("ghtrends:draft");
          if (draft) {
            try {
              const d = JSON.parse(draft);
              setQuery(d.input);
              setKeyword(d.keyword || "");
              setGeo(d.geo || "");
            } catch {}
            sessionStorage.removeItem("ghtrends:draft");
          }
        } else setWatch([]);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible")
        void loadAccount().catch(() => {});
    };
    const returned = () =>
      setCreditNotice("Your research credit has been returned");
    window.addEventListener("ghtrends:credit-returned", returned);
    window.addEventListener("ghtrends:usage", update);
    window.addEventListener("focus", update);
    const timer = setInterval(update, 60000);
    return () => {
      window.removeEventListener("ghtrends:credit-returned", returned);
      window.removeEventListener("ghtrends:usage", update);
      window.removeEventListener("focus", update);
      clearInterval(timer);
    };
  }, []);
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
    const started = job?.created || Date.now();
    setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [scanning, job?.created]);
  const navigate = (input: string) => {
    const destination =
      geo && input.startsWith("/market/") && !input.includes("?")
        ? input + "?geo=" + geo
        : input;
    const url = localUrl(destination);
    history.pushState({}, "", url);
    setPath(routeUrl(url));
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useEffect(() => {
    const pop = () => {
      setPath(currentRoute());
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
  const signIn = (returnTo = path) => {
    location.assign(loginUrl(returnTo));
  };
  const toggleWatch = (name: string) => {
    if (!account?.user) {
      signIn();
      return;
    }
    void api<string[]>("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: name, added: !watch.includes(name) }),
    })
      .then((rows) => {
        setWatch(rows);
        if (rows.includes(name)) track("project_save");
      })
      .catch((e) => setError(e.message));
  };
  const scan = async (input: string, demandKeyword?: string, region = geo) => {
    if (!input.trim()) return;
    const version = ++preparationVersion.current;
    setPreparationContext({
      keyword: demandKeyword || keyword.trim() || undefined,
      geo: region,
    });
    const local = inspectInput(input);
    setPreflight(local);
    setScanError("");
    if (local) return;
    if (!account?.user) {
      sessionStorage.setItem(
        "ghtrends:draft",
        JSON.stringify({
          input,
          keyword: demandKeyword || keyword,
          geo: region,
        }),
      );
      signIn("/");
      return;
    }
    setCreditNotice("");
    setChoices([]);
    setPreparing(true);
    const context = {
      keyword: demandKeyword || keyword.trim() || undefined,
      geo: region,
    };
    setPreparationContext(context);
    try {
      const result = await api<PreflightResult>("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: input, ...context }),
      });
      if (version === preparationVersion.current) setPreflight(result);
    } catch (e) {
      if (version === preparationVersion.current)
        setScanError((e as Error).message);
    } finally {
      if (version === preparationVersion.current) setPreparing(false);
    }
  };
  const editResearchScope = (scope: ResearchScope) => {
    ++preparationVersion.current;
    setPreflight(null);
    setQuery(scope.input);
    setKeyword(scope.keyword || "");
    setGeo(scope.geo);
    navigate(scope.geo ? "/?geo=" + encodeURIComponent(scope.geo) : "/");
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLInputElement>(".search-form input, form input")
        ?.focus(),
    );
  };
  const beginResearch = async (scope: ResearchScope) => {
    setPreflight(null);
    setScanning(true);
    setScanError("");
    setPollError("");
    try {
      const d = await api<any>("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: scope.input,
          geo: scope.geo,
          keyword: scope.keyword,
          preflightId: scope.id,
        }),
      });
      if (d.state === "complete") {
        if (d.credit === "free")
          setCreditNotice("Cached result opened · 0 credits used");
        await refresh();
        navigate("/report/" + d.market.id);
        setScanning(false);
      } else {
        setJob(d);
        sessionStorage.setItem("ghtrends:job", d.id);
      }
    } catch (e) {
      const error = e as Error & {
        status?: number;
        guidance?: PreflightResult;
        scope?: ResearchScope;
      };
      setScanning(false);
      if (error.guidance || error.scope)
        setPreflight(error.guidance || error.scope || null);
      else if (error.status === 409)
        await scan(scope.input, scope.keyword, scope.geo);
      else setScanError(error.message);
    }
  };
  useEffect(() => {
    if (!job) return;
    return watchResearch<any>(
      "/api/jobs/" + job.id,
      (d) => {
        setPollError("");
        if (d.state === "complete") {
          if (d.credit === "returned")
            setCreditNotice(
              "Collection needs a refresh · Your research credit has been returned",
            );
          setJob(null);
          sessionStorage.removeItem("ghtrends:job");
          setScanning(false);
          void loadAccount();
          void refresh();
          navigate("/report/" + d.market.id);
          return true;
        }
        if (d.state === "failed") {
          void loadAccount();
          if (d.credit === "returned")
            setCreditNotice("Your research credit has been returned");
          setScanError(d.clarification?.[locale] || d.error || "Scan failed.");
          setChoices(d.choices || []);
          sessionStorage.removeItem("ghtrends:job");
          setJob(null);
          setScanning(false);
          return true;
        }
        setJob(d);
        return false;
      },
      (error) => {
        if ([401, 403, 404].includes(error.status)) {
          setScanError(error.message);
          sessionStorage.removeItem("ghtrends:job");
          setJob(null);
          setScanning(false);
        } else
          setPollError(
            "Reconnecting to your research. Your task continues on the server.",
          );
      },
    );
  }, [job?.id]);
  const pendingAssessment = job?.progress?.preview
    ? marketAssessment(job.progress.preview, locale)
    : null;
  const scanTopic = job?.progress?.topic || null;
  const stageLabels = {
    interpreting: "Understanding your research question",
    brief: "Developing a focused product strategy",
    researching: "Reading project documentation and user requests",
    reviewing: "Comparing directions, resources and evidence",
    refining: "Refining same-intent project searches",
    sources: "Collecting source evidence",
    github: "GitHub supply received",
    demand: "Search history received",
    details: "Core evidence ready; adding project details",
  };
  const route = path.split("?")[0]!;
  useEffect(() => {
    if (account && route === "/start") track("opensource_view", "start");
  }, [route, account]);
  const active =
    route === "/account"
      ? "account"
      : route === "/admin"
        ? "admin"
        : route.startsWith("/history") || route.startsWith("/research/")
          ? "history"
          : route.startsWith("/compare")
            ? "compare"
            : route.startsWith("/watch")
              ? "history"
              : route.startsWith("/docs")
                ? "docs"
                : route.startsWith("/start")
                  ? "start"
                  : route.startsWith("/gaps")
                    ? "gaps"
                    : "radar";
  const shown = markets
    .filter(
      (m) => filter === "all" || marketAssessment(m, locale).kind === filter,
    )
    .sort((a, b) =>
      sort === "growth"
        ? (b.metrics.growth ?? -Infinity) - (a.metrics.growth ?? -Infinity)
        : b.asOf.localeCompare(a.asOf),
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
          id="main-navigation"
          className={mobileMenu ? "is-open" : ""}
          aria-label={t("Main navigation")}
        >
          {[
            ["radar", "Explore", "/"],
            ...(account?.user ? [["history", "My research", "/history"]] : []),
            ["start", "Use open source", "/start"],
          ].map(([key, label, href]) => {
            return (
              <button
                key={String(key)}
                className={active === key ? "active" : ""}
                aria-current={active === key ? "page" : undefined}
                onClick={() => navigate(String(href))}
              >
                {t(String(label))}
              </button>
            );
          })}
        </nav>
        <div className="header-end">
          {account?.user ? (
            <details className="account-menu">
              <summary
                aria-label={
                  account.quota
                    ? t("{remaining} of {limit} research credits left today", {
                        remaining: account.quota.remaining,
                        limit: account.quota.limit,
                      })
                    : t("Account")
                }
              >
                <UserRound className="account-symbol" size={16} />
                <span>
                  {account.quota ? (
                    <>
                      <b className="quota-count">{account.quota.remaining}</b>
                      <span className="quota-total">
                        /{account.quota.limit}
                      </span>
                    </>
                  ) : (
                    t("Account")
                  )}
                </span>
                <ChevronDown className="account-chevron" size={14} />
              </summary>
              <div
                className="account-popover"
                onClick={(event) =>
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open")
                }
              >
                <strong>
                  {account.hosted ? account.user.name : t("Local workspace")}
                </strong>
                <UsageSummary account={account} />
                <button onClick={() => navigate("/account")}>
                  {locale === "zh" ? "账户与研究次数" : "Account & credits"}
                </button>
                <button onClick={() => navigate("/history")}>
                  {t("My research")}
                </button>
                {account.user.isAdmin && (
                  <button onClick={() => navigate("/admin")}>
                    {t("Admin")}
                  </button>
                )}
                {account.hosted && (
                  <button
                    onClick={() =>
                      void api("/auth/logout", { method: "POST" })
                        .then(() => location.assign(localUrl("/")))
                        .catch((e) => setError(e.message))
                    }
                  >
                    {t("Sign out")}
                  </button>
                )}
              </div>
            </details>
          ) : (
            account?.hosted && (
              <button className="account-button" onClick={() => signIn()}>
                {t("Sign in")}
              </button>
            )
          )}
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
            aria-label={t("Star on GitHub")}
            title={t("Star on GitHub")}
            href={SOURCE}
            onClick={() => track("github_click")}
            target="_blank"
            rel="noreferrer"
          >
            {/* Official, unmodified asset: https://brand.github.com/foundations/logo */}
            <img
              src={appUrl("/github-mark.svg")}
              width="22"
              height="22"
              alt=""
            />
          </a>
          <button
            className="icon-button mobile-menu"
            aria-label={t("Toggle navigation")}
            aria-expanded={mobileMenu}
            aria-controls="main-navigation"
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            {mobileMenu ? <X size={22} /> : <Menu size={22} />}
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
        {creditNotice && (
          <div className="credit-notice" role="status">
            <span>{t(creditNotice)}</span>
            <button
              className="icon-button"
              aria-label={t("Dismiss")}
              onClick={() => setCreditNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {route === "/" ? (
          <>
            <div className="research-intro">
              <section className="page-heading research-heading">
                <div>
                  <div className="eyebrow">
                    <span className="live-dot" />
                    {t("THE OPEN-SOURCE OPPORTUNITY RADAR")}
                  </div>
                  <h1>{t("Research your next idea")}</h1>
                </div>
                <div className="heading-aside">
                  <p>
                    {t(
                      "Search interest. Active projects. Unresolved workflows.",
                    )}
                    <br />
                    {t("A short report with sources and a next step.")}
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
              <section
                className="search-hero"
                aria-label={t("Research a direction")}
              >
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
                      onChange={(e) => {
                        ++preparationVersion.current;
                        setPreparing(false);
                        setQuery(e.target.value);
                        setPreflight(null);
                      }}
                      placeholder={t("Explore a topic, e.g. agent memory")}
                      aria-label={t("Search or scan a topic")}
                      maxLength={300}
                    />
                    <button
                      disabled={
                        !account || scanning || preparing || !query.trim()
                      }
                      type="submit"
                    >
                      {t(
                        preparing
                          ? "Preparing…"
                          : scanning
                            ? "Researching…"
                            : !account
                              ? "Research"
                              : account.hosted
                                ? account.user
                                  ? "Research · 1 credit"
                                  : "Sign in to research"
                                : "Scan",
                      )}
                      <ArrowUpRight size={15} />
                    </button>
                  </form>
                </div>
                <ScopeReview
                  result={preflight}
                  preparing={preparing}
                  hosted={!!account?.hosted}
                  onChoose={(query) => {
                    setQuery(query);
                    void scan(
                      query,
                      preparationContext.keyword,
                      preparationContext.geo,
                    );
                  }}
                  onConfirm={(scope) => void beginResearch(scope)}
                  onEdit={editResearchScope}
                  onClose={() => setPreflight(null)}
                />
                <div className="search-options">
                  <label className="select-field">
                    <Globe2 size={15} />
                    <select
                      value={geo}
                      onChange={(e) => {
                        const value = e.target.value;
                        ++preparationVersion.current;
                        setPreparing(false);
                        setPreflight(null);
                        setGeo(value);
                        const url = new URL(location.href);
                        if (value) url.searchParams.set("geo", value);
                        else url.searchParams.delete("geo");
                        history.replaceState({}, "", url.pathname + url.search);
                        setPath(routeUrl(url.pathname) + url.search);
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
                  <details className="keyword-options">
                    <summary>
                      {t("Choose a different Google search term")}
                    </summary>
                    <label>
                      {t("Demand keyword")}
                      <input
                        value={keyword}
                        onChange={(e) => {
                          ++preparationVersion.current;
                          setPreparing(false);
                          setPreflight(null);
                          setKeyword(e.target.value);
                        }}
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
                </div>
                {!account ? (
                  <p className="research-access-loading" role="status">
                    {t("Checking research access…")}
                  </p>
                ) : account.hosted && account.user ? (
                  <div className="research-allowance">
                    <UsageSummary account={account} />
                    <ResearchCost account={account} />
                  </div>
                ) : (
                  <p className="scan-access-note">
                    {t(
                      account?.hosted
                        ? "Public reports are free to browse. Sign in for {limit} research credits each day and your saved history."
                        : "Self-hosted: your keys, your data. Scans are saved on this server.",
                      { limit: account?.dailyLimit || 10 },
                    )}
                  </p>
                )}
                {account?.trends.retryAt && (
                  <p className="source-notice" role="status">
                    {t(
                      "Google Trends collection resumes at {time}. Explore public reports while it refreshes.",
                      {
                        time: new Date(
                          account.trends.retryAt,
                        ).toLocaleTimeString(),
                      },
                    )}
                  </p>
                )}
                <div className="example-links">
                  <span>{t("Read a public example")}</span>
                  {["browser-agents", "agent-memory", "mcp-servers"].map(
                    (slug) => (
                      <button
                        key={slug}
                        onClick={() => navigate("/market/" + slug)}
                      >
                        {t(resolveTopic(slug).name)}
                      </button>
                    ),
                  )}
                </div>
              </section>
            </div>
            <section className="market-section">
              <div className="section-header">
                <div>
                  <div className="section-kicker">{t("PUBLIC RESEARCH")}</div>
                  <h2>
                    {t("Your next starting point")}
                    <span className="accent-ink">↗</span>
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

              <div className="category-tools">
                {" "}
                <label className="select-field">
                  <SlidersHorizontal size={15} />
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                    aria-label={t("Sort categories")}
                  >
                    <option value="recent">{t("Recently updated")}</option>
                    <option value="growth">{t("Search growth")}</option>
                  </select>
                  <ChevronDown size={13} />
                </label>
                <span>{t("Public examples · updated source evidence")}</span>
              </div>
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
                          "--accent": topicColor(m.topic.slug),
                          "--delay": `${i * 45}ms`,
                        } as React.CSSProperties
                      }
                    >
                      <div className="card-top">
                        <span className="category-mark">
                          {m.topic.name.slice(0, 1)}
                          <sup>↗</sup>
                        </span>
                        <Pill
                          kind={marketAssessment(m, locale).kind}
                          label={marketAssessment(m, locale).landscape}
                        />
                      </div>
                      <h3>
                        {t(m.topic.name)}
                        <ArrowUpRight size={20} />
                      </h3>
                      <p className="card-assessment">
                        {marketAssessment(m, locale).reason}
                      </p>
                      <Sparkline
                        values={completeWeeklySeries(m.demand, m.asOf)
                          .points.slice(-26)
                          .map((p) => p.value)}
                        color={topicColor(m.topic.slug)}
                        height={49}
                        fill
                      />
                      <div className="card-metrics">
                        <div>
                          <small>
                            {t("Search direction")} ·{" "}
                            {t("trend." + (m.metrics.trend || "unknown"))}
                          </small>
                          {m.metrics.emerging ? (
                            <strong>{t("Low-base rise")}</strong>
                          ) : (
                            <Growth
                              value={
                                m.metrics.fast === null
                                  ? null
                                  : m.metrics.directionBasis === "seasonal-year"
                                    ? m.metrics.yearOverYear
                                    : m.metrics.directionBasis ===
                                        "sustained-quarter"
                                      ? (m.metrics.quarterGrowth ?? null)
                                      : m.metrics.growth
                              }
                            />
                          )}
                        </div>
                        <div>
                          <small>
                            {t(
                              m.competition
                                ? "Open-source competition"
                                : "Active projects",
                            )}
                          </small>
                          <strong>
                            {m.competition
                              ? competitionPressure(m)
                              : m.supply.error
                                ? "—"
                                : (m.supply.complete ? "" : "≥") +
                                  number(m.supply.total)}
                          </strong>
                        </div>
                        <div>
                          <small>{t("Year-over-year search change")}</small>
                          <Growth value={m.metrics.yearOverYear} />
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
            <details className="overview-disclosure">
              <summary>
                {t("View the category map")} <ChevronDown size={18} />
              </summary>
              <section className="radar-section">
                <div className="radar-sidebar">
                  <div className="section-kicker">{t("CATEGORY MAP")}</div>
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
                  <button
                    className="text-link"
                    onClick={() => navigate("/docs")}
                  >
                    {t("Understand the methodology")}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
                <Radar
                  markets={markets}
                  onSelect={(m) => navigate("/market/" + m.topic.slug)}
                />
              </section>
            </details>
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
                onClick={() => navigate("/start")}
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
            account={account}
          />
        ) : route.startsWith("/research/") ? (
          <DeepResearchView id={route.slice(10)} account={account} />
        ) : route.startsWith("/repo/") ? (
          <RepoView
            account={account}
            name={decodeURIComponent(route.slice(6))}
            watch={watch}
            onWatch={toggleWatch}
            navigate={navigate}
          />
        ) : route === "/compare" ? (
          account?.user ? (
            <CompareView path={path} navigate={navigate} account={account} />
          ) : (
            <SignInGate account={account} returnTo={path} purpose="compare" />
          )
        ) : route === "/admin" ? (
          <AdminView account={account} />
        ) : route === "/account" ? (
          <AccountView account={account} />
        ) : route === "/history" || route === "/watch" ? (
          <HistoryView
            account={account}
            navigate={navigate}
            tab={
              route === "/watch" ||
              new URLSearchParams(path.split("?")[1]).get("tab") === "projects"
                ? "projects"
                : "reports"
            }
          >
            <WatchView
              names={watch}
              onWatch={toggleWatch}
              navigate={navigate}
            />
          </HistoryView>
        ) : route === "/gaps" ? (
          <GapView />
        ) : route === "/start" ? (
          <StartView />
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
      {path.split("?")[0] !== "/" && (preparing || preflight) && (
        <div className="scope-overlay">
          <ScopeReview
            result={preflight}
            preparing={preparing}
            hosted={!!account?.hosted}
            onChoose={(query) => {
              setQuery(query);
              void scan(
                query,
                preparationContext.keyword,
                preparationContext.geo,
              );
            }}
            onConfirm={(scope) => void beginResearch(scope)}
            onEdit={editResearchScope}
            onClose={() => setPreflight(null)}
          />
        </div>
      )}
      {(scanning || scanError) && (
        <div className="scan-status" role={scanError ? "alert" : "status"}>
          {scanError ? (
            <>
              <Info size={20} />
              <div>
                <strong>{t("Scan needs attention")}</strong>
                <p>{t(scanError)}</p>
                {choices.length > 0 && (
                  <div className="topic-chips">
                    {choices.map((c) => (
                      <button key={c.query} onClick={() => void scan(c.query)}>
                        {c.label} <ArrowUpRight size={13} />
                      </button>
                    ))}
                  </div>
                )}
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
                {pollError && <p>{t(pollError)}</p>}
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
                <ActivityFeed items={job?.progress?.activities} />
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
  account,
}: {
  path: string;
  geo: string;
  navigate: (s: string) => void;
  watch: string[];
  onWatch: (s: string) => void;
  onScan: (s: string, keyword?: string, region?: string) => void;
  account: Account | null;
}) {
  const [m, setM] = useState<Market | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<{
      public: boolean;
      owned: boolean;
      saved: boolean;
    } | null>(null),
    [actionError, setActionError] = useState(""),
    [saved, setSaved] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (m)
      void api<{ public: boolean; owned: boolean; saved: boolean }>(
        "/api/reports/" + m.id + "/access",
      )
        .then((a) => {
          setAccess(a);
          setSaved(a.saved);
        })
        .catch(() => {});
  }, [m?.id, account?.user?.name]);
  useEffect(() => {
    if (m && account) track("report_view", m.id);
  }, [m?.id, account]);
  useEffect(() => {
    setLoading(true);
    setAccess(null);
    setSelected([]);
    setSaved(false);
    setActionError("");
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
          path.startsWith("/report/") && account?.hosted && !account.user ? (
            <a className="button" href={loginUrl(path)}>
              {t("Sign in to open your private reports")}
            </a>
          ) : (
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
          )
        }
      />
    );
  const assessment = marketAssessment(m, locale);
  const displayKind = assessment.kind;
  const presentation = outlookPresentation(displayKind, locale);
  const strategy =
    assessment.narrative.kind === "ai"
      ? visibleStrategy(m.brief, locale)
      : undefined;
  const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const opportunityMap = visibleOpportunities(m.brief);
  const share = location.origin + localUrl("/report/" + m.id);
  const demandPoints = completeWeeklySeries(m.demand, m.asOf).points;
  const gapSignals = reportIssueSignals(m);
  const requestAuthors = new Set(
    gapSignals.flatMap((g) => (g.authorKey ? [g.authorKey] : [])),
  );
  return (
    <div className="detail-page report-page">
      <button className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={16} />
        {t("Back to the radar")}
      </button>
      {m.version !== ALGORITHM_VERSION && (
        <div className="admin-note old-method">
          <p>
            {t(
              "This saved report uses method {old}. Current method: {current}. Run a new scan to update the evidence; the original snapshot stays unchanged.",
              { old: m.version, current: ALGORITHM_VERSION },
            )}
          </p>
          <button
            className="button secondary"
            onClick={() =>
              onScan(
                m.topic.plan?.input || m.topic.slug,
                m.topic.keyword,
                m.geo,
              )
            }
          >
            {t("Run an updated scan")}
          </button>
        </div>
      )}
      <div className="detail-heading">
        <div>
          <div className="eyebrow">
            {t("CATEGORY INTELLIGENCE /")}
            {m.geo || t("WORLDWIDE")}
          </div>
          <h1>
            {locale === "zh" &&
            m.topic.plan &&
            m.topic.plan.input !== m.topic.slug
              ? m.topic.plan.input
              : t(m.topic.name)}
          </h1>
          <p>
            {locale === "zh" && m.topic.plan
              ? m.topic.name
              : t(m.topic.description)}
          </p>
        </div>
        <div className="detail-actions">
          {(account?.user || account?.hosted === false) && (
            <button
              className="button subtle"
              onClick={() =>
                onScan(
                  m.topic.plan?.input || m.topic.slug,
                  m.topic.keyword,
                  m.geo,
                )
              }
            >
              <RefreshCw size={14} />
              {l("Update research", "更新研究")}
            </button>
          )}
          {access?.public ? (
            <CopyButton
              value={share}
              label={t("Share report")}
              className="button"
              onCopied={() => track("share_copy")}
            />
          ) : access?.owned ? (
            <button
              className="button subtle"
              onClick={() =>
                void api("/api/reports/" + m.id + "/share", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ shared: true }),
                })
                  .then(() => {
                    setAccess({ public: true, owned: true, saved });
                    track("share_publish");
                  })
                  .catch((e) => setActionError(e.message))
              }
            >
              {t("Make public to share")}
            </button>
          ) : null}
          {account?.user && (
            <button
              disabled={saved}
              className="button subtle"
              onClick={() =>
                void api("/api/history", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: m.id }),
                })
                  .then(() => {
                    setSaved(true);
                    track("report_save");
                  })
                  .catch((e) => setActionError(e.message))
              }
            >
              <Bookmark size={14} />
              {t(saved ? "Saved" : "Save to my research")}
            </button>
          )}
          <details className="export-menu">
            <summary className="button subtle">
              <Download size={15} />
              {t("Export")}
            </summary>
            <div>
              <a
                href={localUrl(`/api/reports/${m.id}?format=md&v=2`)}
                download={`ghtrends-${m.topic.slug}.md`}
                onClick={() => track("export_md")}
              >
                Markdown
              </a>
              <button
                onClick={() =>
                  void downloadCard(m, share, locale)
                    .then(() => track("export_png"))
                    .catch((e) => setActionError(e.message))
                }
              >
                {t("Save image")}
              </button>
              <a
                href={appUrl(`/api/reports/${m.id}`)}
                download={`ghtrends-${m.topic.slug}.json`}
                onClick={() => track("export_json")}
              >
                JSON
              </a>
            </div>
          </details>
        </div>
      </div>
      {actionError && <p role="alert">{t(actionError)}</p>}
      {access && (
        <p className="report-privacy">
          {t(
            access.public
              ? "This report is public. Anyone with the link can read it."
              : "Private report. Only you can read this result.",
          )}{" "}
          {access.public && access.owned && (
            <button
              className="text-link"
              onClick={() =>
                void api("/api/reports/" + m.id + "/share", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ shared: false }),
                })
                  .then(() => setAccess({ public: false, owned: true, saved }))
                  .catch((e) => setActionError(e.message))
              }
            >
              {t("Stop sharing")}
            </button>
          )}
        </p>
      )}
      <nav className="report-nav" aria-label={l("Report sections", "报告章节")}>
        <a href="#outlook">{l("Overview", "判断概览")}</a>
        {opportunityMap?.overview && (
          <a
            href={
              researchLandscape(m) ? "#market-landscape" : "#topic-overview"
            }
          >
            {l("Whole topic", "整体机会")}
          </a>
        )}
        {visibleOpportunities(m.brief) && (
          <a href="#opportunities">{l("Directions", "方向地图")}</a>
        )}
        {strategy && <a href="#strategy">{l("Strategy", "优先方向")}</a>}
        <a href="#evidence">{l("Evidence", "趋势证据")}</a>
        <a href="#competitors">{l("Competitors", "同行")}</a>
        <a href="#projects">{l("Projects", "相关项目")}</a>
        <a href="#method">{l("Research scope", "研究范围")}</a>
      </nav>
      <section
        id="outlook"
        className={`report-outlook ${displayKind}`}
        style={
          {
            "--outlook-accent": presentation.color,
            "--outlook-wash": presentation.wash,
          } as React.CSSProperties
        }
      >
        <div className="outlook-copy">
          <div className="outlook-meta">
            {l("THE OPPORTUNITY IN FOCUS", "这次，机会在哪里")}
          </div>
          <h2>
            {opportunityMap?.overview &&
            assessment.narrative.kind === "ai" &&
            assessment.narrative.headline
              ? assessment.narrative.headline
              : opportunityMap
                ? l(
                    `${opportunityMap.opportunities.length} directions. Find your way in.`,
                    `${opportunityMap.opportunities.length} 个细分方向，找到适合你的切入点`,
                  )
                : assessment.narrative.kind === "ai" &&
                    assessment.narrative.headline
                  ? assessment.narrative.headline
                  : assessment.title}
          </h2>
          <p className="outlook-summary">
            {assessment.narrative.kind === "ai"
              ? assessment.narrative.summary
              : assessment.summary}
          </p>
          <div className="outlook-byline">
            <span>
              {assessment.narrative.kind === "ai"
                ? "DeepSeek Flash"
                : "ghtrends"}{" "}
              ·{" "}
              {assessment.narrative.kind === "ai"
                ? l("Source-led interpretation", "基于来源的解读")
                : l("Collected evidence", "采集证据摘要")}
            </span>
            <span>
              {new Date(m.asOf).toLocaleDateString(
                locale === "zh" ? "zh-CN" : "en-US",
              )}
            </span>
          </div>
        </div>
        <aside className="outlook-signal">
          <div className="outlook-verdict">
            <span className="outlook-verdict-caption">
              {assessment.basisLabel}
            </span>
            <h3>{assessment.landscape}</h3>
            <p>{assessment.reason}</p>
          </div>
          <div className="outlook-momentum">
            <span>{l("Search momentum", "搜索动向")}</span>
            <strong>
              {m.metrics.emerging ? (
                t("Low-base rise")
              ) : (
                <Growth
                  value={assessment.searchReady ? m.metrics.growth : null}
                />
              )}
            </strong>
          </div>
          <span className="outlook-window">
            {t("Last 8 complete weeks vs previous 8")}
          </span>
          <Sparkline
            values={demandPoints.slice(-26).map((p) => p.value)}
            color={m.metrics.trend === "falling" ? "#a65c42" : "#277c81"}
            height={70}
            domain={[0, 100]}
          />
          <a href={m.demand.sourceUrl} target="_blank" rel="noreferrer">
            Google Trends <ExternalLink size={12} />
          </a>
        </aside>
      </section>
      {m.aiError && (
        <p className="report-delivery-note" role="status">
          {t(m.aiError)}
        </p>
      )}
      <div className="report-facts">
        <div>
          <span>{l("Year over year", "同比搜索变化")}</span>
          <strong>
            <Growth value={m.metrics.yearOverYear} />
          </strong>
          <small>
            {l("Same 8 weeks, one year apart", "与去年相同的 8 周比较")}
          </small>
        </div>
        <div>
          <span>{l("Open-source alternatives", "同类开源项目")}</span>
          <strong>
            {m.supply.error ? "—" : number(m.competition?.direct ?? 0)}
            <em>{l("projects", "个")}</em>
          </strong>
          <small>
            {l("Reviewed GitHub search matches", "当前 GitHub 检索与审核范围")}
          </small>
        </div>
        <div>
          <span>{l("Open-source competition", "开源竞争程度")}</span>
          <strong>
            {competitionPressure(m)}
            <em>/ 100</em>
          </strong>
          <small>{t("pressure." + (m.competition?.level || "pending"))}</small>
        </div>
        <div>
          <span>{l("Search coverage", "搜索数据覆盖")}</span>
          <strong>
            {m.metrics.points}
            <em>{l("weeks", "周")}</em>
          </strong>
          <small>
            {t(m.confidence)} · {t("evidence confidence")}
          </small>
        </div>
      </div>
      {m.brief && !researchLandscape(m) && (
        <TopicOverview
          brief={m.brief}
          locale={locale}
          topic={m.topic.plan?.input || m.topic.name}
        />
      )}
      <LandscapePanel market={m} locale={locale} />
      <CompetitorPanel market={m} locale={locale} />
      <SourceDocuments market={m} locale={locale} />
      {m.brief && <OpportunityMap key={m.id} market={m} locale={locale} />}
      {strategy ? (
        <section className="strategy-section" id="strategy">
          <div className="report-section-heading">
            <div>
              <div className="eyebrow">
                {l("FIRST DIRECTION · A DEEPER LOOK", "优先方向 · 深入一步")}
              </div>
              <h3>{strategy.angle}</h3>
            </div>
            <span className="strategy-basis">
              {m.brief?.basis === "source-led"
                ? l("Source-led hypothesis", "基于来源的策略假设")
                : l("Domain hypothesis", "领域知识推演")}
            </span>
          </div>
          <p className="strategy-audience">{strategy.audience}</p>
          <div className="strategy-reasoning">
            <div>
              <h4>{l("The mechanism", "关键洞察")}</h4>
              <p>{strategy.mechanism}</p>
            </div>
            <div>
              <h4>{l("The first useful artifact", "第一件值得做的东西")}</h4>
              <p>{strategy.wedge}</p>
            </div>
          </div>
          <details className="strategy-tradeoffs">
            <summary>
              {l("The tradeoff & the assumption", "这条路的取舍与关键假设")}
            </summary>
            <div className="strategy-reasoning">
              <div>
                <h4>{l("Deliberate tradeoff", "主动取舍")}</h4>
                <p>{strategy.tradeoff}</p>
              </div>
              <div>
                <h4>{l("What must hold true", "成立条件")}</h4>
                <p>{strategy.assumption}</p>
              </div>
            </div>
          </details>
          <div className="strategy-experiment">
            <div className="eyebrow">
              {l("THE DECIDING EXPERIMENT", "用一次实验决定投入")}
            </div>
            <p>{strategy.experiment}</p>
            <div className="strategy-decisions">
              <div>
                <h4>{l("Continue when", "建议继续的信号")}</h4>
                <p>{strategy.successSignal}</p>
              </div>
              <div>
                <h4>{l("Change direction when", "建议转向的信号")}</h4>
                <p>{strategy.pivotSignal}</p>
              </div>
            </div>
          </div>
          <div className="strategy-sources">
            <span>{l("Premise sources", "推演依据")}</span>
            {m.brief?.evidence
              ?.filter(
                (ref, index, refs) =>
                  refs.findIndex((r) => r.id === ref.id) === index,
              )
              .map((ref) => {
                const source = m.brief!.sources.find((s) => s.id === ref.id);
                return source ? (
                  <a
                    key={ref.id}
                    title={ref.quote}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.label}
                    <ExternalLink size={12} />
                  </a>
                ) : null;
              })}
          </div>
          <p className="footnote">
            {l(
              "AI strategy hypothesis. The thresholds are proposed experiment criteria; actual outcomes determine the next decision.",
              "以上为 AI 提出的策略假设。数字门槛属于建议实验标准，真实结果用于决定下一步。",
            )}
          </p>
        </section>
      ) : (
        <section className="report-actions-section">
          <div className="report-section-heading">
            <div>
              <div className="eyebrow">
                {l("YOUR NEXT MOVE", "下一步怎么做")}
              </div>
              <h3>
                {l(
                  "Turn the signal into a small experiment",
                  "把判断变成一次小验证",
                )}
              </h3>
            </div>
            <span>{l("A practical starting point", "从具体行动开始")}</span>
          </div>
          <ol className="report-next-steps">
            {assessment.narrative.nextSteps.slice(0, 3).map((step, i) => (
              <li key={step}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {m.demand.retryAt && (
        <p className="admin-note">
          {t("Google Trends refresh window")}:{" "}
          {new Date(m.demand.retryAt).toLocaleString(
            locale === "zh" ? "zh-CN" : "en",
          )}
          {" · "}
          {m.demand.points.length
            ? t("Using the dated source snapshot")
            : t("Source collection is pending; refresh after this time")}
        </p>
      )}
      {m.demand.selectionReason && (
        <p className="admin-note">
          {t(m.demand.selectionReason)} ({m.demand.requestedKeyword} →{" "}
          {m.demand.keyword})
        </p>
      )}
      <div id="evidence" className="detail-columns report-evidence">
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
              color={topicColor(m.topic.slug)}
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
        <aside className="panel report-reading">
          <div className="eyebrow">
            {l("READING THE EVIDENCE", "如何读这些信号")}
          </div>
          <h3>{l("The facts behind the recommendation", "这份判断的依据")}</h3>
          {(m.reasons.length ? m.reasons : assessment.facts)
            .slice(0, 3)
            .map((f, i) => (
              <div className="reading-fact" key={f}>
                <span>{i + 1}</span>
                <p>{t(f)}</p>
              </div>
            ))}
          <p className="footnote">
            {l(
              "Search attention, open-source alternatives and customer demand are distinct research signals. Validate your audience through direct conversations.",
              "搜索关注度、开源替代项目与客户需求分别提供研究线索。可通过直接交流核实目标用户的需求。",
            )}
          </p>
        </aside>
      </div>
      {!!m.demand.alternatives?.length && (
        <details className="panel">
          <summary>{t("Related search terms")}</summary>
          <div className="panel-title">
            <div>
              <h3>{t("Related search terms")}</h3>
              <p>
                {t("Measured separately; normalized indices are not added.")}
              </p>
            </div>
          </div>
          <div className="synonym-series">
            {[m.demand, ...m.demand.alternatives].map((d, i) => (
              <article key={d.keyword}>
                <strong>{d.keyword}</strong>
                <small>
                  {i === 0 ? t("Primary query") : t("Related search terms")}
                </small>
                <Sparkline
                  values={completeWeeklySeries(d, m.asOf).points.map(
                    (p) => p.value,
                  )}
                  color={i === 0 ? topicColor(m.topic.slug) : "#8963b0"}
                  height={110}
                  domain={[0, 100]}
                />
                <small>{t("Relative search interest")} · 0–100</small>
              </article>
            ))}
          </div>
        </details>
      )}
      <section id="projects" className="panel report-projects">
        <div className="panel-title">
          <div>
            <h3>{t("The projects shaping this space")}</h3>
            <p>
              {t(
                "Direct alternatives appear first, followed by other matching projects.",
              )}
            </p>
          </div>
          <a href={m.supply.sourceUrl} target="_blank" rel="noreferrer">
            {t("View search")}
            <ExternalLink size={13} />
          </a>
        </div>
        <p className="footnote">
          {t(
            "Search matches can include libraries, integrations and resource lists. A topic tag does not prove a project is a direct competitor.",
          )}
        </p>
        {m.competition && (
          <details className="project-review">
            <summary>
              {t("Review project roles")} · {m.competition.sampled}
            </summary>
            {m.supply.repositories.map((r) => (
              <div className="project-review-row" key={r.name}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.name}
                </a>
                <span>
                  {t("role." + (r.relevance?.role || "unclear"))} ·{" "}
                  {t(
                    r.relevance?.method === "model"
                      ? "AI review"
                      : "Metadata rules",
                  )}
                </span>
                <small>
                  {r.relevance?.method === "model"
                    ? r.relevance.reason
                    : t(
                        r.relevance?.reason ||
                          "Project role awaiting closer review",
                      )}
                </small>
              </div>
            ))}
          </details>
        )}
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
        {[...m.supply.repositories]
          .sort(
            (a, b) =>
              Number(b.relevance?.role === "direct") -
              Number(a.relevance?.role === "direct"),
          )
          .slice(0, 10)
          .map((r) => (
            <RepoRow
              key={r.name}
              repo={r}
              selected={selected.includes(r.name)}
              onSelect={() =>
                setSelected((current) =>
                  current.includes(r.name)
                    ? current.filter((n) => n !== r.name)
                    : current.length < 6
                      ? [...current, r.name]
                      : current,
                )
              }
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
            disabled={selected.length < 2}
            onClick={() => navigate("/compare?repos=" + selected.join(","))}
          >
            {t("Compare selected projects")} ({selected.length}/6)
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
            <h3>{l("User requests and progress", "用户的问题与进展")}</h3>
            <p>
              {l(
                "Public requests from relevant projects. Review the original report and current version.",
                "来自相关项目的公开请求，结合原文与当前版本继续核对。",
              )}
            </p>
          </div>
          <span className="method-tag">
            {gapSignals.length}
            {t("signals")}
            {requestAuthors.size > 0 &&
              ` · ${requestAuthors.size} ${l("identified authors", "位已识别发起者")}`}
          </span>
        </div>
        {gapSignals.length ? (
          <>
            <div className="gap-grid gap-grid-research">
              {gapSignals.slice(0, 3).map((g) => (
                <RequestCard
                  key={g.url}
                  gap={g}
                  brief={m.brief}
                  locale={locale}
                />
              ))}
            </div>
            {gapSignals.length > 3 && (
              <details className="request-more">
                <summary>
                  {l("View more requests", "查看更多请求")} ·{" "}
                  {gapSignals.length - 3}
                </summary>
                <div className="gap-grid gap-grid-research">
                  {gapSignals.slice(3).map((g) => (
                    <RequestCard
                      key={g.url}
                      gap={g}
                      brief={m.brief}
                      locale={locale}
                    />
                  ))}
                </div>
              </details>
            )}
          </>
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
          <a
            href={appUrl(`/api/reports/${m.id}`)}
            target="_blank"
            rel="noreferrer"
          >
            {t("Download evidence JSON")}
            <ExternalLink size={13} />
          </a>
        </div>
        <ul>
          {assessment.scopeNotes.map((l) => (
            <li key={l}>{t(l)}</li>
          ))}
        </ul>
        {access?.public && (
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
        )}
      </section>
      <section id="method" className="report-method">
        <div className="report-section-heading">
          <div>
            <div className="eyebrow">{l("RESEARCH NOTES", "研究记录")}</div>
            <h3>{l("Scope, sources & method", "范围、来源与方法")}</h3>
          </div>
        </div>
        {m.topic.plan && (
          <details className="panel query-plan">
            <summary>
              {t("How we understood your search")}: {m.topic.plan.input}
            </summary>
            <p>{assessment.queryExplanation}</p>
            <div>
              <strong>Google Trends</strong>
              <p>{m.topic.plan.trends.join(" · ")}</p>
              <strong>GitHub</strong>
              <p>{(m.topic.queries || [m.topic.query]).join(" · ")}</p>
            </div>
            <small>
              {m.topic.plan.model === "curated"
                ? t("Curated search scope")
                : m.topic.plan.model}{" "}
              · {t("You can edit the demand keyword and scan again.")}
            </small>
          </details>
        )}
        {m.supply.recovery && (
          <details className="panel">
            <summary>
              {l("AI improved the search coverage", "AI 已优化检索覆盖")}
            </summary>
            <p>{m.supply.recovery.explanation[locale]}</p>
            <p>{m.supply.recovery.addedQueries.join(" · ")}</p>
          </details>
        )}
        <details className="panel">
          <summary>
            {l("Search windows & source queries", "搜索窗口与来源查询")}
          </summary>
          <div className="research-scope">
            <span>
              {t("Measured search term")}: <strong>{m.demand.keyword}</strong>
            </span>
            <span>
              {t("GitHub search scope")}:{" "}
              {(m.topic.queries || [m.topic.query]).map((q) => (
                <code key={q}>{q}</code>
              ))}
            </span>
          </div>
          <div className="search-direction">
            <strong>
              {t("Search direction")}:{" "}
              {t("trend." + (m.metrics.trend || "unknown"))}
            </strong>
            <span>
              {t("Direction basis")}:{" "}
              {t("basis." + (m.metrics.directionBasis || "recent-windows"))}
            </span>
            <span>
              {t("4-week change")}: {pct(m.metrics.shortGrowth ?? null)}
            </span>
            <span>
              {t("13-week change")}: {pct(m.metrics.quarterGrowth ?? null)}
            </span>
          </div>
          {m.metrics.windows?.main && (
            <p className="footnote">
              {t("Measured windows")}:{" "}
              {m.metrics.windows.main.recentStart.slice(0, 10)}–
              {m.metrics.windows.main.recentEnd.slice(0, 10)} /{" "}
              {m.metrics.windows.main.baselineStart.slice(0, 10)}–
              {m.metrics.windows.main.baselineEnd.slice(0, 10)} (
              {t("recent / baseline")})
            </p>
          )}
        </details>
        {m.competition && (
          <details className="panel competition-evidence">
            <summary>{t("How competition is assessed")}</summary>
            <p>
              {t(
                "Independent alternatives, maintained project adoption signals, and established leaders determine pressure. Project roles keep resources and integrations in their own groups.",
              )}
            </p>
            <dl className="competition-breakdown">
              <div>
                <dt>{t("Independent alternatives")}</dt>
                <dd>
                  {m.competition.breadth.toFixed(1)} /{" "}
                  {COMPETITION_POLICY.breadthWeight}
                </dd>
              </div>
              <div>
                <dt>{t("Established alternatives")}</dt>
                <dd>
                  {m.competition.incumbency.toFixed(1)} /{" "}
                  {COMPETITION_POLICY.incumbencyWeight}
                </dd>
              </div>
              <div>
                <dt>{t("Leading project strength")}</dt>
                <dd>
                  {m.competition.dominance.toFixed(1)} /{" "}
                  {COMPETITION_POLICY.dominanceWeight}
                </dd>
              </div>
            </dl>
            <p>
              {t("Roles in the inspected sample")}: {t("role.direct")}{" "}
              {m.competition.direct} · {t("role.adjacent")}{" "}
              {m.competition.adjacent} · {t("role.resource")}{" "}
              {m.competition.resources} · {t("role.unclear")}{" "}
              {m.competition.unclear}
            </p>
            <p>
              {t("Matching active projects")}: {m.supply.complete ? "" : "≥"}
              {number(m.supply.total)} ·{" "}
              {t("Original search filters shown below.")}
            </p>
            <p>
              {t(
                m.competition.enumerated
                  ? "All matches in this search scope were inspected."
                  : "The inspected projects form a sample; the displayed pressure is a lower bound.",
              )}
            </p>
            {!!m.competition.unclear && (
              <p>
                {t("The range includes projects whose role awaits review.")}
              </p>
            )}
            {m.supply.review?.status === "fallback" && (
              <p>
                {t(
                  "Roles use local metadata rules. A refreshed scan can add AI review.",
                )}
              </p>
            )}
            <p>
              {t("Top 3 owner attention share")}:{" "}
              {m.concentration === null
                ? "—"
                : (m.concentration * 100).toFixed(0) + "%"}
            </p>
          </details>
        )}
        <details className="panel reasoning-panel">
          <summary>{t("Method and detailed evidence")}</summary>
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
        </details>{" "}
      </section>
      <ResearchFeedback key={m.id} kind="report" id={m.id} account={account} />
    </div>
  );
}
function RepoView({
  account,
  name,
  watch,
  onWatch,
  navigate,
}: {
  account: Account | null;
  name: string;
  watch: string[];
  onWatch: (s: string) => void;
  navigate: (s: string) => void;
}) {
  const [r, setR] = useState<Repo | null>(null),
    [error, setError] = useState(""),
    [required, setRequired] = useState(false),
    [loading, setLoading] = useState(true),
    [days, setDays] = useState(30);
  const load = (fresh = false) => {
    setLoading(true);
    setError("");
    return api<Repo>(
      fresh ? "/api/repo" : "/api/repo?name=" + encodeURIComponent(name),
      fresh
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          }
        : undefined,
    )
      .then((data) => {
        setR(data);
        setRequired(false);
      })
      .catch((e) => {
        setRequired(e.status === 409 || e.status === 401);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    setR(null);
    void load();
  }, [name]);
  if (loading)
    return (
      <Loading
        text={t("Reading repository history and maintenance signals…")}
      />
    );
  if (!r)
    return (
      <Empty
        title={name}
        description={t(
          required ? "Explore this project's growth and maintenance." : error,
        )}
        action={
          <div className="research-start">
            <UsageSummary account={account} />
            <ResearchCost account={account} />
            {account?.user ? (
              <button className="button" onClick={() => void load(true)}>
                {t(
                  account.hosted
                    ? "Analyze project · 1 credit"
                    : "Analyze project",
                )}
              </button>
            ) : (
              <a className="button" href={loginUrl("/repo/" + name)}>
                {t("Sign in to research")}
              </a>
            )}
          </div>
        }
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
          {watch.includes(r.name) ? t("Saved project") : t("Save project")}
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
            <dd>{r.archived ? t("Archived") : t("Active")}</dd>
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
  account,
  path,
  navigate,
}: {
  account: Account | null;
  path: string;
  navigate: (s: string) => void;
}) {
  const initial =
      new URLSearchParams(path.split("?")[1] || "").get("repos") || "",
    [input, setInput] = useState(initial.replaceAll(",", " ")),
    [repos, setRepos] = useState<Repo[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const compare = async (value: string, fresh = true) => {
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
          fresh
            ? "/api/compare"
            : "/api/compare?repos=" + encodeURIComponent(names.join(",")),
          fresh
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repos: names }),
              }
            : undefined,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (initial) void compare(initial, false);
  }, [initial]);
  return (
    <div className="detail-page">
      <div className="eyebrow">{t("SIDE BY SIDE")}</div>
      <h1>{t("Compare the contenders")}</h1>
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
          {t(account?.hosted ? "Compare · 1 credit" : "Compare")}
          <ArrowRight size={16} />
        </button>
      </form>
      <UsageSummary account={account} />
      <ResearchCost account={account} />
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
          error: name + ": " + t(e.message),
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
      <div className="eyebrow">{t("YOUR RESEARCH")}</div>
      <h2>{t("Saved projects")}</h2>
      <p className="page-intro">
        {t(
          "Your saved projects, with cached evidence. Open a project to request a fresh analysis.",
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
          aria-label={t("Save a repository")}
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
        <Loading text={t("Loading saved projects…")} />
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
            "Save a project from any category or add a repository above. Your saved projects are stored on this server.",
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
function StartView() {
  useEffect(() => {
    track("opensource_view", "start");
  }, []);
  return (
    <div className="docs-page">
      <div className="eyebrow">MIT · CLI · MCP</div>
      <h1>{t("Research in your own workflow")}</h1>
      <p className="page-intro">
        {t(
          "Use the hosted website, or run the same open-source engine with your own keys.",
        )}
      </p>
      <div className="deployment-options">
        <section className="panel">
          <h2>{t("Hosted website")}</h2>
          <p>
            {t(
              "Read public reports freely. Sign in for private scans, saved reports and projects across devices.",
            )}
          </p>
        </section>
        <section className="panel">
          <h2>{t("Your own workspace")}</h2>
          <p>
            {t(
              "CLI, MCP and local Web share your SQLite workspace. Configure your GitHub key and an optional DeepSeek key. Hosted account history is separate.",
            )}
          </p>
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
          <pre>{`npm install -g https://github.com/noahbenjamin1994/ghtrends-radar/releases/download/v0.20.0/ghtrends-radar-0.20.0.tgz\n\nghtrends scan --topic mcp-servers --json\nghtrends repo facebook/react\nghtrends compare facebook/react vuejs/core --format md\nghtrends watch add facebook/react\nghtrends watch run\nghtrends report --topic agent-memory --format md\nghtrends ui --port 3721\nghtrends mcp`}</pre>
          <CopyButton
            value="npm install -g https://ghtrends.dev/radar/ghtrends.tgz"
            label={t("Copy installation command")}
            onCopied={() => track("install_copy")}
          />
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
      <p>
        <a
          className="button"
          href={SOURCE}
          onClick={() => track("github_click")}
        >
          {t("Source and setup instructions")} <ArrowUpRight size={15} />
        </a>
      </p>
      <p>
        <a href={localUrl("/docs")}>{t("Understand the methodology")}</a>
      </p>
    </div>
  );
}
function Docs() {
  return (
    <div className="docs-page">
      <div className="eyebrow">{t("OPEN DATA. OPEN METHOD.")}</div>
      <h1>{t("A signal you can inspect")}</h1>
      <p className="page-intro">
        {t(
          "ghtrends puts two independent questions together: how much active open-source supply exists, and whether search demand is growing.",
        )}
      </p>
      <section className="panel">
        <h2>{t("Read supply and search direction separately")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t("Landscape")}</th>
              <th>{t("Supply")}</th>
              <th>{t("Search direction")}</th>
              <th>{t("Starting strategy")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Pill kind="blue" />
              </td>
              <td>{t("Limited observed competition")}</td>
              <td>{t("trend.rising")}</td>
              <td>{t("Validate an underserved use case.")}</td>
            </tr>
            <tr>
              <td>
                <Pill kind="expanding" />
              </td>
              <td>{t("Established alternatives")}</td>
              <td>{t("trend.rising")}</td>
              <td>{t("Find a specific audience or advantage.")}</td>
            </tr>
            <tr>
              <td>
                <Pill kind="contested" />
              </td>
              <td>{t("Established alternatives")}</td>
              <td>{t("Stable, falling, mixed or pending")}</td>
              <td>{t("Identify a reason people would switch.")}</td>
            </tr>
            <tr>
              <td>
                <Pill kind="quiet" />
              </td>
              <td>{t("Limited observed competition")}</td>
              <td>{t("Stable or falling")}</td>
              <td>{t("Check if the market is early, niche or inactive.")}</td>
            </tr>
          </tbody>
        </table>
        <p>
          {t(
            "Ocean labels summarize search direction and observed open-source supply. They are research signals, not verified measures of commercial competition. A quiet ocean may still be a valuable niche.",
          )}
        </p>
        <p>
          {t(
            "“Needs validation” means the evidence is missing, stale or too weak. Zero search values can be rounded or below Google’s reporting threshold; they never establish that demand does not exist.",
          )}
        </p>
      </section>
      <div className="detail-columns">
        <section className="panel">
          <span className="section-kicker">{t("01 / DEMAND")}</span>
          <h2>{t("Look past the spike.")}</h2>
          <p>
            {t(
              "Search direction compares 4-, 8- and 13-week windows, sustained changes and a resampling range. Slow growth can qualify across a full quarter. A repeating annual pattern switches the direction comparison to the same period last year. Opposing synonyms keep a mixed signal.",
            )}
          </p>
          <p>
            {t(
              "A weekly observation is usable only after that week ended at collection time. Invalid rows cannot refresh old evidence, and conflicting values for the same week prevent classification.",
            )}
          </p>
          <p>
            {t(
              "Annual patterns require at least 40 paired weeks, correlation of 0.75 or more, and a substantial rise and fall in both annual profiles. Two-week block resampling checks sensitivity. These are evidence diagnostics for research decisions.",
            )}
          </p>
          <p>
            {t(
              "The primary phrase and up to two same-intent variants are collected independently for the same region and time range. If the primary lacks usable evidence, the first usable variant is selected by data coverage. We never add normalized indices or select by growth direction.",
            )}
          </p>
          <p>
            {t(
              "A low-base rise is reported without a percentage when the prior median is below 3, at least six of the last eight weekly indices reach 10, and the last-four-week median retains at least 80% of the first four. It remains a low-confidence early signal; sparse or isolated spikes stay unconfirmed.",
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
              "Known categories retain their published query scope. Compound requirements use intersecting GitHub topics. For incomplete unions, the lower bound is the larger of the deduplicated sample and any complete individual search count.",
            )}
          </p>
          <p>
            {t(
              "GitHub searches use relevant topics and specific name or description phrases. Original, active projects qualify with at least one star and a push within 365 days. We review their roles, group projects by owner, and calculate pressure from direct alternatives.",
            )}
          </p>
          <p>
            {t(
              "Pressure combines independent teams (50 points), established alternatives (30), and leading project strength (20). The published boundary is 45/100. Project maturity considers stars, forks, age and maintenance. This index describes observed open-source competition; commercial validation adds another layer.",
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
        <h2>{t("How to use a classification")}</h2>
        <p>
          {t(
            "Use it to decide where to investigate next. Validate real workflows with people, inspect existing alternatives and account for commercial products. Search measurements do not predict revenue, investment outcomes or GitHub stars.",
          )}
        </p>
        <p>
          {t(
            "Reports preserve their collected evidence. New hosted scans are private and saved to your account; you choose whether to share them. Self-hosted data and credentials stay on your server.",
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
      .then((rows) => setGaps(selectGapSignals(rows)))
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
      <h1>{t("Find the friction")}</h1>
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
                <div className="gap-card-meta">
                  <span className="gap-label">
                    {g.reactions == null
                      ? locale === "zh"
                        ? "社区请求"
                        : "Community request"
                      : t(g.label.replaceAll("-", " "))}
                  </span>
                  {g.reactions != null && <span>↑ {g.reactions}</span>}
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
