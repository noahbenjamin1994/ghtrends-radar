import type { Market } from "../core/types.js";
import type { Locale } from "../core/i18n.js";
import { text } from "../core/i18n.js";
import { marketAssessment } from "../core/assessment.js";
import {
  visibleOpportunities,
  opportunityLabel,
} from "../core/opportunities.js";
import { visibleStrategy } from "../core/strategy.js";
import { completeWeeklySeries } from "../core/evidence.js";
import QRCode from "qrcode";

export type PosterFormat = "portrait" | "long";
const ink = "#183d34",
  muted = "#65726a",
  paper = "#f7f5ef";
const font = '"Archivo Variable", "PingFang SC", "Microsoft YaHei", sans-serif';

/** Measured text layout keeps both Chinese prose and long Latin words inside the image. */
export function wrapPosterText(
  value: string,
  width: number,
  measure: (s: string) => number,
) {
  const lines: string[] = [];
  for (const paragraph of value.split(/\n/)) {
    let line = "";
    const tokens =
      paragraph.match(
        /[\p{Script=Latin}\d]+(?:['’-][\p{Script=Latin}\d]+)*|[^\p{Script=Latin}\d]/gu,
      ) || [];
    for (const token of tokens) {
      for (const part of measure(token) > width ? [...token] : [token]) {
        if (line && measure(line + part) > width) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += line ? part : part.trimStart();
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  return lines;
}

export async function renderReportPoster(
  m: Market,
  locale: Locale,
  format: PosterFormat,
  publicUrl?: string,
): Promise<Blob> {
  await document.fonts.ready;
  const zh = locale === "zh",
    l = (en: string, cn: string) => (zh ? cn : en);
  const a = marketAssessment(m, locale),
    map = visibleOpportunities(m.brief);
  const preferred = map?.opportunities.find((o) => o.id === map.recommendedId);
  const strategy = visibleStrategy(m.brief, locale);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error(
      l(
        "Image export is not supported in this browser.",
        "当前浏览器无法生成图片，请更换浏览器重试。",
      ),
    );
  const draw: Array<() => void> = [];
  let y = 76;
  const write = (
    value: string,
    size = 30,
    color = ink,
    weight = 400,
    x = 76,
    width = 928,
    lineHeight = 1.6,
  ) => {
    ctx.font = `${weight} ${size}px ${font}`;
    const lines = wrapPosterText(value, width, (s) => ctx.measureText(s).width),
      top = y;
    draw.push(() => {
      ctx.fillStyle = color;
      ctx.font = `${weight} ${size}px ${font}`;
      ctx.textBaseline = "top";
      lines.forEach((line, i) =>
        ctx.fillText(line, x, top + i * size * lineHeight),
      );
    });
    y += lines.length * size * lineHeight;
  };
  const rule = () => {
    const top = y;
    draw.push(() => {
      ctx.fillStyle = "#d7ddd3";
      ctx.fillRect(76, top, 928, 1);
    });
    y += 32;
  };
  const section = (label: string) => {
    y += 34;
    rule();
    write(label, 21, muted, 600);
    y += 22;
  };
  write("ghtrends  /  FIELD NOTES", 23, ink, 700);
  y += 38;
  write(l("OPPORTUNITY RESEARCH", "一份关于机会的研究"), 22, muted, 500);
  y += 15;
  write(
    zh && m.topic.plan && m.topic.plan.input !== m.topic.slug
      ? m.topic.plan.input
      : text(m.topic.name, locale),
    66,
    ink,
    650,
    76,
    928,
    1.22,
  );
  y += 26;
  write(
    `${m.asOf.slice(0, 10)}   ·   ${m.geo || l("Worldwide", "全球")}   ·   ${text(m.confidence, locale)} ${l("evidence confidence", "证据置信度")}`,
    21,
    muted,
  );
  y += 35;
  rule();
  write(
    a.narrative.kind === "ai" ? a.narrative.headline || a.title : a.title,
    38,
    ink,
    600,
    76,
    928,
    1.4,
  );
  y += 24;
  write(
    a.narrative.kind === "ai" ? a.narrative.summary : a.summary,
    30,
    "#465c50",
  );
  y += 30;
  write(`${a.basisLabel}  ·  ${a.landscape}`, 24, ink, 600);
  write(a.reason, 24, muted);
  if (format === "long") {
    const points = completeWeeklySeries(m.demand, m.asOf).points.slice(-26);
    section(l("01 / THE SIGNAL", "01 / 看见趋势"));
    const growth =
      a.searchReady && m.metrics.growth !== null
        ? `${m.metrics.growth >= 0 ? "+" : ""}${Math.round(m.metrics.growth * 100)}%`
        : l("Pending", "待补充");
    write(
      `${l("Search change", "搜索变化")}   ${m.metrics.emerging ? l("Low-base rise", "低基数增长") : growth}`,
      42,
      ink,
      600,
    );
    write(
      l(
        "Last 8 complete weeks vs previous 8 · Google Trends",
        "最近 8 个完整周与之前 8 周比较 · Google Trends",
      ),
      22,
      muted,
    );
    if (points.length >= 2) {
      const top = y + 30;
      draw.push(() => {
        ctx.strokeStyle = "#dae1d8";
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(76, top + i * 80);
          ctx.lineTo(1004, top + i * 80);
          ctx.stroke();
        }
        ctx.strokeStyle = "#377d65";
        ctx.lineWidth = 4;
        ctx.lineJoin = "round";
        ctx.beginPath();
        points.forEach((p, i) => {
          const x = 76 + (i * 928) / (points.length - 1),
            v = top + 160 - p.value * 1.6;
          i ? ctx.lineTo(x, v) : ctx.moveTo(x, v);
        });
        ctx.stroke();
      });
      y = top + 190;
      write(
        l(
          "Weekly relative search interest · 0–100",
          "每周相对搜索热度 · 0–100",
        ),
        21,
        muted,
      );
    }
    if (map) {
      section(l("02 / POSSIBLE DIRECTIONS", "02 / 几条值得探索的路"));
      const directions = [...map.opportunities].sort(
        (x, z) =>
          Number(z.id === map.recommendedId) -
          Number(x.id === map.recommendedId),
      );
      for (const [i, o] of directions.entries()) {
        if (i) {
          y += 24;
          rule();
        }
        write(
          `${String(i + 1).padStart(2, "0")}  ${o[locale].title}`,
          34,
          ink,
          600,
        );
        write(
          `${o.id === map.recommendedId ? l("First to explore · ", "建议优先 · ") : ""}${l("Resources: ", "资源投入：")}${opportunityLabel("effort", o.effort, locale)}`,
          22,
          muted,
        );
        y += 12;
        write(o[locale].need || o[locale].audience, 28, "#465c50");
        y += 10;
        write(`${l("First step: ", "切入点：")}${o[locale].wedge}`, 28, ink);
      }
    }
    if (preferred || strategy) {
      section(l("03 / THE FIRST EXPERIMENT", "03 / 用一次实验，决定下一步"));
      write(preferred?.[locale].experiment || strategy!.experiment, 29, ink);
      const success =
        preferred?.[locale].successSignal || strategy?.successSignal;
      if (success) {
        y += 18;
        write(l("Continue when", "建议继续的信号"), 23, muted, 600);
        write(success, 28);
      }
    }
    section(l("RESEARCH BOUNDARIES", "研究边界"));
    write(
      map?.overview?.[locale].scope ||
        a.scopeNotes.map((n) => text(n, locale)).join(" "),
      24,
      muted,
    );
    const sources = (m.brief?.sources || []).filter((s) =>
      /^https?:\/\//.test(s.url),
    );
    if (sources.length) {
      y += 20;
      write(l("Selected source publishers", "部分来源"), 22, muted, 600);
      write(
        [
          ...new Set(
            sources.map((s) => {
              try {
                return new URL(s.url).hostname.replace(/^www\./, "");
              } catch {
                return "";
              }
            }),
          ),
        ]
          .filter(Boolean)
          .slice(0, 6)
          .join("  ·  "),
        23,
        muted,
      );
    }
  } else if (preferred) {
    section(l("A DIRECTION TO EXPLORE", "一个值得探索的切入点"));
    write(preferred[locale].title, 34, ink, 600);
    y += 12;
    write(preferred[locale].wedge, 28, "#465c50");
    y += 20;
    write(
      l(
        "Research hypothesis · validate before committing",
        "研究假设 · 经验证后再决定投入",
      ),
      23,
      muted,
    );
  }
  y += 36;
  rule();
  const footerTop = y;
  write(
    publicUrl
      ? l("Keep exploring.", "把好问题，带到下一步。")
      : l("Saved for you.", "留给下一次思考。"),
    32,
    ink,
    600,
    76,
    publicUrl ? 640 : 928,
  );
  y += 15;
  write(
    publicUrl
      ? l(
          "Scan for the full report and its sources.",
          "扫码阅读完整报告与来源证据",
        )
      : l(
          "Private report · personal copy · no public link",
          "私有报告 · 个人留存 · 未生成公开链接",
        ),
    23,
    muted,
    400,
    76,
    publicUrl ? 640 : 928,
  );
  y += 18;
  write("ghtrends.dev", 23, ink, 600);
  if (publicUrl) {
    const qr = document.createElement("canvas");
    await QRCode.toCanvas(qr, publicUrl, {
      errorCorrectionLevel: "M",
      margin: 4,
      scale: 6,
      color: { dark: "#183d34", light: "#ffffff" },
    });
    draw.push(() => {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qr, 808, footerTop, 196, 196);
    });
    y = Math.max(y, footerTop + 196);
  }
  y += 30;
  write(
    l(
      "RESEARCH HIGHLIGHTS · The full report preserves evidence and qualifications.",
      "研究精华节选 · 完整报告保留证据、条件与推断边界。",
    ),
    19,
    muted,
  );
  const height = Math.ceil(y + 64);
  // Stay below conservative mobile canvas pixel limits without truncating content.
  const scale = Math.min(
    1,
    Math.sqrt(14_000_000 / (1080 * height)),
    16000 / height,
  );
  canvas.width = Math.floor(1080 * scale);
  canvas.height = Math.ceil(height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 1080, height);
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 1080, 12);
  draw.forEach((f) => f());
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(
              new Error(
                l(
                  "Image export failed. Please try again.",
                  "图片生成失败，请重试。",
                ),
              ),
            ),
      "image/png",
    ),
  );
}
