import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Download,
  LockKeyhole,
} from "lucide-react";
import {
  deepAreaLabels,
  deepPlanLabels,
  deepQuestions,
  deepEffortText,
  deepProjectUseConditions,
  type DeepAllowance,
  type DeepTaskView,
  type DeepRequest,
} from "../core/deep.js";
import { projectUseCopy } from "../core/capabilities.js";
import type { ResourceProfile } from "../core/fit.js";
import type { CreditsResponse } from "../core/credits.js";
import type { Account } from "./account.js";
import { ActivityFeed } from "./activity.js";
import { api, watchResearch } from "./api.js";
import { locale, localUrl, loginUrl } from "./i18n.js";
import { appUrl } from "./paths.js";
import { Loading } from "./components.js";
import "./deep.css";
import { ResearchFeedback } from "./feedback.js";

const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
const label = (pair: readonly [string, string]) =>
  pair[locale === "zh" ? 1 : 0];
export type DeepStatus = {
  enabled: boolean;
  allowance: DeepAllowance | null;
  paidAvailable?: boolean;
  paidDailyAttempts?: number;
};
const stages = {
  queued: ["Waiting for a research slot", "已保存，等待研究开始"],
  planning: ["Choosing focused searches", "整理这个问题的查询词"],
  sources: [
    "Reading products, projects and user requests",
    "查阅同行、项目与用户原话",
  ],
  writing: ["Turning evidence into a decision", "整理依据与投入建议"],
  reviewing: ["Checking claims against sources", "逐项核对建议与来源"],
  complete: ["Ready to read", "研究已完成"],
  partial: ["Evidence saved · continue research", "证据已保存 · 可继续研究"],
} as const;
const creditCopy = (
  credit: DeepTaskView["credit"],
  funding?: DeepTaskView["funding"],
) =>
  ({
    checking: l(
      "Credit confirmed when research starts",
      "研究开始时核对并预留次数",
    ),
    settling: l("Confirming the credit record", "正在核对次数记录"),
    uncharged: l("This attempt used 0 credits", "本次尝试消耗 0 次"),
    reserved:
      funding === "pack"
        ? l("1 purchased credit reserved", "已预留 1 次已购次数")
        : l("1 introductory credit reserved", "已预留 1 次首次体验"),
    used:
      funding === "pack"
        ? l("1 purchased credit used", "已使用 1 次已购次数")
        : l("1 introductory credit used", "已使用 1 次首次体验"),
    returned:
      funding === "pack"
        ? l(
            "Reservation released · original expiry applies",
            "预留已释放 · 沿用原到期日",
          )
        : l("Your introductory credit was returned", "首次体验次数已返还"),
    "own-keys": l(
      "Self-hosted · your provider keys",
      "自部署 · 使用自己的服务密钥",
    ),
  })[credit];
function usePurchasedCredits(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<CreditsResponse | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null);
    if (enabled)
      void api<CreditsResponse>("/api/account/credits", {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setSnapshot(data);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setSnapshot({ state: "unavailable", retryAfter: 10 });
        });
    return () => controller.abort();
  }, [enabled, reload]);
  return {
    remaining:
      snapshot?.state === "ready" ? snapshot.data.balance.available : null,
    refresh: () => setReload((n) => n + 1),
    pending: snapshot === null,
  };
}

