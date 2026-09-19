import { z } from "zod";

export const feedbackLabels = {
  helpful: ["Useful insight", "有帮助"],
  specific: ["More detail, please", "希望更具体"],
  chosen: ["Chose a direction", "选定了方向"],
  adjusted: ["Changed my plan", "调整了方案"],
  tested: ["Ran a validation", "做过了验证"],
} as const;
export type FeedbackStatus = keyof typeof feedbackLabels;
export const feedbackTargetSchema = z.object({
  kind: z.enum(["report", "deep"]),
  id: z.string().regex(/^[a-f0-9]{16}$/),
});
export type FeedbackKind = z.infer<typeof feedbackTargetSchema>["kind"];
export const feedbackInputSchema = z
  .object({
    status: z.enum(["helpful", "specific", "chosen", "adjusted", "tested"]),
    note: z
      .string()
      .trim()
      .max(500)
      .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/)
      .default(""),
  })
  .strict();
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;
export type ResearchFeedback = FeedbackInput & {
  kind: FeedbackKind;
  targetId: string;
  method: string;
  created: string;
  updated: string;
  statusAt: string;
};
export type FeedbackOverview = {
  since: string;
  users: number;
  responses: number;
  decisionUsers: number;
  internalResponses: number;
  statuses: { status: FeedbackStatus; users: number; responses: number }[];
  recent: ResearchFeedback[];
};
