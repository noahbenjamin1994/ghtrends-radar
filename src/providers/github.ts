import { githubToken } from "./github-auth.js";
import { Store } from "../core/store.js";
import { POLICY, median } from "../core/analyze.js";
import { validateRepo } from "../core/topics.js";
import type { Repo, SupplyEvidence, Topic, Gap } from "../core/types.js";
export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
const stamp = () => new Date().toISOString();
export class GitHub {
  constructor(private store: Store) {}
  async get<T>(path: string, ttl = 3600000): Promise<T> {
    const cached = this.store.get<T>("github:" + path);
    if (cached) return cached;
    const token = await githubToken();
    const response = await fetch("https://api.github.com" + path, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "ghtrends/0.3.0",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
      const delay =
        Number(response.headers.get("retry-after")) ||
        Math.max(
          0,
          Number(response.headers.get("x-ratelimit-reset")) - Date.now() / 1000,
        );
      throw new ProviderError(
        response.status === 429 ||
          response.headers.get("x-ratelimit-remaining") === "0"
          ? "GitHub rate limit reached. Cached results remain available."
          : response.status === 403
            ? "GitHub access denied. Check your token or App permissions."
            : `GitHub returned ${response.status}.`,
        [400, 404, 429].includes(response.status) ? response.status : 502,
        delay,
      );
    }
    const data = (await response.json()) as T;
    this.store.set("github:" + path, data, ttl);
    return data;
  }
  base(r: any): Repo {
    if (r.private)
      throw new ProviderError("Only public repositories are supported.", 400);
    return {
      name: r.full_name,
      description: r.description || "",
      url: `https://github.com/${r.full_name}`,
      stars: r.stargazers_count || 0,
      forks: r.forks_count || 0,
      language: r.language || null,
      license:
        r.license?.spdx_id === "NOASSERTION"
          ? null
          : r.license?.spdx_id || null,
      archived: r.archived,
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
      topics: r.topics || [],
      starHistory: [],
      growth7d: null,
      growth30d: null,
      growthWindowEnd: null,
      openIssues: r.open_issues_count || 0,
      issueResponseHours: null,
      issueSampleSize: 0,
      unansweredIssues: 0,
      contributors: null,
      topContributorShare: null,
      fetchedAt: stamp(),
      errors: [],
    };
  }
  async repo(input: string, deep = true): Promise<Repo> {
    const name = validateRepo(input),
      key = `repo:${name}:${deep}`;
    const cached = this.store.get<Repo>(key);
    if (cached) return cached;
    const repo = this.base(await this.get<any>(`/repos/${name}`));
    try {
      const weeks = await this.get<{ week: number; days: number[] }[]>(
        `/repos/${name}/stargazers/history?per_page=30`,
      );
      const today = stamp().slice(0, 10);
      repo.starHistory = weeks
        .flatMap((w) =>
          w.days.map((count, i) => ({
            date: new Date((w.week + i * 86400) * 1000)
              .toISOString()
              .slice(0, 10),
            count,
          })),
        )
        .filter((p) => p.date < today && Number.isFinite(p.count))
        .sort((a, b) => a.date.localeCompare(b.date));
      const last = repo.starHistory.at(-1);
      if (last) {
        repo.growthWindowEnd = last.date;
        repo.growth7d = repo.starHistory
          .slice(-7)
          .reduce((s, p) => s + p.count, 0);
        repo.growth30d = repo.starHistory
          .slice(-30)
          .reduce((s, p) => s + p.count, 0);
      }
    } catch (e) {
      repo.errors.push((e as Error).message);
    }
    if (deep) {
      try {
        const contributors = await this.get<
          { contributions: number; type: string }[]
        >(`/repos/${name}/contributors?per_page=100`);
        const humans = contributors.filter((c) => c.type !== "Bot");
        repo.contributors = humans.length;
        const sum = humans.reduce((s, c) => s + c.contributions, 0);
        repo.topContributorShare = sum
          ? Math.max(...humans.map((c) => c.contributions)) / sum
          : null;
        if (contributors.length === 100)
          repo.errors.push(
            "Contributor counts and concentration cover the first 100 returned contributors.",
          );
      } catch (e) {
        repo.errors.push((e as Error).message);
      }
      try {
        const issues = (
          await this.get<any[]>(
            `/repos/${name}/issues?state=all&sort=created&direction=desc&per_page=30`,
          )
        )
          .filter((i) => !i.pull_request)
          .slice(0, 8);
        const delays: number[] = [];
        repo.issueSampleSize = issues.length;
        for (const issue of issues) {
          if (!issue.comments) {
            repo.unansweredIssues++;
            continue;
          }
          const comments = await this.get<any[]>(
            `/repos/${name}/issues/${issue.number}/comments?per_page=100`,
          );
          const reply = comments.find(
            (c) =>
              c.user?.type !== "Bot" &&
              c.user?.login !== issue.user?.login &&
              ["OWNER", "MEMBER", "COLLABORATOR"].includes(
                c.author_association,
              ),
          );
          if (reply)
            delays.push(
              Math.max(
                0,
                (Date.parse(reply.created_at) - Date.parse(issue.created_at)) /
                  3600000,
              ),
            );
          else repo.unansweredIssues++;
        }
        repo.issueResponseHours = delays.length ? median(delays) : null;
      } catch (e) {
        repo.errors.push((e as Error).message);
      }
    }
    this.store.set(key, repo, 3600000);
    this.store.saveRepo(repo);
    return repo;
  }
  async supply(
    topic: Topic,
    onBase?: (supply: SupplyEvidence) => void,
  ): Promise<SupplyEvidence> {
    const since = new Date(Date.now() - POLICY.activeDays * 86400000)
      .toISOString()
      .slice(0, 10);
    const queries = (topic.queries || [topic.query]).map(
      (q) =>
        `${q} fork:false archived:false stars:>=${POLICY.minStars} pushed:>=${since}`,
    );
    const result: SupplyEvidence = {
      query: queries.join("; "),
      sourceUrl: `https://github.com/search?q=${encodeURIComponent(queries[0]!)}&type=repositories`,
      fetchedAt: stamp(),
      total: 0,
      complete: false,
      repositories: [],
      searches: [],
    };
    try {
      const unique = new Map<string, Repo>();
      let allEnumerated = true;
      for (const query of queries) {
        const data = await this.get<{
          total_count: number;
          incomplete_results: boolean;
          items: any[];
        }>(
          `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100`,
          21600000,
        );
        result.searches!.push({
          query,
          url: `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
          total: data.total_count,
          complete: !data.incomplete_results,
        });
        for (const r of data.items)
          if (!r.private && !r.archived && !r.fork)
            unique.set(r.full_name, this.base(r));
        allEnumerated &&=
          !data.incomplete_results && data.total_count <= data.items.length;
        if (queries.length === 1) {
          result.total = data.incomplete_results
            ? unique.size
            : data.total_count;
          result.complete = !data.incomplete_results;
        }
      }
      result.repositories = [...unique.values()].sort(
        (a, b) => b.stars - a.stars,
      );
      if (queries.length > 1) {
        result.total = unique.size;
        result.complete = allEnumerated;
      }
      onBase?.(structuredClone(result));
      // Three bounded workers avoid serial head-of-line delay without flooding GitHub.
      let cursor = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(3, result.repositories.length) },
          async () => {
            while (cursor < Math.min(10, result.repositories.length)) {
              const index = cursor++;
              try {
                result.repositories[index] = await this.repo(
                  result.repositories[index]!.name,
                  false,
                );
              } catch (e) {
                result.repositories[index]!.errors.push((e as Error).message);
              }
            }
          },
        ),
      );
    } catch (e) {
      result.error = (e as Error).message;
      onBase?.(structuredClone(result));
    }
    return result;
  }
  async gaps(repos: Repo[]): Promise<Gap[]> {
    if (!repos.length) return [];
    const scope = repos
      .slice(0, 5)
      .map((r) => `repo:${r.name}`)
      .join(" ");
    const query = `${scope} is:issue is:open reactions:>=2`;
    try {
      const data = await this.get<{ items: any[] }>(
        `/search/issues?q=${encodeURIComponent(query)}&sort=reactions&order=desc&per_page=30`,
        21600000,
      );
      return data.items.map((i) => {
        const body = String(i.body || "").slice(0, 10000),
          text = (i.title + " " + body).toLowerCase();
        const label: Gap["label"] = /alternative|replacement|instead of/.test(
          text,
        )
          ? "alternative"
          : /feature|support|request|enhancement/.test(text)
            ? "feature-request"
            : "friction";
        return {
          title: i.title,
          url: i.html_url,
          repo: i.repository_url.split("/").slice(-2).join("/"),
          reactions: i.reactions?.total_count || 0,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
          state: i.state,
          label,
          excerpt: body
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
            .replace(/[#*_`]/g, "")
            .slice(0, 260),
        };
      });
    } catch {
      return [];
    }
  }
}
