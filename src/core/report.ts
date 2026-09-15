import type { Market, Repo } from "./types.js";
const cell = (s: string) => s.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
export function compareMarkdown(repos: Repo[]): string {
  return [
    "| Repository | Stars | 7-day stars | 30-day stars | Last push | License |",
    "|---|---:|---:|---:|---|---|",
    ...repos.map(
      (r) =>
        `| [${cell(r.name)}](${r.url}) | ${r.stars} | ${r.growth7d ?? "unavailable"} | ${r.growth30d ?? "unavailable"} | ${r.pushedAt.slice(0, 10)} | ${r.license ?? "Not specified"} |`,
    ),
  ].join("\n");
}
export function marketMarkdown(m: Market, baseUrl?: string): string {
  return [
    `# ${m.topic.name}: ${m.headline}`,
    "",
    `As of ${m.asOf.slice(0, 10)} · ${m.geo || "Worldwide"} · Method ${m.version} · ${m.confidence} evidence confidence`,
    "",
    m.strategy,
    "",
    "## Evidence",
    "",
    ...m.reasons.map((x) => `- ${x}`),
    "",
    `- Search demand: [Google Trends](${m.demand.sourceUrl})`,
    `- Supply: [GitHub search](${m.supply.sourceUrl})`,
    "",
    "## Leading repositories",
    "",
    compareMarkdown(m.supply.repositories.slice(0, 10)),
    "",
    "## Open demand signals",
    "",
    ...m.gaps.map(
      (g) =>
        `- [${cell(g.title)}](${g.url}) (${g.reactions} reactions; ${g.state}; ${g.repo})`,
    ),
    "",
    "## Scope and limitations",
    "",
    ...m.limitations.map((x) => `- ${x}`),
    "",
    baseUrl
      ? `[View this snapshot](${baseUrl}/report/${m.id}) · [ghtrends source](https://github.com/noahbenjamin1994/ghtrends-radar)`
      : `Local report ${m.id} · [ghtrends source](https://github.com/noahbenjamin1994/ghtrends-radar)`,
    "",
  ].join("\n");
}
