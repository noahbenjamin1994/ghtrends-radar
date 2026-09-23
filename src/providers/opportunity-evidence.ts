import type { DirectionProbe } from "../core/portfolio.js";
import type { ResearchSource, Topic } from "../core/types.js";
import type { GitHub } from "./github.js";
import { searchSources, type GoogleSearch } from "./search.js";
import type { DocumentReader } from "./documents.js";

/** A budget shared by the initial shortlist and its single possible replacement. */
export function opportunityEvidence(
  topic: Topic,
  geo: string,
  github: Pick<GitHub, "directionEvidence">,
  search: Pick<GoogleSearch, "collect" | "enabled">,
  documents: Pick<DocumentReader, "collect">,
) {
  let probes = 0,
    webQueries = 0;
  const seen = new Set<string>();
  return async (directions: DirectionProbe[]): Promise<ResearchSource[]> => {
    const pending = directions
      .filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      })
      .map((d) => {
        const prefix = `P${++probes}`;
        const web = d.channel === "web";
        const allowed =
          probes <= 6 && (!web || (search.enabled && webQueries++ < 2));
        return { d, prefix, web, allowed };
      });
    const rows: ResearchSource[][] = new Array(pending.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, pending.length) }, async () => {
        while (cursor < pending.length) {
          const i = cursor++,
            { d, prefix, web, allowed } = pending[i]!;
          const query = `${topic.keyword} ${d.query}`.slice(0, 160);
          const coverage = (reason: string): ResearchSource => ({
            id: prefix + "C",
            directionId: d.id,
            kind: "search",
            label: `Direction check: ${reason}`,
            fetchedAt: new Date().toISOString(),
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          });
          if (!allowed) {
            rows[i] = [
              coverage(
                "budget or provider unavailable; evidence not collected",
              ),
            ];
            continue;
          }
          try {
            if (!web) {
              rows[i] = (await github.directionEvidence([d])).map((s) => ({
                ...s,
                id: prefix + (s.id || "").replace(/^D1/, ""),
                directionId: d.id,
              }));
            } else {
              const result = await search.collect(topic, geo, [
                { query, intent: "competition" },
              ]);
              const snippets = searchSources(result)
                .filter((s) => s.placement === "organic")
                .slice(0, 4);
              // Only one observed page per web probe; existing SSRF/robots/time limits apply.
              const page = await documents.collect(
                snippets.slice(0, 1),
                `${topic.keyword} ${d.query}`,
              );
              rows[i] = [...snippets, ...page.sources].map((s, n) => ({
                ...s,
                id: prefix + "W" + (n + 1),
                directionId: d.id,
              }));
              rows[i]!.push(
                coverage(
                  `web ${result.state}; ${snippets.length} indexed excerpts; original reads: ${page.reads.map((r) => r.status).join(",") || "none"}`,
                ),
              );
            }
          } catch {
            rows[i] = [
              coverage(
                "source check failed; availability and demand remain unknown",
              ),
            ];
          }
        }
      }),
    );
    return rows.flat();
  };
}
