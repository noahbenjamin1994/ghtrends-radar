import { ArrowUpRight, ChevronDown } from "lucide-react";
import { documentStatusLabel } from "../core/evidence.js";
import type { Market } from "../core/types.js";
export function SourceDocuments({
  market,
  locale,
}: {
  market: Market;
  locale: "en" | "zh";
}) {
  const data = market.documents,
    zh = locale === "zh";
  if (!data || (!data.sources.length && !data.reads.length)) return null;
  return (
    <details className="source-documents">
      <summary>
        {zh ? "核对原文与许可" : "Original text and licenses"}
        <span>
          {data.sources.length} {zh ? "份资料" : "documents"}
          <ChevronDown size={15} />
        </span>
      </summary>
      <p className="footnote">
        {zh
          ? "官网内容代表发布方声明，讨论代表个人经历。结合采集时间、具体版本与原文核对。"
          : "Publisher pages describe their own claims; discussions describe individual experience. Check collection dates, versions and original wording."}
      </p>
      <div className="source-document-list">
        {data.sources.map((s, i) => (
          <details key={s.id || i}>
            <summary>
              <span>{s.label}</span>
              <small>
                {s.publishedAt &&
                  `${zh ? "发布" : "Published"} ${s.publishedAt.slice(0, 10)} · `}
                {zh ? "采集" : "Read"} {s.fetchedAt?.slice(0, 10)}
              </small>
            </summary>
            <a href={s.url} target="_blank" rel="noreferrer">
              {zh ? "打开原文" : "Open original"}
              <ArrowUpRight size={14} />
            </a>
            {s.parentUrl && (
              <a href={s.parentUrl} target="_blank" rel="noreferrer">
                {zh ? "查看上下文" : "Read the surrounding discussion"}
                <ArrowUpRight size={14} />
              </a>
            )}
            <blockquote>{s.excerpt}</blockquote>
          </details>
        ))}
      </div>
      {data.reads.some((r) => r.status !== "read") && (
        <ul className="source-read-status">
          {data.reads
            .filter((r) => r.status !== "read")
            .map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">
                  {new URL(r.url).hostname}
                </a>
                <span>{documentStatusLabel(r.status, locale)}</span>
              </li>
            ))}
        </ul>
      )}
    </details>
  );
}
