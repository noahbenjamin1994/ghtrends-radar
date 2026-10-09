import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  verdictLabel,
  type EffectiveDecision,
  type Quote,
  type Revision,
} from "../../core/decision.js";
import type { Market, ResearchSource } from "../../core/types.js";
import { QuoteLine, Row, ago, host, l, sourceMeta, tx, when } from "./ui.js";

export interface Opened {
  source: ResearchSource;
  quote?: string;
}
export type Working = null | "rejudge" | "supply" | "more" | "ask";

/** The original text around a quote, without leaving the report. */
export function SourceDrawer({
  opened,
  onClose,
}: {
  opened: Opened;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  const mark = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    mark.current?.scrollIntoView({ block: "center" });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus?.();
    };
  }, [opened, onClose]);
  const { source, quote } = opened;
  const text = source.excerpt || "";
  const at = quote ? text.indexOf(quote) : -1;
  const collected = when(source.fetchedAt);
  return (
    <>
      <div className="rd-scrim" onClick={onClose} />
      <aside
        className="rd-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={l("Original source", "原文")}
      >
        <div className="rd-drawer-head">
          <div>
            <h2>{source.label}</h2>
            <p>
              {[
                host(source.url),
                when(source.publishedAt || source.request?.createdAt),
              ]
                .filter(Boolean)
                .join(l(", ", "，"))}
            </p>
          </div>
          <button
            ref={close}
            className="rd-drawer-close"
            onClick={onClose}
            aria-label={l("Close", "关闭")}
          >
            <X size={18} />
          </button>
        </div>
        <div className="rd-drawer-body">
          {at >= 0 ? (
            <>
              {text.slice(0, at)}
              <mark ref={mark}>{quote}</mark>
              {text.slice(at + quote!.length)}
            </>
          ) : (
            text || quote
          )}
          <small>
            {source.excerptTruncated
              ? l(
                  "This is the part that was read, not the whole page.",
                  "此处为读取到的片段，非完整页面。",
                )
              : ""}
            {collected
              ? l(` Collected ${collected}.`, ` 采集于 ${collected}。`)
              : ""}
          </small>
        </div>
        <div className="rd-drawer-foot">
          <a href={source.url} target="_blank" rel="noreferrer">
            {l("Open the original page", "打开原页面")}
          </a>
        </div>
      </aside>
    </>
  );
}