export function DeepStart({
  reportId,
  directionId,
  profile,
}: {
  reportId: string;
  directionId: string;
  profile?: ResourceProfile;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [question, setQuestion] = useState<DeepRequest["question"]>("scope");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef({ signature: "", id: "" });
  const paid = !!(
    account?.user &&
    account.hosted &&
    account.deep?.paidAvailable &&
    account.deep.allowance?.remaining === 0
  );
  const purchased = usePurchasedCredits(paid);
  useEffect(() => {
    let active = true;
    void api<Account>("/api/account?lang=" + locale)
      .then((a) => {
        if (active) setAccount(a);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!account?.deep?.enabled) return null;
  const remaining = paid
    ? purchased.remaining
    : account.deep.allowance?.remaining;
  const start = async () => {
    setBusy(true);
    setError("");
    const body = {
      reportId,
      directionId,
      question,
      context,
      ...(paid ? { funding: "pack" as const } : {}),
      ...(profile ? { profile } : {}),
    };
    const signature = JSON.stringify(body);
    if (key.current.signature !== signature)
      key.current = { signature, id: crypto.randomUUID() };
    try {
      const task = await api<DeepTaskView>(`/api/research?lang=${locale}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, requestKey: key.current.id }),
      });
      window.location.assign(localUrl("/research/" + task.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="deep-upgrade">
      <div className="deep-upgrade-label">
        {l("DEEP RESEARCH · ONE DECISION", "深度研究 · 做好一个决定")}
      </div>
      <details className="deep-start">
        <summary>
          <span>
            {l(
              "Make one decision with more evidence",
              "选定一个问题，深入研究这个方向",
            )}
          </span>
          <ArrowRight size={20} />
        </summary>
        <div className="deep-start-body">
          <p>
            {l(
              "Choose one decision. We take more time to read official product and pricing pages, public GitHub evidence and independent community discussions, then return a scoped first release and a concrete validation experiment.",
              "选一个当前要做的决定。我们会花更多时间查阅官方产品与价格页、GitHub 公开证据和独立社区讨论，再给出首版范围、投入估算与一个具体实验。",
            )}
          </p>
          <div
            className="deep-question-options"
            role="group"
            aria-label={l("Your research question", "研究问题")}
          >
            {Object.entries(deepQuestions).map(([q, text]) => (
              <button
                type="button"
                key={q}
                aria-pressed={question === q}
                disabled={busy}
                onClick={() => setQuestion(q as DeepRequest["question"])}
              >
                <span>
                  {question === q ? (
                    <Check size={16} />
                  ) : (
                    <span className="deep-radio" />
                  )}
                </span>
                {label(text)}
              </button>
            ))}
          </div>
          <label className="deep-context">
            {l("Useful context · optional", "补充信息 · 选填")}
            <input
              value={context}
              onChange={(e) => setContext(e.target.value)}
              disabled={busy}
              maxLength={400}
              placeholder={l(
                "For example: compare these two products, or focus on repair shops",
                "例如：希望比较的两款产品，或重点服务的门店类型",
              )}
            />
          </label>
          <div className="deep-start-footer">
            <div>
              <strong>
                {paid
                  ? l(
                      "Focused research · 1 purchased credit",
                      "专项研究 · 使用 1 次已购次数",
                    )
                  : account.hosted
                    ? l(
                        "First focused research: 1 free trial",
                        "首次专项研究：赠送 1 次体验",
                      )
                    : l("Research with your own keys", "使用自己的密钥研究")}
              </strong>
              <p>
                {l(
                  "Reserved at start, used on complete delivery. A collection or generation interruption returns the credit. Results stay private.",
                  "开始时预留，完整交付后使用。采集或生成中断时返还次数，结果按账户私有保存。",
                )}
              </p>
              {account.user && account.hosted && (
                <span>
                  {l("Available now: ", "当前可用：")}
                  {remaining ?? "—"} {l("credit", "次")}
                </span>
              )}
              {paid && (
                <p>
                  {l(
                    `Up to ${account.deep.paidDailyAttempts || 10} attempts per day; each research allows three attempts.`,
                    `每日最多 ${account.deep.paidDailyAttempts || 10} 次尝试，每项研究最多尝试 3 次。`,
                  )}
                </p>
              )}
            </div>
            {!account.user ? (
              <a
                className="button"
                href={loginUrl(`/report/${reportId}#opportunities`)}
              >
                {l("Sign in to research", "登录后开始研究")}
                <ArrowRight size={16} />
              </a>
            ) : paid && remaining === null ? (
              <button
                className="button secondary"
                disabled={purchased.pending}
                onClick={purchased.refresh}
              >
                {l("Confirm available credits", "核对可用次数")}
              </button>
            ) : remaining === 0 ? (
              <a
                className="button secondary"
                href={localUrl(paid ? "/account" : "/history")}
              >
                {paid
                  ? l("View my credits", "查看账户次数")
                  : l("Open my research", "查看我的研究")}
              </a>
            ) : (
              <button
                className="button"
                disabled={busy}
                onClick={() => void start()}
              >
                {busy
                  ? l("Saving your task…", "正在保存任务…")
                  : paid
                    ? l(
                        "Confirm · use 1 purchased credit",
                        "确认研究 · 使用 1 次已购次数",
                      )
                    : l("Start focused research", "开始专项研究")}
                <ArrowRight size={16} />
              </button>
            )}
          </div>
          {error && (
            <p className="error-banner" role="alert">
              {error}{" "}
              <a href={localUrl("/history")}>{l("My research", "我的研究")}</a>
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

export function DeepResearchView({
  id,
  account,
}: {
  id: string;
  account: Account | null;
}) {
  const [task, setTask] = useState<DeepTaskView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const purchased = usePurchasedCredits(
    !!(
      task?.funding === "pack" &&
      task.state === "partial" &&
      task.credit !== "settling"
    ),
  );
  useEffect(() => {
    setTask(null);
    setError("");
    return watchResearch<DeepTaskView>(
      `/api/research/${id}?lang=${locale}`,
      (next) => {
        setTask(next);
        setError("");
        const done =
          !["queued", "running"].includes(next.state) &&
          !["checking", "settling"].includes(next.credit);
        if (done) window.dispatchEvent(new Event("ghtrends:usage"));
        return done;
      },
      (e) => setError(e.message),
    );
  }, [id, reload]);
  const retry = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/research/${id}/retry?lang=${locale}`, {
        method: "POST",
        ...(task?.funding === "pack"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                funding: "pack",
                fromAttempt: task.attempts,
              }),
            }
          : {}),
      });
      setReload((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !window.confirm(
        l(
          "Delete this research content? Usage and credit records will be retained.",
          "删除这份研究内容？使用记录与次数记录会保留。",
        ),
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/research/${id}?lang=${locale}`, { method: "DELETE" });
      window.location.assign(localUrl("/history"));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  if (!task)
    return error ? (
      <div className="deep-page">
        <p role="alert" className="error-banner">
          {error}
        </p>
        <button
          className="button secondary"
          onClick={() => setReload((v) => v + 1)}
        >
          {l("Reload research", "重新读取研究")}
        </button>
        <a href={localUrl("/history")}>{l("My research", "我的研究")}</a>
      </div>
    ) : (
      <Loading />
    );
  const result = task.result,
    useConditions = result
      ? deepProjectUseConditions(result, task.evidence?.sources || [])
      : [],
    useCopy = projectUseCopy(locale),
    active = ["queued", "running"].includes(task.state);
  return (
    <article className="deep-page">
      <nav className="deep-breadcrumb">
        <a href={localUrl("/history")}>{l("My research", "我的研究")}</a>
        <span>/</span>
        <a href={localUrl("/report/" + task.request.reportId)}>
          {l("Original report", "原报告")}
        </a>
      </nav>
      <header className="deep-heading">
        <div className="eyebrow">
          <LockKeyhole size={13} />{" "}
          {l("PRIVATE · FOCUSED RESEARCH", "私有 · 专项研究")}
        </div>
        <h1>{task.title[locale]}</h1>
        <p>{label(deepQuestions[task.request.question])}</p>
        <div className="deep-record">
          <span>{label(stages[task.stage])}</span>
          <span>{creditCopy(task.credit, task.funding)}</span>
          <time>{new Date(task.updated).toLocaleString()}</time>
        </div>
      </header>
      {active && (
        <section className="deep-progress" aria-live="polite">
          <h2>{label(stages[task.stage])}</h2>
          <p>
            {l(
              "Your task is saved. You can leave this page and return through My research.",
              "任务已保存。可以离开本页，稍后从“我的研究”继续查看。",
            )}
          </p>
          <ol>
            {(["planning", "sources", "writing", "reviewing"] as const).map(
              (s) => (
                <li
                  key={s}
                  aria-current={task.stage === s ? "step" : undefined}
                >
                  {label(stages[s])}
                </li>
              ),
            )}
          </ol>
          <ActivityFeed items={task.activities} />
          {task.state === "queued" && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api(`/api/research/${id}/cancel?lang=${locale}`, {
                  method: "POST",
                })
                  .then(() => setReload((v) => v + 1))
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {l("Cancel queued research", "取消排队研究")}
            </button>
          )}
        </section>
      )}
      {task.state === "partial" && (
        <section className="deep-partial">
          <h2>
            {l(
              "Keep the evidence. Complete the remaining checks.",
              "先看已取得的证据，再补齐关键核对",
            )}
          </h2>
          <p>
            {task.problem === "credits"
              ? l(
                  "Check your available credits, then continue this saved question.",
                  "核对账户中的可用次数后，可继续这个已保存的问题。",
                )
              : task.problem === "billing"
                ? l(
                    "Your credit record needs an account review. Your saved work remains available.",
                    "这笔次数记录需要账户核对，已保存的研究可随时查看。",
                  )
                : task.problem === "interrupted"
                  ? l(
                      "This research paused. Your task and collected sources are saved.",
                      "研究已暂停，任务和已采集来源均已保存。",
                    )
                  : task.problem === "sources"
                    ? l(
                        "The selected question needs stronger original sources. The available material is saved below.",
                        "这个问题需要补充更直接的原始来源，已取得的材料保存在下方。",
                      )
                    : l(
                        "The draft needs source and quality checks. Continue this research to finish them.",
                        "报告仍需完成来源与质量核对，已采集的证据保存在下方。",
                      )}
          </p>
          <p>
            {creditCopy(task.credit, task.funding)} ·{" "}
            {l("Reading and exporting use 0 credits.", "阅读和导出消耗 0 次。")}
          </p>
          {task.funding === "pack" && (
            <p>
              {l("Purchased credits available: ", "已购次数可用：")}
              {purchased.remaining ?? "—"} ·{" "}
              <a href={localUrl("/account")}>
                {l("Account & activity", "查看账户与记录")}
              </a>
            </p>
          )}
          {task.funding === "pack" &&
            task.credit !== "settling" &&
            purchased.remaining === null && (
              <button
                className="button secondary"
                disabled={purchased.pending}
                onClick={purchased.refresh}
              >
                {purchased.pending
                  ? l("Checking credits…", "正在核对次数…")
                  : l("Refresh credits", "刷新可用次数")}
              </button>
            )}
          {task.attempts < 3 &&
            account?.deep?.enabled &&
            task.credit !== "settling" && (
              <button
                className="button"
                disabled={
                  busy ||
                  !account.user ||
                  (task.funding === "pack" &&
                    (!account.deep.paidAvailable || !purchased.remaining))
                }
                onClick={() => void retry()}
              >
                {busy
                  ? l("Resuming…", "正在恢复…")
                  : task.funding === "pack"
                    ? l(
                        "Continue · reserve 1 purchased credit",
                        "继续研究 · 预留 1 次已购次数",
                      )
                    : account.hosted
                      ? l(
                          "Continue this research · reserve 1 trial",
                          "继续本次研究 · 预留 1 次体验",
                        )
                      : l("Continue this research", "继续本次研究")}
              </button>
            )}
          {task.attempts >= 3 && (
            <p>
              {l(
                "Three collection attempts are saved. Use the sources below to continue your own review.",
                "三次采集记录已保存，可结合下方来源继续核对。",
              )}
            </p>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {result && (
        <>
          <section className="deep-answer">
            <span className="eyebrow">
              {task.state === "complete"
                ? l("THE DECISION", "这次研究带来的判断")
                : l("INTERIM JUDGMENT", "阶段性判断")}
            </span>
            <h2>{result.headline[locale]}</h2>
            <p>{result.answer[locale]}</p>
            <div className="deep-next-step">
              <h3>{l("Your next move", "现在最值得做的一步")}</h3>
              <p>{result.plan.deliverable[locale]}</p>
              {result.experimentPlan && (
                <p className="deep-success-rule">
                  <strong>{l("Success means: ", "达标看什么：")}</strong>
                  {result.experimentPlan[locale].measurement}
                </p>
              )}
              <dl className="deep-decision-conditions">
                <div>
                  <dt>{l("Continue when", "什么结果值得继续")}</dt>
                  <dd>{result.plan.continueIf[locale]}</dd>
                </div>
                <div>
                  <dt>{l("Change course when", "什么结果需要调整")}</dt>
                  <dd>{result.plan.changeIf[locale]}</dd>
                </div>
              </dl>
              <small>
                {l(
                  "Proposed test thresholds, not validated demand.",
                  "以上为建议验证门槛，不代表需求或付费意愿已得到证实。",
                )}
              </small>
            </div>
          </section>
          <section className="deep-findings">
            {result.findings.map((f, i) => (
              <article key={i}>
                <div className="deep-finding-label">
                  <span>
                    {String(i + 1).padStart(2, "0")} ·{" "}
                    {label(deepAreaLabels[f.area])}
                  </span>
                  <small>
                    {f.basis === "observed"
                      ? l("Source evidence", "来源证据")
                      : l("Research inference", "研究推断")}
                  </small>
                </div>
                <h3>{f.subject[locale]}</h3>
                <p>{f.statement[locale]}</p>
                {f.evidence.map((ref, j) => {
                  const source = task.evidence?.sources.find(
                    (s) => s.id === ref.id,
                  );
                  return source ? (
                    <details className="deep-citation" key={j}>
                      <summary>
                        {l("Read the supporting quote", "查看依据原话")} ·{" "}
                        {source.label}
                      </summary>
                      <blockquote>{ref.quote}</blockquote>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {l("Open original source", "打开原始来源")}{" "}
                        <ArrowUpRight size={13} />
                      </a>
                      <small>
                        {source.fetchedAt
                          ? l("Read ", "采集于 ") +
                            new Date(source.fetchedAt).toLocaleDateString()
                          : ""}
                      </small>
                    </details>
                  ) : null;
                })}
                {f.implication && (
                  <div className="deep-implication">
                    <span>
                      {l(
                        "What this suggests · research inference",
                        "对你的意义 · 研究推断",
                      )}
                    </span>
                    <p>{f.implication[locale]}</p>
                  </div>
                )}
              </article>
            ))}
          </section>
          <details className="deep-plan">
            <summary>
              {l(
                "Test steps, resources & effort",
                "展开验证步骤、资源与投入估算",
              )}
            </summary>
            <p className="footnote">
              {l(
                "Scope, effort and experiment thresholds are research proposals. Confirm them against your resources and real use.",
                "范围、工期与实验门槛均为研究建议，结合自己的资源和实际使用继续验证。",
              )}
            </p>
            <dl>
              {Object.entries(deepPlanLabels)
                .filter(
                  ([key]) =>
                    !["deliverable", "continueIf", "changeIf"].includes(key),
                )
                .map(([key, text]) => (
                  <div key={key}>
                    <dt>{label(text)}</dt>
                    <dd>
                      {key === "effort"
                        ? deepEffortText(result.plan.effort, locale)
                        : result.plan[
                            key as Exclude<keyof typeof result.plan, "effort">
                          ][locale]}
                      {key === "resources" && useConditions.length > 0 && (
                        <aside
                          className="opportunity-use-conditions"
                          aria-label={useCopy.title}
                        >
                          <strong>{useCopy.title}</strong>
                          <p>{useCopy.text}</p>
                          {useConditions.map((notice) => (
                            <div key={notice.project + notice.quote}>
                              <a
                                href={notice.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {notice.project}
                                <ArrowUpRight size={13} />
                              </a>
                              <blockquote>{notice.quote}</blockquote>
                            </div>
                          ))}
                        </aside>
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          </details>
          {!!result.checks.length && (
            <section className="deep-checks">
              <h2>{l("Before you commit", "投入前再核对")}</h2>
              <ul>
                {result.checks.map((c, i) => (
                  <li key={i}>{c[locale]}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {task.evidence && (
        <section
          className="deep-coverage"
          aria-label={l("Evidence coverage", "证据覆盖")}
        >
          <h2>{l("What this decision rests on", "这次判断基于什么")}</h2>
          <div className="deep-coverage-grid">
            <div>
              <strong>
                {task.evidence.reads.filter((r) => r.status === "read").length}
              </strong>
              <span>{l("web originals read", "已读取网页原文")}</span>
            </div>
            <div>
              <strong>
                {
                  task.evidence.sources.filter(
                    (s) =>
                      s.kind === "request" ||
                      [
                        "hn-comment",
                        "github-comment",
                        "github-discussion",
                      ].includes(s.documentType || ""),
                  ).length
                }
              </strong>
              <span>{l("request / discussion records", "诉求与讨论记录")}</span>
            </div>
            <div>
              <strong>
                {
                  new Set(
                    task.evidence.sources.map((s) => new URL(s.url).hostname),
                  ).size
                }
              </strong>
              <span>{l("source websites", "来源网站")}</span>
            </div>
          </div>
          <p>
            {l(
              "Records can come from the same person. Source coverage describes research, not market demand or willingness to pay.",
              "多条记录可能来自同一个人。来源覆盖表示研究范围，需求规模与付费意愿仍需实际验证。",
            )}
          </p>
          {!!task.evidence.reads.filter((r) => r.status !== "read").length && (
            <p>
              {l(
                "Some original pages could not be read; indexed excerpts remain discovery leads. Check the source details below.",
                "部分原文读取受限，搜索摘要保留为线索。下方来源详情列出具体状态。",
              )}
            </p>
          )}
        </section>
      )}
      {task.evidence && (
        <details className="deep-evidence" open={task.state === "partial"}>
          <summary>
            {l("Research sources", "本次研究来源")} ·{" "}
            {task.evidence.sources.length}
          </summary>
          <p>
            {l(
              "Original material and search leads are listed with their collection dates. Broader demand and pricing require their own supporting evidence.",
              "原始材料与搜索线索保留采集时间，需求规模和具体收费按各自证据核对。",
            )}
          </p>
          <div className="deep-source-list">
            {task.evidence.sources.map((s) => (
              <div key={s.id}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.label}
                  <ArrowUpRight size={14} />
                </a>
                <small>
                  {result &&
                    (result.findings.some((f) =>
                      f.evidence.some((ref) => ref.id === s.id),
                    )
                      ? l("Cited in findings", "结论已引用")
                      : l(
                          "Collected lead · not cited",
                          "采集线索 · 未用于结论",
                        ))}
                  {result ? " · " : ""}
                  {s.documentType ||
                  s.kind === "project" ||
                  s.kind === "request"
                    ? l("Original material", "原始材料")
                    : l("Search excerpt", "搜索摘要")}{" "}
                  ·{" "}
                  {s.fetchedAt
                    ? new Date(s.fetchedAt).toLocaleDateString()
                    : l("See collection record", "见采集记录")}
                </small>
              </div>
            ))}
          </div>
          <details>
            <summary>
              {l("Queries and source coverage", "查询词与来源覆盖")}
            </summary>
            {task.evidence.queries.map((q) => (
              <p key={q.query}>{q.query}</p>
            ))}
            <p>GitHub · {task.evidence.githubQuery}</p>
            {task.evidence.reads.map((read) => (
              <p key={read.url}>
                <a href={read.url} target="_blank" rel="noreferrer">
                  {new URL(read.url).hostname}
                </a>
                {" · "}
                {read.status === "read"
                  ? l("Original read", "已读取原文")
                  : l("Original unavailable", "原文读取受限")}
                {" · "}
                {read.status}
              </p>
            ))}
            {task.evidence.web && (
              <p>
                {l("Web collection", "网页采集")} · {task.evidence.web.state} ·{" "}
                {task.evidence.web.region}
              </p>
            )}
          </details>
        </details>
      )}
      <footer className="deep-export">
        <span>
          {l(
            "Saved privately · bilingual · ready to take with you",
            "私有保存 · 中英双语 · 随时带走",
          )}
        </span>
        <div>
          <a
            className="button secondary"
            href={appUrl(`/api/research/${id}/export?lang=${locale}`)}
          >
            <Download size={15} /> Markdown
          </a>
          <a
            className="button secondary"
            href={appUrl(
              `/api/research/${id}/export?format=json&lang=${locale}`,
            )}
          >
            JSON
          </a>
        </div>
      </footer>
      {!active && (
        <ResearchFeedback key={id} kind="deep" id={id} account={account} />
      )}
      {!active && (
        <button
          className="deep-delete"
          disabled={busy || !account?.user}
          onClick={() => void remove()}
        >
          {l("Delete this research content", "删除这份研究内容")}
        </button>
      )}
    </article>
  );
}

export function DeepHistory({ account }: { account: Account }) {
  const [data, setData] = useState<
    | (DeepStatus & {
        tasks: Pick<
          DeepTaskView,
          | "id"
          | "title"
          | "state"
          | "stage"
          | "credit"
          | "created"
          | "updated"
          | "funding"
        >[];
      })
    | null
  >(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const read = () =>
      api<typeof data>("/api/research", { signal: controller.signal })
        .then((d) => {
          if (!active) return;
          setData(d);
          setError("");
          if (
            d?.tasks.some(
              (t) =>
                t.state === "queued" ||
                t.state === "running" ||
                t.credit === "settling",
            )
          )
            timer = setTimeout(read, 5000);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [account.user?.name]);
  if (!account.deep?.enabled && !data?.tasks.length) return null;
  return (
    <section className="deep-history">
      <div className="deep-history-heading">
        <h2>{l("Focused research", "专项研究")}</h2>
        <span>
          {account.hosted
            ? l("Introductory credits available: ", "首次体验可用：") +
              (data?.allowance?.remaining ??
                account.deep?.allowance?.remaining ??
                0)
            : l("Your provider keys", "使用自己的服务密钥")}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      {data?.tasks.length ? (
        data.tasks.map((task) => (
          <a
            className="deep-history-row"
            key={task.id}
            href={localUrl("/research/" + task.id)}
          >
            <div>
              <strong>{task.title[locale]}</strong>
              <span>
                {label(stages[task.stage])} ·{" "}
                {creditCopy(task.credit, task.funding)}
              </span>
            </div>
            <ArrowRight size={18} />
          </a>
        ))
      ) : (
        <p>
          {l(
            "Open a direction in a report and choose one question to research further.",
            "在报告中选定一个方向，再选择一个问题开始专项研究。",
          )}
        </p>
      )}
    </section>
  );
}
