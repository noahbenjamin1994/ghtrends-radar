import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { effectiveDecision, type Revision } from "../../core/decision.js";
import type { LaneItem, Lanes, ScanProgress } from "../../core/engine.js";
import type { Market, Topic } from "../../core/types.js";
import type { Account } from "../account.js";
import { api, watchResearch } from "../api.js";
import { track } from "../engagement.js";
import { locale } from "../i18n.js";
import { appUrl } from "../paths.js";
import { Report, SourceDrawer, type Opened, type Working } from "./report.js";
import { Ask, QuoteLine, Row, day, l } from "./ui.js";

const Earlier = React.lazy(() =>
  import("../App.js").then((m) => ({ default: m.App })),
);

export interface Job {
  id: string;
  state: "queued" | "running" | "complete" | "failed";
  input?: string;
  topic: string;
  created?: number;
  queuePosition?: number;
  reportId?: string;
  preparedTopic?: Topic;
  progress?: ScanProgress;
  market?: Market;
  error?: string;
  credit?: string;
  clarification?: { en: string; zh: string };
}
export interface Launch {
  input: string;
  stage: "understanding" | "choose" | "error";
  message?: string;
  choices?: { label: string; query: string }[];
}
/** Jobs started in this tab, so the page has its title before the first poll. */
export const started = new Map<string, Job>();

interface RevisionView {
  revision: Revision | null;
  followupsLeft: number;
  supplier?: string | null;
}
type View =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "running"; job: Job }
  | { kind: "failed"; input: string; message: string; returned: boolean }
  | { kind: "earlier"; market: Market }
  | { kind: "report"; market: Market; landing: boolean };

const post = <T,>(url: string, body?: unknown) =>
  api<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });

function Title({ topic, input }: { topic?: Topic; input: string }) {
  const framing = topic?.plan?.framing;
  if (!framing) return <>{input}</>;
  return (
    <>
      <span className="rd-who">{framing.who[locale]}</span>
      <span>{framing.task[locale]}</span>
    </>
  );
}

