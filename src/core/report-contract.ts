import { z } from "zod";
import type { ResearchSource } from "./types.js";

export const REPORT_VERSION = "single-3";
/** Whole-report deadline. Reading originals and one write need a few minutes. */
export const REPORT_DEADLINE_MS =
  Math.max(30, Number(process.env.GHTRENDS_REPORT_SECONDS) || 180) * 1000;
const bilingual = z.object({
  en: z.string().trim().min(2).max(500),
  zh: z.string().trim().min(2).max(500),
});
const reference = z.object({
  id: z.string().max(12),
  quote: z.string().trim().min(8).max(280),
});
const evidence = z.array(reference).max(3);
const finding = z.object({
  status: z.enum(["observed", "limited", "missing"]),
  summary: bilingual,
  evidence,
});
export const reportContentSchema = z.object({
  headline: bilingual,
  overview: bilingual,
  demandTrend: finding,
  commercialSupply: finding,
  openSourceSupply: finding,
  userNeeds: finding,
  directions: z
    .array(
      z.object({
        title: bilingual,
        task: bilingual,
        existingSupply: bilingual,
        entry: bilingual,
        uncertainty: bilingual,
        evidence: z.array(reference).min(1).max(3),
      }),
    )
    .max(3),
  nextStep: bilingual,
  limitations: z.array(bilingual).min(1).max(4),
});
export type ReportContent = z.infer<typeof reportContentSchema>;
/** The model selects immutable original text instead of transcribing quotations. */
export function reportCitations(sources: ResearchSource[]) {
  const citations: Record<string, { id: string; quote: string }> = {};
  for (const source of sources) {
    if (!source.id || !source.excerpt) continue;
    let index = 0;
    for (const paragraph of source.excerpt.split(/\n+|(?<=[.!?。！？])\s+/u)) {
      let rest = paragraph.trim();
      while (rest.length >= 8) {
        let end = Math.min(260, rest.length);
        if (end < rest.length) {
          const space = rest.lastIndexOf(" ", end);
          if (space >= 80) end = space;
        }
        const quote = rest.slice(0, end).trim();
        citations[`${source.id}Q${++index}`] = { id: source.id, quote };
        rest = rest.slice(end).trim();
      }
    }
  }
  return citations;
}

export const reportSections = [
  ["demandTrend", "Search demand", "需求趋势"],
  ["commercialSupply", "Commercial supply", "商业供给"],
  ["openSourceSupply", "Open-source supply", "开源供给"],
  ["userNeeds", "User needs", "用户需求"],
] as const;

/** Check citations locally, without a repair/review model call. */
export function parseReport(
  raw: unknown,
  sources: ResearchSource[],
): ReportContent {
  const value = reportContentSchema.parse(raw);
  const groups = [
    ...reportSections.map(([key]) => value[key]),
    ...value.directions,
  ];
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  for (const group of groups) {
    if (
      "status" in group &&
      group.status === "observed" &&
      !group.evidence.length
    )
      throw new Error("Observed finding requires source evidence.");
    for (const ref of group.evidence) {
      const source = sources.find((s) => s.id === ref.id);
      if (
        !source?.excerpt ||
        !normalize(source.excerpt).includes(normalize(ref.quote))
      )
        throw new Error("Report citation does not match the collected source.");
    }
  }
  return value;
}
