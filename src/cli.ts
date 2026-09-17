#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { competitionPressure, marketAssessment } from "./core/assessment.js";
import { text } from "./core/i18n.js";
import { Engine } from "./core/engine.js";
import { marketMarkdown, compareMarkdown } from "./core/report.js";
import { validateRepo } from "./core/topics.js";
import type { DemandEvidence, Market } from "./core/types.js";
const program = new Command()
  .name("ghtrends")
  .description(
    "GitHub supply × Google search demand. Find your next open-source opportunity.",
  )
  .version("0.14.0");
const withEngine = (fn: (engine: Engine) => Promise<void>) => async () => {
  const e = new Engine();
  try {
    await fn(e);
  } finally {
    await e.close();
  }
};
const json = (x: unknown) => console.log(JSON.stringify(x, null, 2));
const summary = (m: Market) => {
  console.log(
    `\n${m.topic.name} · ${marketAssessment(m).landscape} · ${m.headline}\n${m.strategy}\n`,
  );
  console.table({
    competitionPressure: { value: competitionPressure(m) },
    directAlternatives: {
      value: m.competition?.direct ?? "Review project roles",
    },
    searchDirection: { value: m.metrics.trend || "unknown" },
    directionBasis: {
      value: text(
        "basis." + (m.metrics.directionBasis || "recent-windows"),
        "en",
      ),
    },
    matchingProjects: {
      value: `${m.supply.complete ? "" : "≥"}${m.supply.total}`,
    },
    searchGrowth: {
      value: m.metrics.emerging
        ? "Early rise from a small baseline"
        : m.metrics.growth === null
          ? "Search history pending"
          : `${(m.metrics.growth * 100).toFixed(1)}%`,
    },
    confidence: { value: m.confidence },
    region: { value: m.geo || "Worldwide" },
  });
  for (const r of m.reasons) console.log("• " + text(r, "en"));
  for (const l of m.limitations) console.log("  " + text(l, "en"));
  console.log(`\nReport: ${m.id}\n`);
};
program
  .command("scan")
  .requiredOption("--topic <topic>")
  .option("--keyword <keyword>", "Override the Google Trends demand keyword")
  .option("--geo <country>", "Country code; default worldwide", "")
  .option("--json")
  .option("--report [path]", "Also write a Markdown report")
  .option("--refresh")
  .option("--trends-file <path>", "Use exported DemandEvidence JSON")
  .action(async (o) => {
    const e = new Engine();
    try {
      const demand = o.trendsFile
        ? (JSON.parse(readFileSync(o.trendsFile, "utf8")) as DemandEvidence)
        : undefined;
      const m = await e.scan(o.topic, {
        owner: "local",
        geo: o.geo,
        keyword: o.keyword,
        refresh: o.refresh,
        demand,
      });
      o.json ? json(m) : summary(m);
      if (o.report)
        writeFileSync(
          typeof o.report === "string"
            ? o.report
            : `ghtrends-${m.topic.slug}.md`,
          marketMarkdown(m),
        );
    } finally {
      await e.close();
    }
  });
program
  .command("repo")
  .argument("<owner/repo>")
  .option("--json")
  .action(async (name, o) => {
    const e = new Engine();
    try {
      const r = await e.github.repo(name);
      o.json
        ? json(r)
        : console.table(
            [r].map((x) => ({
              repository: x.name,
              stars: x.stars,
              stars7d: x.growth7d,
              stars30d: x.growth30d,
              lastPush: x.pushedAt.slice(0, 10),
              license: x.license,
              issueResponseHours: x.issueResponseHours,
              issueSample: x.issueSampleSize,
            })),
          );
    } finally {
      await e.close();
    }
  });
program
  .command("compare")
  .argument("<repos...>")
  .option("--format <format>", "table, json or md", "table")
  .action(async (names, o) => {
    if (!["table", "json", "md"].includes(o.format))
      throw new Error("Format must be table, json or md.");
    const e = new Engine();
    try {
      const repos = await e.compare(names);
      if (o.format === "json") json(repos);
      else if (o.format === "md") console.log(compareMarkdown(repos));
      else
        console.table(
          repos.map((r) => ({
            repo: r.name,
            stars: r.stars,
            stars7d: r.growth7d,
            stars30d: r.growth30d,
            license: r.license,
            lastPush: r.pushedAt.slice(0, 10),
          })),
        );
    } finally {
      await e.close();
    }
  });
program
  .command("report")
  .requiredOption("--topic <topic>")
  .option("--geo <country>", "", "")
  .option("--format <format>", "md or json", "md")
  .action(async (o) => {
    if (!["md", "json"].includes(o.format))
      throw new Error("Format must be md or json.");
    const e = new Engine();
    try {
      const m = await e.scan(o.topic, { geo: o.geo, owner: "local" });
      o.format === "json" ? json(m) : console.log(marketMarkdown(m));
    } finally {
      await e.close();
    }
  });
const watch = program
  .command("watch")
  .description("A persistent local watchlist.");
watch
  .command("add")
  .argument("<repo>")
  .action(async (name) => {
    const e = new Engine();
    try {
      e.store.watchAdd(validateRepo(name));
      json(e.store.watchList());
    } finally {
      await e.close();
    }
  });
watch
  .command("remove")
  .argument("<repo>")
  .action(async (name) => {
    const e = new Engine();
    try {
      e.store.watchRemove(validateRepo(name));
      json(e.store.watchList());
    } finally {
      await e.close();
    }
  });
watch
  .command("list")
  .action(withEngine(async (e) => json(e.store.watchList())));
watch.command("run").action(withEngine(async (e) => json(await e.watchRun())));
program
  .command("collect")
  .description("Refresh the curated radar; respects provider rate limits.")
  .action(
    withEngine(async (e) => e.collect((s) => process.stderr.write(s + "\n"))),
  );
program
  .command("ui")
  .option("--port <port>", "Local port", "3721")
  .option("--open", "Open the browser")
  .option("--no-open", "Do not open a browser")
  .action(async (o) => {
    const port = Number(o.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw new Error("Port must be between 1024 and 65535.");
    const { startServer } = await import("./server/index.js");
    await startServer(port);
    if (o.open !== false) {
      const cmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "cmd"
            : "xdg-open";
      spawn(
        cmd,
        process.platform === "win32"
          ? ["/c", "start", "", `http://localhost:${port}`]
          : [`http://localhost:${port}`],
        { stdio: "ignore" },
      ).on("error", () => {});
    }
  });
program
  .command("mcp")
  .description("Run the MCP server over stdio.")
  .action(async () => {
    const { startMcp } = await import("./mcp.js");
    await startMcp();
  });
program.parseAsync().catch((e) => {
  process.stderr.write(`ghtrends: ${e.message}\n`);
  process.exitCode = 1;
});
