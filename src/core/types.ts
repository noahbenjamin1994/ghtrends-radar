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
  trends: string[];
  githubTopics: string[];
  githubTopicGroups?: string[][];
  githubTerms: string[];
  explanation: { en: string; zh: string };
  ambiguity?: { en: string; zh: string };
}
export interface Brief {
  model: string;
  generatedAt: string;
  en: { summary: string; nextSteps: string[] };
  zh: { summary: string; nextSteps: string[] };
  sources: { label: string; url: string }[];
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
export interface Gap {
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
