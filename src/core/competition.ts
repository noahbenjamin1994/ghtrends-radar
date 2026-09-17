import type {
  CompetitionMetrics,
  Repo,
  SupplyEvidence,
  Topic,
} from "./types.js";

// Published operational parameters. These describe the observed open-source
// landscape; they are neither market shares nor business-success probabilities.
export const COMPETITION_POLICY = {
  threshold: 45,
  boundary: 5,
  breadthScale: 12,
  breadthWeight: 50,
  incumbencyWeight: 30,
  dominanceWeight: 20,
  activeDays: 365,
};
export const RELEVANCE_VERSION = "2";
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const normalize = (s: string) =>
  s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();

/** Conservative local mode; model review can distinguish products from users of a technology. */
export function repoRelevance(
  repo: Repo,
  topic: Topic,
): NonNullable<Repo["relevance"]> {
  const name = repo.name.split("/").at(-1) || "";
  const description = repo.description.toLowerCase();
  const wantsResources =
    /\b(?:directory|curated list|tutorial|course|dataset)\b/.test(
      normalize(topic.keyword),
    );
  if (
    !wantsResources &&
    (/^(?:awesome[-_]|learn[-_]|tutorial[-_]|examples?[-_])/.test(
      name.toLowerCase(),
    ) ||
      /^(?:\W)*(?:(?:a|an|the)\s+)?(?:curated (?:list|collection)|list of|collection of (?:papers|resources|tutorials|links)|tutorial|course|learning resources)\b/i.test(
        repo.description,
      ))
  )
    return {
      role: "resource",
      method: "rules",
      reason: "Resource collection or learning material",
    };
  const phrases = (topic.queries || [topic.query]).flatMap((q) => {
    const phrase = q.match(/^"([^"]+)"/)?.[1];
    if (phrase) return [normalize(phrase)];
    const tags = [...q.matchAll(/topic:([\w-]+)/g)].map((m) => m[1]!);
    return tags.length === 1 ? [normalize(tags[0]!)] : [];
  });
  const content = normalize(name + " " + description);
  const exact = phrases.some(
    (p) => content.includes(p) || content.includes(p.replace(/s$/, "")),
  );
  const integration =
    /\b(?:integration (?:for|with)|plugin for|client for|wrapper (?:for|around)|powered by|built (?:with|on)|example (?:of|using))\b/.test(
      description,
    );
  if (exact && !integration)
    return {
      role: "direct",
      method: "rules",
      reason: "Category phrase in project name or description",
    };
  return {
    role: "unclear",
    method: "rules",
    reason: "Project role awaiting closer review",
  };
}

export function assessCompetition(
  topic: Topic,
  supply: SupplyEvidence,
  asOf: string,
): CompetitionMetrics {
  // Keep the original evidence immutable and group by owner so one ecosystem's
  // clients/plugins cannot multiply the number of independent alternatives.
  const unique = new Map<string, Repo>();
  for (const r of supply.repositories) {
    const age = (Date.parse(asOf) - Date.parse(r.pushedAt)) / 86400000;
    if (
      !r.archived &&
      Number.isFinite(age) &&
      age >= -1 &&
      age <= COMPETITION_POLICY.activeDays
    )
      unique.set(r.name.toLowerCase(), r);
  }
  const repos = [...unique.values()];
  const roles = repos.map((r) => ({
    repo: r,
    role: (r.relevance || repoRelevance(r, topic)).role,
  }));
  const count = (role: string) => roles.filter((r) => r.role === role).length;
  const calculate = (includeUnclear: boolean) => {
    const owners = new Map<
      string,
      { weight: number; established: number; stars: number }
    >();
    for (const { repo: r, role } of roles) {
      if (role !== "direct" && !(includeUnclear && role === "unclear"))
        continue;
      const age = Math.max(
        0,
        (Date.parse(asOf) - Date.parse(r.createdAt)) / 86400000,
      );
      const days = Math.max(
        0,
        (Date.parse(asOf) - Date.parse(r.pushedAt)) / 86400000,
      );
      const stars = Math.max(0, Number.isFinite(r.stars) ? r.stars : 0);
      const forks = Math.max(0, Number.isFinite(r.forks) ? r.forks : 0);
      const maintenance = 0.6 + 0.4 * Math.exp(-days / 180);
      const adoption = clamp(Math.log10(stars + 1) / 4);
      const reuse = clamp(Math.log10(forks + 1) / 3);
      const weight = (0.2 + 0.8 * (0.7 * adoption + 0.3 * reuse)) * maintenance;
      // Stars alone contribute breadth. Entrenchment additionally requires forks,
      // a project history, and maintained code. Popularity is an observable proxy.
      const established =
        Math.sqrt(
          clamp((Math.log10(stars + 1) - 3) / 1.3) *
            clamp((Math.log10(forks + 1) - 1.5) / 1.5),
        ) *
        clamp((Number.isFinite(age) ? age : 0) / 365) *
        maintenance;
      const owner = r.name.split("/")[0]!.toLowerCase();
      const previous = owners.get(owner);
      owners.set(owner, {
        weight: Math.max(previous?.weight || 0, weight),
        established: Math.max(previous?.established || 0, established),
        stars: (previous?.stars || 0) + stars,
      });
    }
    const teams = [...owners.values()];
    const effective = teams.reduce((s, t) => s + t.weight, 0);
    const strength = teams.reduce((s, t) => s + t.established, 0);
    const stars = teams.map((t) => t.stars).sort((a, b) => b - a);
    const total = stars.reduce((s, v) => s + v, 0);
    const concentration = total
      ? stars.slice(0, 3).reduce((s, v) => s + v, 0) / total
      : null;
    const breadth =
      COMPETITION_POLICY.breadthWeight *
      (1 - Math.exp(-effective / COMPETITION_POLICY.breadthScale));
    const incumbency =
      COMPETITION_POLICY.incumbencyWeight * (1 - Math.exp(-2 * strength));
    const dominance =
      COMPETITION_POLICY.dominanceWeight *
      Math.max(0, ...teams.map((t) => t.established));
    return {
      score: breadth + incumbency + dominance,
      breadth,
      incumbency,
      dominance,
      effective,
      established: teams.filter((t) => t.established >= 0.5).length,
      concentration,
    };
  };
  const lower = calculate(false),
    possible = calculate(true);
  const enumerated =
    supply.complete && supply.repositories.length >= supply.total;
  // A truncated, stars-ranked sample establishes a lower bound only. Avoid
  // extrapolating its direct-project percentage to every search result.
  const upper = enumerated ? Math.max(lower.score, possible.score) : 100;
  const known = !supply.error && count("direct") > 0;
  const level =
    known && lower.score >= COMPETITION_POLICY.threshold
      ? "established"
      : known && enumerated && upper < COMPETITION_POLICY.threshold
        ? "limited"
        : "pending";
  return {
    score: lower.score,
    upper,
    level,
    direct: count("direct"),
    adjacent: count("adjacent"),
    resources: count("resource"),
    unclear: count("unclear"),
    sampled: roles.length,
    enumerated,
    effectiveTeams: lower.effective,
    establishedTeams: lower.established,
    concentration: lower.concentration,
    breadth: lower.breadth,
    incumbency: lower.incumbency,
    dominance: lower.dominance,
    boundary:
      Math.abs(lower.score - COMPETITION_POLICY.threshold) <=
        COMPETITION_POLICY.boundary ||
      (lower.score < COMPETITION_POLICY.threshold &&
        upper >= COMPETITION_POLICY.threshold),
  };
}
