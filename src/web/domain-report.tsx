import React from "react";
import type { Market } from "../core/types.js";
import { reportSections } from "../core/report-contract.js";
import "./domain-report.css";

export function DomainReport({
  market,
  locale,
}: {
  market: Market;
  locale: "en" | "zh";
}) {
  const brief = market.brief!,
    report = brief.report!;
  const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const citations = (refs: { id: string; quote: string }[]) =>
    refs.length > 0 && (
      <details className="domain-citations">
        <summary>
          {l("Check evidence", "核对依据")} · {refs.length}
        </summary>
        {refs.map((ref, i) => {
          const source = brief.sources.find((s) => s.id === ref.id);
          return (
            source && (
              <blockquote key={`${ref.id}-${i}`}>
                <p>{ref.quote}</p>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.label}
                </a>
              </blockquote>
            )
          );
        })}
      </details>
    );
  return (
    <div className="domain-report">
      <nav className="domain-nav" aria-label={l("Report sections", "报告章节")}>
        <a href="#outlook">{l("Overview", "整体判断")}</a>
        <a href="#evidence">{l("Four perspectives", "四类证据")}</a>
        <a href="#directions">{l("Directions", "可进入的方向")}</a>
      </nav>
      <section id="outlook" className="domain-overview">
        <span className="eyebrow">
          {l("UNDERSTAND THE FIELD FIRST", "先看整个领域")}
        </span>
        <h2>{report.headline[locale]}</h2>
        <p>{report.overview[locale]}</p>
        <small>
          {l(
            "Evidence-based interpretation · not a forecast of commercial success",
            "基于证据的研判 · 不代表商业成功预测",
          )}
        </small>
      </section>
      <section
        id="evidence"
        className="domain-evidence"
        aria-label={l("Four evidence perspectives", "四类领域证据")}
      >
        {reportSections.map(([key, en, zh], i) => (
          <article key={key}>
            <div className="domain-section-title">
              <h3>
                <span>0{i + 1}</span>
                {l(en, zh)}
              </h3>
              <small>
                {report[key].status === "observed"
                  ? l("Evidence found", "有来源依据")
                  : report[key].status === "limited"
                    ? l("Limited evidence", "证据有限")
                    : l("Not established", "尚未取得依据")}
              </small>
            </div>
            <p>{report[key].summary[locale]}</p>
            {citations(report[key].evidence)}
          </article>
        ))}
      </section>
      <section id="directions" className="domain-directions">
        <span className="eyebrow">
          {l("DIRECTIONS DERIVED FROM EVIDENCE", "再从证据中拆出方向")}
        </span>
        <h2>{l("Where could you enter?", "可能从哪里进入？")}</h2>
        <p className="footnote">
          {l(
            "These are hypotheses grounded in the sources, not proven gaps. Direction count follows evidence.",
            "以下是基于来源的进入假设，不是已证实的市场缺口。方向数量由证据决定。",
          )}
        </p>
        {!report.directions.length && (
          <p>
            {l(
              "The current evidence does not support a specific entry direction yet.",
              "当前证据还不足以支持具体进入方向，本轮不强凑建议。",
            )}
          </p>
        )}
        {report.directions.map((direction, i) => (
          <article key={i} className="domain-direction">
            <h3>
              <span>0{i + 1}</span>
              {direction.title[locale]}
            </h3>
            <dl>
              {(
                [
                  ["task", "Who needs what", "具体任务"],
                  ["existingSupply", "Existing supply", "现有供给"],
                  ["entry", "Possible entry", "进入方式"],
                  ["uncertainty", "Still unknown", "尚待确认"],
                ] as const
              ).map(([key, en, zh]) => (
                <div key={key}>
                  <dt>{l(en, zh)}</dt>
                  <dd>{direction[key][locale]}</dd>
                </div>
              ))}
            </dl>
            {citations(direction.evidence)}
          </article>
        ))}
      </section>
      <section id="decision" className="domain-next">
        <span className="eyebrow">{l("NEXT STEP", "下一步")}</span>
        <p>{report.nextStep[locale]}</p>
      </section>
      <section className="domain-limits">
        <h3>{l("What this report cannot establish", "本轮边界")}</h3>
        <ul>
          {report.limitations.map((item, i) => (
            <li key={i}>{item[locale]}</li>
          ))}
        </ul>
      </section>
      <details id="appendix" className="domain-sources">
        <summary>
          {l("Sources and collection coverage", "来源与采集范围")} ·{" "}
          {brief.sources.length}
        </summary>
        <ol>
          {brief.sources.map((source) => (
            <li key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
              <small>
                {source.fetchedAt?.slice(0, 10)} ·{" "}
                {source.documentType
                  ? l("Page excerpt", "网页摘录")
                  : source.searchIntent
                    ? l("Search snippet", "搜索摘要")
                    : l("Source metadata", "来源元数据")}
                {source.excerptTruncated ? l(" · truncated", " · 已截取") : ""}
              </small>
              <p>{source.excerpt}</p>
            </li>
          ))}
        </ol>
        {!!market.documents?.reads.length && (
          <ul>
            {market.documents.reads.map((read) => (
              <li key={read.url}>
                <a href={read.url} target="_blank" rel="noreferrer">
                  {new URL(read.url).hostname}
                </a>{" "}
                ·{" "}
                {read.status === "read"
                  ? l("Read", "已读取")
                  : l("Not read", "未读取") + ` (${read.status})`}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
