import React, { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronsUp, Lightbulb } from "lucide-react";
import type { Market } from "../core/types.js";
import { locale, localUrl } from "./i18n.js";
import "./inspiration.css";
import { api } from "./api.js";

// Editorial entry points into existing public reports; no synthetic research.
const cases = [
  {
    slug: "browser-agents",
    kind: "browser",
    zh: "浏览器智能体，下一步做什么？",
    en: "What comes after browser agents?",
    subZh: "从网页操作，找到真实工作流",
    subEn: "From browser actions to real workflows",
  },
  {
    slug: "agent-memory",
    kind: "memory",
    zh: "让智能体记住什么，才有价值？",
    en: "What should an agent remember?",
    subZh: "记忆、召回与值得解决的问题",
    subEn: "Memory, recall and problems worth solving",
  },
  {
    slug: "mcp-servers",
    kind: "mcp",
    zh: "MCP 热潮里，还能做什么？",
    en: "Where is the next MCP opportunity?",
    subZh: "看清工具生态里的具体缺口",
    subEn: "Find the gaps in a growing tool ecosystem",
  },
  {
    slug: "coding-agents",
    kind: "code",
    zh: "AI 编程，机会只在写代码吗？",
    en: "Coding agents. Beyond writing code.",
    subZh: "从开发流程中，寻找更小的切口",
    subEn: "Look for a narrower opening in the workflow",
  },
  {
    slug: "rag",
    kind: "rag",
    zh: "知识库问答，还缺哪一块？",
    en: "What is missing from knowledge search?",
    subZh: "把检索、证据与实际需求放在一起",
    subEn: "Connect retrieval, evidence and real needs",
  },
  {
    slug: "local-llm",
    kind: "local",
    zh: "本地大模型，谁真正需要？",
    en: "Who actually needs a local model?",
    subZh: "从本地运行，走到有用的产品",
    subEn: "From running locally to building something useful",
  },
] as const;

