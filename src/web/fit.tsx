import { BusyMark } from "../ui/loading.js";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Download, SlidersHorizontal } from "lucide-react";
import {
  fitLabel,
  fitMarkdown,
  profileOptions,
  profileText,
  type SavedFit,
} from "../core/fit.js";
import type { Market } from "../core/types.js";
import { api } from "./api.js";
import { appUrl } from "./paths.js";
import { text } from "../core/i18n.js";

export function PersonalFit({
  market,
  locale,
  result,
  onResult,
}: {
  market: Market;
  locale: "en" | "zh";
  result: SavedFit | null;
  onResult: (value: SavedFit | null) => void;
}) {
  const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState({
    skill: "",
    time: "",
    goal: "",
    context: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signIn, setSignIn] = useState(false);
  const version = useRef(0);
  useEffect(() => {
    const at = version.current;
    let active = true;
    api<SavedFit | null>(`/api/reports/${market.id}/fit`)
      .then((saved) => {
        if (active && saved && at === version.current) {
          setProfile(saved.profile);
          onResult(saved);
        }
      })
      .catch(() => {
        /* Existing public directions remain available. */
      });
    return () => {
      active = false;
    };
  }, [market.id, onResult]);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  const edit = (key: keyof typeof profile, value: string) => {
    version.current++;
    setProfile((previous) => ({ ...previous, [key]: value }));
    setError("");
    setBusy(false);
  };
  const changed =
    result && JSON.stringify(profile) !== JSON.stringify(result.profile);
  const prepare = async (event: React.FormEvent) => {
    event.preventDefault();
    const at = ++version.current;
    setBusy(true);
    setError("");
    setSignIn(false);
    try {
      const saved = await api<SavedFit>(`/api/reports/${market.id}/fit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (at === version.current) {
        setProfile(saved.profile);
        onResult(saved);
      }
    } catch (e) {
      if (at === version.current) {
        setSignIn((e as any).status === 401);
        setError(text((e as Error).message, locale));
      }
    } finally {
      if (at === version.current) setBusy(false);
    }
  };
  const original = async () => {
    version.current++;
    setBusy(false);
    try {
      await api(`/api/reports/${market.id}/fit`, { method: "DELETE" });
      onResult(null);
      setError("");
    } catch (e) {
      setError(text((e as Error).message, locale));
    }
  };
  const download = () => {
    if (!result) return;
    const reportUrl = new URL(
      appUrl(`/report/${market.id}?lang=${locale}`),
      location.origin,
    ).href;
    const url = URL.createObjectURL(
      new Blob([fitMarkdown(result, market, locale, reportUrl)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghtrends-${market.id}-directions-${locale}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="personal-fit">
      <button
        type="button"
        className="fit-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="personal-fit-form"
      >
        <SlidersHorizontal size={17} />
        {l("Find the directions that fit you", "按我的情况筛选")}
        <span>{l("Free", "免费")}</span>
      </button>
      {open && (
        <form id="personal-fit-form" className="fit-form" onSubmit={prepare}>
          <p>
            {l(
              "Use your experience, time and goal to compare these directions. Your preferences stay private.",
              "结合你的经验、时间与目标比较这些方向。个人条件仅自己可见。",
            )}
          </p>
          <div className="fit-fields">
            {(["skill", "time", "goal"] as const).map((key, i) => (
              <label key={key}>
                <span>
                  {
                    (locale === "zh"
                      ? ["我更擅长", "可投入时间", "优先目标"]
                      : ["My experience", "Time available", "My priority"])[i]
                  }
                </span>
                <select
                  required
                  value={profile[key]}
                  onChange={(e) => edit(key, e.target.value)}
                >
                  <option value="">{l("Choose one", "请选择")}</option>
                  {profileOptions[key].map((option) => (
                    <option key={option[0]} value={option[0]}>
                      {option[locale === "zh" ? 2 : 1]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="fit-context">
            <span>{l("Useful context · optional", "补充一点背景 · 选填")}</span>
            <input
              maxLength={160}
              value={profile.context}
              placeholder={l(
                "For example: I know two repair shop owners",
                "例如：我熟悉两家手机维修店的店主",
              )}
              onChange={(e) => edit("context", e.target.value)}
            />
          </label>
          <div className="fit-actions">
            <small>
              {l(
                "0 research credits · Saved for 30 days · Export available",
                "消耗 0 次研究额度 · 筛选建议保留 30 天，可导出",
              )}
            </small>
            <button className="button" disabled={busy} type="submit">
              {busy
                ? l("Comparing your options…", "正在比较适合你的方向…")
                : l("Apply my situation", "按这些条件排序")}
              {busy ? <BusyMark /> : <ArrowRight size={15} />}
            </button>
          </div>
          {busy && (
            <p className="fit-progress" role="status">
              {l(
                "Checking skills, a first step within your time, and your goal.",
                "正在核对经验匹配、这段时间可完成的第一步，以及目标契合度。",
              )}
            </p>
          )}
          {changed && !busy && (
            <p className="fit-progress">
              {l(
                "Apply the updated conditions to refresh the order below.",
                "点击排序，更新下方建议。当前仍显示上一组条件的结果。",
              )}
            </p>
          )}
          {error && (
            <p className="fit-error" role="alert">
              {signIn ? (
                <a
                  href={appUrl(
                    `/auth/login?returnTo=${encodeURIComponent(appUrl(`/report/${market.id}?lang=${locale}`))}`,
                  )}
                >
                  {l(
                    "Sign in to save your personal recommendations",
                    "登录后保存个人方向建议",
                  )}
                </a>
              ) : (
                error
              )}
            </p>
          )}
        </form>
      )}
      {result && (
        <div className="fit-summary" role="status">
          <span>{profileText(result.profile, locale)}</span>
          <p>{result.summary[locale]}</p>
          <div className="fit-result-actions">
            <button type="button" onClick={original}>
              {l("View the report's original order", "查看报告原排序")}
            </button>
            <button type="button" onClick={download}>
              <Download size={14} />
              {l("Export these recommendations", "导出筛选建议")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FitReason({
  result,
  directionId,
  locale,
}: {
  result: SavedFit;
  directionId: string;
  locale: "en" | "zh";
}) {
  const direction = result.directions.find((d) => d.id === directionId);
  if (!direction) return null;
  const zh = locale === "zh";
  return (
    <div className="fit-reasons">
      <h5>
        {zh ? "与你的情况怎么匹配" : "How this fits your situation"}
        <span>{fitLabel(direction.fit, locale)}</span>
      </h5>
      <dl>
        {(["skill", "time", "goal"] as const).map((key, i) => (
          <div key={key}>
            <dt>
              {
                (zh
                  ? ["经验", "时间", "目标"]
                  : ["Experience", "Time", "Goal"])[i]
              }
            </dt>
            <dd>{direction.reasons[key][locale]}</dd>
          </div>
        ))}
      </dl>
      <p>
        <strong>{zh ? "按你的条件，先做这一步" : "Your first step"}</strong>
        {direction.firstStep[locale]}
      </p>
      <small>
        {zh
          ? "基于现有报告与个人条件的研究判断。需求、竞争与来源以原报告为准。"
          : "Research judgment based on this report and your profile. Demand, competition and sources retain the report's original scope."}
      </small>
    </div>
  );
}
