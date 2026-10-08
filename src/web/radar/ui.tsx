import React, { useEffect, useRef } from "react";
import { ArrowUp } from "lucide-react";
import type { L, Quote } from "../../core/decision.js";
import type { ResearchSource } from "../../core/types.js";
import { locale } from "../i18n.js";

export const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
export const tx = (value: L) => value[locale];

export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, "");
  } catch {
    return url;
  }
};

/** Month precision: a quote's age matters, its exact day rarely does. */
export function when(iso?: string) {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    year: "numeric",
    month: locale === "zh" ? "numeric" : "short",
  }).format(time);
}

export function day(iso: string | number) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return l("Today", "今天");
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
    month: "2-digit",
    day: "2-digit",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "2-digit" }),
  }).format(date);
}

export function ago(iso?: string) {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return l("unknown", "未知");
  const days = Math.max(0, Math.round((Date.now() - time) / 86400000));
  if (days < 14)
    return l(
      days < 2 ? "pushed this week" : `pushed ${days} days ago`,
      days < 2 ? "这两天有提交" : `${days} 天前有提交`,
    );
  if (days < 75)
    return l(
      `pushed ${Math.round(days / 7)} weeks ago`,
      `${Math.round(days / 7)} 周前有提交`,
    );
  if (days < 730)
    return l(
      `pushed ${Math.round(days / 30)} months ago`,
      `${Math.round(days / 30)} 个月前有提交`,
    );
  return l(
    `quiet for ${Math.round(days / 365)} years`,
    `${Math.round(days / 365)} 年没动`,
  );
}

export const sourceMeta = (source?: ResearchSource) =>
  source
    ? [source.label, when(source.publishedAt || source.request?.createdAt)]
        .filter(Boolean)
        .join(l(", ", "，"))
    : "";

/** Someone else's words: serif, marker stroke, one click to the original. */
export function QuoteLine({
  quote,
  source,
  onOpen,
  gone,
  action,
}: {
  quote: Quote;
  source?: ResearchSource;
  onOpen: () => void;
  gone?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={gone ? "rd-quote is-gone" : "rd-quote"}>
      <button
        className="rd-quote-open"
        onClick={onOpen}
        aria-label={l(
          "Open this quote in its original context",
          "在原文里看这句话",
        )}
      >
        <q>{quote.quote}</q>
      </button>
      <div className="rd-quote-source">
        <span>{sourceMeta(source)}</span>
        {action}
      </div>
    </div>
  );
}

/** The one input of the product: a sentence in, Enter to send. */
export function Ask({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  disabled,
  autoFocus,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const ref = inputRef || own;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(160, el.scrollHeight) + "px";
  }, [value, ref]);
  return (
    <form
      className="rd-ask"
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim() && !disabled) onSubmit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        maxLength={300}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
        onKeyDown={(event) => {
          // Enter sends; composing Chinese with an IME must not.
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (value.trim() && !disabled) onSubmit();
          }
        }}
      />
      <button
        className="rd-go"
        disabled={!value.trim() || disabled}
        aria-label={label}
      >
        <ArrowUp size={20} strokeWidth={2.2} />
      </button>
    </form>
  );
}

/** A question on the left, its answer on the right. */
export function Row({
  label,
  count,
  className,
  children,
  id,
}: {
  label: string;
  count?: string;
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={"rd-row" + (className ? " " + className : "")}>
      <h2 className="rd-row-label">
        {label}
        {count && <small>{count}</small>}
      </h2>
      <div className="rd-row-body">{children}</div>
    </section>
  );
}
