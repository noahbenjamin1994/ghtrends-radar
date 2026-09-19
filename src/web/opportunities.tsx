import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronRight } from "lucide-react";
import {
  visibleOpportunities,
  opportunityLabel,
  opportunityRoute,
  overviewRows,
} from "../core/opportunities.js";
import type { Brief, Market } from "../core/types.js";
import { fitLabel, type SavedFit } from "../core/fit.js";
import { FitReason, PersonalFit } from "./fit.js";
import { DeepStart } from "./deep.js";
import { projectUseConditions, projectUseCopy } from "../core/capabilities.js";

export function TopicOverview({
  brief,
  locale,
  topic,
}: {
  brief: Brief;
  locale: "en" | "zh";
  topic: string;
}) {
  const overview = visibleOpportunities(brief)?.overview;
  if (!overview) return null;
  const rows = overviewRows(overview, locale);
  return (
    <section className="topic-overview" id="topic-overview">
      <div className="report-section-heading">
        <div>
          <div className="eyebrow">
            {locale === "zh" ? "先看整体，再选方向" : "THE WHOLE OPPORTUNITY"}
          </div>
          <h3>
            {topic}
            {locale === "zh"
              ? "，整体机会怎么看？"
              : ": the overall opportunity"}
          </h3>
        </div>
        <span>
          {locale === "zh"
            ? "综合研判 · 含领域推演"
            : "Research judgment · includes domain inference"}
        </span>
      </div>
      <p className="topic-verdict">{overview[locale].verdict}</p>
      <div className="topic-overview-grid">
        {rows.slice(1, 5).map((row) => (
          <div key={row.label}>
            <h4>{row.label}</h4>
            <p>{row.text}</p>
          </div>
        ))}
      </div>
      <div className="topic-coverage">
        <strong>{rows[5]!.label}</strong>
        <p>{rows[5]!.text}</p>
        <div className="strategy-sources">
          {overview.evidence.map((ref) => {
            const source = brief.sources.find((s) => s.id === ref.id);
            return source ? (
              <a
                key={ref.id}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                title={ref.quote}
              >
                {source.label}
                <ArrowUpRight size={12} />
              </a>
            ) : null;
          })}
        </div>
      </div>
    </section>
  );
}

export function OpportunityMap({
  market,
  locale,
}: {
  market: Market;
  locale: "en" | "zh";
}) {
  const brief = market.brief!;
  const map = visibleOpportunities(brief);
  const [choice, setChoice] = useState(map?.recommendedId);
  const [fit, setFit] = useState<SavedFit | null>(null);
  useEffect(() => {
    setChoice(fit?.directions[0]?.id || map?.recommendedId);
  }, [fit, map?.recommendedId]);
  if (!map) return null;
  const recommendedId = fit?.directions[0]?.id || map.recommendedId;
  const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const label = (
    kind: "effort" | "demand" | "competition" | "basis",
    value: string,
  ) => opportunityLabel(kind, value, locale);
  const selected =
    map.opportunities.find((o) => o.id === choice) ||
    map.opportunities.find((o) => o.id === map.recommendedId)!;
  const p = selected[locale];
  const useConditions = projectUseConditions(brief, selected.id);
  const useCopy = projectUseCopy(locale);
  const refs = [
    ...selected.demand.evidence,
    ...selected.competition.evidence,
  ].filter((r, i, all) => all.findIndex((a) => a.id === r.id) === i);
  const directions = [...map.opportunities].sort((a, b) =>
    fit
      ? fit.directions.findIndex((d) => d.id === a.id) -
        fit.directions.findIndex((d) => d.id === b.id)
      : Number(b.id === map.recommendedId) - Number(a.id === map.recommendedId),
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
        {map.opportunities.find((o) => o.id === recommendedId)![locale].title}
        {l(
          ". Select a direction below to compare what it takes.",
          "。点选下方方向，对比投入与机会。",
        )}
      </p>
      <details className="opportunity-priority">
        <summary>
          {fit
            ? l("The report's original ranking", "原报告的排序理由")
            : l(
                "Why this order, and who each direction suits",
                "排序理由与适合的人群",
              )}
        </summary>
        <p className="opportunity-selection">{map.selection[locale]}</p>
      </details>
      <PersonalFit
        market={market}
        locale={locale}
        result={fit}
        onResult={setFit}
      />
      <p className="footnote">
        {fit
          ? l(
              "The order reflects your situation. Demand, competition and resources retain the original report's evidence and scope.",
              "顺序结合你的个人条件调整。需求、竞争与资源投入沿用原报告的证据和范围。",
            )
          : l(
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
                <strong>{o[locale].title}</strong>
                {o.route && (
                  <span className={`direction-route route-${o.route}`}>
                    {opportunityRoute(o.route, locale)}
                  </span>
                )}
                {o[locale].service && (
                  <span className="opportunity-service">
                    {o[locale].service}
                  </span>
                )}
                {o.id === recommendedId && (
                  <small>
                    <Check size={12} />
                    {fit
                      ? fitLabel(fit.directions[0]!.fit, locale)
                      : l("First to explore", "建议优先")}
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
        {fit && (
          <FitReason result={fit} directionId={selected.id} locale={locale} />
        )}
        {!!selected.basedOn?.length && (
          <div className="strategy-sources">
            {selected.basedOn.map((ref) => {
              const source = brief.sources.find((s) => s.id === ref.id);
              return source ? (
                <a
                  key={ref.id}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  title={ref.quote}
                >
                  {l("Build on", "基于项目")} · {source.label}
                  <ArrowUpRight size={12} />
                </a>
              ) : null;
            })}
          </div>
        )}
        <dl className="opportunity-explainer">
          <div>
            <dt>{l("Who it serves", "服务谁")}</dt>
            <dd>{p.audience}</dd>
          </div>
          {p.need && (
            <div>
              <dt>{l("The need", "解决什么问题")}</dt>
              <dd>{p.need}</dd>
            </div>
          )}
          {p.service && (
            <div>
              <dt>{l("What you offer", "提供什么服务")}</dt>
              <dd>{p.service}</dd>
            </div>
          )}
        </dl>
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
        {!!useConditions.length && (
          <aside
            className="opportunity-use-conditions"
            aria-label={useCopy.title}
          >
            <h5>{useCopy.title}</h5>
            <p>{useCopy.text}</p>
            {useConditions.map((condition) => (
              <div key={condition.url + condition.quote}>
                <a href={condition.url} target="_blank" rel="noreferrer">
                  {condition.project}{" "}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
                <blockquote>{condition.quote}</blockquote>
              </div>
            ))}
          </aside>
        )}
        <div className="opportunity-assessments opportunity-action">
          <div>
            <h5>{l("Build this first", "第一件值得做的东西")}</h5>
            <p>{p.wedge}</p>
          </div>
          <div>
            <h5>{l("A test worth running", "怎样验证值得投入")}</h5>
            <p>{p.experiment}</p>
            {p.successSignal && (
              <>
                <h5>{l("Proposed continue criteria", "建议继续条件")}</h5>
                <p>{p.successSignal}</p>
              </>
            )}
            {p.pivotSignal && (
              <>
                <h5>{l("Proposed redirect criteria", "建议调整条件")}</h5>
                <p>{p.pivotSignal}</p>
              </>
            )}
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
        <DeepStart
          key={selected.id}
          reportId={market.id}
          directionId={selected.id}
          profile={fit?.profile}
        />
      </article>
    </section>
  );
}