function CaseArtwork({ kind }: { kind: string }) {
  return (
    <svg viewBox="0 0 320 180" fill="none" aria-hidden="true" focusable="false">
      {kind === "browser" && (
        <>
          <rect
            x="47"
            y="27"
            width="222"
            height="132"
            rx="12"
            fill="white"
            stroke="#ccd4df"
          />
          <path d="M47 51H269" stroke="#e5e9ef" />
          {[61, 70, 79].map((x) => (
            <circle key={x} cx={x} cy="39" r="2.3" fill="#c6cdd7" />
          ))}
          <rect x="104" y="34" width="127" height="10" rx="5" fill="#f0f3f7" />
          {[70, 98, 126].map((y, i) => (
            <g key={y}>
              <rect
                x="64"
                y={y}
                width="150"
                height="18"
                rx="5"
                fill={i === 1 ? "#e8f1ee" : "#f3f5f8"}
              />
              <circle
                cx="75"
                cy={y + 9}
                r="3"
                fill={i === 1 ? "#599983" : "#c9d1db"}
              />
              <path
                d={`M87 ${y + 9}h${76 - i * 13}`}
                stroke="#b7c2cf"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          ))}
          <path
            d="m232 100 1 40 10-11 14 2z"
            fill="#243d58"
            stroke="white"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <circle
            cx="235"
            cy="96"
            r="18"
            stroke="#a1b6d0"
            strokeDasharray="3 5"
          />
        </>
      )}
      {kind === "memory" && (
        <>
          <g stroke="#92879f" strokeWidth="1.2">
            <path d="M160 90C118 90 124 39 82 39M160 90C205 90 203 44 246 44M160 90C107 90 127 147 81 147M160 90C213 90 203 139 252 139" />
            <path
              d="M82 39C35 75 40 122 81 147M246 44C293 78 288 112 252 139"
              strokeDasharray="3 6"
              opacity=".45"
            />
          </g>
          <circle cx="160" cy="90" r="42" stroke="#b4a7c7" opacity=".16" />
          <circle cx="160" cy="90" r="31" fill="#373246" stroke="#9384a8" />
          <path
            d="M147 82h26M147 90h20M147 98h12"
            stroke="#e9d8ac"
            strokeWidth="3"
            strokeLinecap="round"
          />
          {[
            [82, 39],
            [246, 44],
            [81, 147],
            [252, 139],
          ].map(([x, y], i) => (
            <g key={x}>
              <rect
                x={x - 20}
                y={y - 12}
                width="40"
                height="24"
                rx="7"
                fill="#393344"
                stroke="#665d77"
              />
              <circle
                cx={x - 8}
                cy={y}
                r="3"
                fill={i % 2 ? "#a4b6d0" : "#e7c88e"}
              />
              <path
                d={`M${x} ${y}h10`}
                stroke="#a59caf"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>
          ))}
        </>
      )}
      {kind === "mcp" && (
        <>
          <g stroke="#c4b8a6" strokeWidth="1.5">
            <path d="M111 45h30q19 0 19 19v55q0 17 18 17h29M111 135h22q27 0 27-24V66q0-21 21-21h26" />
          </g>
          {[
            [63, 25],
            [63, 115],
            [207, 25],
            [207, 115],
          ].map(([x, y], i) => (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width="50"
                height="40"
                rx="10"
                fill="#fffdfa"
                stroke="#dfd5c5"
              />
              <path
                d={`M${x + 16} ${y + 15}h18m-18 6h${i % 2 ? 12 : 18}m-18 6h8`}
                stroke="#a69984"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>
          ))}
          <rect x="137" y="67" width="46" height="46" rx="14" fill="#554f43" />
          <path
            d="m149 88 7-7a5 5 0 0 1 7 7l-7 7m1-10 7-7m-4 20 7-7"
            stroke="#fff9ea"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "code" && (
        <>
          <rect
            x="66"
            y="23"
            width="222"
            height="126"
            rx="10"
            fill="#2a393a"
            stroke="#425657"
          />
          <rect
            x="37"
            y="39"
            width="229"
            height="125"
            rx="10"
            fill="#182829"
            stroke="#526968"
          />
          <path d="M37 64H266" stroke="#3b5050" />
          {[52, 61, 70].map((x) => (
            <circle key={x} cx={x} cy="52" r="2" fill="#839b96" />
          ))}
          <g fontFamily="monospace" fontSize="10">
            <text x="54" y="85" fill="#819b97">
              01
            </text>
            <text x="78" y="85" fill="#c5dcae">
              plan → build → review
            </text>
            <text x="54" y="106" fill="#819b97">
              02
            </text>
            <text x="78" y="106" fill="#aac5c0">
              small steps. real evidence.
            </text>
          </g>
          <path
            d="m57 129 4 4 8-9"
            stroke="#b7d9a4"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M80 130h72"
            stroke="#647d77"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <rect x="207" y="119" width="39" height="21" rx="6" fill="#304b42" />
          <path
            d="m221 127 4 4 7-7"
            stroke="#b7d9a4"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "rag" && (
        <>
          <g transform="rotate(-10 115 90)">
            <rect
              x="62"
              y="38"
              width="95"
              height="112"
              rx="9"
              fill="#e8dfd9"
              stroke="#d4c7bc"
            />
          </g>
          <rect
            x="79"
            y="29"
            width="95"
            height="112"
            rx="9"
            fill="#fffdfa"
            stroke="#d9c9bd"
          />
          <path
            d="M97 51h38M97 65h57M97 77h46M97 101h51M97 113h34"
            stroke="#d0c0b4"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <rect x="93" y="86" width="66" height="6" rx="3" fill="#e8c09d" />
          <path d="M170 88h25" stroke="#bd9e88" strokeDasharray="3 3" />
          <rect
            x="191"
            y="66"
            width="75"
            height="62"
            rx="12"
            fill="#faf3ec"
            stroke="#d9c2ad"
          />
          <circle cx="222" cy="92" r="10" stroke="#9d7656" strokeWidth="2" />
          <path
            d="m230 100 9 9"
            stroke="#9d7656"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </>
      )}
      {kind === "local" && (
        <>
          <g stroke="#355962" strokeWidth="1.5">
            <path d="M112 70H73V38M112 90H45M112 110H71v37M208 70h40V38M208 90h67M208 110h40v37" />
            {[70, 90, 110].map((y) => (
              <path key={y} d={`M104 ${y}h10M206 ${y}h10`} />
            ))}
          </g>
          <rect
            x="108"
            y="43"
            width="104"
            height="94"
            rx="18"
            fill="#203b43"
            stroke="#567e85"
          />
          <rect
            x="120"
            y="55"
            width="80"
            height="70"
            rx="11"
            fill="#182e37"
            stroke="#3b5e65"
          />
          <path
            d="M144 82v-6a16 16 0 0 1 32 0v6"
            stroke="#bddcd0"
            strokeWidth="2.3"
          />
          <rect x="140" y="81" width="40" height="29" rx="7" fill="#bddcd0" />
          <circle cx="160" cy="93" r="3" fill="#284850" />
          <path d="M160 94v6" stroke="#284850" strokeWidth="2" />
          {[
            [73, 38],
            [45, 90],
            [71, 147],
            [248, 38],
            [275, 90],
            [248, 147],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#85b4ad" />
          ))}
        </>
      )}
    </svg>
  );
}

export function InspirationDeck({
  markets,
  loading,
  geo,
  navigate,
}: {
  markets: Market[];
  loading: boolean;
  geo: string;
  navigate: (path: string) => void;
}) {
  const section = useRef<HTMLElement>(null);
  const [globalMarkets, setGlobalMarkets] = useState<Market[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);
  useEffect(() => {
    if (!geo) return;
    let active = true;
    setGlobalLoading(true);
    void api<{ markets: Market[] }>("/api/markets?geo=")
      .then((result) => {
        if (active) setGlobalMarkets(result.markets);
      })
      .catch(() => {
        if (active) setGlobalMarkets([]);
      })
      .finally(() => {
        if (active) setGlobalLoading(false);
      });
    return () => {
      active = false;
    };
  }, [geo]);
  const source = geo ? globalMarkets : markets;
  const pending = geo ? globalLoading : loading;
  const available = cases.flatMap((item) => {
    const report = source.find((m) => m.topic.slug === item.slug);
    return report ? [{ ...item, reportId: report.id }] : [];
  });
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const distance = innerHeight - element.getBoundingClientRect().top - 56;
      element.dataset.lit = String(distance > 24);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    element
      .querySelectorAll(".inspiration-card")
      .forEach((card) => observer.observe(card));
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [available.length]);
  return (
    <section
      className="inspiration-section"
      ref={section}
      aria-labelledby="inspiration-title"
      data-lit="false"
    >
      <button
        className="inspiration-handle"
        onClick={() => {
          section.current?.scrollIntoView({
            block: "start",
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
          });
        }}
        aria-controls="inspiration-cases"
      >
        <span className="inspiration-label">
          <span className="inspiration-bulb">
            <Lightbulb size={19} strokeWidth={1.7} />
          </span>
          <span id="inspiration-title">
            {locale === "zh" ? "探索灵感" : "Explore ideas"}
          </span>
        </span>
        <span className="inspiration-scroll">
          {locale === "zh" ? "滑动探索" : "Scroll to explore"}
          <ChevronsUp size={17} strokeWidth={1.5} />
        </span>
      </button>
      <div id="inspiration-cases" className="inspiration-content">
        <p className="inspiration-caption">
          {locale === "zh"
            ? "从一个好问题开始。看看这些已经完成的公开研究。"
            : "Start with a good question. Explore these ready-to-read public reports."}
        </p>
        <div className="inspiration-grid">
          {available.map((item, i) => (
            <a
              className="inspiration-card"
              key={item.slug}
              href={localUrl("/report/" + item.reportId)}
              style={
                { "--case-delay": `${(i % 3) * 55}ms` } as React.CSSProperties
              }
              onClick={(event) => {
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  event.button !== 0
                )
                  return;
                event.preventDefault();
                navigate("/report/" + item.reportId);
              }}
            >
              <div className={`case-art case-art-${item.kind}`}>
                <CaseArtwork kind={item.kind} />
                <span className="case-open">
                  <ArrowUpRight size={17} />
                </span>
              </div>
              <h3>{locale === "zh" ? item.zh : item.en}</h3>
              <p>{locale === "zh" ? item.subZh : item.subEn}</p>
            </a>
          ))}
          {pending &&
            !available.length &&
            cases.map((item) => (
              <div
                className="case-placeholder"
                key={item.slug}
                aria-hidden="true"
              />
            ))}
        </div>
        {!pending && !available.length && (
          <p className="inspiration-empty">
            {locale === "zh"
              ? "公开案例暂未就绪，你可以先研究自己的想法。"
              : "Public examples are not ready yet. Start with your own idea above."}
          </p>
        )}
      </div>
    </section>
  );
}
