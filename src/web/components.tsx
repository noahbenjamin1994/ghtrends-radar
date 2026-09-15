import React, { useId, useState } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Plus,
  CheckCircle2,
} from "lucide-react";
import type { Market, MarketKind, Repo } from "../core/types.js";
export const kindLabels: Record<MarketKind, string> = {
  blue: "Early blue ocean",
  expanding: "Growth red ocean",
  contested: "Established red ocean",
  quiet: "Quiet waters",
  uncertain: "Uncharted",
};
export const kindColors: Record<MarketKind, string> = {
  blue: "#bcf85e",
  expanding: "#ffbb7b",
  contested: "#e99c9a",
  quiet: "#a1abb0",
  uncertain: "#77817b",
};
export const number = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Intl.NumberFormat("en", {
        notation: n >= 10000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(n);
export const pct = (n: number | null) =>
  n === null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;
export function Logo() {
  return (
    <span className="brand">
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="14" />
        <path d="m8 28 11-12 7 7L36 6" />
        <circle className="logo-dot" cx="36" cy="6" r="3" />
      </svg>
      <span>
        gh<span className="brand-weight">trends</span>
        <sup>↗</sup>
      </span>
    </span>
  );
}
export function Pill({ kind }: { kind: MarketKind }) {
  return (
    <span className={`pill ${kind}`}>
      <i />
      {kindLabels[kind]}
    </span>
  );
}
export function Growth({ value }: { value: number | null }) {
  return (
    <span
      className={
        value !== null && value > 0
          ? "growth positive"
          : value !== null && value < 0
            ? "growth negative"
            : "growth"
      }
    >
      {value !== null &&
        (value >= 0 ? (
          <ArrowUpRight size={15} />
        ) : (
          <ArrowDownRight size={15} />
        ))}
      {pct(value)}
    </span>
  );
}
export function Sparkline({
  values,
  color = "#bcf85e",
  height = 48,
  fill = false,
  domain,
}: {
  values: number[];
  color?: string;
  height?: number;
  fill?: boolean;
  domain?: [number, number];
}) {
  const id = useId().replaceAll(":", "");
  if (values.length < 2)
    return (
      <div className="no-series" style={{ height }}>
        Awaiting history
      </div>
    );
  const min = domain?.[0] ?? Math.min(...values),
    max = domain?.[1] ?? Math.max(...values),
    range = max - min || 1,
    w = 300,
    p = 3;
  const points = values
    .map(
      (v, i) =>
        `${p + (i / (values.length - 1)) * (w - p * 2)},${height - p - ((v - min) / range) * (height - p * 2)}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Historical trend"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor={color} stopOpacity=".2" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && (
        <polygon
          points={`${p},${height} ${points} ${w - p},${height}`}
          fill={`url(#${id})`}
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Radar({
  markets,
  onSelect,
}: {
  markets: Market[];
  onSelect: (m: Market) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const plotted = markets.filter((m) => m.kind !== "uncertain");
  const positions = plotted.map((m, i) => {
    const dense = m.supplyDensity === "dense",
      count = m.supply.total;
    const x = dense
      ? 355 + Math.min(1, Math.log10(Math.max(count / 50, 1)) / 3) * 215
      : 290 - Math.min(1, (50 - count) / 50) * 185;
    const strength = Math.min(1, Math.abs(m.metrics.growth ?? 0) / 2);
    const y = m.metrics.fast ? 215 - strength * 130 : 285 + strength * 130;
    return { m, x, y: y + ((i % 3) - 1) * 13 };
  });
  return (
    <div className="radar-outer">
      <svg
        viewBox="0 0 660 470"
        className="radar"
        role="img"
        aria-label="Opportunity map: active repository supply from left to right, sustained search demand growth from bottom to top"
      >
        <defs>
          <radialGradient id="radarGlow" cx="0.18" cy="0.18" r=".8">
            <stop stopColor="#bdf665" stopOpacity=".12" />
            <stop offset="1" stopColor="#bdf665" stopOpacity="0" />
          </radialGradient>
          <pattern
            id="radarGrid"
            width="34"
            height="34"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".7" fill="#ffffff" opacity=".14" />
          </pattern>
        </defs>
        <rect x="44" y="24" width="580" height="397" rx="12" fill="#121713" />
        <rect
          x="44"
          y="24"
          width="290"
          height="223"
          rx="12"
          fill="url(#radarGlow)"
        />
        <rect x="44" y="24" width="580" height="397" fill="url(#radarGrid)" />
        <path
          d="M334 24V421M44 247H624"
          stroke="#5c6a60"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
        <g className="radar-label">
          <text x="64" y="56" fill="#bcf85e">
            EARLY BLUE
          </text>
          <text x="64" y="75" className="radar-sub">
            Room to build
          </text>
          <text x="600" y="56" textAnchor="end" fill="#ffbb7b">
            GROWTH RED
          </text>
          <text x="600" y="75" textAnchor="end" className="radar-sub">
            A rising, crowded field
          </text>
          <text x="64" y="383" fill="#a1abb0">
            QUIET WATERS
          </text>
          <text x="64" y="402" className="radar-sub">
            Validate the need
          </text>
          <text x="600" y="383" textAnchor="end" fill="#e99c9a">
            ESTABLISHED RED
          </text>
          <text x="600" y="402" textAnchor="end" className="radar-sub">
            Find your difference
          </text>
        </g>
        <text
          transform="translate(18 247) rotate(-90)"
          textAnchor="middle"
          className="axis-label"
        >
          SUSTAINED SEARCH GROWTH →
        </text>
        <text x="334" y="451" textAnchor="middle" className="axis-label">
          ACTIVE PROJECT SUPPLY →
        </text>
        {positions.map(({ m, x, y }, i) => (
          <g
            key={m.id}
            role="button"
            tabIndex={0}
            aria-label={`${m.topic.name}: ${m.headline}`}
            className={`radar-point ${hover === m.id ? "is-hovered" : ""}`}
            onMouseEnter={() => setHover(m.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(m.id)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(m)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(m);
              }
            }}
          >
            <circle
              cx={x}
              cy={y}
              r="16"
              fill={m.topic.color}
              opacity={hover === m.id ? ".18" : ".045"}
            />
            <circle
              cx={x}
              cy={y}
              r={hover === m.id ? 8 : 5}
              fill={m.topic.color}
              stroke="#141b15"
              strokeWidth="2"
            />
            {hover === m.id && (
              <circle
                className="point-ring"
                cx={x}
                cy={y}
                r="13"
                fill="none"
                stroke={m.topic.color}
                opacity=".5"
              />
            )}
            <title>
              {m.topic.name}: {m.supply.total} active projects ·{" "}
              {pct(m.metrics.growth)} search growth
            </title>
          </g>
        ))}
        {positions
          .filter((p) => p.m.id === hover)
          .map(({ m, x, y }) => (
            <g key={m.id} pointerEvents="none">
              <rect
                x={Math.min(x - 80, 440)}
                y={y - 66}
                width="175"
                height="43"
                rx="6"
                fill="#0d130e"
                stroke={m.topic.color}
                strokeOpacity=".6"
              />
              <text
                x={Math.min(x - 69, 451)}
                y={y - 48}
                fill="#edf4e9"
                fontSize="12"
              >
                {m.topic.name}
              </text>
              <text
                x={Math.min(x - 69, 451)}
                y={y - 33}
                fill="#9eac98"
                fontSize="9"
              >
                {m.supply.total} projects · {pct(m.metrics.growth)} search
              </text>
            </g>
          ))}
        {!plotted.length && (
          <g>
            <text
              x="334"
              y="203"
              textAnchor="middle"
              fill="#c4cec3"
              fontSize="17"
            >
              Your next opportunity starts with evidence.
            </text>
            <text
              x="334"
              y="227"
              textAnchor="middle"
              fill="#89958b"
              fontSize="13"
            >
              Scan a topic to place it on the radar.
            </text>
          </g>
        )}
      </svg>
      <div className="radar-category-keys">
        {plotted.map((m) => (
          <button
            key={m.id}
            onMouseEnter={() => setHover(m.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(m.id)}
            onBlur={() => setHover(null)}
            onClick={() => onSelect(m)}
          >
            <i style={{ background: m.topic.color }} />
            {m.topic.name}
          </button>
        ))}
      </div>
      <div className="radar-foot">
        <span>
          <i className="live-dot" />
          {plotted.length} mapped categories
        </span>
        <span>
          Click a signal to explore <ArrowUpRight size={13} />
        </span>
      </div>
    </div>
  );
}
export function CopyButton({
  value,
  label = "Copy",
  className = "button subtle",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link:", value);
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
      {copied ? "Copied" : label}
    </button>
  );
}
export function RepoRow({
  repo,
  onView,
  watched,
  onWatch,
}: {
  repo: Repo;
  onView: () => void;
  watched: boolean;
  onWatch: () => void;
}) {
  return (
    <div className="repo-row">
      <button className="repo-main" onClick={onView}>
        <span className="repo-avatar">
          {repo.name.split("/")[0]!.slice(0, 2).toUpperCase()}
        </span>
        <span>
          <strong>{repo.name}</strong>
          <small>{repo.description || "No description provided."}</small>
        </span>
      </button>
      <div className="repo-stats">
        <span>
          {number(repo.stars)}
          <small>stars</small>
        </span>
        <span className="positive">
          {repo.growth7d !== null ? "+" + number(repo.growth7d) : "—"}
          <small>this week</small>
        </span>
      </div>
      <button
        className={`icon-button ${watched ? "selected" : ""}`}
        onClick={onWatch}
        title={watched ? "Remove from watchlist" : "Add to watchlist"}
        aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
      >
        {watched ? <CheckCircle2 size={19} /> : <Plus size={19} />}
      </button>
      <a
        className="icon-button"
        href={repo.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${repo.name} on GitHub`}
      >
        <ArrowUpRight size={19} />
      </a>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-orbit">↗</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading({ text = "Reading the signals…" }: { text?: string }) {
  return (
    <div className="loading-state">
      <span className="spinner" />
      <p>{text}</p>
    </div>
  );
}
export function ComparisonChart({ repos }: { repos: Repo[] }) {
  const colors = [
    "#bcf85e",
    "#79c9ff",
    "#cdadff",
    "#ffbc8b",
    "#69d9c3",
    "#f19eba",
  ];
  const dates = [
    ...new Set(repos.flatMap((r) => r.starHistory.map((p) => p.date))),
  ]
    .sort()
    .slice(-30);
  const maximum = Math.max(
    1,
    ...repos.flatMap((r) =>
      r.starHistory.filter((p) => dates.includes(p.date)).map((p) => p.count),
    ),
  );
  if (dates.length < 2)
    return (
      <Empty
        title="History is still loading"
        description="The comparison needs at least two daily observations."
      />
    );
  return (
    <section className="panel shared-chart">
      <div className="panel-title">
        <h3>Daily star momentum</h3>
        <span className="footnote">30 days · shared vertical scale</span>
      </div>
      <svg
        viewBox="0 0 900 250"
        role="img"
        aria-label="Repository daily new stars on a shared scale"
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="44"
              x2="880"
              y1={210 - f * 180}
              y2={210 - f * 180}
              stroke="#34402e"
              strokeDasharray="3 5"
            />
            <text
              x="34"
              y={214 - f * 180}
              textAnchor="end"
              fill="#94a68b"
              fontSize="11"
            >
              {Math.round(maximum * f)}
            </text>
          </g>
        ))}
        {repos.map((r, k) => {
          const values = new Map(r.starHistory.map((p) => [p.date, p.count]));
          let last = false;
          const path = dates
            .map((date, i) => {
              const value = values.get(date);
              if (value === undefined) {
                last = false;
                return "";
              }
              const part = `${last ? "L" : "M"}${44 + (i / (dates.length - 1)) * 836},${210 - (value / maximum) * 180}`;
              last = true;
              return part;
            })
            .join(" ");
          return (
            <path
              key={r.name}
              d={path}
              fill="none"
              stroke={colors[k % colors.length]}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            >
              <title>{r.name}</title>
            </path>
          );
        })}
        <text x="44" y="240" fill="#94a68b" fontSize="11">
          {dates[0]}
        </text>
        <text x="880" y="240" textAnchor="end" fill="#94a68b" fontSize="11">
          {dates.at(-1)}
        </text>
      </svg>
      <div className="chart-legend">
        {repos.map((r, k) => (
          <span key={r.name}>
            <i style={{ background: colors[k % colors.length] }} />
            {r.name}
          </span>
        ))}
      </div>
    </section>
  );
}
