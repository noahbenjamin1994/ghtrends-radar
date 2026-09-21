import { createElement as h } from "react";

export type SkeletonVariant = "report" | "list" | "compact" | "home";
const block = (name: string, key?: number) =>
  h("span", { className: `skeleton-block ${name}`, key });

/** Shared by the first HTML response and React's data-loading states. */
export function Skeleton({
  variant = "list",
  text = "Loading…",
}: {
  variant?: SkeletonVariant;
  text?: string;
}) {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, i) => block("skeleton-line", i));
  return h(
    "div",
    {
      className: `content-skeleton skeleton-${variant}`,
      role: "status",
      "aria-busy": true,
    },
    h("span", { className: "skeleton-label" }, text),
    h(
      "div",
      { "aria-hidden": true },
      variant !== "compact" &&
        h(
          "div",
          { className: "skeleton-heading" },
          block("skeleton-kicker"),
          block("skeleton-title"),
          block("skeleton-subtitle"),
        ),
      variant === "home"
        ? h(
            "div",
            { className: "skeleton-composer" },
            block("skeleton-line"),
            block("skeleton-send"),
          )
        : variant === "report"
          ? h(
              "div",
              null,
              h(
                "div",
                { className: "skeleton-tabs" },
                ...Array.from({ length: 5 }, (_, i) =>
                  block("skeleton-tab", i),
                ),
              ),
              h(
                "div",
                { className: "skeleton-panel" },
                block("skeleton-kicker"),
                block("skeleton-section-title"),
                ...lines(3),
              ),
              h(
                "div",
                { className: "skeleton-metrics" },
                ...Array.from({ length: 3 }, (_, i) =>
                  h(
                    "div",
                    { className: "skeleton-panel", key: i },
                    block("skeleton-kicker"),
                    block("skeleton-value"),
                    block("skeleton-line"),
                  ),
                ),
              ),
            )
          : variant === "compact"
            ? h("div", { className: "skeleton-copy" }, ...lines(3))
            : h(
                "div",
                { className: "skeleton-list" },
                ...Array.from({ length: 3 }, (_, i) =>
                  h(
                    "div",
                    { className: "skeleton-row", key: i },
                    block("skeleton-avatar"),
                    h("div", { className: "skeleton-copy" }, ...lines(2)),
                  ),
                ),
              ),
    ),
  );
}

export function BusyMark() {
  return h(
    "span",
    { className: "busy-mark", "aria-hidden": true },
    h("i"),
    h("i"),
    h("i"),
  );
}

export const loadingStyles = `
body{margin:0;background:#fff}
.content-skeleton{width:100%;padding:36px 0 64px;box-sizing:border-box}
.skeleton-label{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.skeleton-block{display:block;position:relative;overflow:hidden;isolation:isolate;background:#f0f1f0;border-radius:7px;max-width:100%;flex-shrink:0}
.skeleton-block::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 15%,#ffffffa8 48%,transparent 82%);transform:translateX(-100%);animation:skeleton-sweep 1.8s ease-in-out infinite}
.skeleton-heading{display:grid;gap:20px;margin:16px 0 40px}
.skeleton-kicker{width:126px;height:10px}.skeleton-title{width:440px;height:48px;border-radius:10px}.skeleton-subtitle{width:340px;height:16px}
.skeleton-line{height:12px;width:100%}.skeleton-line:last-child{width:66%}.skeleton-section-title{height:26px;width:56%;margin:20px 0 28px}
.skeleton-tabs{display:flex;gap:22px;padding:20px 0;margin-bottom:24px;border-block:1px solid #eeeeed}.skeleton-tab{width:76px;height:12px}
.skeleton-panel{padding:28px;border:1px solid #eeeeed;border-radius:18px}.skeleton-panel>.skeleton-line{margin-top:14px}
.skeleton-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:24px}.skeleton-value{width:86px;height:32px;margin-top:22px}
.skeleton-list{border-top:1px solid #eeeeed}.skeleton-row{display:flex;align-items:center;gap:20px;padding:26px 0;border-bottom:1px solid #eeeeed}.skeleton-avatar{width:40px;height:40px;border-radius:12px}.skeleton-copy{display:grid;gap:14px;flex:1}.skeleton-row .skeleton-copy{max-width:620px}
.skeleton-report{max-width:1160px;margin-inline:auto}
.skeleton-compact{padding:18px 0;width:min(100%,520px)}
.skeleton-home{max-width:760px;margin:auto;padding-top:clamp(90px,18vh,200px)}.skeleton-home .skeleton-heading{justify-items:center;margin-bottom:38px}.skeleton-composer{height:144px;border:1px solid #eeeeed;border-radius:32px;padding:24px;position:relative}.skeleton-composer>.skeleton-line{width:50%}.skeleton-send{position:absolute;right:14px;bottom:14px;width:36px;height:36px;border-radius:50%}
.busy-mark{display:inline-flex;align-items:center;justify-content:center;gap:3px;width:22px;height:22px;flex-shrink:0}.busy-mark i{width:4px;height:10px;border-radius:3px;background:currentColor;opacity:.35;animation:skeleton-breathe 1.2s ease-in-out infinite}.busy-mark i:nth-child(2){animation-delay:.15s}.busy-mark i:nth-child(3){animation-delay:.3s}
.boot-shell{max-width:1392px;margin:auto;padding:0 56px;font-family:"Archivo Variable","PingFang SC","Microsoft YaHei",sans-serif;box-sizing:border-box}.boot-header{height:88px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:24px;align-items:center}.boot-brand{justify-self:start;display:flex;align-items:center;gap:9px;color:#191919;text-decoration:none;font-size:27px;letter-spacing:-1.5px}.boot-brand svg{width:33px;height:33px}.boot-nav{display:flex;gap:32px}.boot-actions{justify-self:end;display:flex;gap:12px}.boot-actions .skeleton-block{width:64px;height:34px;border-radius:22px}.boot-shell .content-skeleton{min-height:calc(100svh - 88px)}
.boot-help{position:absolute;top:112px;right:56px;font-size:12px;color:#777;visibility:hidden;animation:boot-help-reveal 0s 12s forwards}.boot-help a{color:inherit;text-underline-offset:3px}@keyframes boot-help-reveal{to{visibility:visible}}
@keyframes skeleton-sweep{to{transform:translateX(100%)}}@keyframes skeleton-breathe{50%{opacity:.85;transform:scaleY(1.35)}}
@media(max-width:700px){.boot-shell{padding:0 20px}.boot-header{height:80px;grid-template-columns:1fr auto}.boot-nav{display:none}.boot-brand{font-size:24px}.content-skeleton{padding-top:24px}.skeleton-title{height:36px;width:80%}.skeleton-heading{gap:16px;margin-bottom:28px}.skeleton-tabs{gap:16px;overflow:hidden}.skeleton-tab{width:56px}.skeleton-panel{padding:22px}.skeleton-metrics{gap:12px}.skeleton-metrics .skeleton-panel{padding:16px}.skeleton-metrics .skeleton-kicker{width:52px}.skeleton-metrics .skeleton-value{width:48px;height:24px}.skeleton-home{padding-top:100px}.skeleton-composer{border-radius:28px}.boot-shell .content-skeleton{min-height:calc(100svh - 80px)}}
@media(prefers-reduced-motion:reduce){.skeleton-block::after,.busy-mark i{animation:none}.skeleton-block::after{display:none}}
`;
