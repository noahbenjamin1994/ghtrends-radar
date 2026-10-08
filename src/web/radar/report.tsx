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
export type Working = null | "rejudge" | "supply" | "ask";

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
                  "这是读到的那一段，不是整页。",
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
  unread: ["could not be read", "没读到"],
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
        `${l("Counts as a yes", "算成")}: ${tx(next.success)}`,
        `${l("Counts as a no", "算败")}: ${tx(next.fail)}`,
        ...next.where.map((w) => w.url),
      ].join("\n")
    : "";
  const status = revision?.status;
  const kind = d.verdict.kind;
  return (
    <>
      <Row label={l("Verdict", "判断")} className="is-verdict">
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
                    "你移除了这个判断用到的证据。",
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
                    ? l("Judging again…", "正在重新判断…")
                    : l("Judge again", "重新判断")}
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
        label={l("Who is in pain", "谁在疼")}
        count={
          quoteCount
            ? l(`${quoteCount} quotes`, `${quoteCount} 条原话`)
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
                              ? l("Put it back", "放回来")
                              : l("Not relevant", "这条不相关")}
                          </button>
                        ) : undefined
                      }
                    />
                  );
                })}
                {pain.workaround && !emptied && (
                  <p className="rd-cope">
                    <b>{l("Today they", "他们现在")}</b>
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
                "Nobody was found describing this problem in their own words.",
                "没找到有人用自己的话说这个问题。",
              )}
            </p>
            <p className="rd-empty">
              {l(
                "That is not proof the problem doesn't exist. Vendor pages and search snippets don't count as someone being in pain.",
                "这不代表问题不存在。厂商页面和搜索摘要不算有人在疼。",
              )}
            </p>
          </>
        )}
        {gaps("pains").length > 0 && (
          <p className="rd-gap">
            {l("Not collected: ", "没采到：")}
            {gapLine("pains")}
          </p>
        )}
      </Row>

      <Row
        id="rd-supply"
        label={l("Who serves them", "谁在做")}
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
                <th>{l("Serves", "服务谁")}</th>
                <th>{l("Price", "收费")}</th>
                <th>{l("Leaves open", "没接住什么")}</th>
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
                        {l("added by you", "你补充的")}
                      </span>
                    )}
                  </td>
                  <td data-label={l("Serves", "服务谁")}>{tx(row.audience)}</td>
                  <td data-label={l("Price", "收费")}>
                    {row.pricing
                      ? tx(row.pricing)
                      : l("not published", "未公开")}
                  </td>
                  <td data-label={l("Leaves open", "没接住")}>
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
                <th>{l("Does", "能力")}</th>
                <th>{l("Activity", "近期活跃")}</th>
                <th>{l("License", "许可")}</th>
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
                  <td data-label={l("Does", "能力")}>{tx(row.capability)}</td>
                  <td data-label={l("Activity", "活跃")}>
                    {row.pushedAt ? ago(row.pushedAt) : ""}
                  </td>
                  <td data-label={l("License", "许可")}>
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
              "这次没读到在服务这群人的产品或项目。",
            )}
          </p>
        )}
        <div className="rd-supply-foot">
          {gaps("supply").length > 0 ? (
            <p className="rd-gap">
              {l(
                "This list may be incomplete. Not collected: ",
                "这张表可能不全。没采到：",
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
              {l("One is missing", "漏了一家")}
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
                  "它的名字，或者定价页链接",
                )}
                aria-label={l("Missing supplier", "漏掉的那一家")}
              />
              <button className="rd-btn" disabled={!name.trim()}>
                {l("Read it", "去读它")}
              </button>
            </form>
          )}
        </div>
        {working === "supply" && (
          <p className="rd-wait" role="status" style={{ marginTop: 12 }}>
            <i className="rd-live" />
            {l(
              "Reading its page, then judging again…",
              "正在读它的页面，读完重新判断…",
            )}
          </p>
        )}
      </Row>

      <Row label={l("Timing", "时机")}>
        <div className="rd-timing">
          <p>{tx(d.timing.summary)}</p>
          <Trend market={market} />
        </div>
      </Row>

      <Row
        label={l("What's left open", "口子")}
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
                  <dt>{l("For", "给谁")}</dt>
                  <dd>{tx(dir.audience)}</dd>
                  <dt>{l("Answers", "接哪条痛")}</dt>
                  <dd>
                    <button
                      className="rd-ref"
                      onClick={() => jump(`rd-${dir.pain}`)}
                    >
                      {pain ? tx(pain.title) : dir.pain}
                    </button>
                  </dd>
                  <dt>{l("Why it's open", "为什么空着")}</dt>
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
                  <dt>{l("Not yet known", "还不确定")}</dt>
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
                  "No direction is given without someone's pain to answer.",
                  "没有痛点原话，就不给方向。",
                )
              : kind === "stop"
                ? l(
                    "Existing supply already covers the pains found here.",
                    "找到的痛点，现有供给都接住了。",
                  )
                : l(
                    "No pain here could be matched to an opening in supply.",
                    "这里的痛点没对上供给留下的空缺。",
                  )}
          </p>
        )}
      </Row>

      {(next || lead) && (
        <Row label={l("Next step", "下一步")}>
          {next ? (
            <div className="rd-next">
              {lead?.tentative && (
                <p className="rd-gap" style={{ margin: "0 0 12px" }}>
                  {l(
                    "First check that the suppliers above really don't do this; the list may be incomplete.",
                    "先确认上面这几家是不是真没做，供给表可能不全。",
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
                <dt>{l("A yes", "算成")}</dt>
                <dd>{tx(next.success)}</dd>
                <dt>{l("A no", "算败")}</dt>
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
                    : l("Copy this step", "复制这一步")}
                </button>
                {owner && (
                  <div
                    className="rd-outcome"
                    role="group"
                    aria-label={l("What happened", "后来怎么样")}
                  >
                    {(
                      [
                        ["won", l("Did it, a yes", "做了·成")],
                        ["lost", l("Did it, a no", "做了·没成")],
                        ["parked", l("Parked", "先放下")],
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
                "原来的下一步对应的方向已被你移除依据。重新判断后会给新的。",
              )}
            </p>
          )}
        </Row>
      )}

      <p className="rd-unverified">
        {l(
          "Only real people and payment can confirm: ",
          "以下需要真人和付款才能确认：",
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
