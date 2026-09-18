import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { GitHub } from "../providers/github.js";
import { Trends } from "../providers/trends.js";
import {
  GoogleSearch,
  searchSources,
  SEARCH_VERSION,
} from "../providers/search.js";
import { marketGapSignals } from "./gaps.js";
import { Research } from "../providers/research.js";
import { resolveTopic, validateGeo, validateRepo, TOPICS } from "./topics.js";
import { importDemand } from "./import.js";
import { analyze, ALGORITHM_VERSION } from "./analyze.js";
import {
  sourceEvidenceIsFresh,
  completeWeeklySeries,
  searchEvidenceIsFresh,
} from "./evidence.js";
import { STRATEGY_VERSION } from "./strategy.js";
import type { Market, DemandEvidence, SupplyEvidence, Topic } from "./types.js";
export interface ScanProgress {
  stage:
    | "interpreting"
    | "sources"
    | "github"
    | "demand"
    | "details"
    | "brief"
    | "researching"
    | "reviewing"
    | "refining";
  supplyCount?: number;
  weeklyPoints?: number;
  preview?: Market;
  topic?: Topic;
}
export class Engine {
  github: GitHub;
  trends: Trends;
  research: Research;
  search: GoogleSearch;
  constructor(public store = new Store()) {
    this.github = new GitHub(store);
    this.trends = new Trends(store);
    this.research = new Research(store);
    this.search = new GoogleSearch(store);
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
      (!ai || existing.brief?.strategyVersion === STRATEGY_VERSION) &&
      (!ai ||
        !this.search.enabled ||
        (searchEvidenceIsFresh(existing.web) &&
          existing.web?.version === SEARCH_VERSION)) &&
      (!ai || existing.topic.plan?.version === topic.plan?.version) &&
      (!ai ||
        JSON.stringify(existing.topic.plan?.webQueries) ===
          JSON.stringify(topic.plan?.webQueries)) &&
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
    let [demand, supply, web] = await Promise.all([
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
      this.github
        .supply(topic, (data) => {
          initialSupply = data;
          options.onProgress?.({ stage: "github", supplyCount: data.total });
          preview();
        })
        .then((data) => (ai ? this.research.reviewSupply(topic, data) : data)),
      ai ? this.search.collect(topic, geo) : Promise.resolve(undefined),
    ]);
    if (ai && !supply.error && supply.repositories.length < 3) {
      const repair = await this.research.repairQueries(topic, supply);
      if (repair) {
        options.onProgress?.({ stage: "refining", topic });
        const expanded = await this.github.supply(repair.topic);
        // Retain the successful original evidence if an additional query fails.
        if (!expanded.error) {
          const reviewed = await this.research.reviewSupply(topic, expanded);
          reviewed.recovery = {
            model: this.research.model,
            originalCount: supply.total,
            addedQueries: repair.topic.queries!.filter(
              (q) => !(topic.queries || [topic.query]).includes(q),
            ),
            explanation: repair.explanation,
          };
          supply = reviewed;
        }
      }
    }
    if (options.demand)
      this.store.set(
        `trends:v3:${JSON.stringify([topic.keyword])}:${geo}`,
        demand,
        Math.max(0, 86400000 - (Date.now() - Date.parse(demand.fetchedAt))),
      );
    options.onProgress?.({
      stage: "details",
      preview: analyze(topic, demand, supply),
    });
    const selectedProjects = ai
      ? await this.research.selectProjects(topic, supply.repositories)
      : supply.repositories
          .filter((r) => !r.relevance || r.relevance.role === "direct")
          .slice(0, 4);
    const gaps = await this.github.gaps(selectedProjects);
    const market = analyze(topic, demand, supply, gaps);
    market.gaps = marketGapSignals(market);
    market.web = web;
    if (ai) {
      options.onProgress?.({ stage: "researching", preview: market });
      try {
        const documents = await this.github.researchSources(
          selectedProjects,
          market.gaps,
        );
        const projectNames = [
          ...new Set(
            searchSources(web)
              .filter(
                (s) =>
                  s.searchIntent === "opensource" && s.placement === "organic",
              )
              .flatMap(
                (s) =>
                  /^https:\/\/github\.com\/([^/?#]+\/[^/?#]+)(?:[/?#]|$)/.exec(
                    s.url,
                  )?.[1] || [],
              ),
          ),
        ]
          .filter(
            (name) =>
              !supply.repositories.some(
                (r) => r.name.toLowerCase() === name.toLowerCase(),
              ),
          )
          .slice(0, 2);
        const webDocs = await this.github.researchSources(
          projectNames.map((name) => ({ name }) as any),
          [],
        );
        documents.push(...webDocs.map((s, i) => ({ ...s, id: `WR${i + 1}` })));
        options.onProgress?.({ stage: "brief", preview: market });
        market.brief = await this.research.insights(
          market,
          documents,
          () => options.onProgress?.({ stage: "reviewing", preview: market }),
          (queries) => this.github.ideaAlternatives(queries),
          (directions) => this.github.directionEvidence(directions),
        );
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
