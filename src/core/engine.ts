import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { GitHub } from "../providers/github.js";
import { Trends } from "../providers/trends.js";
import { Research } from "../providers/research.js";
import { resolveTopic, validateGeo, validateRepo, TOPICS } from "./topics.js";
import { importDemand } from "./import.js";
import { analyze, ALGORITHM_VERSION } from "./analyze.js";
import { sourceEvidenceIsFresh, completeWeeklySeries } from "./evidence.js";
import type { Market, DemandEvidence, SupplyEvidence, Topic } from "./types.js";
export interface ScanProgress {
  stage: "interpreting" | "sources" | "github" | "demand" | "details" | "brief";
  supplyCount?: number;
  weeklyPoints?: number;
  preview?: Market;
  topic?: Topic;
}
export class Engine {
  github: GitHub;
  trends: Trends;
  research: Research;
  constructor(public store = new Store()) {
    this.github = new GitHub(store);
    this.trends = new Trends(store);
    this.research = new Research(store);
    const seed = fileURLToPath(
      new URL("../../web-dist/seed.json", import.meta.url),
    );
    if (!store.markets().length && existsSync(seed))
      for (const m of JSON.parse(readFileSync(seed, "utf8")) as Market[]) {
        const current =
          Date.now() - Date.parse(m.asOf) > 14 * 86400000
            ? analyze(m.topic, m.demand, m.supply, m.gaps)
            : m;
        store.saveMarket(current);
        if (Date.now() - Date.parse(m.demand.fetchedAt) < 86400000)
          store.set(
            `trends:v2:${JSON.stringify([m.topic.keyword])}:${m.geo}`,
            m.demand,
            86400000 - (Date.now() - Date.parse(m.demand.fetchedAt)),
          );
      }
    for (const m of store.markets("", true))
      if (
        m.version !== ALGORITHM_VERSION ||
        (m.kind !== "uncertain" &&
          Date.now() - Date.parse(m.demand.fetchedAt) > 14 * 86400000)
      )
        store.saveMarket(analyze(m.topic, m.demand, m.supply, m.gaps));
  }
  async scan(
    input: string,
    options: {
      geo?: string;
      keyword?: string;
      refresh?: boolean;
      demand?: DemandEvidence;
      onProgress?: (progress: ScanProgress) => void;
      ai?: boolean;
      owner?: string;
      private?: boolean;
    } = {},
  ): Promise<Market> {
    const ai = options.ai !== false && this.research.enabled && !options.demand;
    if (ai) options.onProgress?.({ stage: "interpreting" });
    const topic = ai
        ? await this.research.plan(
            input,
            options.keyword,
            validateGeo(options.geo ?? ""),
          )
        : resolveTopic(input, options.keyword),
      geo = validateGeo(options.geo ?? "");
    const existing = this.store.market(topic.slug, geo, topic.keyword);
    if (
      !options.refresh &&
      !options.demand &&
      !options.private &&
      existing &&
      existing.version === ALGORITHM_VERSION &&
      existing.topic.query === topic.query &&
      JSON.stringify(existing.topic.queries) ===
        JSON.stringify(topic.queries) &&
      (existing.kind === "uncertain" || sourceEvidenceIsFresh(existing)) &&
      existing.topic.keyword === topic.keyword &&
      Date.now() - Date.parse(existing.asOf) <
        (existing.kind === "uncertain" ? 300000 : 86400000)
    ) {
      if (options.owner)
        this.store.addHistory(options.owner, existing.id, input);
      return existing;
    }
    let initialDemand: DemandEvidence | undefined,
      initialSupply: SupplyEvidence | undefined;
    const preview = () => {
      if (initialDemand && initialSupply)
        options.onProgress?.({
          stage: "details",
          preview: analyze(topic, initialDemand, initialSupply),
        });
    };
    const onDemand = (data: DemandEvidence) => {
      initialDemand = data;
      options.onProgress?.({
        stage: "demand",
        weeklyPoints: completeWeeklySeries(data, new Date().toISOString())
          .points.length,
      });
      preview();
    };
    options.onProgress?.({ stage: "sources", topic });
    const [demand, supply] = await Promise.all([
      options.demand
        ? Promise.resolve(
            importDemand(options.demand, topic.keyword, geo),
          ).then((data) => {
            onDemand(data);
            return data;
          })
        : this.trends.demand(
            topic.keyword,
            geo,
            onDemand,
            topic.plan?.trends.slice(1),
          ),
      this.github.supply(topic, (data) => {
        initialSupply = data;
        options.onProgress?.({ stage: "github", supplyCount: data.total });
        preview();
      }),
    ]);
    if (options.demand)
      this.store.set(
        `trends:v2:${JSON.stringify([topic.keyword])}:${geo}`,
        demand,
        Math.max(0, 86400000 - (Date.now() - Date.parse(demand.fetchedAt))),
      );
    options.onProgress?.({
      stage: "details",
      preview: analyze(topic, demand, supply),
    });
    const gaps = await this.github.gaps(supply.repositories);
    const market = analyze(topic, demand, supply, gaps);
    if (ai) {
      options.onProgress?.({ stage: "brief", preview: market });
      try {
        market.brief = await this.research.brief(market);
      } catch {
        market.aiError =
          "The AI brief is unavailable. Verified source evidence is still shown.";
      }
    }
    if (options.private && options.owner)
      market.id = createHash("sha256")
        .update(options.owner + ":" + market.id)
        .digest("hex")
        .slice(0, 16);
    this.store.saveMarket(market, !options.private, options.owner);
    if (options.owner) this.store.addHistory(options.owner, market.id, input);
    return market;
  }
  async compare(names: string[]) {
    if (names.length < 2 || names.length > 6)
      throw new Error("Compare between two and six repositories.");
    const repos = [];
    for (const name of [...new Set(names.map(validateRepo))])
      repos.push(await this.github.repo(name));
    if (repos.length < 2)
      throw new Error("Choose at least two different repositories.");
    return repos;
  }
  async watchRun() {
    const results = [];
    for (const name of this.store.watchList()) {
      try {
        results.push({ repo: name, data: await this.github.repo(name) });
      } catch (e) {
        results.push({ repo: name, error: (e as Error).message });
      }
    }
    return results;
  }
  async collect(progress: (s: string) => void = () => {}) {
    for (const [i, t] of TOPICS.entries()) {
      progress(`Collecting ${t.name} (${i + 1}/${TOPICS.length})`);
      const m = await this.scan(t.slug, { refresh: true });
      progress(`${t.slug}: ${m.headline} (${m.confidence})`);
      if (i < TOPICS.length - 1) await new Promise((r) => setTimeout(r, 35000));
    }
  }
  async close() {
    await this.trends.close();
    this.store.close();
  }
}
