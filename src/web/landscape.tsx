import {
  searchCollectionMessage,
  searchEngineLabel,
  searchQueryUrl,
  adCollectionMessage,
  competitorDiscovery,
} from "../core/evidence.js";
import { ArrowUpRight } from "lucide-react";
import { landscapeLabel, researchLandscape } from "../core/landscape.js";
import type { Brief, Gap, Market } from "../core/types.js";
import {
  issueReading,
  requestStatus,
  requestAction,
  type RequestSignal,
} from "../core/gaps.js";

export function IssueReading({
  gap,
  brief,
  locale,
}: {
  gap: Pick<Gap, "url" | "title" | "excerpt"> & {
    state?: string;
    stateReason?: string;
  };
  brief?: Brief;
  locale: "en" | "zh";
}) {
  const insight = issueReading(brief, gap.url);
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
        [
          gap.state === "closed" || gap.state === "answered"
            ? zh
              ? "核对已有进展"
              : "Review the progress"
            : zh
              ? "可探索的开源贡献"
              : "Contribution to explore",
          requestAction(gap, p.opportunity, locale),
        ],
      ].map(([label, value]) => (
        <p key={label}>
          <strong>{label}</strong>
          {value}
        </p>
      ))}
      <details className="request-quote">
        <summary>
          {zh
            ? "看当前做法、验证办法与原话"
            : "Workaround, checks & original request"}
        </summary>
        <div className="request-details">
          {[
            ...(p.currentSolution
              ? [
                  [
                    zh ? "现在怎么解决" : "Current workaround",
                    p.currentSolution,
                  ],
                ]
              : []),
            ...(p.desiredOutcome
              ? [[zh ? "希望得到什么" : "Desired outcome", p.desiredOutcome]]
              : []),
            [zh ? "下一步核对" : "Check next", p.check],
          ].map(([label, value]) => (
            <p key={label}>
              <strong>{label}</strong>
              {value}
            </p>
          ))}
        </div>
        <blockquote>{insight.evidence.quote}</blockquote>
        <small>
          {zh ? "原始标题：" : "Original title: "}
          {gap.title}
        </small>
      </details>
    </div>
  );
}

export function RequestCard({
  gap: g,
  brief,
  locale,
}: {
  gap: RequestSignal;
  brief?: Brief;
  locale: "en" | "zh";
}) {
  const insight = issueReading(brief, g.url),
    zh = locale === "zh";
  const labels = {
    "feature-request": ["Feature request", "功能请求"],
    friction: ["Usage problem", "使用问题"],
    selection: ["Choosing a solution", "选型求助"],
    migration: ["Switching solutions", "迁移意向"],
    alternative: ["Alternative sought", "寻找替代方案"],
    promotion: ["Publisher introduction", "作者介绍"],
    advice: ["Existing approaches and advice", "已有办法与建议"],
  };
  const label = labels[insight?.kind || g.label];
  const release = brief?.sources.find(
    (s) =>
      s.kind === "project" &&
      s.url
        .toLowerCase()
        .startsWith(`https://github.com/${g.repo.toLowerCase()}/releases/tag/`),
  );
  return (
    <article className="gap-card request-card">
      <div className="gap-card-meta">
        <span className="gap-label">{label[zh ? 1 : 0]}</span>
        {g.reactions != null && (
          <span>
            {zh ? "互动" : "Reactions"} {g.reactions}
          </span>
        )}
      </div>
      <h4>
        <a href={g.url} target="_blank" rel="noreferrer">
          {insight?.[locale].title || g.title}
          <ArrowUpRight size={15} />
        </a>
      </h4>
      <span
        className={`request-state ${g.state === "closed" ? "request-closed" : ""}`}
      >
        {requestStatus(g, locale)}
      </span>
      <IssueReading gap={g} brief={brief} locale={locale} />
      {release && (
        <a
          className="request-release"
          href={release.url}
          target="_blank"
          rel="noreferrer"
        >
          {zh ? "核对最近发布" : "Check the latest release"} · {release.label}
        </a>
      )}
      <footer className="request-meta">
        <span>{g.repo}</span>
        <div>
          {[
            [zh ? "发布" : "Posted", g.createdAt],
            [zh ? "更新" : "Updated", g.updatedAt],
            [zh ? "采集" : "Collected", g.observedAt],
          ]
            .filter(([, value]) => value && Number.isFinite(Date.parse(value)))
            .map(([label, value]) => (
              <span key={label}>
                {label} {value!.slice(0, 10)}
              </span>
            ))}
        </div>
      </footer>
    </article>
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
              ? "趋势 × 商业同行 × 开源项目"
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
    </section>
  );
}

