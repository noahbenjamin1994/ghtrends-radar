import type { Opportunity, MarketOverview } from "./opportunities.js";
export type MarketKind =
  "blue" | "expanding" | "contested" | "quiet" | "uncertain";
export type Confidence = "high" | "moderate" | "low";
export interface Topic {
  slug: string;
  name: string;
  keyword: string;
  query: string;
  queries?: string[];
  description: string;
  color: string;
  aliases: string[];
  scope?: "category" | "field";
  plan?: QueryPlan;
}
export interface QueryPlan {
  input: string;
  model: string;
  version: string;
  intent: string;
  entity?: { name: string; aliases: string[] };
  trends: string[];
  githubTopics: string[];
  githubTopicGroups?: string[][];
  githubTerms: string[];
  explanation: { en: string; zh: string };
  ambiguity?: { en: string; zh: string };
  webQueries?: import("../providers/search.js").SearchQuery[];
}
export interface Brief {
  model: string;
  generatedAt: string;
  en: BriefParagraph;
  zh: BriefParagraph;
  sources: ResearchSource[];
  strategyVersion?: string;
  overview?: MarketOverview;
  opportunities?: Opportunity[];
  recommendedId?: string;
  selection?: { en: string; zh: string };
  reviewed?: boolean;
  basis?: "source-led" | "hypothesis-led";
  evidence?: { id: string; quote: string }[];
  landscape?: import("./landscape.js").Landscape;
  issueInsights?: import("./landscape.js").IssueInsight[];
}
export interface BriefParagraph {
  headline?: string;
  summary: string;
  nextSteps: string[];
  strategy?: Strategy;
}
export interface Strategy {
  angle: string;
  audience: string;
  mechanism: string;
  wedge: string;
  tradeoff: string;
  assumption: string;
  experiment: string;
  successSignal: string;
  pivotSignal: string;
}
export interface ResearchSource {
  directionId?: string;
  searchIntent?: "competition" | "demand" | "opensource";
  placement?: "organic" | "ad";
  kind?: "request" | "project" | "search";
  id?: string;
  label: string;
  url: string;
  excerpt?: string;
  fetchedAt?: string;
  request?: RequestEvidence;
}
export interface RequestEvidence {
  state?: string;
  stateReason?: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  observedAt?: string;
  reactions?: number;
  comments?: number;
  authorKey?: string;
}
export interface InterestPoint {
  date: string;
  value: number;
  anchor?: number;
  partial?: boolean;
}
export interface DemandEvidence {
  keyword: string;
  geo: string;
  fetchedAt: string;
  sourceUrl: string;
  points: InterestPoint[];
  related: {
    query: string;
    value: number;
    formatted: string;
    type: "top" | "rising";
  }[];
  error?: string;
  collectionError?: string;
  retryAt?: string;
  resolution?: string;
  seriesIndex?: number;
  normalization?: "independent";
  requestedKeyword?: string;
  selectionReason?: string;
  alternatives?: Omit<DemandEvidence, "alternatives">[];
}
export interface Repo {
  name: string;
  description: string;
  url: string;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  archived: boolean;
  createdAt: string;
  pushedAt: string;
  topics: string[];
  starHistory: { date: string; count: number }[];
  growth7d: number | null;
  growth30d: number | null;
  growthWindowEnd: string | null;
  openIssues: number;
  issueResponseHours: number | null;
  issueSampleSize: number;
  unansweredIssues: number;
  contributors: number | null;
  topContributorShare: number | null;
  fetchedAt: string;
  errors: string[];
  matchedQueries?: string[];
  relevance?: {
    role: "direct" | "adjacent" | "resource" | "unclear";
    method: "rules" | "model";
    reason: string;
  };
}
export interface SupplyEvidence {
  query: string;
  sourceUrl: string;
  fetchedAt: string;
  total: number;
  complete: boolean;
  repositories: Repo[];
  searches?: { query: string; url: string; total: number; complete: boolean }[];
  error?: string;
  review?: {
    version: string;
    model: string;
    reviewed: number;
    status: "complete" | "partial" | "fallback";
  };
  recovery?: {
    model: string;
    originalCount: number;
    addedQueries: string[];
    explanation: { en: string; zh: string };
  };
}
export interface CompetitionMetrics {
  score: number;
  upper: number;
  level: "limited" | "established" | "pending";
  direct: number;
  adjacent: number;
  resources: number;
  unclear: number;
  sampled: number;
  enumerated: boolean;
  effectiveTeams: number;
  establishedTeams: number;
  concentration: number | null;
  breadth: number;
  incumbency: number;
  dominance: number;
  boundary: boolean;
}
export interface DemandMetrics {
  recent: number;
  baseline: number;
  growth: number | null;
  lower: number | null;
  upper: number | null;
  yearOverYear: number | null;
  slope: number;
  nonzeroShare: number;
  points: number;
  anchorRatio: number | null;
  persistence: number;
  fast: boolean | null;
  seasonal: boolean;
  regularWeekly: boolean;
  shortGrowth?: number | null;
  quarterGrowth?: number | null;
  trend?: "rising" | "falling" | "stable" | "mixed" | "unknown";
  recentNonzeroShare?: number;
  emerging?: boolean;
  directionBasis?: "recent-windows" | "sustained-quarter" | "seasonal-year";
  seasonalCorrelation?: number | null;
  yearLower?: number | null;
  yearUpper?: number | null;
  synonymAgreement?: { measured: number; agreeing: number; opposing: number };
  horizon?:
    "cooling-above-year" | "rebounding-below-year" | "aligned" | "unavailable";
  windows?: {
    short?: DemandWindow;
    main?: DemandWindow;
    quarter?: DemandWindow;
  };
}
export interface DemandWindow {
  recentStart: string;
  recentEnd: string;
  baselineStart: string;
  baselineEnd: string;
}
export interface Gap extends RequestEvidence {
  title: string;
  url: string;
  repo: string;
  reactions: number;
  createdAt: string;
  updatedAt: string;
  state: string;
  label: "feature-request" | "alternative" | "friction";
  excerpt: string;
}
export interface Market {
  id: string;
  version: string;
  topic: Topic;
  geo: string;
  asOf: string;
  kind: MarketKind;
  confidence: Confidence;
  headline: string;
  strategy: string;
  reasons: string[];
  limitations: string[];
  demand: DemandEvidence;
  supply: SupplyEvidence;
  metrics: DemandMetrics;
  supplyDensity: "dense" | "sparse" | "unknown";
  concentration: number | null;
  competition?: CompetitionMetrics;
  gaps: Gap[];
  score: number | null;
  brief?: Brief;
  aiError?: string;
  web?: import("../providers/search.js").WebEvidence;
}
export interface MarketSummary extends Omit<
  Market,
  "demand" | "supply" | "gaps"
> {
  demand: Omit<DemandEvidence, "points" | "related"> & {
    points: InterestPoint[];
  };
  supply: Omit<SupplyEvidence, "repositories"> & { repositories: Repo[] };
  gapCount: number;
}
