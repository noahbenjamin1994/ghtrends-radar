// Public progress contains task labels and counters, never model prompts or reasoning text.
export interface ResearchActivity {
  id: string;
  operation: string;
  state: "waiting" | "thinking" | "writing" | "complete" | "retrying";
  started: number;
  updated: number;
}
export function mergeActivity(
  items: ResearchActivity[] = [],
  next: ResearchActivity,
) {
  return [...items.filter((item) => item.id !== next.id), next]
    .sort((a, b) => a.started - b.started)
    .slice(-40);
}
export function activityLabel(operation: string, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    plan: ["Understanding your topic", "理解研究主题"],
    "web-relevance": [
      "Checking search result relevance",
      "核对搜索结果与研究主题",
    ],
    relevance: ["Checking relevant projects", "筛选相关项目"],
    "capability-audit": [
      "Checking existing product capabilities",
      "核对同行已有功能",
    ],
    strategy: ["Exploring possible directions", "梳理可探索的方向"],
    "strategy-portfolio-review": [
      "Checking alternative opportunities",
      "复核候选机会与取舍",
    ],
    "strategy-direction": [
      "Comparing a direction's demand and resources",
      "分析方向的需求与投入",
    ],
    "strategy-priority": ["Choosing a starting point", "比较优先切入点"],
    "strategy-overall": [
      "Assessing the market and competitors",
      "分析市场与竞争对手",
    ],
    "strategy-pilot": ["Designing the first validation", "设计首个验证步骤"],
    "issue-reading": ["Reading what users ask for", "解读用户的具体需求"],
    "strategy-evidence-review": [
      "Checking conclusions against evidence",
      "逐项核对结论与证据",
    ],
    "strategy-deep-plan": ["Choosing focused searches", "整理专项查询词"],
    "strategy-deep-write": [
      "Preparing your focused recommendation",
      "整理专项建议",
    ],
    "strategy-deep-review": [
      "Checking recommendations against sources",
      "核对专项建议与来源",
    ],
    "strategy-deep-decision-check": [
      "Checking buyer fit and decision logic",
      "核对买家、替代方案与决策逻辑",
    ],
  };
  const pair =
    labels[operation] ||
    (/copy|edit|repair|correction/.test(operation)
      ? ["Refining the report", "完善报告表述"]
      : /review/.test(operation)
        ? ["Cross-checking source evidence", "交叉核对来源与依据"]
        : ["Organizing research evidence", "整理研究资料"]);
  return pair[zh ? 1 : 0];
}
