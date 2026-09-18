import React, { useEffect, useState } from "react";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "./api.js";
import { locale } from "./i18n.js";
import { Loading, Empty } from "./components.js";
import { SignInGate, type Account } from "./account.js";
import type { ProxyUsage } from "../providers/proxy-usage.js";
const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
const n = (x: number | null | undefined) =>
  x == null ? "—" : Math.round(x).toLocaleString();
const money = (x: number | null) => (x == null ? "—" : "$" + x.toFixed(5));
const date = (s: string) =>
  new Date(s).toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
const bytes = (v: number | null) =>
  v === null
    ? "—"
    : v >= 1e9
      ? (v / 1e9).toFixed(2) + " GB"
      : (v / 1e6).toFixed(2) + " MB";
const labels: Record<string, string> = {
  queued: l("Queued", "排队中"),
  running: l("Running", "进行中"),
  complete: l("Complete", "已完成"),
  failed: l("Failed", "失败"),
  interrupted: l("Interrupted", "重启中断"),
};
interface AdminData {
  proxyUsage: ProxyUsage;
  traffic: {
    since: string;
    today: { bytes: number | null; requests: number; measuredRequests: number };
    period: {
      bytes: number | null;
      requests: number;
      scans: number;
      averageScanBytes: number | null;
      errors: number;
      measuredRequests: number;
    };
    daily: { day: string; bytes: number; requests: number }[];
    routes: {
      route: string;
      requests: number;
      successes: number;
      throttled: number;
      averageMs: number;
      bytes: number | null;
    }[];
  };
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
    reasoningTokens: number | null;
    reasoningPending: number;
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
    researchThinking: "off" | "low";
    dailyLimit: number;
    serviceLimit: number;
    attemptLimit: number;
    search?: {
      configured: boolean;
      mode?: "direct" | "api" | "off";
      maxQueries: number;
      cacheHours: number;
    };
    trends: {
      proxy: boolean;
      region: string;
      retryAt: string | null;
      routes?: number;
      coolingRoutes?: number;
    };
    usageToday: { kind: string; state: string; count: number }[];
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
          <section className="proxy-overview panel">
            <div className="panel-title">
              <div>
                <div className="eyebrow">GOOGLE TRENDS + SEARCH / DECODO</div>
                <h2>
                  {l("Proxy traffic & reliability", "代理流量与采集质量")}
                </h2>
              </div>
              <a
                href="https://dashboard.decodo.com/"
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                {l("Decodo dashboard ↗", "Decodo 账单 ↗")}
              </a>
            </div>
            <div className="metric-grid proxy-metrics">
              <div>
                <span>{l("Plan remaining", "套餐剩余")}</span>
                <strong>
                  {data.proxyUsage.subscription
                    ? data.proxyUsage.subscription.remainingGb.toFixed(2) +
                      " GB"
                    : "—"}
                </strong>
                <small>
                  {data.proxyUsage.subscription
                    ? l("of ", "套餐总量 ") +
                      data.proxyUsage.subscription.totalGb.toFixed(2) +
                      " GB"
                    : l(
                        "Connect the management API for balance",
                        "接入管理 API 后显示余额",
                      )}
                </small>
              </div>
              <div>
                <span>{l("Billed today · UTC", "今日计费流量 · UTC")}</span>
                <strong>
                  {bytes(
                    data.proxyUsage.traffic
                      ? (data.proxyUsage.traffic.daily.find(
                          (d) =>
                            d.day === new Date().toISOString().slice(0, 10),
                        )?.bytes ?? 0)
                      : null,
                  )}
                </strong>
                <small>
                  {l(
                    "Decodo account · uploads + downloads",
                    "Decodo 账号 · 上传与下载合计",
                  )}
                </small>
              </div>
              <div>
                <span>
                  {l("HTTP bytes per research", "单次研究 HTTP 流量")}
                </span>
                <strong>{bytes(data.traffic.period.averageScanBytes)}</strong>
                <small>
                  {l(
                    "Measured transfers · TLS billed separately",
                    "实测传输量 · 计费另含 TLS 开销",
                  )}
                </small>
              </div>
              <div>
                <span>{l("Proxy request success", "代理请求成功率")}</span>
                <strong>
                  {data.traffic.period.requests
                    ? (
                        ((data.traffic.period.requests -
                          data.traffic.period.errors) /
                          data.traffic.period.requests) *
                        100
                      ).toFixed(1) + "%"
                    : "—"}
                </strong>
                <small>
                  {data.configuration.trends.routes || 1}{" "}
                  {l("Trends sessions", "个 Trends 会话")} ·{" "}
                  {data.configuration.trends.coolingRoutes || 0}{" "}
                  {l("cooling down", "个等待恢复")}
                </small>
              </div>
            </div>
            {data.proxyUsage.subscription && (
              <div
                className="usage-track"
                role="meter"
                aria-label={l("Plan traffic used", "套餐已用流量")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(
                  100,
                  (data.proxyUsage.subscription.usedGb /
                    Math.max(0.001, data.proxyUsage.subscription.totalGb)) *
                    100,
                )}
              >
                <span
                  style={{
                    width:
                      Math.min(
                        100,
                        (data.proxyUsage.subscription.usedGb /
                          Math.max(
                            0.001,
                            data.proxyUsage.subscription.totalGb,
                          )) *
                          100,
                      ) + "%",
                  }}
                />
              </div>
            )}
            <p className="footnote">
              {data.proxyUsage.state === "setup"
                ? l(
                    "Add DECODO_API_KEY to the server environment to connect official usage. Local HTTP measurements are already active.",
                    "在服务端配置 DECODO_API_KEY 即可接入官方用量。本地 HTTP 流量统计已启用。",
                  )
                : data.proxyUsage.state === "refreshing"
                  ? l(
                      "Official usage is awaiting synchronization. The last recorded snapshot stays visible.",
                      "官方用量等待同步，当前保留最近记录的快照。",
                    )
                  : l(
                      "Official figures cover this Decodo account and refresh every 15 minutes.",
                      "官方数据覆盖整个 Decodo 账号，每 15 分钟刷新。",
                    )}
              {data.proxyUsage.fetchedAt && (
                <> · {date(data.proxyUsage.fetchedAt)}</>
              )}
              {data.proxyUsage.subscription?.validUntil && (
                <>
                  {" · "}
                  {l("Plan valid through ", "套餐有效期至 ")}
                  {data.proxyUsage.subscription.validUntil.slice(0, 10)}
                </>
              )}
            </p>
            <div className="proxy-detail-grid">
              <div>
                <h3>{l("Daily billed traffic", "每日计费流量")}</h3>
                <div className="traffic-bars">
                  {(data.proxyUsage.traffic?.daily || []).map((d) => (
                    <div
                      key={d.day}
                      title={`${d.day}: ${bytes(d.bytes)} · ${d.requests} requests`}
                    >
                      <span>{bytes(d.bytes)}</span>
                      <i
                        style={{
                          height: Math.max(
                            3,
                            (90 * d.bytes) /
                              Math.max(
                                1,
                                ...data.proxyUsage.traffic!.daily.map(
                                  (x) => x.bytes,
                                ),
                              ),
                          ),
                        }}
                      />
                      <small>{d.day.slice(5)}</small>
                    </div>
                  ))}
                </div>
                {!data.proxyUsage.traffic && (
                  <p className="muted">
                    {l(
                      "Official daily totals appear after connection.",
                      "接入后显示官方每日消耗曲线。",
                    )}
                  </p>
                )}
              </div>
              <div>
                <h3>{l("Session health", "会话状态")}</h3>
                <div className="admin-table">
                  <table>
                    <thead>
                      <tr>
                        <th>{l("Session", "会话")}</th>
                        <th>{l("Success", "成功")}</th>
                        <th>429</th>
                        <th>{l("HTTP traffic", "HTTP 流量")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.traffic.routes.map((r) => (
                        <tr key={r.route}>
                          <th>
                            {r.route === "primary"
                              ? l("Primary", "主会话")
                              : l("Backup", "备用会话")}
                          </th>
                          <td>
                            {r.successes}/{r.requests}
                          </td>
                          <td>{r.throttled}</td>
                          <td>{bytes(r.bytes)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="footnote">
                  {l("HTTP measurement began ", "HTTP 流量开始统计于 ")}
                  {date(data.traffic.since)} · {l("today ", "今日 ")}
                  {bytes(data.traffic.today.bytes)}
                  {data.configuration.trends.retryAt && (
                    <>
                      {" "}
                      · {l("Recovery ", "恢复于 ")}
                      {date(data.configuration.trends.retryAt)}
                    </>
                  )}
                </p>
              </div>
            </div>
          </section>
          <p className="admin-note">
            {l("Recording began", "记录开始于")} {date(data.recordedSince)}.{" "}
            {l(
              "Spending totals begin on this date. Operational logs are kept for",
              "消耗统计从此日期开始。运行日志保留",
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
                "These counters track actions. Individual users and GitHub stars are separate metrics. Stored fields contain daily event totals.",
                "以下统计行为次数，独立用户与 GitHub Star 分别衡量；存储字段仅包含每日事件汇总。",
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
                        "用户完成的扫描（后台任务单列）",
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
                  "USD · estimates for priced requests",
                  "USD · 按已配置单价估算，实际费用以服务商账单为准",
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
                  "Calls will appear here as they are recorded.",
                  "采集到的调用记录会显示在这里。",
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
                "Token counts come from provider responses. Usage awaiting confirmation and calls awaiting pricing are listed separately; requests in every status may incur charges. Cached input tokens are part of input tokens.",
                "Token 来自服务商响应。待补充用量与待估价调用单列；各状态请求均可能产生费用。缓存命中的输入 token 已包含在输入总量内。",
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
                      l("Usage / price pending", "用量待补充 / 待估价"),
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
                            : m.operation === "strategy"
                              ? l("Product strategy", "深度研判")
                              : m.operation === "issue-reading"
                                ? l("Issue interpretation", "社区请求解读")
                                : m.operation === "strategy-evidence-review"
                                  ? l(
                                      "Evidence and meaning review",
                                      "证据与语义复核",
                                    )
                                  : m.operation === "strategy-copy"
                                    ? l("Copy & citations", "文案与引用校验")
                                    : m.operation === "strategy-edit"
                                      ? l("Strategy editing", "建议校订")
                                      : m.operation === "strategy-direction"
                                        ? l(
                                            "Direction analysis",
                                            "细分方向分析",
                                          )
                                        : m.operation === "strategy-priority"
                                          ? l(
                                              "Priority strategy",
                                              "优先方向策略",
                                            )
                                          : m.operation === "strategy-overall"
                                            ? l(
                                                "Overall analysis",
                                                "整体机会分析",
                                              )
                                            : m.operation ===
                                                "strategy-section-edit"
                                              ? l("Section review", "分项校验")
                                              : m.operation ===
                                                  "strategy-translate"
                                                ? l(
                                                    "Bilingual copy",
                                                    "双语整理",
                                                  )
                                                : m.operation ===
                                                    "strategy-review"
                                                  ? l(
                                                      "Strategy review",
                                                      "建议复核",
                                                    )
                                                  : m.operation ===
                                                      "document-selection"
                                                    ? l(
                                                        "Source selection",
                                                        "文档选取",
                                                      )
                                                    : m.operation ===
                                                        "relevance"
                                                      ? l(
                                                          "Project relevance",
                                                          "项目相关性",
                                                        )
                                                      : m.operation ===
                                                          "query-repair"
                                                        ? l(
                                                            "Query refinement",
                                                            "检索修复",
                                                          )
                                                        : m.operation ===
                                                            "brief-rewrite"
                                                          ? l(
                                                              "Brief review",
                                                              "报告校验",
                                                            )
                                                          : l(
                                                              "Research brief",
                                                              "简短报告",
                                                            )}
                        </small>
                      </th>
                      <td>
                        {n(m.requests - m.cacheHits)} / {n(m.cacheHits)}
                      </td>
                      <td>
                        {n(m.inputTokens)} / {n(m.outputTokens)}
                        <small>
                          {l("Reasoning within output", "输出中的思考 Token")}:{" "}
                          {n(m.reasoningTokens)}
                          {!!m.reasoningPending && (
                            <>
                              {" "}
                              · {n(m.reasoningPending)}{" "}
                              {l("calls awaiting detail", "次待补明细")}
                            </>
                          )}
                        </small>
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
                  "AI calls will appear here as they are recorded.",
                  "采集到的 AI 调用记录会显示在这里。",
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
                    ? l("background", "后台任务")
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
                      ? l("Background task", "后台任务")
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
                {l(
                  "Choose another filter to explore recorded scans.",
                  "调整筛选条件，查看已记录的扫描。",
                )}
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
              <dt>{l("Research generation", "研究生成模式")}</dt>
              <dd>
                {data.configuration.researchThinking === "low"
                  ? l(
                      "Light reasoning for evidence; direct report writing",
                      "证据研判：轻量思考 · 正文：直接生成",
                    )
                  : l(
                      "Direct generation with evidence review",
                      "直接生成 · 保留证据复核",
                    )}
              </dd>
              <dt>{l("Daily research allowance", "每人每日研究额度")}</dt>
              <dd>{data.configuration.dailyLimit}</dd>
              <dt>{l("Daily collection budget", "全站每日采集预算")}</dt>
              <dd>
                {data.configuration.serviceLimit} ·{" "}
                {l("Per account attempts", "每人采集尝试")}{" "}
                {data.configuration.attemptLimit}
              </dd>
              <dt>{l("Web search", "网页搜索")}</dt>
              <dd>
                {data.configuration.search?.configured
                  ? data.configuration.search.mode === "direct"
                    ? l(
                        "Residential proxy · Google with DuckDuckGo fallback",
                        "住宅代理 · Google 优先，DuckDuckGo 自动补位",
                      )
                    : l("Managed search API", "托管搜索 API")
                  : l("Awaiting configuration", "等待配置")}{" "}
                ·{" "}
                {l(
                  data.configuration.search?.mode === "direct"
                    ? "Up to 3 queries; Google cache 6h, fallback 30min; uses residential traffic"
                    : "Up to 3 queries; 6-hour cache; managed service balance",
                  data.configuration.search?.mode === "direct"
                    ? "最多 3 组查询；Google 缓存 6 小时，备用来源 30 分钟；使用住宅流量"
                    : "最多 3 组查询，缓存 6 小时；使用托管服务额度",
                )}
              </dd>
              <dt>{l("Trends connection", "Trends 采集连接")}</dt>
              <dd>
                {data.configuration.trends.proxy
                  ? l("Residential proxy", "住宅代理")
                  : l("Direct", "直连")}{" "}
                · {data.configuration.trends.region}
                {" · "}
                {data.configuration.trends.routes || 1}{" "}
                {l("sticky sessions", "个粘性会话")}
                {!!data.configuration.trends.coolingRoutes && (
                  <>
                    {" "}
                    · {data.configuration.trends.coolingRoutes}{" "}
                    {l("cooling down", "个等待恢复")}
                  </>
                )}
                {data.configuration.trends.retryAt && (
                  <>
                    {" "}
                    · {l("Resumes", "恢复时间")}{" "}
                    {date(data.configuration.trends.retryAt)}
                  </>
                )}
              </dd>
              <dt>{l("Today's credits", "今日额度记录")}</dt>
              <dd>
                {data.configuration.usageToday.map((row) => (
                  <div key={row.kind + row.state}>
                    {
                      (
                        {
                          scan: l("Scan", "研究"),
                          repo: l("Project", "项目"),
                          compare: l("Compare", "对比"),
                        } as Record<string, string>
                      )[row.kind]
                    }{" "}
                    ·{" "}
                    {
                      (
                        {
                          used: l("Used", "已使用"),
                          reserved: l("In progress", "进行中"),
                          released: l("Returned", "已返还"),
                        } as Record<string, string>
                      )[row.state]
                    }{" "}
                    {row.count}
                  </div>
                ))}
              </dd>
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
                "Configure GHTRENDS_ADMIN_USER_IDS on the server with fixed Logto user IDs, separated by commas, then restart. The server controls privileges and stores credentials.",
                "通过服务器的 GHTRENDS_ADMIN_USER_IDS 配置管理员，填写以逗号分隔的 Logto 固定用户 ID，修改后重启。权限和密钥由服务器管理。",
              )}
            </p>
            <p>
              {l(
                "Cost rates: GHTRENDS_LLM_PRICING_JSON. Each request preserves its estimate using the rate at that time.",
                "费用单价：GHTRENDS_LLM_PRICING_JSON。每次请求按当时单价保存估价，历史记录保留原值。",
              )}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
