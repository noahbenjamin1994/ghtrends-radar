import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { inspectInput, type PreflightResult } from "../../core/preflight.js";
import type { Account } from "../account.js";
import { api, setCsrf } from "../api.js";
import { Logo } from "../components.js";
import { enableEngagement, track } from "../engagement.js";
import { locale, localUrl, loginUrl, switchLanguage, t } from "../i18n.js";
import { currentRoute } from "../paths.js";
import { Home } from "./home.js";
import { Research, started, type Job, type Launch } from "./research.js";
import { l } from "./ui.js";
import "./radar.css";

const Earlier = React.lazy(() =>
  import("../App.js").then((m) => ({ default: m.App })),
);

const SOURCE = "https://github.com/noahbenjamin1994/ghtrends-radar";
const DRAFT = "ghtrends:draft";
const post = <T,>(url: string, body: unknown) =>
  api<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export function Root() {
  const [path, setPath] = useState(currentRoute());
  const [account, setAccount] = useState<Account | null>(null);
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [draft, setDraft] = useState(
    () => new URLSearchParams(location.search).get("q")?.slice(0, 300) || "",
  );
  const [note, setNote] = useState("");
  const version = useRef(0);
  const route = path.split("?")[0]!;

  const go = useCallback((to: string, replace = false) => {
    history[replace ? "replaceState" : "pushState"]({}, "", localUrl(to));
    setPath(currentRoute());
    if (!replace) window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const sync = useCallback(() => setPath(currentRoute()), []);
  useEffect(() => {
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [sync]);

  const loadAccount = useCallback(
    () =>
      api<Account>("/api/account?lang=" + locale).then((a) => {
        setCsrf(a.csrf);
        enableEngagement(a.engagementEnabled);
        setAccount(a);
        return a;
      }),
    [],
  );

  const start = useCallback(
    async (raw: string, known?: Account | null) => {
      const input = raw.trim();
      // Enter can arrive before the account has loaded; wait rather than drop it.
      const who =
        (known === undefined ? account : known) ||
        (await loadAccount().catch(() => null));
      if (!input || !who) return;
      const run = ++version.current;
      setNote("");
      const local = inspectInput(input);
      if (local && !local.choices.length) {
        setLaunch(null);
        setDraft(input);
        setNote(local.message[locale]);
        if (route !== "/") go("/");
        return;
      }
      if (who.hosted && !who.user) {
        sessionStorage.setItem(DRAFT, input);
        location.assign(loginUrl("/"));
        return;
      }
      if (route !== "/") go("/");
      setLaunch({ input, stage: "understanding" });
      const clarify = (
        result: Exclude<PreflightResult, { status: "ready" }>,
      ) =>
        result.choices.length
          ? setLaunch({
              input,
              stage: "choose",
              message: result.message[locale],
              choices: result.choices,
            })
          : (setLaunch(null), setDraft(input), setNote(result.message[locale]));
      try {
        if (local) return clarify(local);
        const scope = await post<PreflightResult>("/api/preflight", {
          topic: input,
          geo: "",
        });
        if (run !== version.current) return;
        if (scope.status !== "ready") return clarify(scope);
        const d = await post<Job & { market?: { id: string } }>("/api/scan", {
          topic: input,
          geo: "",
          preflightId: scope.id,
        });
        if (run !== version.current) return;
        const id = d.state === "complete" ? d.market!.id : d.reportId!;
        if (d.state !== "complete") started.set(id, d);
        setLaunch(null);
        go("/report/" + id);
      } catch (e) {
        if (run !== version.current) return;
        const error = e as Error & {
          guidance?: Exclude<PreflightResult, { status: "ready" }>;
        };
        if (error.guidance) return clarify(error.guidance);
        setLaunch({ input, stage: "error", message: t(error.message) });
      }
    },
    [account, go, route, loadAccount],
  );

  useEffect(() => {
    void loadAccount()
      .then((a) => {
        // Enter was pressed before signing in; carry on from there.
        const pending = sessionStorage.getItem(DRAFT);
        if (!pending) return;
        sessionStorage.removeItem(DRAFT);
        if (a.user) void start(pending, a);
        else setDraft(pending);
      })
      .catch(() => {});
    const refresh = () => void loadAccount().catch(() => {});
    window.addEventListener("ghtrends:usage", refresh);
    return () => window.removeEventListener("ghtrends:usage", refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = useCallback(
    (input: string) => {
      version.current++;
      setLaunch(null);
      setNote("");
      setDraft(input);
      go("/");
    },
    [go],
  );

  // Pages that were folded into the home page or retired.
  useEffect(() => {
    if (/^\/(history|watch|compare|gaps)(\/|$)/.test(route)) go("/", true);
    else if (route.startsWith("/repo/")) {
      setDraft(decodeURIComponent(route.slice(6)));
      go("/", true);
    }
  }, [route, go]);

  const reportId = /^\/report\/([a-f0-9]{16})$/.exec(route)?.[1];
  const researching = !!reportId || (!!launch && route === "/");
  const quota = account?.quota;
  return (
    <div className="rd">
      <header className="rd-top rd-wrap">
        <button
          onClick={() => edit("")}
          aria-label={l("Radar home", "Radar 首页")}
        >
          <Logo />
        </button>
        <div className="rd-top-end">
          <button
            className="rd-quiet"
            onClick={switchLanguage}
            aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
          >
            {locale === "zh" ? "EN" : "中文"}
          </button>
          {account?.user ? (
            <details className="rd-menu">
              <summary
                className="rd-quiet"
                aria-label={
                  quota
                    ? l(
                        `Account, ${quota.remaining} of ${quota.limit} research left today`,
                        `账户，今天还能研究 ${quota.remaining} 次`,
                      )
                    : l("Account", "账户")
                }
              >
                {quota ? (
                  <span className="rd-menu-credits">
                    {l(`${quota.remaining} left`, `还剩 ${quota.remaining} 次`)}
                  </span>
                ) : (
                  l("Account", "账户")
                )}
                <ChevronDown size={14} />
              </summary>
              <div
                className="rd-menu-panel"
                onClick={(event) =>
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open")
                }
              >
                <p>
                  <strong>
                    {account.hosted
                      ? account.user.name
                      : l("Local workspace", "本地工作区")}
                  </strong>
                  {quota &&
                    l(
                      `${quota.remaining} of ${quota.limit} research left today`,
                      `今天还能研究 ${quota.remaining} 次，共 ${quota.limit} 次`,
                    )}
                </p>
                <button onClick={() => go("/account")}>
                  {l("Account and billing", "账户与账单")}
                </button>
                {account.user.isAdmin && (
                  <button onClick={() => go("/admin")}>
                    {l("Admin", "管理")}
                  </button>
                )}
                {account.hosted && (
                  <button
                    onClick={() =>
                      void api("/auth/logout", { method: "POST" }).then(() =>
                        location.assign(localUrl("/")),
                      )
                    }
                  >
                    {l("Sign out", "退出登录")}
                  </button>
                )}
              </div>
            </details>
          ) : (
            account?.hosted && (
              <button
                className="rd-quiet"
                onClick={() => location.assign(loginUrl(path))}
              >
                {l("Sign in", "登录")}
              </button>
            )
          )}
        </div>
      </header>
      <main className="rd-main">
        {researching ? (
          <Research
            key="research"
            id={reportId}
            launch={launch}
            account={account}
            onStart={(input) => void start(input)}
            onEdit={edit}
            onNavigate={sync}
            onChoose={(query) => void start(query)}
          />
        ) : route === "/" ? (
          <Home
            account={account}
            initial={draft}
            note={note}
            onStart={(input) => void start(input)}
            open={go}
          />
        ) : /^\/(history|watch|compare|gaps|repo)(\/|$)/.test(route) ? null : (
          <Earlier
            key={route}
            embedded
            onResearch={(input) => void start(input)}
            onNavigate={sync}
          />
        )}
      </main>
      <footer className="rd-foot rd-wrap">
        <span>
          {l(
            "Open source. Not affiliated with GitHub, Inc.",
            "开源项目，与 GitHub, Inc. 无关联。",
          )}
        </span>
        <nav aria-label={l("About", "关于")}>
          <a
            href={SOURCE}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("github_click")}
          >
            {l("Source code", "源代码")}
          </a>
          <a href={SOURCE + "#readme"} target="_blank" rel="noreferrer">
            {l("How it works and self-hosting", "方法说明与自部署")}
          </a>
          <a href="https://ghtrends.dev">
            {l("Daily GitHub trends", "每日 GitHub 热榜")}
          </a>
        </nav>
      </footer>
    </div>
  );
}