function SearchEvidence({
  market: m,
  locale,
}: {
  market: Market;
  locale: "en" | "zh";
}) {
  const zh = locale === "zh";
  return (
    <>
      {" "}
      {m.web && (
        <details className="web-evidence">
          <summary>
            {zh ? "查看网页搜索证据" : "Inspect web search evidence"} ·{" "}
            {m.web.queries.filter((q) => q.state === "ready").length}/
            {m.web.queries.length} {zh ? "组已采集" : "queries collected"}
            {m.web.queries.some((q) => q.state === "ready") &&
              ` · ${m.web.queries.reduce((n, q) => n + q.results.length, 0)} ${zh ? "条结果" : "results"}`}
          </summary>
          <p className="research-caption">
            {zh ? "目标地区" : "Requested region"} · {m.web.region} ·{" "}
            {m.web.language} · {m.web.fetchedAt.slice(0, 10)}.{" "}
            {zh
              ? "搜索结果为地域样本；广告仅覆盖当次页面展示的位置，反映商业投放意向。购买与持续使用需要行为证据。"
              : "A regional search sample with ads visible on the collected page. Ads signal marketing intent; purchases and sustained use need behavioral evidence."}
          </p>
          {searchCollectionMessage(m.web, locale) && (
            <p role="status">{searchCollectionMessage(m.web, locale)}</p>
          )}
          {m.web.queries.map((q) => (
            <div className="web-query" key={q.query}>
              <h5>
                <a
                  href={searchQueryUrl(q, m.web!)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {q.query}
                  <ArrowUpRight size={12} />
                </a>
              </h5>
              {q.state === "ready" && (
                <p className="research-caption">
                  {searchEngineLabel(q)} ·{" "}
                  {q.region === "GLOBAL"
                    ? zh
                      ? "全球"
                      : "Global"
                    : q.region || m.web!.region}{" "}
                  ·{" "}
                  {(q.fetchedAt || m.web!.fetchedAt)
                    .replace("T", " ")
                    .slice(0, 16)}{" "}
                  UTC
                  {q.engine === "duckduckgo"
                    ? zh
                      ? " · 备用搜索 · 自然结果"
                      : " · Fallback · Organic results"
                    : ""}
                </p>
              )}
              {q.state !== "ready" && (
                <p>
                  {zh
                    ? "采集已暂停 · 可更新研究后重试"
                    : "Collection stopped · update research to retry"}
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
                  {r.relevance && (
                    <span>
                      {
                        {
                          direct: zh ? "同类产品" : "Matching offer",
                          resource: zh ? "相关资料" : "Related source",
                          adjacent: zh ? "相邻场景" : "Adjacent task",
                          unrelated: zh
                            ? "已排除：其他主题"
                            : "Excluded: other topic",
                          unclear: zh ? "相关性待核对" : "Relevance pending",
                        }[r.relevance.role]
                      }
                    </span>
                  )}
                  <strong>{r.title}</strong>
                  <p>{r.excerpt}</p>
                </a>
              ))}
            </div>
          ))}
        </details>
      )}
    </>
  );
}

