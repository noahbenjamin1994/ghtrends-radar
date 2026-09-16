import { t, locale } from "./i18n.js";
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
  blue: t("Rising · limited supply"),
  expanding: t("Rising · established supply"),
  contested: t("Established supply"),
  quiet: t("Limited observed supply"),
  uncertain: t("Needs validation"),
};
export const kindColors: Record<MarketKind, string> = {
  blue: "#18846b",
  expanding: "#3768af",
  contested: "#a36a3c",
  quiet: "#666666",
  uncertain: "#777777",
};
export const number = (n: number | null | undefined) =>
  n == null
    ? "—"
    : Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en", {
        notation: n >= 10000 ? "compact" : "standard",
        maximumFractionDigits: 1,
      }).format(n);
export const pct = (n: number | null) =>
  n === null ? "—" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(0)}%`;
// Stable colors for visual identity; report data keeps its original values.
export function topicColor(slug: string) {
  const palette = [
    "#3d70b5",
    "#18846b",
    "#8b5baf",
    "#b57237",
    "#318793",
    "#b65a83",
  ];
  const hash = Array.from(slug).reduce(
    (n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0,
    0,
  );
  return palette[hash % palette.length];
}
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
  color = "#18846b",
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
        {t("Awaiting history")}
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
      aria-label={t("Historical trend")}
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
    const y =
      m.metrics.trend === "rising"
        ? 215 - strength * 130
        : 285 + strength * 130;
    return { m, x, y: y + ((i % 3) - 1) * 13 };
  });
  return (
    <div className="radar-outer">
      <svg
        viewBox="0 0 660 470"
        className="radar"
        role="img"
        aria-label={t(
          "Opportunity map: active repository supply from left to right, sustained search demand growth from bottom to top",
        )}
      >
        <defs>
          <radialGradient id="radarGlow" cx="0.18" cy="0.18" r=".8">
            <stop stopColor="#68b7a0" stopOpacity=".12" />
            <stop offset="1" stopColor="#68b7a0" stopOpacity="0" />
          </radialGradient>
          <pattern
            id="radarGrid"
            width="34"
            height="34"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".7" fill="#657080" opacity=".18" />
          </pattern>
        </defs>
        <rect x="44" y="24" width="580" height="397" rx="12" fill="#f5f6f7" />
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
          stroke="#c5cacf"
          strokeWidth="1"
          strokeDasharray="4 6"
        />
        <g className="radar-label">
          <text x="64" y="56" fill="#18846b">
            {t("RISING / LIMITED SUPPLY")}
          </text>
          <text x="64" y="75" className="radar-sub">
            {t("Room to build")}
          </text>
          <text x="600" y="56" textAnchor="end" fill="#3768af">
            {t("RISING / ESTABLISHED SUPPLY")}
          </text>
          <text x="600" y="75" textAnchor="end" className="radar-sub">
            {t("Search rising; compare alternatives")}
          </text>
          <text x="64" y="383" fill="#666666">
            {t("LIMITED SUPPLY")}
          </text>
          <text x="64" y="402" className="radar-sub">
            {t("Validate the need")}
          </text>
          <text x="600" y="383" textAnchor="end" fill="#a36a3c">
            {t("ESTABLISHED SUPPLY")}
          </text>
          <text x="600" y="402" textAnchor="end" className="radar-sub">
            {t("Find your difference")}
          </text>
        </g>
        <text
          transform="translate(18 247) rotate(-90)"
          textAnchor="middle"
          className="axis-label"
        >
          {t("SEARCH INTEREST CHANGE →")}
        </text>
        <text x="334" y="451" textAnchor="middle" className="axis-label">
          {t("ACTIVE PROJECT SUPPLY →")}
        </text>
        {positions.map(({ m, x, y }, i) => (
          <g
            key={m.id}
            role="button"
            tabIndex={0}
            aria-label={`${t(m.topic.name)}: ${m.headline}`}
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
              fill={topicColor(m.topic.slug)}
              opacity={hover === m.id ? ".18" : ".045"}
            />
            <circle
              cx={x}
              cy={y}
              r={hover === m.id ? 8 : 5}
              fill={topicColor(m.topic.slug)}
              stroke="#ffffff"
              strokeWidth="2"
            />
            {hover === m.id && (
              <circle
                className="point-ring"
                cx={x}
                cy={y}
                r="13"
                fill="none"
                stroke={topicColor(m.topic.slug)}
                opacity=".5"
              />
            )}
            <title>
              {t(m.topic.name)}: {m.supply.total}
              {t("active projects ·")} {pct(m.metrics.growth)}
              {t("search growth")}
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
                fill="#ffffff"
                stroke={topicColor(m.topic.slug)}
                strokeOpacity=".6"
              />
              <text
                x={Math.min(x - 69, 451)}
                y={y - 48}
                fill="#242424"
                fontSize="12"
              >
                {t(m.topic.name)}
              </text>
              <text
                x={Math.min(x - 69, 451)}
                y={y - 33}
                fill="#666666"
                fontSize="9"
              >
                {m.supply.total}
                {t("projects ·")}
                {pct(m.metrics.growth)}
                {t("search")}
              </text>
            </g>
          ))}
        {!plotted.length && (
          <g>
            <text
              x="334"
              y="203"
              textAnchor="middle"
              fill="#444444"
              fontSize="17"
            >
              {t("Your next opportunity starts with evidence.")}
            </text>
            <text
              x="334"
              y="227"
              textAnchor="middle"
              fill="#777777"
              fontSize="13"
            >
              {t("Scan a topic to place it on the radar.")}
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
            <i style={{ background: topicColor(m.topic.slug) }} />
            {t(m.topic.name)}
          </button>
        ))}
      </div>
      <div className="radar-foot">
        <span>
          <i className="live-dot" />
          {plotted.length}
          {t("mapped categories")}
        </span>
        <span>
          {t("Click a signal to explore")}
          <ArrowUpRight size={13} />
        </span>
      </div>
    </div>
  );
}
export function CopyButton({
  value,
  label = t("Copy"),
  className = "button subtle",
  onCopied,
}: {
  value: string;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          onCopied?.();
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt(t("Copy this link:"), value);
        }
      }}
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
      {copied ? t("Copied") : label}
    </button>
  );
}
export function RepoRow({
  repo,
  onView,
  watched,
  onWatch,
  selected,
  onSelect,
}: {
  repo: Repo;
  onView: () => void;
  watched: boolean;
  onWatch: () => void;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <div className="repo-row">
      {onSelect && (
        <input
          className="repo-select"
          type="checkbox"
          checked={!!selected}
          onChange={onSelect}
          aria-label={t("Select {repo} to compare", { repo: repo.name })}
        />
      )}
      <button className="repo-main" onClick={onView}>
        <span className="repo-avatar">
          {repo.name.split("/")[0]!.slice(0, 2).toUpperCase()}
        </span>
        <span>
          <strong>{repo.name}</strong>
          <small>{repo.description || t("No description provided.")}</small>
        </span>
      </button>
      <div className="repo-stats">
        <span>
          {number(repo.stars)}
          <small>{t("stars")}</small>
        </span>
        <span className="positive">
          {repo.growth7d !== null ? "+" + number(repo.growth7d) : "—"}
          <small>{t("this week")}</small>
        </span>
      </div>
      <button
        className={`icon-button ${watched ? "selected" : ""}`}
        onClick={onWatch}
        title={watched ? t("Remove saved project") : t("Save project")}
        aria-label={watched ? t("Remove saved project") : t("Save project")}
      >
        {watched ? <CheckCircle2 size={19} /> : <Plus size={19} />}
      </button>
      <a
        className="icon-button"
        href={repo.url}
        target="_blank"
        rel="noreferrer"
        aria-label={t("Open {repo} on GitHub", { repo: repo.name })}
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
export function Loading({
  text = t("Reading the signals…"),
}: {
  text?: string;
}) {
  return (
    <div className="loading-state">
      <span className="spinner" />
      <p>{text}</p>
    </div>
  );
}
export function ComparisonChart({ repos }: { repos: Repo[] }) {
  const colors = [
    "#18846b",
    "#3d70b5",
    "#8b5baf",
    "#b57237",
    "#318793",
    "#b65a83",
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
        title={t("History is still loading")}
        description={t("The comparison needs at least two daily observations.")}
      />
    );
  return (
    <section className="panel shared-chart">
      <div className="panel-title">
        <h3>{t("Daily star momentum")}</h3>
        <span className="footnote">{t("30 days · shared vertical scale")}</span>
      </div>
      <svg
        viewBox="0 0 900 250"
        role="img"
        aria-label={t("Repository daily new stars on a shared scale")}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="44"
              x2="880"
              y1={210 - f * 180}
              y2={210 - f * 180}
              stroke="#e6e6e6"
              strokeDasharray="3 5"
            />
            <text
              x="34"
              y={214 - f * 180}
              textAnchor="end"
              fill="#707070"
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
        <text x="44" y="240" fill="#707070" fontSize="11">
          {dates[0]}
        </text>
        <text x="880" y="240" textAnchor="end" fill="#707070" fontSize="11">
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