function Lane({ items, quoted }: { items: LaneItem[]; quoted?: boolean }) {
  return (
    <ul className="rd-lane">
      {items.slice(0, 8).map((item, i) => {
        const key = (item.url || item.label) + i;
        if (quoted && item.state === "read" && item.quote)
          return (
            <li key={key} className="is-quoted">
              <q>{item.quote}</q>
              <span className="rd-lane-host">{item.host}</span>
            </li>
          );
        return (
          <li key={key} className={"is-" + item.state}>
            <span className="rd-lane-mark" aria-hidden="true">
              {item.state === "read"
                ? "✓"
                : item.state === "failed"
                  ? "×"
                  : item.state === "reading"
                    ? "…"
                    : "·"}
            </span>
            <span className="rd-lane-text">
              {item.kind === "trend"
                ? item.count
                  ? l(
                      `Search trend for “${item.label}”, ${item.count} weeks`,
                      `“${item.label}”的搜索趋势，${item.count} 周`,
                    )
                  : l(
                      `Search trend for “${item.label}”`,
                      `“${item.label}”的搜索趋势`,
                    )
                : item.label}
            </span>
            <span className="rd-lane-host">
              {item.state === "failed"
                ? l("not collected", "未采到")
                : item.state === "reading"
                  ? l("reading", "正在读")
                  : item.host}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The report's skeleton, filling with what is actually found. */
function Collecting({ job }: { job?: Job }) {
  const lanes: Lanes = job?.progress?.lanes || {
    pains: [],
    supply: [],
    timing: [],
  };
  const stage = job?.progress?.stage;
  const read = (items: LaneItem[]) =>
    items.filter((i) => i.state === "read").length;
  const waiting = (text: string) => (
    <p className="rd-wait">
      <i className="rd-live" />
      {text}
    </p>
  );
  const writing = stage === "brief";
  return (
    <>
      <Row label={l("Conclusion", "结论")} className="is-verdict">
        <div className="rd-verdict is-pending" role="status">
          <p>
            {!job
              ? l("Working out who this is about…", "正在识别目标用户与任务…")
              : job.state === "queued"
                ? job.queuePosition
                  ? l(
                      `Queued behind ${job.queuePosition} other research.`,
                      `排队中，前面还有 ${job.queuePosition} 个研究。`,
                    )
                  : l("Starting…", "马上开始…")
                : writing
                  ? l(
                      "The three sections below are in. Writing the verdict from them…",
                      "需求、竞品、趋势已采集完，正在生成结论…",
                    )
                  : l(
                      "The verdict comes after the three sections below are in.",
                      "结论将在需求、竞品、趋势采集完成后给出。",
                    )}
          </p>
        </div>
      </Row>
      <Row
        label={l("Demand analysis", "需求分析")}
        count={
          read(lanes.pains)
            ? l(`${read(lanes.pains)} read`, `读了 ${read(lanes.pains)} 条`)
            : undefined
        }
      >
        {lanes.pains.length ? (
          <Lane items={lanes.pains} quoted />
        ) : (
          waiting(
            l(
              "Looking for people describing this in their own words…",
              "正在采集用户的一手描述…",
            ),
          )
        )}
      </Row>
      <Row
        label={l("Competitor analysis", "竞品分析")}
        count={
          lanes.supply.filter((i) => i.state !== "failed").length
            ? l(
                `${lanes.supply.filter((i) => i.state !== "failed").length} found`,
                `找到 ${lanes.supply.filter((i) => i.state !== "failed").length} 个`,
              )
            : undefined
        }
      >
        {lanes.supply.length ? (
          <Lane items={lanes.supply} />
        ) : (
          waiting(
            l(
              "Looking for products and open-source projects…",
              "正在采集现有产品与开源项目…",
            ),
          )
        )}
      </Row>
      <Row label={l("Market trend", "市场趋势")}>
        {lanes.timing.length ? (
          <Lane items={lanes.timing} />
        ) : (
          waiting(l("Fetching the search trend…", "正在获取搜索趋势…"))
        )}
      </Row>
      <Row label={l("Opportunities", "机会方向")}>
        <p className="rd-wait">
          {l(
            "Waits for the two sections above: an opening is a pain that supply doesn't cover.",
            "待需求分析与竞品分析完成后给出：机会方向是现有竞品未满足的需求。",
          )}
        </p>
      </Row>
      <Row label={l("Validation plan", "验证计划")}>
        <p className="rd-wait">
          {l("Pending an opportunity.", "待机会方向确定。")}
        </p>
      </Row>
    </>
  );
}

export function Research({
  id,
  launch,
  account,
  onStart,
  onEdit,
  onNavigate,
  onChoose,
}: {
  id?: string;
  launch?: Launch | null;
  account: Account | null;
  onStart: (input: string) => void;
  onEdit: (input: string) => void;
  onNavigate: () => void;
  onChoose: (query: string) => void;
}) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [revision, setRevision] = useState<Revision | null>(null);
  const [left, setLeft] = useState(0);
  const [access, setAccess] = useState<{
    public: boolean;
    owned: boolean;
  } | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [working, setWorking] = useState<Working>(null);
  const [original, setOriginal] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [askError, setAskError] = useState("");
  const [toast, setToast] = useState("");
  const [own, setOwn] = useState("");
  const [now, setNow] = useState(Date.now());
  const loaded = useRef("");
  const closeDrawer = useCallback(() => setOpened(null), []);

  const show = useCallback((market: Market, landing: boolean) => {
    if (!market.brief?.decision) {
      setView(
        market.brief?.report || !market.aiError
          ? { kind: "earlier", market }
          : {
              kind: "failed",
              input: market.topic.plan?.input || market.topic.name,
              message: l(
                "The sources were collected, but no report passed the evidence check.",
                "来源采到了，但没有一份报告通过证据核对。",
              ),
              returned: true,
            },
      );
      return;
    }
    setView({ kind: "report", market, landing });
    track("report_view", market.id);
    void api<RevisionView>(`/api/reports/${market.id}/revision`)
      .then((r) => {
        setRevision(r.revision);
        setLeft(r.followupsLeft);
      })
      .catch(() => {});
    void api<{ public: boolean; owned: boolean }>(
      `/api/reports/${market.id}/access`,
    )
      .then(setAccess)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id || loaded.current === id) return;
    loaded.current = id;
    setRevision(null);
    setAccess(null);
    setOriginal(false);
    setError("");
    setOpened(null);
    const job = started.get(id);
    if (job) return setView({ kind: "running", job });
    setView({ kind: "loading" });
    api<Market | { pending: true; job: string }>("/api/reports/" + id)
      .then((d) => {
        if (loaded.current !== id) return;
        if ("pending" in d)
          setView({
            kind: "running",
            job: { id: d.job, state: "running", topic: "" },
          });
        else show(d, false);
      })
      .catch(() => loaded.current === id && setView({ kind: "missing" }));
  }, [id, show]);

  const jobId = view.kind === "running" ? view.job.id : "";
  useEffect(() => {
    if (!jobId) return;
    return watchResearch<Job>(
      "/api/jobs/" + jobId,
      (d) => {
        if (d.state === "complete" && d.market) {
          started.delete(d.reportId || "");
          window.dispatchEvent(new Event("ghtrends:usage"));
          if (d.market.brief?.decision) show(d.market, true);
          else show(d.market, false);
          return true;
        }
        if (d.state === "failed") {
          started.delete(d.reportId || "");
          window.dispatchEvent(new Event("ghtrends:usage"));
          setView({
            kind: "failed",
            input: d.input || d.topic,
            message:
              d.clarification?.[locale] ||
              l("This research could not be finished.", "本次研究未能完成。"),
            returned: d.credit === "returned",
          });
          return true;
        }
        setView({ kind: "running", job: d });
        return false;
      },
      (e) => {
        if ([401, 403, 404].includes(e.status)) setView({ kind: "missing" });
      },
    );
  }, [jobId, show]);

  const running = view.kind === "running" || (!!launch && !id);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const market = view.kind === "report" ? view.market : null;
  const owner = !!market && (!account?.hosted || !!access?.owned);
  const decision = useMemo(
    () =>
      market
        ? effectiveDecision(market.brief!.decision!, original ? null : revision)
        : null,
    [market, revision, original],
  );
  const sources = useMemo(
    () =>
      market ? [...market.brief!.sources, ...(revision?.sources || [])] : [],
    [market, revision],
  );
  const apply = (r: RevisionView) => {
    setRevision(r.revision);
    setLeft(r.followupsLeft);
  };
  const change = (body: Record<string, unknown>, optimistic: Revision) => {
    if (!market) return;
    const before = revision;
    setRevision(optimistic);
    setError("");
    post<RevisionView>(`/api/reports/${market.id}/revision`, body)
      .then(apply)
      .catch((e: Error) => {
        setRevision(before);
        setError(e.message);
      });
  };
  const base: Revision = revision || { dismissed: [] };
  const rejudge = () => {
    if (!market || working) return;
    setWorking("rejudge");
    setError("");
    post<RevisionView>(`/api/reports/${market.id}/rejudge`)
      .then(apply)
      .catch((e: Error) => setError(e.message))
      .finally(() => setWorking(null));
  };
  const addSupply = (name: string) => {
    if (!market) return;
    setWorking("supply");
    setError("");
    return post<RevisionView>(`/api/reports/${market.id}/supply`, { name })
      .then(apply)
      .catch((e: Error) => {
        setError(e.message);
        setAskError(e.message);
      })
      .finally(() => setWorking(null));
  };
  const ask = () => {
    if (!market || working || !question.trim()) return;
    const text = question.trim();
    setWorking("ask");
    setAskError("");
    post<RevisionView>(`/api/reports/${market.id}/ask`, { question: text })
      .then((r) => {
        apply(r);
        setQuestion("");
        setWorking(null);
        if (r.supplier) void addSupply(r.supplier);
      })
      .catch((e: Error) => {
        setAskError(e.message);
        setWorking(null);
      });
  };
  const share = async (shared: boolean) => {
    if (!market) return;
    try {
      const r = await post<{ shared: boolean; url: string }>(
        `/api/reports/${market.id}/share`,
        { shared },
      );
      setAccess((a) => (a ? { ...a, public: r.shared } : a));
      if (r.shared) {
        await navigator.clipboard
          ?.writeText(r.url + (locale === "zh" ? "?lang=zh" : ""))
          .catch(() => {});
        track("share_publish");
        setToast(
          l(
            "Link copied. Anyone with it can read this research.",
            "链接已复制。拿到链接的人都能读这份研究。",
          ),
        );
      } else
        setToast(l("This research is private again.", "这份研究已恢复私有。"));
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  // Before the address exists: the question is being understood.
  if (launch && !id) {
    return (
      <div className="rd-research rd-wrap">
        <header className="rd-head">
          <h1 className="rd-title is-raw">{launch.input}</h1>
          {launch.stage === "choose" && (
            <>
              <p className="rd-note is-plain">{launch.message}</p>
              <div className="rd-choices">
                {launch.choices?.map((c) => (
                  <button key={c.query} onClick={() => onChoose(c.query)}>
                    {c.label}
                  </button>
                ))}
                <button
                  style={{ color: "var(--soft)" }}
                  onClick={() => onEdit(launch.input)}
                >
                  {l("None of these, let me rephrase", "都不是，重新输入")}
                </button>
              </div>
            </>
          )}
          {launch.stage === "error" && (
            <>
              <p className="rd-note" role="alert">
                {launch.message}
              </p>
              <div className="rd-meta" style={{ marginLeft: 0, gap: 8 }}>
                <button
                  className="rd-btn"
                  onClick={() => onStart(launch.input)}
                >
                  {l("Try again", "再试一次")}
                </button>
                <button
                  className="rd-btn is-light"
                  onClick={() => onEdit(launch.input)}
                >
                  {l("Rephrase", "修修改问题")}
                </button>
              </div>
            </>
          )}
        </header>
        {launch.stage === "understanding" && <Collecting />}
      </div>
    );
  }
  if (view.kind === "loading")
    return <div className="rd-research rd-wrap" aria-busy="true" />;
  if (view.kind === "missing")
    return (
      <div className="rd-wrap rd-state">
        <h1>{l("This research isn't available", "无法打开这份研究")}</h1>
        <p>
          {account?.hosted && !account.user
            ? l(
                "It may be private. Sign in with the account that created it.",
                "它可能是私有的。用创建它的账号登录后再打开。",
              )
            : l(
                "It may have been removed, or the link is incomplete.",
                "它可能已被移除，或者链接不完整。",
              )}
        </p>
        <button className="rd-btn" onClick={() => onEdit("")}>
          {l("Research something", "开始新的研究")}
        </button>
      </div>
    );
  if (view.kind === "failed")
    return (
      <div className="rd-wrap rd-state">
        <h1>{l("This one didn't finish", "本次研究未完成")}</h1>
        <p>
          {view.message}{" "}
          {view.returned
            ? l(
                "It was not counted against your research.",
                "没有计入你的研究次数。",
              )
            : ""}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="rd-btn" onClick={() => onStart(view.input)}>
            {l("Research it again", "再研究一次")}
          </button>
          <button
            className="rd-btn is-light"
            onClick={() => onEdit(view.input)}
          >
            {l("Rephrase", "修修改问题")}
          </button>
        </div>
      </div>
    );
  if (view.kind === "earlier") {
    const input = view.market.topic.plan?.input || view.market.topic.name;
    return (
      <>
        <div className="rd-wrap">
          <p className="rd-legacy-note">
            <span>
              {l(
                "This report uses the earlier format.",
                "这是旧版结构的报告。",
              )}
            </span>
            <button className="rd-btn" onClick={() => onStart(input)}>
              {l("Research it again in the new format", "用新版重新研究")}
            </button>
          </p>
        </div>
        <React.Suspense fallback={null}>
          <Earlier embedded onResearch={onStart} onNavigate={onNavigate} />
        </React.Suspense>
      </>
    );
  }
  if (view.kind === "running") {
    const job = view.job;
    const input = job.input || job.topic;
    const seconds = Math.max(
      0,
      Math.floor((now - (job.created || now)) / 1000),
    );
    return (
      <div className="rd-research rd-wrap">
        <header className="rd-head">
          <h1 className="rd-title">
            <Title
              topic={job.preparedTopic || job.progress?.topic}
              input={input}
            />
          </h1>
          <div className="rd-meta">
            <span aria-hidden="true">
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </span>
            {input && job.progress?.stage !== "brief" && (
              <button
                className="rd-quiet"
                onClick={() => {
                  void post(`/api/jobs/${job.id}/cancel`).catch(() => {});
                  started.delete(job.reportId || "");
                  onEdit(input);
                }}
              >
                {l("Change the question", "修改问题")}
              </button>
            )}
            <span>
              {l(
                "You can close this page. It will be here when you come back.",
                "可以关掉这页，回来时它就在这里。",
              )}
            </span>
          </div>
        </header>
        <Collecting job={job} />
      </div>
    );
  }

  const m = view.market;
  const input = m.topic.plan?.input || m.topic.name;
  const followups = original ? [] : revision?.followups || [];
  return (
    <div className="rd-research rd-wrap">
      {account?.hosted && access && !access.owned && (
        <div className="rd-shared">
          <span>
            {l(
              "This is a Radar research. Run one on your own idea.",
              "这是一份 Radar 研究。也研究一下你自己的想法。",
            )}
          </span>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (own.trim()) onStart(own.trim());
            }}
          >
            <input
              value={own}
              maxLength={300}
              onChange={(event) => setOwn(event.target.value)}
              placeholder={l("A domain or an idea", "一个领域或一个想法")}
              aria-label={l("Your domain or idea", "你的领域或想法")}
            />
            <button className="rd-btn" disabled={!own.trim()}>
              {l("Research it", "开始研究")}
            </button>
          </form>
        </div>
      )}
      <header className="rd-head">
        <h1 className="rd-title">
          <Title topic={m.topic} input={input} />
        </h1>
        <div className="rd-meta">
          <span>{day(m.brief!.generatedAt || m.asOf)}</span>
          {owner && account?.hosted && (
            <button
              className={"rd-quiet" + (access?.public ? " is-on" : "")}
              onClick={() => void share(!access?.public)}
            >
              {access?.public
                ? l("Shared, make private", "已公开，改回私有")
                : l("Share", "分享")}
            </button>
          )}
          {owner && (
            <button className="rd-quiet" onClick={() => onStart(input)}>
              {l("Research again", "重新研究")}
            </button>
          )}
          <a
            className="rd-quiet"
            href={appUrl(`/api/reports/${m.id}?format=md&lang=${locale}`)}
            target="_blank"
            rel="noreferrer"
            onClick={() => track("export_md")}
          >
            Markdown
          </a>
        </div>
      </header>
      <Report
        market={m}
        decision={decision!}
        sources={sources}
        owner={owner}
        revision={revision}
        working={working}
        landing={view.landing}
        showingOriginal={original}
        error={error}
        onOpen={setOpened}
        onOriginal={setOriginal}
        onRejudge={rejudge}
        onAddSupply={(name) => void addSupply(name)}
        onDismiss={(key) =>
          change(
            { dismiss: key },
            { ...base, dismissed: [...base.dismissed, key], stale: true },
          )
        }
        onRestore={(key) => {
          const dismissed = base.dismissed.filter((k) => k !== key);
          change(
            { restore: key },
            { ...base, dismissed, stale: dismissed.length > 0 },
          );
        }}
        onStatus={(status) =>
          change(
            { status },
            status ? { ...base, status } : { ...base, status: undefined },
          )
        }
      />
      {followups.length > 0 && (
        <div className="rd-thread">
          {followups.map((f, i) => (
            <article key={i} className="rd-turn">
              <p className="rd-turn-q">{f.question}</p>
              <p className="rd-turn-a">{f.answer}</p>
              {f.quotes.map((q) => {
                const s = sources.find((x) => x.id === q.id);
                return (
                  <QuoteLine
                    key={q.cid}
                    quote={q}
                    source={s}
                    onOpen={() => s && setOpened({ source: s, quote: q.quote })}
                  />
                );
              })}
              {f.note === "added-supply" && (
                <small>
                  {l(
                    "If its page could be read, it is listed under “Competitor analysis”, marked as added by you.",
                    "页面读取成功后，它会列入「竞品分析」，并标注「用户补充」。",
                  )}
                </small>
              )}
              {!f.quotes.length && f.note !== "added-supply" && (
                <small>
                  {f.note === "unanswerable"
                    ? l(
                        "The collected sources don't answer this.",
                        "已采集的来源无法回答这个问题。",
                      )
                    : l(
                        "No source quote supports this answer; treat it as an opinion.",
                        "该回答没有来源原文支撑，仅供参考。",
                      )}
                </small>
              )}
            </article>
          ))}
        </div>
      )}
      {owner && !original && (
        <div className="rd-composer">
          <Ask
            value={question}
            onChange={setQuestion}
            onSubmit={ask}
            disabled={!!working || left <= 0}
            label={l("Send", "发送")}
            placeholder={
              left <= 0
                ? l(
                    "Follow-ups used. Research again to go deeper.",
                    "提问次数已用完。如需深入，请重新研究。",
                  )
                : l(
                    "What's wrong here, or what else do you want to know?",
                    "补充信息或继续提问",
                  )
            }
          />
          <p
            className={"rd-composer-note" + (askError ? " is-error" : "")}
            role={askError ? "alert" : "status"}
          >
            {askError
              ? askError
              : working === "ask"
                ? l("Reading the sources to answer…", "正在查阅来源原文…")
                : working === "supply"
                  ? l(
                      "Reading that supplier's page, then judging again…",
                      "正在读取该竞品页面，完成后重新评估…",
                    )
                  : left > 0
                    ? l(
                        `Say what's missing or wrong, and the report is corrected. ${left} follow-ups left.`,
                        `可指出遗漏或错误，报告会相应修订。剩余提问 ${left} 次。`,
                      )
                    : ""}
          </p>
        </div>
      )}
      {opened && <SourceDrawer opened={opened} onClose={closeDrawer} />}
      {toast && (
        <div className="rd-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