export function CompetitorPanel({
  market: m,
  locale,
}: {
  market: Market;
  locale: "en" | "zh";
}) {
  const zh = locale === "zh",
    l = (en: string, cn: string) => (zh ? cn : en);
  const peers = (
    researchLandscape(m) ? m.brief?.landscape?.leaders || [] : []
  ).filter((p) => p.category !== "opensource");
  const discovered = competitorDiscovery(m.web);
  const directProjects = [
    ...new Map(
      m.supply.repositories
        .filter((r) => r.relevance?.role === "direct" && !r.archived)
        .map((r) => [r.name.toLowerCase(), r]),
    ).values(),
  ];
  const projects = directProjects.slice(0, 3);
  const recentlyUpdated = directProjects.filter((r) => {
    const days = (Date.parse(m.asOf) - Date.parse(r.pushedAt)) / 86400000;
    return Number.isFinite(days) && days >= -1 && days <= 90;
  }).length;
  const ads =
    m.web?.queries.flatMap((q) =>
      q.results
        .filter((r) => r.kind === "ad" && r.relevance?.role === "direct")
        .map((r) => ({
          ...r,
          query: q.query,
          date: q.fetchedAt || m.web!.fetchedAt,
          region: q.region || m.web!.region,
        })),
    ) || [];
  const refs = (ids: string[]) =>
    [...new Set(ids)].flatMap(
      (id) => m.brief?.sources.find((s) => s.id === id) || [],
    );
  const sourceLinks = (ids: string[]) => (
    <div className="peer-sources">
      {refs(ids).map((s) => (
        <a key={s.id} href={s.url} target="_blank" rel="noreferrer">
          {s.label}
          {s.fetchedAt ? ` · ${s.fetchedAt.slice(0, 10)}` : ""}
          <ArrowUpRight size={12} />
        </a>
      ))}
    </div>
  );
  return (
    <section className="competitor-section" id="competitors">
      <div className="report-section-heading">
        <div>
          <div className="eyebrow">
            {l("WHO ELSE SERVES THIS NEED", "谁也在解决这个问题")}
          </div>
          <h3>{l("Get to know the competition", "看看同行都在做什么")}</h3>
        </div>
      </div>
      <p className="research-caption">
        {l(
          "Compare open-source projects, commercial offers and observed ads. Each source answers a different question.",
          "分开看开源项目、商业服务和广告，再判断自己适合从哪做起。",
        )}
      </p>
      <div className="peer-block">
        <h4>
          <span>01</span>
          {l("Open-source projects", "开源项目")}
        </h4>
        <p className="research-caption">
          {l(
            "Project history, recent updates and community activity help you assess maturity and ecosystem reach.",
            "项目做了多久、最近是否更新、社区积累如何，能帮助判断成熟度和生态优势。",
          )}
        </p>
        <div className="peer-open-stats">
          <div>
            <strong>
              {m.supply.error ? "—" : (m.competition?.direct ?? "—")}
            </strong>
            <span>{l("similar projects reviewed", "已审核的同类项目")}</span>
          </div>
          <div>
            <strong>{m.supply.error ? "—" : recentlyUpdated}</strong>
            <span>
              {l(
                "similar projects updated within 90 days",
                "近 90 天更新的同类项目",
              )}
            </span>
          </div>
          <div>
            <strong>{m.competition?.sampled ?? "—"}</strong>
            <span>
              {l("GitHub projects in this sample", "本次查看的 GitHub 项目")}
            </span>
          </div>
        </div>
        <p className="research-caption">
          {l(
            "Maturity considers project age, maintenance, stars and forks. Community activity describes developer attention and reuse.",
            "成熟度结合项目年限、维护情况、Star 与 Fork 评估；社区数据反映开发者关注和代码复用。",
          )}
        </p>
        {projects.map((r) => (
          <article className="peer-project" key={r.name}>
            <div>
              <a href={r.url} target="_blank" rel="noreferrer">
                <strong>{r.name}</strong>
                <ArrowUpRight size={13} />
              </a>
              <p>{r.description}</p>
            </div>
            <div className="peer-project-facts">
              <span>
                ★ {r.stars.toLocaleString()} · {r.forks.toLocaleString()} Fork
              </span>
              <span>
                {l("Created", "创建")} {r.createdAt.slice(0, 10)}
              </span>
              <span>
                {l("Updated", "更新")} {r.pushedAt.slice(0, 10)}
              </span>
              <span>
                {r.license || l("Check repository license", "许可见项目页")}
              </span>
            </div>
          </article>
        ))}
        <a className="peer-more" href="#projects">
          {l("See the full project comparison", "查看完整项目对比")} ↗
        </a>
      </div>
      <div className="peer-block">
        <h4>
          <span>02</span>
          {l("Commercial competitors & related offers", "商业同行与相关方案")}
        </h4>
        <p className="research-caption">
          {l(
            "Source-backed offers, with pricing tied to the quoted plan and collection date. Possible openings are research suggestions.",
            "根据来源整理具体产品和服务；收费以引用的方案与采集时间为准，切入建议供进一步验证。",
          )}
        </p>
        {peers.length ? (
          peers.map((x) => (
            <article className="peer-card" key={x.name}>
              <header>
                <h5>{x.name}</h5>
                <span>
                  {x.category === "commercial"
                    ? l("Commercial service", "商业服务")
                    : x.category === "official"
                      ? l("Official service", "官方服务")
                      : x.category === "opensource"
                        ? l("Open-source tool", "开源工具")
                        : l("Related offer", "相关方案")}
                </span>
              </header>
              <p className="peer-offer">{x[locale].position}</p>
              <dl>
                <div>
                  <dt>{l("Who it serves", "服务谁")}</dt>
                  <dd>
                    {x.audience?.[locale] ||
                      l(
                        "Check the product page for its intended users.",
                        "查看产品介绍，确认目标用户。",
                      )}
                  </dd>
                  {x.audience && sourceLinks([x.audience.evidence.id])}
                </div>
                <div>
                  <dt>{l("Pricing & quotes", "收费与报价")}</dt>
                  <dd>
                    {x.pricing?.[locale] ||
                      l(
                        "Check the product website for current plans and billing.",
                        "查看官网，确认当前方案和收费方式。",
                      )}
                  </dd>
                  {x.pricing && (
                    <>
                      <p className="research-caption">
                        {l(
                          "Check the quoted plan, currency and eligibility on the source page.",
                          "请按来源核对方案、币种与适用条件。",
                        )}
                      </p>
                      {sourceLinks([x.pricing.evidence.id])}
                    </>
                  )}
                </div>
                <div>
                  <dt>
                    {l("Existing advantage", "现有优势")}
                    <small>{l("Research assessment", "研究判断")}</small>
                  </dt>
                  <dd>{x[locale].barrier}</dd>
                </div>
                <div>
                  <dt>
                    {l("Where you could start", "你可以从哪做起")}
                    <small>{l("Research suggestion", "研究建议")}</small>
                  </dt>
                  <dd>{x[locale].opening}</dd>
                </div>
              </dl>
              {sourceLinks(x.evidence.map((r) => r.id))}
            </article>
          ))
        ) : discovered.length ? (
          <>
            <p className="research-caption">
              {l(
                "These product pages describe services matching the researched task. Publisher excerpts are preserved; check each page for current pricing.",
                "以下产品页面已通过主题相关性核对。保留网页原文，便于比较实际服务；收费以产品页面为准。",
              )}
            </p>
            {discovered.map((page) => (
              <article className="peer-card" key={page.url}>
                <a href={page.url} target="_blank" rel="noreferrer">
                  <h5>
                    {page.title} <ArrowUpRight size={15} />
                  </h5>
                </a>
                <p>{page.excerpt}</p>
                <small>
                  {page.host} · {page.date.slice(0, 10)}
                </small>
                <p className="research-caption">
                  {l("Found with", "搜索词")}：{page.query}
                </p>
              </article>
            ))}
          </>
        ) : (
          <p className="peer-empty">
            {l(
              "This report currently compares the open-source projects above. Update research to collect product and pricing pages for the same user task.",
              "本报告当前已覆盖上方开源项目。更新研究可补充同一用户任务的产品与收费页面。",
            )}
          </p>
        )}
      </div>
      {ads.length > 0 && (
        <div className="peer-block">
          <h4>
            <span>03</span>
            {l("Competitors appearing in ads", "广告里的同行")}
          </h4>
          <p className="research-caption">
            {l(
              "These are ads captured for specific searches. The landing-page website identifies the destination; the advertiser's business identity can be checked there.",
              "这里记录具体搜索中采集到的广告。先看落地页网站，再核对广告主的公司身份。",
            )}
          </p>
          {ads.length ? (
            ads.map((ad, i) => (
              <article className="peer-ad" key={ad.query + ad.url + i}>
                <span className="peer-ad-site">
                  {l("Landing-page website", "投放网站")} ·{" "}
                  {new URL(ad.url).hostname}
                </span>
                <a href={ad.url} target="_blank" rel="noreferrer">
                  <h5>
                    {ad.title}
                    <ArrowUpRight size={15} />
                  </h5>
                </a>
                <p>
                  {ad.excerpt ||
                    l(
                      "Open the landing page for the offer details.",
                      "打开落地页查看方案详情。",
                    )}
                </p>
                <dl>
                  <div>
                    <dt>{l("Search keyword", "出现的关键词")}</dt>
                    <dd>{ad.query}</dd>
                  </div>
                  <div>
                    <dt>
                      {l("Region / language / date", "地区 / 语言 / 时间")}
                    </dt>
                    <dd>
                      {ad.region} · {m.web!.language} · {ad.date.slice(0, 10)}
                    </dd>
                  </div>
                  <div>
                    <dt>{l("Landing page", "落地页")}</dt>
                    <dd>
                      <a href={ad.url} target="_blank" rel="noreferrer">
                        {ad.url}
                      </a>
                    </dd>
                  </div>
                </dl>
              </article>
            ))
          ) : (
            <p className="peer-empty">{adCollectionMessage(m.web, locale)}</p>
          )}
          <div className="peer-sources">
            {m.web?.queries
              .filter((q) => q.intent === "competition")
              .slice(0, 1)
              .map((q) => (
                <a
                  key={q.query}
                  href={`https://www.google.com/search?${new URLSearchParams({ q: q.query, hl: m.web!.language, gl: m.web!.region.toLowerCase() })}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {l(
                    "Check this keyword on Google",
                    "在 Google 核对这个关键词",
                  )}
                  <ArrowUpRight size={12} />
                </a>
              ))}
            <a
              href={`https://adstransparency.google.com/?${new URLSearchParams({ platform: "SEARCH", region: m.web?.region || m.geo || "US" })}`}
              target="_blank"
              rel="noreferrer"
            >
              {l(
                "Check advertisers in Google's ad library",
                "到 Google 广告库核对同行投放",
              )}
              <ArrowUpRight size={12} />
            </a>
          </div>
          <p className="research-caption">
            {l(
              "Search the ad library by competitor name or website to check creatives and advertiser identity. Keyword appearances come from search-page observations.",
              "在广告库输入同行名称或官网，可核对广告素材和广告主身份；关键词曝光以搜索页面记录为准。",
            )}
          </p>
          <p className="research-caption">
            {m.web?.provider === "google-mobile" ||
            m.web?.provider === "multi-search"
              ? l(
                  "Collected from a lightweight search page. ",
                  "当前采集使用轻量搜索页面。",
                )
              : ""}
            {l(
              "Coverage follows the captured page. Spend, clicks and conversions require data from the advertiser's account.",
              "广告覆盖以实际采集页面为准；投放金额、点击量与转化数据需由广告账户提供。",
            )}
          </p>
        </div>
      )}
      {ads.length === 0 && (
        <details className="web-evidence">
          <summary>{l("Advertising sample coverage", "广告采样范围")}</summary>
          <p className="research-caption">
            {adCollectionMessage(m.web, locale)}
          </p>
        </details>
      )}
      <SearchEvidence market={m} locale={locale} />
    </section>
  );
}
