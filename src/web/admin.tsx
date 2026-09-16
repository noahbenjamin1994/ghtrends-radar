import React, { useEffect, useState } from "react";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "./api.js";
import { locale } from "./i18n.js";
import { Loading, Empty } from "./components.js";
import { SignInGate, type Account } from "./account.js";
const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
const n = (x: number | null | undefined) =>
  x == null ? "—" : Math.round(x).toLocaleString();
const money = (x: number | null) => (x == null ? "—" : "$" + x.toFixed(5));
const date = (s: string) =>
  new Date(s).toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
const labels: Record<string, string> = {
  queued: l("Queued", "排队中"),
  running: l("Running", "进行中"),
  complete: l("Complete", "已完成"),
  failed: l("Failed", "失败"),
  interrupted: l("Interrupted", "重启中断"),
};
interface AdminData {
  engagement: {
    since: string;
    events: { event: string; count: number }[];
    scans: { state: string; count: number }[];
  };
  recordedSince: string;
  retentionDays: number;
  version: string;
  runCount: number;
  totals: {
    users: number;
    reports: number;
    privateReports: number;
    databaseBytes: number;
  };
  runsSummary: { state: string; count: number }[];
  providers: {
    provider: string;
    calls: number;
    cacheHits: number;
    errors: number;
    averageMs: number | null;
  }[];
  models: {
    model: string;
    operation: string;
    requests: number;
    cacheHits: number;
    inputTokens: number | null;
    outputTokens: number | null;
    cachedTokens: number | null;
    estimatedUsd: number | null;
    unknownUsage: number;
    unpriced: number;
  }[];
  runs: {
    id: string;
    input: string;
    user_id: string | null;
    user_name: string | null;
    state: string;
    created: string;
    started: string | null;
    finished: string | null;
    error: string | null;
    warnings: string | null;
    estimated_usd: number | null;
    background: number;
  }[];
  users: {
    id: string;
    name: string;
    created: string;
    scans: number;
    reports: number;
    estimatedUsd: number | null;
  }[];
  recentErrors: {
    provider: string;
    operation: string;
    started: string;
    status: number | null;
    error: string;
  }[];
  githubLimits: {
    rate_bucket: string;
    rate_remaining: number;
    rate_reset: number;
    started: string;
  }[];
  queue: {
    id: string;
    input: string;
    state: string;
    stage?: string;
    background: boolean;
    created: number;
  }[];
  configuration: {
    mode: string;
    auth: boolean;
    ai: boolean;
    model: string;
    dailyLimit: number;
    adminUserIds: string[];
    pricingConfigured: boolean;
  };
}
export function AdminView({ account }: { account: Account | null }) {
  const [data, setData] = useState<AdminData | null>(null),
    [error, setError] = useState(""),
    [days, setDays] = useState(7),
    [page, setPage] = useState(0),
    [state, setState] = useState(""),
    [loading, setLoading] = useState(false);
  const load = () => {
    setLoading(true);
    return api<AdminData>(`/api/admin?days=${days}&page=${page}&state=${state}`)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => {
        setError(e.message);
        if (e.status === 401 || e.status === 403) setData(null);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!account?.user?.isAdmin) return;
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 30000);
    return () => clearInterval(timer);
  }, [account?.user?.isAdmin, days, page, state]);
  if (!account) return <Loading />;
  if (!account.user) return <SignInGate account={account} returnTo="/admin" />;
  if (!account.user.isAdmin)
    return (
      <Empty
        title={l("Administrator access required", "此页面仅管理员可用")}
        description={l(
          "Ask the deployment owner to configure your Logto user ID.",
          "请让部署者在服务器配置你的 Logto 用户 ID。",
        )}
      />
    );
  return (
    <div className="admin-page">
      <div className="eyebrow">
        {l("OPERATIONS / PRIVATE", "运行管理 / 仅管理员")}
      </div>
      <div className="admin-heading">
        <div>
          <h1>{l("Keep the radar running", "运行与消耗")}</h1>
          <p>
            {l(
              "Scans, source health and recorded AI usage.",
              "查看扫描状态、数据源情况与 AI 消耗记录。",
            )}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
          {l("Refresh", "刷新")}
        </button>
      </div>
      <div className="admin-filters">
        <label>
          {l("Period", "时间范围")}{" "}
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPage(0);
            }}
          >
            {[1, 7, 30].map((d) => (
              <option key={d} value={d}>
                {d} {l("days", "天")}
              </option>
            ))}
          </select>
        </label>
        <span>
          {l(
            "Rolling window · dates shown in your local time · refreshes every 30s",
            "滚动时间范围 · 日期按本地时区显示 · 每 30 秒刷新",
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <p className="admin-note">
            {l("Recording began", "记录开始于")} {date(data.recordedSince)}.{" "}
            {l(
              "Earlier spending is unknown. Operational logs are kept for",
              "更早的消耗未知。运行日志保留",
            )}{" "}
            {data.retentionDays}{" "}
            {l(
              "days; saved reports are retained separately.",
              "天；已保存的报告单独保留。",
            )}
          </p>
          <section className="panel">
            <h2>{l("Research and sharing", "研究与传播")}</h2>
            <p>
              {l("Aggregate actions since", "汇总行为记录开始于")}{" "}
              {date(data.engagement.since)}.{" "}
              {l(
                "Actions are grouped by UTC calendar day; user scans use the rolling period above.",
                "行为按 UTC 自然日汇总，用户扫描使用上方的滚动时间范围。",
              )}{" "}
              {l(
                "Actions are not unique people or GitHub stars. These counters store no search text or visitor identifiers.",
                "以下为行为次数，不是独立用户数或实际 GitHub Star；这些计数不保存搜索内容或访客标识。",
              )}
            </p>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{l("Action", "行为")}</th>
                    <th>{l("Count", "次数")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["report_view", "Report reads", "报告阅读"],
                    ["share_copy", "Report link copies", "报告链接复制"],
                    ["share_publish", "Reports made public", "报告公开"],
                    ["export_png", "PNG exports", "图片导出"],
                    [
                      "export_md",
                      "Markdown download clicks",
                      "Markdown 下载点击",
                    ],
                    ["export_json", "JSON download clicks", "JSON 下载点击"],
                    [
                      "opensource_view",
                      "Open-source setup views",
                      "开源使用页面浏览",
                    ],
                    [
                      "github_click",
                      "Source repository clicks",
                      "源码仓库点击",
                    ],
                    ["install_copy", "Install commands copied", "安装命令复制"],
                    ["project_save", "Projects saved", "项目收藏"],
                    ["report_save", "Reports saved manually", "手动保存报告"],
                  ].map(([key, en, zh]) => (
                    <tr key={key}>
                      <td>{l(en!, zh!)}</td>
                      <td>
                        {n(
                          data.engagement.events.find((e) => e.event === key)
                            ?.count || 0,
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      {l(
                        "Completed user scans (excludes scheduled refreshes)",
                        "用户完成的扫描（不含定时刷新）",
                      )}
                    </td>
                    <td>
                      {n(
                        data.engagement.scans.find(
                          (r) => r.state === "complete",
                        )?.count || 0,
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <div className="metric-grid admin-metrics">
            <div>
              <span>{l("Registered here", "本站登录用户")}</span>
              <strong>{n(data.totals.users)}</strong>
              <small>{l("All time", "累计")}</small>
            </div>
            <div>
              <span>{l("Reports stored", "已存报告")}</span>
              <strong>{n(data.totals.reports)}</strong>
              <small>
                {n(data.totals.privateReports)} {l("private", "份私有")}
              </small>
            </div>
            <div>
              <span>{l("Scans in period", "期间扫描")}</span>
              <strong>
                {n(data.runsSummary.reduce((s, r) => s + r.count, 0))}
              </strong>
              <small>
                {data.runsSummary
                  .map((r) => `${labels[r.state]} ${r.count}`)
                  .join(" · ") || "—"}
              </small>
            </div>
            <div>
              <span>{l("Estimated AI cost", "AI 估算费用")}</span>
              <strong>
                {money(
                  data.models.some((m) => m.estimatedUsd !== null)
                    ? data.models.reduce((s, m) => s + (m.estimatedUsd || 0), 0)
                    : null,
                )}
              </strong>
              <small>
                {l(
                  "USD · priced requests only; not an invoice",
                  "USD · 仅计已知价格的请求，并非账单",
                )}
              </small>
            </div>
          </div>
          <section className="panel">
            <div className="panel-title">
              <h2>{l("Source health", "数据源运行情况")}</h2>
              <span>
                {l("Requests include cache reuse", "请求数含本地缓存复用")}
              </span>
            </div>
            <div className="admin-table">
              <table>
                <thead>
                  <tr>
                    {[
                      l("Source", "数据源"),
                      l("Requests", "请求数"),
                      l("Local cache", "本地缓存"),
                      l("Failed calls", "失败调用"),
                      l("Mean duration", "平均耗时"),
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.providers.map((p) => (
                    <tr key={p.provider}>
                      <th>{p.provider}</th>
                      <td>{n(p.calls)}</td>
                      <td>{n(p.cacheHits)}</td>
                      <td>{n(p.errors)}</td>
                      <td>
                        {p.averageMs == null
                          ? "—"
                          : (p.averageMs / 1000).toFixed(1) + "s"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.providers.length && (
              <p>
                {l(
                  "No calls recorded in this period.",
                  "此时间段还没有调用记录。",
                )}
              </p>
            )}
            {data.githubLimits.map((r) => (
              <p className="footnote" key={r.rate_bucket}>
                GitHub {r.rate_bucket}: {n(r.rate_remaining)}{" "}
                {l("remaining at", "次剩余，采样于")} {date(r.started)} ·{" "}
                {l("reset", "重置于")}{" "}
                {date(new Date(r.rate_reset * 1000).toISOString())}
              </p>
            ))}
          </section>
          <section className="panel">
            <h2>{l("AI consumption", "AI 消耗")}</h2>
            <p className="footnote">
              {l(
                "Token counts come from provider responses. Unknown usage and unpriced calls are listed separately; a failed request may still be billed. Cached input tokens are part of input tokens.",
                "Token 来自服务商响应。未知用量与未估价调用单独列出；失败请求也可能产生费用。命中缓存的输入 token 已包含在输入总量内。",
              )}
            </p>
            <div className="admin-table">
              <table>
                <thead>
                  <tr>
                    {[
                      l("Model / task", "模型 / 任务"),
                      l("API / local cache", "API / 本地缓存"),
                      l("Input / output", "输入 / 输出"),
                      l("Cached input", "缓存输入"),
                      l("Estimated USD", "估算 USD"),
                      l("Unknown usage / price", "用量未知 / 未估价"),
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.models.map((m) => (
                    <tr key={m.model + m.operation}>
                      <th>
                        {m.model}
                        <small>
                          {m.operation === "plan"
                            ? l("Query planning", "搜索词整理")
                            : l("Research brief", "简短报告")}
                        </small>
                      </th>
                      <td>
                        {n(m.requests - m.cacheHits)} / {n(m.cacheHits)}
                      </td>
                      <td>
                        {n(m.inputTokens)} / {n(m.outputTokens)}
                      </td>
                      <td>{n(m.cachedTokens)}</td>
                      <td>{money(m.estimatedUsd)}</td>
                      <td>
                        {n(m.unknownUsage)} / {n(m.unpriced)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.models.length && (
              <p>
                {l(
                  "No AI calls recorded in this period.",
                  "此时间段还没有 AI 调用记录。",
                )}
              </p>
            )}
          </section>
          {!!data.queue.length && (
            <section className="panel">
              <h2>{l("Live queue", "当前队列")}</h2>
              {data.queue.map((q) => (
                <p key={q.id}>
                  {q.input} · {labels[q.state]} ·{" "}
                  {q.background
                    ? l("scheduled", "定时采集")
                    : l("user scan", "用户扫描")}
                </p>
              ))}
            </section>
          )}
          <section className="panel">
            <div className="panel-title">
              <h2>{l("Scan records", "扫描记录")}</h2>
              <label>
                {l("Status", "状态")}{" "}
                <select
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">{l("All", "全部")}</option>
                  {Object.entries(labels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="admin-runs">
              {data.runs.map((r) => (
                <article key={r.id}>
                  <div>
                    <strong>{r.input}</strong>
                    <span className={`admin-state ${r.state}`}>
                      {labels[r.state]}
                    </span>
                  </div>
                  <p>
                    {r.background
                      ? l("Scheduled collection", "定时采集")
                      : r.user_name ||
                        r.user_id ||
                        l("Local workspace", "本地工作区")}{" "}
                    · {date(r.created)}
                    {r.started && r.finished
                      ? ` · ${((Date.parse(r.finished) - Date.parse(r.started)) / 1000).toFixed(1)}s`
                      : ""}{" "}
                    · {money(r.estimated_usd)}
                  </p>
                  {r.error && <p className="error-banner">{r.error}</p>}
                  {r.warnings &&
                    JSON.parse(r.warnings).map((w: string) => (
                      <p className="admin-note" key={w}>
                        {w}
                      </p>
                    ))}
                  <small className="muted">{r.id}</small>
                </article>
              ))}
            </div>
            {!data.runs.length && (
              <p>
                {l("No scans match these filters.", "没有符合筛选条件的扫描。")}
              </p>
            )}
            <div className="admin-pagination">
              <button
                className="button secondary"
                disabled={!page}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={15} />
                {l("Previous", "上一页")}
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(data.runCount / 20))}
              </span>
              <button
                className="button secondary"
                disabled={(page + 1) * 20 >= data.runCount}
                onClick={() => setPage((p) => p + 1)}
              >
                {l("Next", "下一页")}
                <ChevronRight size={15} />
              </button>
            </div>
          </section>
          {!!data.recentErrors.length && (
            <section className="panel">
              <h2>{l("Recent source failures", "最近的数据源失败")}</h2>
              <div className="admin-table">
                <table>
                  <tbody>
                    {data.recentErrors.map((r, i) => (
                      <tr key={i}>
                        <td>{date(r.started)}</td>
                        <td>
                          {r.provider} / {r.operation}
                        </td>
                        <td>{r.status ?? "—"}</td>
                        <td>{r.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section className="panel">
            <h2>{l("Accounts", "用户概况")}</h2>
            <p className="footnote">
              {l(
                "Up to 100 accounts, sorted by scans in this period. Private report access remains with its owner.",
                "最多展示 100 个用户，按期间扫描数排序。私有报告仍仅供其所有者查看。",
              )}
            </p>
            <div className="admin-table">
              <table>
                <thead>
                  <tr>
                    {[
                      l("Account", "账号"),
                      l("Scans in period", "期间扫描"),
                      l("Saved reports", "保存报告"),
                      l("Estimated USD", "估算 USD"),
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <th>
                        {u.name}
                        <small>{u.id}</small>
                      </th>
                      <td>{u.scans}</td>
                      <td>{u.reports}</td>
                      <td>{money(u.estimatedUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel admin-configuration">
            <h2>{l("Deployment settings", "部署配置")}</h2>
            <dl>
              <dt>{l("Mode / method", "模式 / 算法")}</dt>
              <dd>
                {data.configuration.mode} / v{data.version}
              </dd>
              <dt>{l("Identity / AI", "身份服务 / AI")}</dt>
              <dd>
                Logto {data.configuration.auth ? "✓" : "—"} ·{" "}
                {data.configuration.ai ? data.configuration.model : "—"}
              </dd>
              <dt>{l("Daily scan allowance", "每日扫描额度")}</dt>
              <dd>{data.configuration.dailyLimit}</dd>
              <dt>{l("Database", "数据库")}</dt>
              <dd>
                SQLite · {(data.totals.databaseBytes / 1048576).toFixed(1)} MiB
              </dd>
              <dt>{l("Administrator IDs", "管理员 ID")}</dt>
              <dd>
                {data.configuration.adminUserIds.join(", ") ||
                  l("Local workspace owner", "本地工作区所有者")}
              </dd>
            </dl>
            <p>
              {l(
                "Set GHTRENDS_ADMIN_USER_IDS on the server to a comma-separated list of immutable Logto user IDs, then restart. This page cannot grant privileges. No credentials are returned to the browser.",
                "服务器通过 GHTRENDS_ADMIN_USER_IDS 配置管理员，填写以逗号分隔的 Logto 固定用户 ID，修改后重启。此页不能自行授予权限，也不会返回密钥。",
              )}
            </p>
            <p>
              {l(
                "Cost rates: GHTRENDS_LLM_PRICING_JSON. Estimates are saved per request; later rate changes do not rewrite history.",
                "费用单价：GHTRENDS_LLM_PRICING_JSON。每次请求保存当时估价，修改单价不会重算历史。",
              )}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
