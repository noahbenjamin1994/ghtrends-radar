import { ArrowUpRight } from "lucide-react";
import { landscapeLabel, researchLandscape } from "../core/landscape.js";
import type { Brief, Gap, Market } from "../core/types.js";

export function IssueReading({
  gap,
  brief,
  locale,
}: {
  gap: Pick<Gap, "url" | "title" | "excerpt">;
  brief?: Brief;
  locale: "en" | "zh";
}) {
  const insight = brief?.issueInsights?.find(
    (i) =>
      i.relevance === "direct" &&
      brief.sources.find((s) => s.id === i.sourceId)?.url === gap.url,
  );
  if (!insight) return <p>{gap.excerpt}</p>;
  const p = insight[locale],
    zh = locale === "zh";
  return (
    <div className="issue-reading">
      <span className="research-caption">
        {zh ? "AI 解读 · 基于这条请求" : "AI reading · this individual request"}
      </span>
      {[
        [zh ? "谁的需求" : "Who and why", `${p.audience} ${p.need}`],
        [zh ? "可探索的开源贡献" : "Contribution to explore", p.opportunity],
        [zh ? "下一步核对" : "Check next", p.check],
      ].map(([label, value]) => (
        <p key={label}>
          <strong>{label}</strong>
          {value}
        </p>
      ))}
      <small>
        {zh ? "原始标题：" : "Original title: "}
        {gap.title}
      </small>
    </div>
  );
}
export function LandscapePanel({
  market: m,
  locale,
}: {
  market: Market;
  locale: "en" | "zh";
}) {
  const result = researchLandscape(m),
    landscape = m.brief?.landscape;
  if (!result || !landscape) return null;
  const zh = locale === "zh",
    p = landscape[locale];
  const sources = m.brief?.sources || [];
  const refs = [
    ...new Map(
      [
        ...landscape.demand.evidence,
        ...landscape.competition.evidence,
        ...landscape.leaders.flatMap((x) => x.evidence),
      ].map((r) => [r.id, r]),
    ).values(),
  ];
  return (
    <section className="landscape-section" id="market-landscape">
      <div className="report-section-heading">
        <div>
          <div className="eyebrow">
            {zh
              ? "趋势 × 商业竞品 × 开源生态"
              : "TRENDS × COMPETITORS × OPEN SOURCE"}
          </div>
          <h3>
            {m.topic.plan?.input || m.topic.name}
            {zh ? "，整体机会怎么看？" : ": the overall opportunity"}
          </h3>
        </div>
        <span className={`ocean-label ocean-${result.kind}`}>
          {landscapeLabel(result.kind, locale)}
        </span>
      </div>
      <p className="landscape-summary">{p.summary}</p>
      <p className="research-caption">
        {zh
          ? "综合研判 · 含研究推断；下方数据保留各自的衡量范围"
          : "Research judgment · includes inference; measurements retain their stated scope"}
      </p>
      <div className="landscape-columns">
        {[
          [zh ? "需求与使用场景" : "Demand and jobs", p.demand],
          [
            zh ? "竞争与替代方案" : "Competition and substitutes",
            p.competition,
          ],
          [zh ? "进入条件" : "Entry requirements", p.entry],
        ].map(([label, value]) => (
          <div key={label}>
            <h4>{label}</h4>
            <p>{value}</p>
          </div>
        ))}
      </div>
      {!!landscape.leaders.length && (
        <div className="incumbent-list">
          <h4>
            {zh
              ? "已有玩家与小团队的进入门槛"
              : "Existing players and entry requirements"}
          </h4>
          {landscape.leaders.map((x) => (
            <article key={x.name}>
              <h5>{x.name}</h5>
              <div>
                <p>{x[locale].position}</p>
                <p>
                  <strong>{zh ? "进入门槛" : "Barrier"}</strong>
                  {x[locale].barrier}
                </p>
                <p>
                  <strong>{zh ? "可探索的切口" : "Opening to test"}</strong>
                  {x[locale].opening}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="strategy-sources">
        {refs.map((r) => {
          const s = sources.find((s) => s.id === r.id);
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
        })}
      </div>
      {m.web && (
        <details className="web-evidence">
          <summary>
            {zh ? "查看 Google 搜索证据" : "Inspect Google search evidence"} ·{" "}
            {m.web.queries.reduce((n, q) => n + q.results.length, 0)}{" "}
            {zh ? "条结果" : "results"}
          </summary>
          <p className="research-caption">
            Google · {m.web.region} · {m.web.language} ·{" "}
            {m.web.fetchedAt.slice(0, 10)}.{" "}
            {zh
              ? "搜索结果为地域样本；广告仅覆盖当次页面展示的位置，反映商业投放意向。购买与持续使用需要行为证据。"
              : "A regional search sample with ads visible on the collected page. Ads signal marketing intent; purchases and sustained use need behavioral evidence."}
          </p>
          {m.web.state === "setup" || m.web.state === "pending" ? (
            <p>
              {zh
                ? "网页证据采集准备中；当前研判结合已有来源与领域推演。"
                : "Web evidence collection is being prepared; this judgment uses available sources and domain inference."}
            </p>
          ) : null}
          {m.web.queries.map((q) => (
            <div className="web-query" key={q.query}>
              <h5>
                <a
                  href={`https://www.google.com/search?${new URLSearchParams({ q: q.query, hl: m.web!.language, gl: m.web!.region.toLowerCase() })}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {q.query}
                  <ArrowUpRight size={12} />
                </a>
              </h5>
              {q.state === "pending" && (
                <p>
                  {zh ? "此组证据待采集" : "This query is awaiting collection"}
                </p>
              )}
              {q.results.map((r) => (
                <a
                  key={r.kind + r.url}
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>
                    {r.kind === "ad"
                      ? zh
                        ? "广告"
                        : "Ad"
                      : zh
                        ? "自然结果"
                        : "Organic"}
                  </span>
                  <strong>{r.title}</strong>
                  <p>{r.excerpt}</p>
                </a>
              ))}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
