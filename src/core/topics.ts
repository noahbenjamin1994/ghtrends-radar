import type { Topic } from "./types.js";
export const TOPICS: Topic[] = [
  {
    slug: "mcp-servers",
    name: "MCP servers",
    keyword: "mcp servers",
    query: "topic:mcp-server",
    description: "The tools connecting AI agents to the real world.",
    color: "#bcf85e",
    aliases: ["mcp", "mcp-server", "model context protocol"],
  },
  {
    slug: "coding-agents",
    name: "Coding agents",
    keyword: "coding agent",
    query: "topic:coding-agent",
    description: "Agents that navigate, write and ship code.",
    color: "#79c9ff",
    aliases: ["coding-agent", "ai coding", "code agent"],
  },
  {
    slug: "browser-agents",
    name: "Browser agents",
    keyword: "browser agent",
    query: "topic:browser-agent",
    queries: [
      "topic:browser-agent",
      '"browser agent" in:name,description',
      "topic:browser-automation topic:ai-agents",
      "topic:browser-automation topic:ai-agent",
    ],
    description: "Software that turns the web into an action space.",
    color: "#cdadff",
    aliases: ["browser agent", "browser agents"],
  },
  {
    slug: "agent-memory",
    name: "Agent memory",
    keyword: "ai agent memory",
    query: "topic:agent-memory",
    description: "Persistent context for agents that learn over time.",
    color: "#ffbc8b",
    aliases: ["agent memory", "memory agent"],
  },
  {
    slug: "local-llm",
    name: "Local LLMs",
    keyword: "local llm",
    query: "topic:local-llm",
    description: "Models and inference that run on your own machine.",
    color: "#f4dc83",
    aliases: ["local llm", "local ai"],
  },
  {
    slug: "vector-databases",
    name: "Vector databases",
    keyword: "vector database",
    query: "topic:vector-database",
    description: "The retrieval infrastructure behind AI products.",
    color: "#69d9c3",
    aliases: ["vector database", "vector-db"],
  },
  {
    slug: "voice-agents",
    name: "Voice agents",
    keyword: "ai voice agent",
    query: "topic:voice-agent",
    description: "Real-time conversations that get things done.",
    color: "#f19eba",
    aliases: ["voice agent", "voice ai"],
  },
  {
    slug: "rag",
    name: "Retrieval / RAG",
    keyword: "retrieval augmented generation",
    query: "topic:retrieval-augmented-generation",
    description: "Grounding model answers in useful knowledge.",
    color: "#a8b9ff",
    aliases: [
      "retrieval augmented generation",
      "retrieval-augmented-generation",
    ],
  },
];
// These names resolve user input; they do not expand the curated daily dashboard.
const KNOWN_TOPICS: Topic[] = [
  ...TOPICS,
  // Established identifiers can resemble placeholders. Preserve their exact scope.
  // Sources: https://vvvv.org/ and MDN's Object.prototype.__proto__ reference.
  {
    slug: "vvvv",
    name: "vvvv visual programming",
    keyword: "vvvv visual programming",
    query: "topic:vvvv",
    queries: ["topic:vvvv", '"vvvv" in:name,description'],
    description:
      "Tools and workflows around the vvvv visual programming environment.",
    color: "#79c9ff",
    aliases: ["vvvv", "vvvv visual programming"],
  },
  {
    slug: "javascript-proto",
    name: "JavaScript __proto__",
    scope: "field",
    keyword: "JavaScript __proto__",
    query: '"__proto__" in:name,description',
    description:
      "JavaScript prototype behavior, education and tooling around __proto__.",
    color: "#79c9ff",
    aliases: ["__proto__", "javascript __proto__"],
  },
  {
    slug: "vibe-coding",
    name: "Vibe coding",
    scope: "field",
    keyword: "vibe coding",
    query: "topic:vibe-coding",
    queries: ["topic:vibe-coding", '"vibe coding" in:name,description'],
    description:
      "Tools and workflows for building software through natural-language interaction.",
    color: "#79c9ff",
    aliases: ["vibe coding", "氛围编程"],
  },
  {
    slug: "agent-skills",
    name: "Agent skills",
    keyword: "agent skills",
    query: "topic:agent-skills",
    queries: ["topic:agent-skills", '"agent skills" in:name,description'],
    description:
      "Reusable instructions and capabilities packaged for AI agents.",
    color: "#cdadff",
    aliases: ["agent skills", "智能体技能"],
  },
  {
    slug: "auto-research",
    name: "Autoresearch",
    scope: "field",
    keyword: "autoresearch",
    query: "topic:autoresearch",
    queries: [
      "topic:autoresearch",
      '"autoresearch" in:name,description',
      '"auto research" in:name,description',
    ],
    description:
      "AI automated research: assistants that search sources, analyze evidence and synthesize findings, plus agents that run research experiments. Compare these distinct user jobs separately.",
    color: "#79c9ff",
    aliases: [
      "autoresearch",
      "auto research",
      "auto research ai",
      "autoresearch ai",
    ],
    plan: {
      input: "autoresearch",
      model: "curated",
      version: "1",
      intent:
        "AI automated research: source discovery, evidence synthesis and autonomous experiments; compare each user job separately.",
      trends: ["autoresearch"],
      githubTopics: ["autoresearch"],
      githubTerms: ["autoresearch", "auto research"],
      webQueries: [
        { query: "auto research ai", intent: "competition" },
        { query: "auto research ai reviews", intent: "demand" },
        { query: "autoresearch github", intent: "opensource" },
      ],
      explanation: {
        en: "Research AI automated research, comparing research assistants and autonomous experiment tools as distinct jobs. Trends tracks autoresearch; buyer search uses auto research ai.",
        zh: "围绕 AI 自动研究，分别比较资料检索与综合分析助手、自主实验工具。趋势追踪 autoresearch；商业产品使用 auto research ai 检索。",
      },
    },
  },
  {
    slug: "ai-for-science",
    name: "AI for Science",
    scope: "field",
    keyword: "AI for Science",
    query: "topic:ai4science",
    queries: ["topic:ai4science", "topic:ai-for-science", "topic:ai4s"],
    description: "Models and tools for scientific discovery.",
    color: "#79c9ff",
    aliases: [
      "ai4s",
      "ai4science",
      "ai for science",
      "科学智能",
      "人工智能科学",
    ],
  },
];
const CHINESE_TOPICS: Record<string, string> = {
  智能体记忆: "agent-memory",
  编程智能体: "coding-agents",
  浏览器智能体: "browser-agents",
  向量数据库: "vector-databases",
  本地大模型: "local-llm",
  语音智能体: "voice-agents",
  检索增强: "rag",
  mcp服务: "mcp-servers",
};
export function resolveTopic(input: string, keyword?: string): Topic {
  if (
    keyword !== undefined &&
    (typeof keyword !== "string" ||
      !keyword.trim() ||
      keyword.length > 100 ||
      /[\x00-\x1f<>]/.test(keyword))
  )
    throw new Error("Invalid demand keyword.");
  const original = input.trim().toLowerCase();
  const value = Object.hasOwn(CHINESE_TOPICS, original)
    ? CHINESE_TOPICS[original]!
    : original;
  if (!value || value.length > 80 || /[\x00-\x1f<>]/.test(value))
    throw new Error("Enter a topic between 1 and 80 characters.");
  const found = KNOWN_TOPICS.find(
    (t) =>
      t.slug === value ||
      t.name.toLowerCase() === value ||
      t.aliases.includes(value),
  );
  if (found) return { ...found, keyword: keyword?.trim() || found.keyword };
  const slug = value.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug)
    throw new Error("Use an English GitHub topic or a known category.");
  if (keyword && (keyword.length > 100 || /[\x00-\x1f<>]/.test(keyword)))
    throw new Error("Invalid demand keyword.");
  return {
    slug,
    name: input.trim(),
    keyword: keyword?.trim() || value.replaceAll("-", " "),
    query: `topic:${slug}`,
    description: "A custom GitHub topic, paired with Google search interest.",
    color: "#bcf85e",
    aliases: [],
  };
}
export function validateRepo(input: string): string {
  const name = input.replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  if (
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})\/[a-zA-Z0-9._-]{1,100}$/.test(name) ||
    /\/\.{1,2}$/.test(name)
  )
    throw new Error("Use a public repository in owner/repo format.");
  return name;
}
export function validateGeo(geo: string): string {
  if (geo !== "" && !/^[A-Z]{2}$/.test(geo))
    throw new Error(
      "Region must be a two-letter country code or empty for worldwide.",
    );
  return geo;
}