function Trend({ market }: { market: Market }) {
  const points = market.demand.points.filter((p) => !p.partial).slice(-52);
  if (points.length < 16) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i: number) => (i / (points.length - 1)) * 132;
  const y = (v: number) => 38 - (v / max) * 36;
  const line = (from: number) =>
    points
      .slice(from)
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(from + i).toFixed(1)} ${y(p.value).toFixed(1)}`,
      )
      .join(" ");
  return (
    <svg
      viewBox="0 0 132 40"
      role="img"
      aria-label={l(
        "Search interest, last year; the last 8 weeks are highlighted",
        "近一年搜索关注度，最后 8 周加粗",
      )}
    >
      <path d={line(0)} />
      <path className="is-recent" d={line(points.length - 9)} />
    </svg>
  );
}

const reasonText = {
  blocked: ["blocked", "被拒绝"],
  timeout: ["timed out", "超时"],
  unread: ["could not be read", "未读取"],
  missing: ["not collected", "未采到"],
} as const;

export function Report({
  market,
  decision: d,
  sources,
  owner,
  revision,
  working,
  landing,
  onOpen,
  onDismiss,
  onRestore,
  onRejudge,
  onAddSupply,
  onStatus,
  onOriginal,
  showingOriginal,
  error,
}: {
  market: Market;
  decision: EffectiveDecision;
  sources: ResearchSource[];
  owner: boolean;
  revision: Revision | null;
  working: Working;
  landing: boolean;
  onOpen: (opened: Opened) => void;
  onDismiss: (key: string) => void;
  onRestore: (key: string) => void;
  onRejudge: () => void;
  onAddSupply: (name: string) => void;
  onStatus: (status: Revision["status"] | null) => void;
  onOriginal: (show: boolean) => void;
  showingOriginal: boolean;
  error: string;
}) {
  const [trace, setTrace] = useState<{ pain?: string; supply: string[] }>({
    supply: [],
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const source = (id: string) => sources.find((s) => s.id === id);
  const open = (q: Quote) => {
    const s = source(q.id);
    if (s) onOpen({ source: s, quote: q.quote });
  };
  const livePains = d.pains.filter((p) => !d.emptied.includes(p.id));
  const liveDirections = d.directions.filter(
    (x) => !d.invalidated.includes(x.id),
  );
  const rows = [...d.commercial, ...d.openSource];
  const rowName = (id: string) => rows.find((r) => r.id === id)?.name || id;
  const quoteCount = livePains.reduce(
    (n, p) =>
      n +
      p.quotes.filter((q) => !d.dismissed.includes(`${p.id}:${q.cid}`)).length,
    0,
  );
  const gaps = (lane: string) => d.coverage.gaps.filter((g) => g.lane === lane);
  const gapLine = (lane: string) =>
    gaps(lane)
      .map(
        (g) =>
          `${g.label} ${l(reasonText[g.reason][0], reasonText[g.reason][1])}`,
      )
      .join(l("; ", "；"));
  const jump = (id: string) =>
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  const lead = liveDirections[0];
  const next = d.nextStep;
  const nextText = next
    ? [
        tx(next.who),
        tx(next.ask),
        `${l("Success criterion", "成功标准")}: ${tx(next.success)}`,
        `${l("Failure criterion", "失败标准")}: ${tx(next.fail)}`,
        ...next.where.map((w) => w.url),
      ].join("\n")
    : "";
  const status = revision?.status;
  const kind = d.verdict.kind;
  return (
    <>
      <Row label={l("Conclusion", "结论")} className="is-verdict">
        <div className={`rd-verdict is-${kind}${landing ? " is-landing" : ""}`}>
          <h2>{tx(verdictLabel[kind])}</h2>
          <p>{tx(d.verdict.reason)}</p>
          {(d.stale || (revision?.decision && owner) || error) && (
            <div className="rd-verdict-note" role="status">
              {error ? (
                <span>{error}</span>
              ) : d.stale ? (
                <span>
                  {l(
                    "You removed evidence this verdict relied on.",
                    "该结论依据的证据已被你移除。",
                  )}
                </span>
              ) : (
                <span>
                  {showingOriginal
                    ? l(
                        "This is the report as first delivered.",
                        "这是最初交付的版本。",
                      )
                    : l("Updated with your corrections.", "已按你的修正更新。")}
                </span>
              )}
              {d.stale && owner && (
                <button
                  className="rd-btn"
                  onClick={onRejudge}
                  disabled={!!working}
                >
                  {working === "rejudge"
                    ? l("Reassessing…", "正在重新评估…")
                    : l("Reassess", "重新评估")}
                </button>
              )}
              {!d.stale && revision?.decision && (
                <button onClick={() => onOriginal(!showingOriginal)}>
                  {showingOriginal
                    ? l("Back to the corrected version", "回到修正后的版本")
                    : l("See the original", "看原始版本")}
                </button>
              )}
            </div>
          )}
        </div>
      </Row>

      <Row
        id="rd-pains"
        label={l("Demand analysis", "需求分析")}
        count={
          quoteCount
            ? l(`${quoteCount} quotes`, `${quoteCount} 条用户原话`)
            : undefined
        }
      >
        {d.pains.length ? (
          d.pains.map((pain) => {
            const emptied = d.emptied.includes(pain.id);
            return (
              <article
                key={pain.id}
                id={`rd-${pain.id}`}
                className={
                  "rd-pain" + (trace.pain === pain.id ? " is-traced" : "")
                }
              >
                <h3 style={emptied ? { color: "var(--faint)" } : undefined}>
                  {tx(pain.title)}
                </h3>
                {pain.quotes.map((q) => {
                  const key = `${pain.id}:${q.cid}`;
                  const gone = d.dismissed.includes(key);
                  return (
                    <QuoteLine
                      key={q.cid}
                      quote={q}
                      source={source(q.id)}
                      gone={gone}
                      onOpen={() => open(q)}
                      action={
                        owner && !showingOriginal ? (
                          <button
                            onClick={() =>
                              gone ? onRestore(key) : onDismiss(key)
                            }
                          >
                            {gone
                              ? l("Restore", "恢复")
                              : l("Mark as irrelevant", "标记为不相关")}
                          </button>
                        ) : undefined
                      }
                    />
                  );
                })}
                {pain.workaround && !emptied && (
                  <p className="rd-cope">
                    <b>{l("Current workaround", "现有做法")}</b>
                    {l(" ", "：")}
                    {tx(pain.workaround)}
                  </p>
                )}
              </article>
            );
          })
        ) : (
          <>
            <p className="rd-empty">
              {l(
                "No first-hand user account of this problem was collected.",
                "未采集到用户对该问题的一手描述。",
              )}
            </p>
            <p className="rd-empty">
              {l(
                "That is not proof the problem doesn't exist. Vendor pages and search snippets don't count as someone being in pain.",
                "这不代表需求不存在。厂商页面和搜索摘要不计为用户需求证据。",
              )}
            </p>
          </>
        )}
        {gaps("pains").length > 0 && (
          <p className="rd-gap">
            {l("Not collected: ", "未采集到：")}
            {gapLine("pains")}
          </p>
        )}
      </Row>

      <Row
        id="rd-supply"
        label={l("Competitor analysis", "竞品分析")}
        count={
          rows.length
            ? l(`${rows.length} found`, `找到 ${rows.length} 家`)
            : undefined
        }
      >
        {d.commercial.length > 0 && (
          <table className="rd-supply">
            <thead>
              <tr>
                <th>{l("Commercial", "商业")}</th>
                <th>{l("Target users", "目标用户")}</th>
                <th>{l("Pricing", "定价")}</th>
                <th>{l("Unmet need", "未满足需求")}</th>
              </tr>
            </thead>
            <tbody>
              {d.commercial.map((row) => (
                <tr
                  key={row.id}
                  id={`rd-${row.id}`}
                  className={
                    "rd-supply-row" +
                    (trace.supply.includes(row.id) ? " is-traced" : "")
                  }
                >
                  <td>
                    <button
                      onClick={() => row.evidence[0] && open(row.evidence[0])}
                    >
                      {row.name}
                    </button>
                    {row.added && (
                      <span className="rd-tag">
                        {l("added by you", "用户补充")}
                      </span>
                    )}
                  </td>
                  <td data-label={l("Target users", "目标用户")}>
                    {tx(row.audience)}
                  </td>
                  <td data-label={l("Pricing", "定价")}>
                    {row.pricing
                      ? tx(row.pricing)
                      : l("not published", "未公开")}
                  </td>
                  <td data-label={l("Unmet need", "未满足需求")}>
                    {row.gap ? tx(row.gap) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d.openSource.length > 0 && (
          <table className="rd-supply">
            <thead>
              <tr>
                <th>{l("Open source", "开源")}</th>
                <th>{l("Features", "功能")}</th>
                <th>{l("Activity", "活跃度")}</th>
                <th>{l("License", "许可证")}</th>
              </tr>
            </thead>
            <tbody>
              {d.openSource.map((row) => (
                <tr
                  key={row.id}
                  id={`rd-${row.id}`}
                  className={
                    "rd-supply-row" +
                    (trace.supply.includes(row.id) ? " is-traced" : "")
                  }
                >
                  <td>
                    <button
                      onClick={() => row.evidence[0] && open(row.evidence[0])}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td data-label={l("Features", "功能")}>
                    {tx(row.capability)}
                  </td>
                  <td data-label={l("Activity", "活跃度")}>
                    {row.pushedAt ? ago(row.pushedAt) : ""}
                  </td>
                  <td data-label={l("License", "许可证")}>
                    {row.license === undefined
                      ? ""
                      : row.license || l("none stated", "未声明")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!rows.length && (
          <p className="rd-empty">
            {l(
              "No product or project serving these people was read this time.",
              "本次未采集到面向该用户群的产品或项目。",
            )}
          </p>
        )}
        <div className="rd-supply-foot">
          {gaps("supply").length > 0 ? (
            <p className="rd-gap">
              {l(
                "This list may be incomplete. Not collected: ",
                "竞品列表可能不完整。未采集到：",
              )}
              {gapLine("supply")}
            </p>
          ) : (
            <span />
          )}
          {owner && !showingOriginal && !adding && (
            <button
              className="rd-add"
              onClick={() => setAdding(true)}
              disabled={!!working}
            >
              {l("Add a competitor", "补充竞品")}
            </button>
          )}
          {adding && (
            <form
              className="rd-add-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim() || working) return;
                onAddSupply(name.trim());
                setAdding(false);
                setName("");
              }}
            >
              <input
                autoFocus
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setAdding(false);
                }}
                placeholder={l(
                  "Its name, or a link to its pricing page",
                  "竞品名称或定价页链接",
                )}
                aria-label={l("Competitor name or URL", "竞品名称或网址")}
              />
              <button className="rd-btn" disabled={!name.trim()}>
                {l("Add", "添加")}
              </button>
            </form>
          )}
        </div>
        {working === "supply" && (
          <p className="rd-wait" role="status" style={{ marginTop: 12 }}>
            <i className="rd-live" />
            {l(
              "Reading its page, then judging again…",
              "正在读取该竞品页面，完成后重新评估…",
            )}
          </p>
        )}
      </Row>

      <Row label={l("Market trend", "市场趋势")}>
        <div className="rd-timing">
          <p>{tx(d.timing.summary)}</p>
          <Trend market={market} />
        </div>
      </Row>

      <Row
        label={l("Opportunities", "机会方向")}
        count={
          liveDirections.length
            ? l(`${liveDirections.length} open`, `${liveDirections.length} 个`)
            : undefined
        }
      >
        {d.directions.length ? (
          d.directions.map((dir, i) => {
            const voided = d.invalidated.includes(dir.id);
            const pain = d.pains.find((p) => p.id === dir.pain);
            if (voided)
              return (
                <article key={dir.id} className="rd-direction is-void">
                  <h3>
                    <i>{i + 1}</i>
                    {tx(dir.title)}
                  </h3>
                  <p>
                    {l(
                      "You removed the evidence this rested on.",
                      "依据已被你移除。",
                    )}
                  </p>
                </article>
              );
            return (
              <article
                key={dir.id}
                className="rd-direction"
                onMouseEnter={() =>
                  setTrace({ pain: dir.pain, supply: dir.supply })
                }
                onMouseLeave={() => setTrace({ supply: [] })}
                onFocus={() => setTrace({ pain: dir.pain, supply: dir.supply })}
                onBlur={() => setTrace({ supply: [] })}
              >
                <h3>
                  <i>{i + 1}</i>
                  <span>
                    {tx(dir.title)}
                    {dir.tentative && (
                      <span className="rd-tag is-warn">
                        {l("unconfirmed", "待核实")}
                      </span>
                    )}
                  </span>
                </h3>
                <dl className="rd-facts">
                  <dt>{l("Target users", "目标用户")}</dt>
                  <dd>{tx(dir.audience)}</dd>
                  <dt>{l("Addresses", "对应需求")}</dt>
                  <dd>
                    <button
                      className="rd-ref"
                      onClick={() => jump(`rd-${dir.pain}`)}
                    >
                      {pain ? tx(pain.title) : dir.pain}
                    </button>
                  </dd>
                  <dt>{l("Market gap", "市场空缺")}</dt>
                  <dd>
                    {tx(dir.whyOpen)}{" "}
                    <span style={{ color: "var(--faint)" }}>
                      {l("See ", "见")}
                    </span>
                    {dir.supply.map((id) => (
                      <button
                        key={id}
                        className="rd-ref"
                        onClick={() => jump(`rd-${id}`)}
                      >
                        {rowName(id)}
                      </button>
                    ))}
                  </dd>
                  <dt>{l("To validate", "待验证假设")}</dt>
                  <dd style={{ color: "var(--soft)" }}>
                    {tx(dir.uncertainty)}
                  </dd>
                </dl>
              </article>
            );
          })
        ) : (
          <p className="rd-empty">
            {!d.pains.length
              ? l(
                  "No opportunity is proposed without demand evidence.",
                  "缺少用户需求证据，暂不给出机会方向。",
                )
              : kind === "stop"
                ? l(
                    "Existing competitors already cover the needs identified.",
                    "已识别的需求均被现有竞品覆盖。",
                  )
                : l(
                    "No pain here could be matched to an opening in supply.",
                    "已识别的需求未能对应到现有竞品留下的空缺。",
                  )}
          </p>
        )}
      </Row>

      {(next || lead) && (
        <Row label={l("Validation plan", "验证计划")}>
          {next ? (
            <div className="rd-next">
              {lead?.tentative && (
                <p className="rd-gap" style={{ margin: "0 0 12px" }}>
                  {l(
                    "First check that the suppliers above really don't do this; the list may be incomplete.",
                    "请先核实上述竞品是否确实未覆盖，竞品列表可能不完整。",
                  )}
                </p>
              )}
              <p>{tx(next.who)}</p>
              {next.where.length > 0 && (
                <ul className="rd-next-where">
                  {next.where.map((w) => (
                    <li key={w.url}>
                      <a href={w.url} target="_blank" rel="noreferrer">
                        {w.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <p>{tx(next.ask)}</p>
              <dl>
                <dt>{l("Success criterion", "成功标准")}</dt>
                <dd>{tx(next.success)}</dd>
                <dt>{l("Failure criterion", "失败标准")}</dt>
                <dd>{tx(next.fail)}</dd>
              </dl>
              <div className="rd-next-foot">
                <button
                  className="rd-btn is-light"
                  onClick={() =>
                    void navigator.clipboard?.writeText(nextText).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    })
                  }
                >
                  {copied
                    ? l("Copied", "已复制")
                    : l("Copy the plan", "复制计划")}
                </button>
                {owner && (
                  <div
                    className="rd-outcome"
                    role="group"
                    aria-label={l("Outcome", "执行结果")}
                  >
                    {(
                      [
                        ["won", l("Validated", "已验证")],
                        ["lost", l("Invalidated", "已证伪")],
                        ["parked", l("On hold", "暂缓")],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        aria-pressed={status === value}
                        onClick={() =>
                          onStatus(status === value ? null : value)
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="rd-empty">
              {l(
                "The step was written for a direction whose evidence you removed. Judge again to get a new one.",
                "原验证计划对应的机会方向已被移除依据，重新评估后将给出新的计划。",
              )}
            </p>
          )}
        </Row>
      )}

      <p className="rd-unverified">
        {l(
          "To confirm through user interviews and paid trials: ",
          "以下假设需通过用户访谈和付费验证确认：",
        )}
        {d.unverified.map((u, i) => (
          <span key={i}>{tx(u).replace(/[。.]$/, "")}</span>
        ))}
        {l(".", "。")}
      </p>

      <details className="rd-sources">
        <summary>
          {l(
            `All sources (${sources.length}${d.coverage.gaps.length ? `, ${d.coverage.gaps.length} not collected` : ""})`,
            `全部来源（${sources.length} 条${d.coverage.gaps.length ? `，${d.coverage.gaps.length} 条未采到` : ""}）`,
          )}
        </summary>
        <ol>
          {sources.map((s) => (
            <li key={s.id}>
              <button onClick={() => onOpen({ source: s })}>
                {sourceMeta(s) || s.label}
              </button>
              <span>{host(s.url)}</span>
            </li>
          ))}
          {d.coverage.gaps.map((g, i) => (
            <li key={"gap" + i} className="is-missed">
              <button disabled>{g.label}</button>
              <span>{l(reasonText[g.reason][0], reasonText[g.reason][1])}</span>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
