import { Skeleton } from "../ui/loading.js";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Download, Trash2 } from "lucide-react";
import {
  feedbackLabels,
  type FeedbackStatus,
  type FeedbackKind,
  type ResearchFeedback as SavedFeedback,
} from "../core/feedback.js";
import type { Account } from "./account.js";
import { api } from "./api.js";
import { appUrl } from "./paths.js";
import { locale, loginUrl, localUrl } from "./i18n.js";
import "./feedback.css";

const l = (en: string, zh: string) => (locale === "zh" ? zh : en);
const label = (status: FeedbackStatus) =>
  feedbackLabels[status][locale === "zh" ? 1 : 0];
const endpoint = (kind: FeedbackKind, id: string) =>
  `/api/feedback/${kind}/${id}?lang=${locale}`;

export function ResearchFeedback({
  kind,
  id,
  account,
}: {
  kind: FeedbackKind;
  id: string;
  account: Account | null;
}) {
  const name = useId();
  const generation = useRef(0);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<SavedFeedback | null>(null),
    [status, setStatus] = useState<FeedbackStatus | "">(""),
    [note, setNote] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    setReady(false);
    setBusy(false);
    setSaved(null);
    setStatus("");
    setNote("");
    setError("");
    setMessage("");
    setLoading(true);
    if (account?.user)
      void api<SavedFeedback | null>(endpoint(kind, id), {
        signal: controller.signal,
      })
        .then((value) => {
          if (controller.signal.aborted) return;
          setReady(true);
          setSaved(value);
          setStatus(value?.status || "");
          setNote(value?.note || "");
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError(
              l(
                "Open your saved feedback again to continue.",
                "请重新读取已保存的反馈后继续。",
              ),
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [kind, id, account?.csrf, !!account?.user, reload]);
  const save = async (remove = false) => {
    if (!ready || (!remove && !status)) return;
    const at = generation.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await api<SavedFeedback | null>(endpoint(kind, id), {
        method: remove ? "DELETE" : "POST",
        ...(!remove
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status, note }),
            }
          : {}),
      });
      if (at !== generation.current) return;
      setSaved(remove ? null : value);
      setStatus(remove ? "" : value!.status);
      setNote(remove ? "" : value!.note);
      setMessage(
        remove
          ? l("Feedback deleted.", "反馈已删除。")
          : l(
              "Saved. You can update this as your project progresses.",
              "已保存，项目有进展时可随时更新。",
            ),
      );
    } catch (error) {
      if (at !== generation.current) return;
      setError(
        (error as Error).message ===
          "Manage your saved feedback in Account before adding another."
          ? l(
              "Open Account and remove an older response before saving this one.",
              "请到账户页清理部分反馈，再保存这条记录。",
            )
          : [401, 403].includes((error as { status?: number }).status || 0)
            ? l(
                "Sign in again to continue. Your previously saved feedback remains available.",
                "请重新登录后继续，已保存的反馈仍可查阅。",
              )
            : l(
                "Your draft is here. Try saving again shortly.",
                "填写内容已保留，请稍后重试保存。",
              ),
      );
    } finally {
      if (at === generation.current) setBusy(false);
    }
  };
  if (!account || (!account.user && !account.authAvailable)) return null;
  return (
    <section className="research-feedback" aria-labelledby={`${name}-title`}>
      <div className="feedback-heading">
        <div>
          <p className="eyebrow">{l("YOUR NEXT STEP", "你的下一步")}</p>
          <h2 id={`${name}-title`}>
            {l(
              "What did this research help you do?",
              "这份研究帮你推进了哪一步？",
            )}
          </h2>
        </div>
        <span>{l("A quick check-in", "留下一点进展")}</span>
      </div>
      {!account.user ? (
        <a
          className="text-link"
          href={loginUrl(`/${kind === "deep" ? "research" : "report"}/${id}`)}
        >
          {l("Sign in to save your feedback", "登录后保存你的反馈")} →
        </a>
      ) : loading ? (
        <Skeleton variant="compact" text={l("Reading your saved feedback…", "正在读取已保存的反馈…")} />
      ) : !ready ? (
        <p role="alert">
          {error}{" "}
          <button className="text-link" onClick={() => setReload((x) => x + 1)}>
            {l("Reload saved feedback", "重新读取反馈")}
          </button>
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <legend>
              {l(
                "Choose what best describes your progress",
                "选择最接近当前进展的一项",
              )}
            </legend>
            <div className="feedback-options">
              {(Object.keys(feedbackLabels) as FeedbackStatus[]).map(
                (value) => (
                  <label
                    key={value}
                    className={status === value ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name={name}
                      value={value}
                      checked={status === value}
                      onChange={() => {
                        setStatus(value);
                        setMessage("");
                      }}
                    />
                    <span>{label(value)}</span>
                    {status === value && <Check size={14} aria-hidden="true" />}
                  </label>
                ),
              )}
            </div>
            <label className="feedback-note-label" htmlFor={`${name}-note`}>
              {l(
                "What changed, or what would help?",
                "具体改变了什么，或希望补充什么？",
              )}{" "}
              <span>{l("Optional", "选填")}</span>
            </label>
            <textarea
              id={`${name}-note`}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setMessage("");
              }}
              placeholder={l(
                "For example: I chose a plugin over a standalone app after comparing the existing tools.",
                "例如：对比现有工具后，我决定先做插件；还想了解第一批用户在哪里。",
              )}
            />
            <p className="feedback-privacy">
              {l(
                "Visible to you and this site's administrators. Saved until you delete it; report sharing keeps your feedback private.",
                "仅你与本站管理员可见，保存至你主动删除；分享报告时，反馈仍保持私有。",
              )}
            </p>
            <div className="feedback-controls">
              <button
                className="button"
                type="submit"
                disabled={
                  !status ||
                  (status === saved?.status && note.trim() === saved.note)
                }
              >
                {busy
                  ? l("Saving…", "正在保存…")
                  : saved
                    ? l("Update feedback", "更新反馈")
                    : l("Save feedback", "保存反馈")}
              </button>
              {saved && (
                <button
                  className="text-link"
                  type="button"
                  onClick={() => void save(true)}
                >
                  {l("Delete feedback", "删除反馈")}
                </button>
              )}
              <span role="status">{message}</span>
            </div>
          </fieldset>
          {error && (
            <p className="feedback-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

export function MyFeedback({ account }: { account: Account | null }) {
  const [rows, setRows] = useState<SavedFeedback[]>([]),
    [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(0);
  const pageIndex = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 20) - 1),
  );
  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    setBusy("");
    setLoading(true);
    setRows([]);
    setPage(0);
    setError("");
    if (account?.user)
      void api<SavedFeedback[]>("/api/account/feedback", {
        signal: controller.signal,
      })
        .then((value) => {
          if (!controller.signal.aborted) setRows(value);
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setError(
              l("Load your feedback again shortly.", "请稍后重新读取反馈。"),
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [account?.csrf, !!account?.user, reload]);
  if (!account?.user) return null;
  return (
    <section className="research-feedback feedback-history">
      <div className="feedback-heading">
        <h2>{l("Your feedback", "我的反馈")}</h2>
        {rows.length > 0 && (
          <a
            className="text-link"
            href={appUrl("/api/account/feedback?format=json")}
          >
            <Download size={15} />
            {l("Export JSON", "导出 JSON")}
          </a>
        )}
      </div>
      <p className="feedback-privacy">
        {l(
          "Your saved responses and notes. You can remove each one here, including feedback on an older report.",
          "这里保存你提交的选择与说明，可逐条删除，也可从原报告修改。",
        )}
      </p>
      {rows.slice(pageIndex * 20, (pageIndex + 1) * 20).map((row) => (
        <article key={row.kind + row.targetId}>
          <div>
            <strong>{label(row.status)}</strong>
            <small>
              {new Date(row.updated).toLocaleDateString(
                locale === "zh" ? "zh-CN" : "en-US",
              )}
            </small>
            {row.note && <p>{row.note}</p>}
            <a
              className="text-link"
              href={localUrl(
                `/${row.kind === "deep" ? "research" : "report"}/${row.targetId}`,
              )}
            >
              {l("Open research", "打开研究")} ↗
            </a>
          </div>
          <button
            className="text-link"
            disabled={!!busy}
            aria-label={`${l("Delete feedback", "删除反馈")} · ${label(row.status)}`}
            onClick={async () => {
              const at = generation.current;
              setBusy(row.targetId);
              setError("");
              try {
                await api(endpoint(row.kind, row.targetId), {
                  method: "DELETE",
                });
                if (at !== generation.current) return;
                setRows((all) =>
                  all.filter(
                    (x) => x.kind !== row.kind || x.targetId !== row.targetId,
                  ),
                );
              } catch {
                if (at !== generation.current) return;
                setError(
                  l(
                    "Try deleting the feedback again shortly.",
                    "请稍后重试删除反馈。",
                  ),
                );
              } finally {
                if (at === generation.current) setBusy("");
              }
            }}
          >
            <Trash2 size={16} />
          </button>
        </article>
      ))}
      {loading && (
        <Skeleton variant="compact" text={l("Reading your feedback…", "正在读取你的反馈…")} />
      )}
      {!loading && rows.length === 0 && !error && (
        <p>
          {l(
            "Leave a response at the end of a report to start your record.",
            "在报告底部留下一条反馈，就能在这里查看。",
          )}
        </p>
      )}
      {rows.length > 20 && (
        <div className="feedback-controls">
          <button
            className="text-link"
            disabled={pageIndex === 0}
            onClick={() => setPage(pageIndex - 1)}
          >
            {l("Previous", "上一页")}
          </button>
          <span>
            {pageIndex * 20 + 1}–{Math.min((pageIndex + 1) * 20, rows.length)} /{" "}
            {rows.length}
          </span>
          <button
            className="text-link"
            disabled={(pageIndex + 1) * 20 >= rows.length}
            onClick={() => setPage(pageIndex + 1)}
          >
            {l("Next", "下一页")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="text-link" onClick={() => setReload((x) => x + 1)}>
            {l("Retry", "重试")}
          </button>
        </p>
      )}
    </section>
  );
}
