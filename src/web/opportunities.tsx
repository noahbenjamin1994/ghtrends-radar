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
                key={`${ref.id}:${ref.quote}`}
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
      <details className="opportunity-detail-disclosure">
        <summary>
          <span>
            <strong>
              {l("Read the direction brief", "查看方向依据与验证方案")}
            </strong>
            <small>
              {l(
                "Audience, evidence, effort and the first test",
                "人群、依据、投入与第一次验证",
              )}
            </small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </summary>
        <article
          className="opportunity-detail"
          id="opportunity-detail"
          aria-live="polite"
          aria-labelledby="opportunity-title"
        >
          <header className="direction-heading">
            <div className="eyebrow">{l("DIRECTION IN FOCUS", "方向详情")}</div>
            <h4 id="opportunity-title">{p.title}</h4>
            {fit && (
              <FitReason
                result={fit}
                directionId={selected.id}
                locale={locale}
              />
            )}
            {!!selected.basedOn?.length && (
              <DirectionSources
                sources={brief.sources}
                refs={selected.basedOn}
                label={l("Build on", "基于项目")}
              />
            )}
          </header>
          <section
            className="direction-section"
            aria-labelledby="direction-offer"
          >
            <h5 className="direction-section-title" id="direction-offer">
              <span aria-hidden="true">01</span>
              {l("The proposition", "做什么")}
            </h5>
            <dl className="direction-facts">
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
                <div className="direction-offer">
                  <dt>{l("What you offer", "提供什么服务")}</dt>
                  <dd>{p.service}</dd>
                </div>
              )}
            </dl>
          </section>
          <section
            className="direction-section"
            aria-labelledby="direction-evidence"
          >
            <h5 className="direction-section-title" id="direction-evidence">
              <span aria-hidden="true">02</span>
              {l("The evidence", "为什么值得探索")}
            </h5>
            <div className="direction-evidence-grid">
              <div>
                <div className="direction-field-heading">
                  <h6>{l("Demand & its evidence", "需求与依据")}</h6>
                  <span className="direction-basis">
                    {label("basis", selected.demand.basis)}
                  </span>
                </div>
                <p>{p.demand}</p>
              </div>
              <div>
                <div className="direction-field-heading">
                  <h6>{l("Competition & the opening", "竞争与切入空间")}</h6>
                  <span className="direction-basis">
                    {label("basis", selected.competition.basis)}
                  </span>
                </div>
                <p>{p.competition}</p>
              </div>
            </div>
          </section>
          <section
            className="direction-section"
            aria-labelledby="direction-investment"
          >
            <h5 className="direction-section-title" id="direction-investment">
              <span aria-hidden="true">03</span>
              {l("The commitment", "需要投入多少")}
            </h5>
            <dl className="direction-facts direction-investment">
              <div>
                <dt>{l("Resources", "所需资源")}</dt>
                <dd>{p.resources}</dd>
              </div>
              <div>
                <dt>{l("First release", "首版投入估算")}</dt>
                <dd>{p.delivery}</dd>
              </div>
              <div>
                <dt>{l("Ongoing work", "持续投入")}</dt>
                <dd>{p.upkeep}</dd>
              </div>
            </dl>
            {!!useConditions.length && (
              <aside
                className="opportunity-use-conditions"
                aria-label={useCopy.title}
              >
                <h6>{useCopy.title}</h6>
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
          </section>
          <section
            className="direction-section direction-validation"
            aria-labelledby="direction-validation"
          >
            <h5 className="direction-section-title" id="direction-validation">
              <span aria-hidden="true">04</span>
              {l("The first test", "怎样验证值得投入")}
            </h5>
            <dl className="direction-facts">
              <div>
                <dt>{l("Build this first", "先做什么")}</dt>
                <dd>{p.wedge}</dd>
              </div>
              <div>
                <dt>{l("Run this test", "验证方法")}</dt>
                <dd>{p.experiment}</dd>
              </div>
            </dl>
            {(p.successSignal || p.pivotSignal) && (
              <div className="direction-decisions">
                {p.successSignal && (
                  <div className="direction-continue">
                    <h6>
                      <span aria-hidden="true">↗</span>
                      {l("Proposed continue criteria", "建议继续条件")}
                    </h6>
                    <p>{p.successSignal}</p>
                  </div>
                )}
                {p.pivotSignal && (
                  <div className="direction-adjust">
                    <h6>
                      <span aria-hidden="true">↳</span>
                      {l("Proposed redirect criteria", "建议调整条件")}
                    </h6>
                    <p>{p.pivotSignal}</p>
                  </div>
                )}
              </div>
            )}
          </section>
          <div className="direction-notes">
            {refs.length ? (
              <DirectionSources
                sources={brief.sources}
                refs={refs}
                label={l("Judgment sources", "判断依据")}
              />
            ) : (
              <p className="footnote">
                {l(
                  "Domain hypothesis · test with the experiment above",
                  "领域推演 · 按上方实验采集真实反馈",
                )}
              </p>
            )}
            <p className="footnote">
              {l(
                "Project documents establish features; issues record individual requests. Broader demand and adoption remain research hypotheses. Time and decision thresholds are proposed estimates.",
                "项目文档支持功能判断，Issue 记录个体诉求；更广泛的需求与采用仍属于研究假设。工期与实验门槛均为建议估算。",
              )}
            </p>
          </div>
        </article>
      </details>
      <section
        className="strategy-experiment light-next-step"
        id="decision"
        aria-live="polite"
      >
        <div className="eyebrow">{l("YOUR NEXT STEP", "你的下一步")}</div>
        <h4>{p.title}</h4>
        <p>{p.experiment}</p>
        <div className="strategy-decisions">
          <div>
            <h5>{l("Continue when", "建议继续的信号")}</h5>
            <p>{p.successSignal || p.wedge}</p>
          </div>
          <div>
            <h5>{l("Reconsider when", "建议调整的信号")}</h5>
            <p>{p.pivotSignal || p.resources}</p>
          </div>
        </div>
        <p className="footnote">
          {l(
            "Proposed experiment and thresholds. Validate with real use before committing.",
            "以上为建议实验与门槛，按真实使用结果决定投入。",
          )}
        </p>
      </section>
    </section>
  );
}

function DirectionSources({
  sources,
  refs,
  label,
}: {
  sources: Brief["sources"];
  refs: { id: string; quote: string }[];
  label: string;
}) {
  // One document may back several claims; retain every quotation on one link.
  const documents = new Map<string, { label: string; quotes: Set<string> }>();
  for (const ref of refs) {
    const source = sources.find((s) => s.id === ref.id);
    if (!source?.url) continue;
    const entry = documents.get(source.url) || {
      label: source.label,
      quotes: new Set<string>(),
    };
    entry.quotes.add(ref.quote);
    documents.set(source.url, entry);
  }
  if (!documents.size) return null;
  return (
    <div className="direction-sources">
      <span>{label}</span>
      <div>
        {[...documents].map(([url, source]) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            title={[...source.quotes].join("\n\n")}
          >
            {source.label}
            <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        ))}
      </div>
    </div>
  );
}
