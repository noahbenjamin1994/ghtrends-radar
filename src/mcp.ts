import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { marketAssessment } from "./core/assessment.js";
import { Engine } from "./core/engine.js";
import { completeWeeklySeries } from "./core/evidence.js";
export async function startMcp() {
  const engine = new Engine(),
    server = new McpServer({ name: "ghtrends", version: "0.5.0" });
  const result = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  });
  const wrap = (fn: () => Promise<unknown>) =>
    fn()
      .then(result)
      .catch((e) => ({
        isError: true,
        content: [
          {
            type: "text" as const,
            text: e.choices
              ? JSON.stringify({
                  error: e.message,
                  choices: e.choices,
                  clarification: e.clarification,
                })
              : (e as Error).message,
          },
        ],
      }));
  server.tool(
    "ghtrends_scan",
    "Classify open-source supply and Google search demand. Includes evidence, scope and uncertainty; not a revenue forecast.",
    {
      topic: z.string().min(1).max(300),
      geo: z.string().max(2).optional(),
      keyword: z.string().max(100).optional(),
    },
    ({ topic, geo, keyword }) =>
      wrap(async () => {
        const m = await engine.scan(topic, { geo, keyword, owner: "local" });
        return {
          ...m,
          assessment: marketAssessment(m),
          demand: {
            ...m.demand,
            points: completeWeeklySeries(m.demand, m.asOf).points.slice(-16),
            related: m.demand.related.slice(0, 10),
          },
          supply: {
            ...m.supply,
            repositories: m.supply.repositories
              .slice(0, 10)
              .map(
                ({
                  name,
                  url,
                  description,
                  stars,
                  growth7d,
                  growth30d,
                  license,
                }) => ({
                  name,
                  url,
                  description,
                  stars,
                  growth7d,
                  growth30d,
                  license,
                }),
              ),
          },
          gaps: m.gaps.slice(0, 10),
        };
      }),
  );
  server.tool(
    "ghtrends_repo",
    "Public repository growth, maintenance and sampled contributor / issue-response metrics.",
    { repo: z.string().max(140) },
    ({ repo }) => wrap(() => engine.github.repo(repo)),
  );
  server.tool(
    "ghtrends_compare",
    "Compare two to six public repositories on the same metrics.",
    { repos: z.array(z.string()).min(2).max(6) },
    ({ repos }) => wrap(() => engine.compare(repos)),
  );
  server.tool(
    "ghtrends_watch_list",
    "Read the local persistent watchlist.",
    {},
    async () => result(engine.store.watchList()),
  );
  await server.connect(new StdioServerTransport());
  process.once("SIGTERM", () => void server.close().then(() => engine.close()));
}
