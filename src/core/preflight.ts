import type { Topic } from "./types.js";

export interface InputGuidance {
  status: "guide" | "clarify";
  message: { en: string; zh: string };
  choices: { label: string; query: string }[];
}
export interface ResearchScope {
  status: "ready";
  id: string;
  input: string;
  keyword?: string;
  geo: string;
  topic: Topic;
  fallback: boolean;
}
export type PreflightResult = InputGuidance | ResearchScope;

export const inputGuidance: InputGuidance = {
  status: "guide",
  message: {
    en: "Add a product, industry or user problem, such as inventory management for small shops.",
    zh: "补充一个产品、行业或用户问题，例如“小店库存管理”。",
  },
  choices: [],
};

/** Only exact conversational or placeholder inputs are handled locally.
 * Familiar numeric brands and unusual ideas continue to semantic planning. */
export function inspectInput(input: string): InputGuidance | null {
  const text = input.normalize("NFKC").trim();
  const phrase = text.toLowerCase().replace(/[!！?？。.,，\s]+$/u, "");
  if (
    /^(你好|您好|嗨|哈喽|在吗|早上好|晚上好|hello|hi|hey|good morning|good evening)$/u.test(
      phrase,
    )
  )
    return {
      ...inputGuidance,
      message: {
        en: "Hello! Tell me a product, industry or user problem you would like to research.",
        zh: "你好！告诉我一个想研究的产品、行业或用户问题。",
      },
    };
  if (
    !phrase ||
    /^(123|1234|12345|123456|123456789|asdf|asdfgh|qwerty|测试一下|随便测试|test test)$/u.test(
      phrase,
    ) ||
    (!/^(vvvv)$/u.test(phrase) && /^(.)\1{3,}$/u.test(phrase)) ||
    !/[\p{L}\p{N}]/u.test(phrase)
  )
    return inputGuidance;
  const meanings: Record<string, InputGuidance["choices"]> = {
    "harness engineering": [
      {
        label: "AI agent harness / AI 智能体运行框架",
        query: "AI agent harness",
      },
      {
        label: "Software test harness / 软件测试脚手架",
        query: "software test harness",
      },
      {
        label: "Wiring harness design / 线束设计",
        query: "wiring harness design",
      },
    ],
    rsi: [
      {
        label: "Recursive self-improvement / 递归自改进",
        query: "recursive self improvement",
      },
      {
        label: "Relative strength index / 相对强弱指数",
        query: "relative strength index",
      },
      {
        label: "Repetitive strain injury / 重复性劳损",
        query: "repetitive strain injury",
      },
    ],
    apple: [
      { label: "Apple products / 苹果产品", query: "Apple products ecosystem" },
      { label: "Apple fruit / 苹果种植与消费", query: "apple fruit products" },
    ],
  };
  const key = phrase.replaceAll("-", " ");
  const choices = Object.hasOwn(meanings, key) ? meanings[key] : undefined;
  return choices
    ? {
        status: "clarify",
        message: {
          en: "This term has several meanings. Choose your research direction.",
          zh: "这个词有多个含义，请选择你想研究的方向。",
        },
        choices,
      }
    : null;
}

export function requireResearchInput(input: string) {
  const guidance = inspectInput(input);
  if (guidance)
    throw Object.assign(new Error(guidance.message.en), {
      status: 422,
      guidance,
      clarification: guidance.message,
      choices: guidance.choices,
    });
}
