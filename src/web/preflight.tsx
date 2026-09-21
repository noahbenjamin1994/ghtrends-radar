import { BusyMark, Skeleton } from "../ui/loading.js";
import React, { useEffect, useRef } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import type { PreflightResult, ResearchScope } from "../core/preflight.js";
import { t, locale } from "./i18n.js";

export function ScopeReview({
  result,
  preparing,
  hosted,
  onChoose,
  onConfirm,
  onEdit,
  onClose,
}: {
  result: PreflightResult | null;
  preparing: boolean;
  hosted: boolean;
  onChoose: (query: string) => void;
  onConfirm: (scope: ResearchScope) => void;
  onEdit: (scope: ResearchScope) => void;
  onClose: () => void;
}) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (result) {
      element.current?.focus({ preventScroll: true });
      element.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [result]);
  if (!result && !preparing) return null;
  return (
    <section
      className="scope-review"
      aria-label={t("Your research scope")}
      tabIndex={-1}
      ref={element}
    >
      <div className="scope-review-heading">
        <span className="eyebrow">
          {t(
            preparing
              ? "Preparing your research scope"
              : result?.status === "ready"
                ? "Your research scope"
                : "A little context helps",
          )}
        </span>
        {preparing ? (
          <BusyMark />
        ) : (
          <button
            type="button"
            className="icon-button"
            aria-label={t("Close research scope")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        )}
      </div>
      {preparing ? (
        <>
          <Skeleton variant="compact" text={t("Preparing your research scope")} />
          <p>{t("Organizing your topic and search phrases · 0 research credits used")}</p>
        </>
      ) : result?.status === "ready" ? (
        <>
          <h3>{result.input}</h3>
          <p>
            {result.topic.plan?.explanation[locale] ||
              t(result.topic.description)}
          </p>
          <div className="scope-queries">
            <span>{t("Search phrases")}</span>
            {(result.topic.plan?.trends || [result.topic.keyword]).map(
              (phrase) => (
                <b key={phrase}>{phrase}</b>
              ),
            )}
          </div>
          <div className="scope-review-actions">
            <span>
              <Check size={14} />
              {t(
                hosted
                  ? "Fresh research uses 1 credit"
                  : "Uses your configured data sources",
              )}
            </span>
            <button
              type="button"
              className="button secondary"
              onClick={() => onEdit(result)}
            >
              {t("Edit research topic")}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => onConfirm(result)}
            >
              {t("Confirm and research")}
              <ArrowRight size={16} />
            </button>
          </div>
          {result.fallback && (
            <p className="scope-fallback">
              {t(
                "Using your original wording. Confirm to collect evidence, or edit your research topic.",
              )}
            </p>
          )}
        </>
      ) : result ? (
        <>
          <p>{result.message[locale]}</p>
          {result.choices.length > 0 && (
            <div className="topic-chips">
              {result.choices.map((choice) => (
                <button
                  type="button"
                  key={choice.query}
                  onClick={() => onChoose(choice.query)}
                >
                  {choice.label}
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          )}
          <small>{t("Scope preparation is free")}</small>
        </>
      ) : null}
    </section>
  );
}
