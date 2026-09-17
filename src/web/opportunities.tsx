import { useState } from "react";
import { ArrowUpRight, Check, ChevronRight } from "lucide-react";
import {
  visibleOpportunities,
  opportunityLabel,
} from "../core/opportunities.js";
import type { Brief } from "../core/types.js";

export function OpportunityMap({
  brief,
  locale,
}: {
  brief: Brief;
  locale: "en" | "zh";
}) {
  const map = visibleOpportunities(brief);
  const [choice, setChoice] = useState(map?.recommendedId);
  if (!map) return null;
  const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const label = (
    kind: "effort" | "demand" | "competition" | "basis",
    value: string,
  ) => opportunityLabel(kind, value, locale);
  const selected =
    map.opportunities.find((o) => o.id === choice) ||
    map.opportunities.find((o) => o.id === map.recommendedId)!;
  const p = selected[locale];
  const refs = [
    ...selected.demand.evidence,
    ...selected.competition.evidence,
  ].filter((r, i, all) => all.findIndex((a) => a.id === r.id) === i);
  const directions = [...map.opportunities].sort(
    (a, b) =>
      Number(b.id === map.recommendedId) - Number(a.id === map.recommendedId),
  );
  return (
    <section className="opportunity-map" id="opportunities">
      <div className="report-section-heading">
        <div>
          <div className="eyebrow">
            {l("ONE TOPIC, SEVERAL WAYS IN", "一个词，几条值得走的路")}
          </div>
          <h3>{l("Compare your directions", "先比较方向，再决定投入")}</h3>
        </div>
        <span className="opportunity-count">
          {map.opportunities.length} {l("directions", "个细分方向")}
        </span>
      </div>
      <p className="opportunity-selection">
        {l("First to explore: ", "优先探索：")}
        {
          map.opportunities.find((o) => o.id === map.recommendedId)![locale]
            .title
        }
        {l(
          ". Select a direction below to compare what it takes.",
          "。点选下方方向，对比投入与机会。",
        )}
      </p>
      <details className="opportunity-priority">
        <summary>
          {l(
            "Why this order, and who each direction suits",
            "排序理由与适合的人群",
          )}
        </summary>
        <p className="opportunity-selection">{map.selection[locale]}</p>
      </details>
      <p className="footnote">
        {l(
          "Priority assumes a solo developer or small team. Ratings combine cited signals and research inference; resources describe the scoped first release.",
          "优先顺序面向独立开发者或小团队。各方向依据引用信号与研究推断评估，资源等级对应下方首版范围。",
        )}
      </p>
      <div
        className="opportunity-comparison"
        role="group"
        aria-label={l("Choose a direction to explore", "选择方向查看详情")}
      >
        <div className="opportunity-columns" aria-hidden="true">
          <span>{l("Direction", "细分方向")}</span>
          <span>{l("Resources", "资源投入")}</span>
          <span>{l("Demand", "需求判断")}</span>
          <span>{l("Competition", "竞争情况")}</span>
          <span />
        </div>
        {directions.map((o, i) => (
          <button
            key={o.id}
            className={`opportunity-row ${selected.id === o.id ? "selected" : ""}`}
            onClick={() => setChoice(o.id)}
            aria-pressed={selected.id === o.id}
            aria-controls="opportunity-detail"
          >
            <span className="opportunity-name">
              <span className="opportunity-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>
                {o[locale].title}
                {o.id === map.recommendedId && (
                  <small>
                    <Check size={12} />
                    {l("First to explore", "建议优先")}
                  </small>
                )}
              </span>
            </span>
            <span className="opportunity-rating">
              <small>{l("Resources", "资源")}</small>
              <span className={`effort-${o.effort}`}>
                {label("effort", o.effort)}
              </span>
            </span>
            <span className="opportunity-rating">
              <small>{l("Demand", "需求")}</small>
              <span>
                {label("demand", o.demand.level)}
                <em>{label("basis", o.demand.basis)}</em>
              </span>
            </span>
            <span className="opportunity-rating">
              <small>{l("Competition", "竞争")}</small>
              <span>
                {label("competition", o.competition.level)}
                <em>{label("basis", o.competition.basis)}</em>
              </span>
            </span>
            <ChevronRight className="opportunity-chevron" size={18} />
          </button>
        ))}
      </div>
      <article
        className="opportunity-detail"
        id="opportunity-detail"
        aria-live="polite"
        aria-labelledby="opportunity-title"
      >
        <div className="eyebrow">{l("DIRECTION IN FOCUS", "方向详情")}</div>
        <h4 id="opportunity-title">{p.title}</h4>
        <p className="opportunity-audience">{p.audience}</p>
        <div className="opportunity-assessments">
          <div>
            <h5>
              {l("Demand & its evidence", "需求与依据")}
              <span>{label("basis", selected.demand.basis)}</span>
            </h5>
            <p>{p.demand}</p>
          </div>
          <div>
            <h5>
              {l("Competition & the opening", "竞争与切入空间")}
              <span>{label("basis", selected.competition.basis)}</span>
            </h5>
            <p>{p.competition}</p>
          </div>
        </div>
        <div className="opportunity-resources">
          <div>
            <h5>{l("What you need", "需要什么资源")}</h5>
            <p>{p.resources}</p>
          </div>
          <div>
            <h5>{l("First-release estimate", "首版投入估算")}</h5>
            <p>{p.delivery}</p>
          </div>
          <div>
            <h5>{l("Keeping it useful", "持续投入")}</h5>
            <p>{p.upkeep}</p>
          </div>
        </div>
        <div className="opportunity-assessments opportunity-action">
          <div>
            <h5>{l("Build this first", "第一件值得做的东西")}</h5>
            <p>{p.wedge}</p>
          </div>
          <div>
            <h5>{l("A test worth running", "怎样验证值得投入")}</h5>
            <p>{p.experiment}</p>
          </div>
        </div>
        <div className="strategy-sources">
          <span>{l("Judgment sources", "判断依据")}</span>
          {refs.length ? (
            refs.map((r) => {
              const s = brief.sources.find((s) => s.id === r.id);
              return s ? (
                <a
                  key={r.id}
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  title={r.quote}
                >
                  {s.label}
                  <ArrowUpRight size={12} />
                </a>
              ) : null;
            })
          ) : (
            <span>
              {l(
                "Domain hypothesis · test with the experiment above",
                "领域推演 · 按上方实验采集真实反馈",
              )}
            </span>
          )}
        </div>
        <p className="footnote">
          {l(
            "Project documents establish features; issues record individual requests. Broader demand and adoption remain research hypotheses. Time and decision thresholds are proposed estimates.",
            "项目文档支持功能判断，Issue 记录个体诉求；更广泛的需求与采用仍属于研究假设。工期与实验门槛均为建议估算。",
          )}
        </p>
      </article>
    </section>
  );
}
