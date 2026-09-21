import { useEffect, useRef, useState } from "react";
import {
  Download,
  Share2,
  X,
  Link,
  Globe2,
  LockKeyhole,
  Check,
} from "lucide-react";
import type { Market } from "../core/types.js";
import type { Locale } from "../core/i18n.js";
import type { PosterFormat } from "./report-poster.js";
import { Skeleton } from "../ui/loading.js";
import { track } from "./engagement.js";

export function ReportShare({
  market,
  locale,
  url,
  access,
  onVisibility,
}: {
  market: Market;
  locale: Locale;
  url: string;
  access: { public: boolean; owned: boolean } | null;
  onVisibility: (value: boolean) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false),
    [format, setFormat] = useState<PosterFormat>("portrait");
  const [poster, setPoster] = useState<{ blob: Blob; url: string } | null>(
    null,
  );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const zh = locale === "zh",
    l = (en: string, cn: string) => (zh ? cn : en);
  useEffect(() => {
    if (!open) return;
    const el = dialog.current!,
      previous = document.activeElement as HTMLElement | null;
    el.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      el.close();
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open || !access) return;
    let cancelled = false,
      objectUrl = "";
    setPoster(null);
    setError("");
    setNotice("");
    import("./report-poster.js")
      .then((m) =>
        m.renderReportPoster(
          market,
          locale,
          format,
          access.public ? url : undefined,
        ),
      )
      .then((blob) => {
        if (!cancelled) {
          objectUrl = URL.createObjectURL(blob);
          setPoster({ blob, url: objectUrl });
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, format, market, locale, access?.public, !!access, url, retry]);
  async function visibility(value: boolean) {
    setBusy(true);
    setError("");
    try {
      await onVisibility(value);
      if (value) track("share_publish");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(l("Link copied", "链接已复制"));
      track("share_copy");
    } catch {
      setError(
        l(
          "Copy the link below to share this report.",
          "请选中下方链接，手动复制分享。",
        ),
      );
    }
  }
  function save() {
    if (!poster) return;
    const a = document.createElement("a");
    a.href = poster.url;
    a.download = `ghtrends-${market.id}-${locale}-${format}.png`;
    a.click();
    setNotice(l("Image download started", "图片已开始下载"));
    track("export_png");
  }
  async function nativeShare() {
    if (!poster) return;
    const file = new File([poster.blob], `ghtrends-${market.id}.png`, {
      type: "image/png",
    });
    try {
      if (navigator.canShare?.({ files: [file] }))
        await navigator.share({
          files: [file],
          title: market.topic.plan?.input || market.topic.name,
        });
      else save();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(
          l(
            "Sharing failed. You can save the image instead.",
            "分享未完成，可以保存图片后发送。",
          ),
        );
    }
  }
  return (
    <>
      <button
        className="button report-share-trigger"
        onClick={() => setOpen(true)}
      >
        <Share2 size={15} />
        {l("Share & export", "分享与长图")}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="report-share-dialog"
          aria-labelledby="share-heading"
          onCancel={() => setOpen(false)}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="share-dialog-inner">
            <header className="share-heading">
              <div>
                <span>GHTRENDS / SHARE STUDIO</span>
                <h2 id="share-heading">
                  {l("Ideas worth passing on.", "让好想法，被更多人看见。")}
                </h2>
              </div>
              <button
                className="share-close"
                aria-label={l("Close", "关闭")}
                onClick={() => setOpen(false)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="share-workspace">
              <div className="share-preview" aria-busy={!poster && !error}>
                {poster ? (
                  <img
                    src={poster.url}
                    alt={l(
                      "Preview of the image to export",
                      "导出图片的完整预览",
                    )}
                  />
                ) : (
                  <Skeleton
                    variant="report"
                    text={l("Typesetting your image…", "正在排版图片…")}
                  />
                )}
              </div>
              <div className="share-controls">
                <div className="share-control-label">
                  {l("IMAGE FORMAT", "选择画幅")}
                </div>
                <div
                  className="share-formats"
                  role="group"
                  aria-label={l("Image format", "图片格式")}
                >
                  <button
                    aria-pressed={format === "portrait"}
                    onClick={() => setFormat("portrait")}
                  >
                    <span className="format-icon portrait" />
                    <strong>{l("Story card", "摘要海报")}</strong>
                    <small>
                      {l("The finding & a first step", "核心判断 + 优先切入点")}
                    </small>
                  </button>
                  <button
                    aria-pressed={format === "long"}
                    onClick={() => setFormat("long")}
                  >
                    <span className="format-icon long" />
                    <strong>{l("Research scroll", "研究长图")}</strong>
                    <small>
                      {l(
                        "Signals, directions & experiment",
                        "趋势 + 各方向 + 验证建议",
                      )}
                    </small>
                  </button>
                </div>
                <p className="share-caption">
                  {l(
                    "A carefully typeset selection. Full sources and details remain in the report.",
                    "重新排版的研究精华。完整来源和详细论证保留在原报告中。",
                  )}
                </p>
                <div className="share-visibility">
                  <strong>
                    {access?.public ? (
                      <Globe2 size={16} />
                    ) : (
                      <LockKeyhole size={16} />
                    )}{" "}
                    {access?.public
                      ? l("Public report", "公开报告")
                      : l("Private report", "私有报告")}
                  </strong>
                  <p>
                    {access?.public
                      ? l(
                          "Anyone can read the full report via the link or QR code. Making it private closes the link; downloaded images remain.",
                          "图片已附二维码，任何人都能扫码阅读完整报告。关闭公开分享后链接停止开放，已保存的图片仍会保留。",
                        )
                      : l(
                          "Saving an image keeps the report private. Publish it to add a QR code others can open.",
                          "保存图片不会公开报告。公开后，图片会添加他人可访问的报告二维码。",
                        )}
                  </p>
                  {access?.owned && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => void visibility(!access.public)}
                    >
                      {busy
                        ? l("Updating…", "正在更新…")
                        : access.public
                          ? l("Make report private", "关闭公开分享")
                          : l(
                              "Publish report & add QR code",
                              "公开完整报告并添加二维码",
                            )}
                    </button>
                  )}
                  {!access && (
                    <p>
                      {l("Checking sharing permissions…", "正在核对分享权限…")}
                    </p>
                  )}
                  {access?.public && (
                    <div className="share-link">
                      <input
                        aria-label={l("Public report link", "公开报告链接")}
                        readOnly
                        value={url}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        onClick={() => void copy()}
                        aria-label={l("Copy link", "复制链接")}
                      >
                        <Link size={17} />
                      </button>
                    </div>
                  )}
                </div>
                {error && (
                  <div className="share-error" role="alert">
                    {error}{" "}
                    {!poster && (
                      <button onClick={() => setRetry((n) => n + 1)}>
                        {l("Retry", "重试")}
                      </button>
                    )}
                  </div>
                )}
                <div className="share-downloads">
                  <button
                    className="button"
                    disabled={!poster || busy}
                    onClick={save}
                  >
                    <Download size={16} />
                    {l("Save PNG", "保存高清 PNG")}
                  </button>
                  {typeof navigator.share === "function" && (
                    <button
                      className="button subtle"
                      disabled={!poster || busy}
                      onClick={() => void nativeShare()}
                    >
                      <Share2 size={16} />
                      {l("Send image", "发送图片")}
                    </button>
                  )}
                </div>
                <p className="share-status" role="status">
                  {notice && (
                    <>
                      <Check size={14} />
                      {notice}
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
