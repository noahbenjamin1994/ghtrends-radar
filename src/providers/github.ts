import { selectGapSignals } from "../core/gaps.js";
import { createHash } from "node:crypto";
import type { ProviderCall } from "../core/operations.js";
import type { DocumentRead } from "./documents.js";
import { githubToken } from "./github-auth.js";
import { Store } from "../core/store.js";
import { repoRelevance } from "../core/competition.js";
import { POLICY, median } from "../core/analyze.js";
import { validateRepo } from "../core/topics.js";
import type {
  Repo,
  SupplyEvidence,
  Topic,
  Gap,
  ResearchSource,
  RequestEvidence,
} from "../core/types.js";
interface GitHubIssue {
  id?: number;
  title: string;
  html_url: string;
  body?: string;
  state?: string;
  state_reason?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  reactions?: { total_count: number };
  comments?: number;
  user?: { id?: number; type?: string };
  author_association?: string;
  issue_url?: string;
  minimized?: unknown;
  pull_request?: unknown;
}

/** Markdown code and autolinks are publisher evidence, even when they contain
 * angle brackets. Remove presentation markup only outside fenced/inline code. */
export function cleanResearchMarkdown(text: string, limit: number) {
  const clean = (plain: string) =>
    plain
      .split(/(`+[^`]*`+)/g)
      .map((part) =>
        part.startsWith("`")
          ? part
          : part
              .replace(/<!--[\s\S]*?-->/g, "")
              .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
              .replace(
                /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*?)?\s*\/?>/g,
                " ",
              ),
      )
      .join("");
  let output = "",
    plain = "",
    fence = "";
  for (const line of text.match(/^.*(?:\n|$)/gm) || []) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      output += line;
      if (marker && marker[0] === fence[0] && marker.length >= fence.length)
        fence = "";
    } else if (marker) {
      output += clean(plain) + line;
      plain = "";
      fence = marker;
    } else plain += line;
  }
  return (output + clean(plain)).replace(/\n{3,}/g, "\n\n").slice(0, limit);
}

/** Keep the introduction and relevant Markdown sections within the same source
 * budget. Each part is an unchanged span; the separator marks omitted text. */
export function researchExcerpt(text: string, limit: number, focus = "") {
  const prefix = () => ({
    excerpt: text.slice(0, limit),
    excerptTruncated: text.length > limit,
  });
  if (text.length <= limit || !focus.trim()) return prefix();
  const stop = new Set(
    "a an and are as at be by for from how in into is it of on or that the this to using with tool tools app application software project open source self hosted".split(
      " ",
    ),
  );
  const terms = [
    ...new Set(
      focus
        .normalize("NFKC")
        .toLowerCase()
        .match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) || [],
    ),
  ]
    .filter(
      (word) => word.length >= 3 && /\p{L}/u.test(word) && !stop.has(word),
    )
    .slice(0, 16);
  if (!terms.length) return prefix();
  const headings: { start: number; title: string; level: number }[] = [];
  let fence = "";
  const lines = [...text.matchAll(/^.*(?:\n|$)/gm)];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]![0].trimEnd();
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = "";
      continue;
    }
    if (fence) continue;
    const atx = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const underline = /^(={3,}|-{3,})\s*$/.exec(lines[i + 1]?.[0] || "");
    if (atx)
      headings.push({
        start: lines[i]!.index!,
        title: atx[2]!,
        level: atx[1]!.length,
      });
    else if (line.trim() && !/^\s/.test(line) && underline) {
      headings.push({
        start: lines[i]!.index!,
        title: line,
        level: underline[1]![0] === "=" ? 1 : 2,
      });
      i++;
    }
  }
  const blocks = headings.map((h, i) => ({
    ...h,
    text: text.slice(h.start, headings[i + 1]?.start ?? text.length),
  }));
  if (blocks.length < 2) return prefix();
  const patterns = terms.map(
    (term) =>
      new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`,
        "iu",
      ),
  );
  const weights = patterns.map((pattern) =>
    Math.log1p(
      blocks.length /
        Math.max(1, blocks.filter((b) => pattern.test(b.text)).length),
    ),
  );
  const ranked = blocks
    .map((block) => ({
      ...block,
      score: /^(?:table of contents|contents|目录)$/i.test(block.title.trim())
        ? 0
        : patterns.reduce(
            (sum, pattern, i) =>
              sum +
              (pattern.test(block.title)
                ? 4
                : pattern.test(block.text)
                  ? 1
                  : 0) *
                weights[i]!,
            0,
          ),
    }))
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score || a.start - b.start);
  if (!ranked.length) return prefix();
  const separator = "\n\n[…]\n\n";
  const introEnd = Math.min(
    800,
    headings.find((h) => h.level > 1)?.start ?? 800,
  );
  const parts = [{ start: 0, value: text.slice(0, introEnd).trimEnd() }];
  let remaining = limit - parts[0]!.value.length;
  for (const block of ranked
    .filter((b) => b.score >= ranked[0]!.score * 0.35)
    .slice(0, 3)) {
    if (remaining <= separator.length + 40) break;
    const start = Math.max(block.start, introEnd);
    const content = block.text.slice(start - block.start);
    const available = remaining - separator.length;
    const value = content
      .slice(
        0,
        content.length <= available
          ? content.length
          : Math.min(3000, available),
      )
      .trim();
    if (value.length < 40) continue;
    parts.push({ start, value });
    remaining -= value.length + separator.length;
  }
  if (parts.length === 1) return prefix();
  return {
    excerpt: parts
      .sort((a, b) => a.start - b.start)
      .map((p) => p.value)
      .filter(Boolean)
      .join(separator),
    excerptTruncated: true,
  };
}

function requestEvidence(
  issue: GitHubIssue,
  observedAt?: string,
): RequestEvidence {
  const date = (value?: string) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toISOString()
      : undefined;
  const count = (value?: number) =>
    Number.isSafeInteger(value) && value! >= 0 ? value : undefined;
  return Object.fromEntries(
    Object.entries({
      state: ["open", "closed"].includes(issue.state || "")
        ? issue.state
        : undefined,
      stateReason: ["completed", "not_planned", "reopened"].includes(
        issue.state_reason || "",
      )
        ? issue.state_reason
        : undefined,
      createdAt: date(issue.created_at),
      updatedAt: date(issue.updated_at),
      closedAt: date(issue.closed_at),
      observedAt: date(observedAt),
      reactions: count(issue.reactions?.total_count),
      comments: count(issue.comments),
      authorAssociation: [
        "OWNER",
        "MEMBER",
        "COLLABORATOR",
        "CONTRIBUTOR",
        "FIRST_TIMER",
        "FIRST_TIME_CONTRIBUTOR",
        "MANNEQUIN",
        "NONE",
      ].includes(issue.author_association || "")
        ? issue.author_association
        : undefined,
      authorKey:
        Number.isSafeInteger(issue.user?.id) &&
        issue.user!.id! > 0 &&
        issue.user?.type !== "Bot"
          ? createHash("sha256")
              .update("github:" + issue.user!.id)
              .digest("hex")
              .slice(0, 24)
          : undefined,
    }).filter(([, value]) => value !== undefined),
  );
}
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
    const call: ProviderCall = {
      provider: "github",
      operation: path.endsWith("/readme")
        ? "readme"
        : path.startsWith("/search/")
          ? "search"
          : "repository",
      started: new Date().toISOString(),
      durationMs: 0,
    };
    if (cached) {
      this.store.recordCall({ ...call, cached: true });
      return cached;
    }
    const started = Date.now();
    try {
      const token = await githubToken();
      const response = await fetch("https://api.github.com" + path, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "ghtrends/0.4.1",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(25000),
      });
      call.status = response.status;
      call.rateBucket =
        response.headers.get("x-ratelimit-resource") || undefined;
      const remaining = response.headers.get("x-ratelimit-remaining"),
        reset = response.headers.get("x-ratelimit-reset");
      call.rateRemaining =
        remaining !== null && Number.isFinite(Number(remaining))
          ? Number(remaining)
          : undefined;
      call.rateReset =
        reset !== null && Number.isFinite(Number(reset))
          ? Number(reset)
          : undefined;
      if (!response.ok) {
        call.error = `http_${response.status}`;
        const delay =
          Number(response.headers.get("retry-after")) ||
          Math.max(
            0,
            Number(response.headers.get("x-ratelimit-reset")) -
              Date.now() / 1000,
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
      this.store.set("github-observed:" + path, stamp(), ttl);
      return data;
    } catch (e) {
      call.error ||= "network_error";
      throw e;
    } finally {
      call.durationMs = Date.now() - started;
      this.store.recordCall(call);
    }
  }
  observedAt(path: string) {
    return this.store.get<string>("github-observed:" + path) || undefined;
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
        for (const r of data.items) {
          if (!r.private && !r.archived && !r.fork) {
            const repo = unique.get(r.full_name) || this.base(r);
            repo.matchedQueries = [
              ...(repo.matchedQueries || []),
              query.split(" fork:")[0]!,
            ];
            unique.set(r.full_name, repo);
          }
        }
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
        // A union contains at least as many repos as each complete query.
        // First-page deduplication alone can undercount a 6,000-repo query as 100.
        result.total = Math.max(
          unique.size,
          ...result
            .searches!.filter((search) => search.complete)
            .map((search) => search.total),
        );
        result.complete = allEnumerated;
      }
      result.repositories = result.repositories.map((r) => ({
        ...r,
        relevance: repoRelevance(r, topic),
      }));
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
                result.repositories[index] = {
                  ...(await this.repo(result.repositories[index]!.name, false)),
                  matchedQueries: result.repositories[index]!.matchedQueries,
                  relevance: result.repositories[index]!.relevance,
                };
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
  async directionEvidence(
    directions: { id: string; query: string }[],
  ): Promise<ResearchSource[]> {
    const selected = directions
      .filter(
        (d, i, all) =>
          /^[a-z][a-z0-9-]{1,40}$/.test(d.id) &&
          all.findIndex((x) => x.id === d.id) === i &&
          d.query.length >= 2 &&
          d.query.length <= 70 &&
          /^[\p{L}\p{N}][\p{L}\p{N} .+/#()&-]*$/u.test(d.query),
      )
      .slice(0, 5);
    const output: ResearchSource[][] = new Array(selected.length);
    let cursor = 0;
    // Two source workers bound API pressure. Each task keeps its own evidence IDs.
    await Promise.all(
      Array.from({ length: Math.min(2, selected.length) }, async () => {
        while (cursor < selected.length) {
          const index = cursor++,
            direction = selected[index]!;
          const prefix = `D${index + 1}`;
          const docs = await this.ideaAlternatives([direction.query]);
          const sources: ResearchSource[] = docs.map((s) => ({
            ...s,
            id: prefix + s.id,
            directionId: direction.id,
            kind: s.kind || "search",
          }));
          try {
            // Comments on rolling task logs can mention almost any topic.
            // Search the original request text and use GitHub's best match.
            const q = `${direction.query} in:title,body is:issue is:open`;
            const path =
              "/search/issues?" + new URLSearchParams({ q, per_page: "3" });
            const data = await this.get<{ items: GitHubIssue[] }>(
              path,
              21600000,
            );
            const observedAt = this.observedAt(path);
            for (const [i, issue] of data.items.slice(0, 3).entries()) {
              if (
                !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/.test(
                  issue.html_url,
                )
              )
                continue;
              sources.push({
                id: `${prefix}I${i + 1}`,
                directionId: direction.id,
                kind: "request",
                label: issue.title.slice(0, 150),
                url: issue.html_url,
                fetchedAt: observedAt,
                request: requestEvidence(issue, observedAt),
                excerpt: `${issue.title.slice(0, 300)}\n${(issue.body || "")
                  .replace(/<!--[\s\S]*?-->/g, "")
                  .replace(/<[^>]*>/g, " ")
                  .slice(0, 1600)}`,
              });
            }
          } catch {
            /* Project evidence survives issue-search rate limits. */
          }
          output[index] = sources;
        }
      }),
    );
    return output.flat();
  }
  async ideaAlternatives(queries: string[]): Promise<ResearchSource[]> {
    const terms = [...new Set(queries)]
      .filter(
        (q) =>
          q.length >= 2 &&
          q.length <= 70 &&
          /^[\p{L}\p{N}][\p{L}\p{N} .+/#()&-]*$/u.test(q),
      )
      .slice(0, 2);
    const results = await Promise.allSettled(
      terms.map(async (term, i) => {
        const q = `${term} in:name,description fork:false archived:false`;
        const data = await this.get<{
          total_count: number;
          items: { full_name: string; description: string | null }[];
        }>(
          "/search/repositories?" +
            new URLSearchParams({ q, per_page: "4", sort: "stars" }),
          21600000,
        );
        const candidates = data.items.slice(0, 4).map((r) => ({
          name: validateRepo(r.full_name),
          description: (r.description || "").slice(0, 500),
        }));
        const sources: ResearchSource[] = [
          {
            id: `A${i + 1}`,
            label: `Related tools: ${term} · ${candidates.length} returned`,
            url:
              "https://github.com/search?" +
              new URLSearchParams({ q, type: "repositories" }),
            excerpt: candidates
              .map((r) => `${r.name}: ${r.description}`)
              .join("\n"),
          },
        ];
        if (candidates[0]) {
          const docs = await this.researchSources(
            [{ name: candidates[0].name } as Repo],
            [],
          );
          sources.push(
            ...docs.map((d, j) => ({
              ...d,
              id: `A${i + 1}${d.id?.startsWith("R") ? "R" : d.id?.startsWith("V") ? "V" : `D${j + 1}`}`,
            })),
          );
        }
        return sources;
      }),
    );
    return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  }
  async licenseSources(repos: Repo[]): Promise<ResearchSource[]> {
    const results = await Promise.allSettled(
      repos.slice(0, 2).map(async (repo, i): Promise<ResearchSource> => {
        const name = validateRepo(repo.name),
          path = `/repos/${name}/license`;
        const doc = await this.get<{
          encoding?: string;
          content?: string;
          size?: number;
          html_url?: string;
          license?: { spdx_id?: string };
        }>(path, 3600000);
        const url = new URL(doc.html_url || "https://github.com/");
        if (
          doc.encoding !== "base64" ||
          !doc.content ||
          doc.content.length > 150000 ||
          (doc.size || 0) > 100000 ||
          url.origin !== "https://github.com" ||
          !url.pathname.startsWith(`/${name}/blob/`)
        )
          throw new Error("license_source");
        const content = Buffer.from(doc.content, "base64").toString("utf8");
        return {
          id: `L${i + 1}`,
          kind: "project",
          documentType: "license",
          label: `${name} · License · ${doc.license?.spdx_id || "Review terms"}`,
          url: url.href,
          fetchedAt: this.observedAt(path),
          excerpt: content.slice(0, 20000),
          excerptTruncated: content.length > 20000,
        };
      }),
    );
    return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  }
  /** Read a bounded conversation around selected issues, including late replies.
   * Account keys describe authorship only; demand and recruitment need the text. */
  async issueThreadSources(
    candidates: ResearchSource[],
    onRead?: (read: DocumentRead) => void,
  ): Promise<ResearchSource[]> {
    const selected = [
      ...new Map(
        candidates
          .filter((s) =>
            /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/[1-9]\d*$/.test(
              s.url,
            ),
          )
          .map((s) => [s.url.toLowerCase(), s]),
      ).values(),
    ].slice(0, 2);
    const threads = await Promise.all(
      selected.map(async (source, index) => {
        const out: ResearchSource[] = [];
        try {
          const parts = new URL(source.url).pathname.split("/"),
            name = validateRepo(`${parts[1]}/${parts[2]}`),
            number = Number(parts[4]);
          if (!Number.isSafeInteger(number) || number > 2147483647) return out;
          const repo = await this.get<{ private: boolean }>(
            `/repos/${name}`,
            3600000,
          );
          if (repo.private !== false)
            throw new ProviderError("Public issue access required.", 403);
          const path = `/repos/${name}/issues/${number}`,
            issue = await this.get<GitHubIssue>(path, 3600000);
          if (
            issue.pull_request ||
            issue.html_url?.toLowerCase() !== source.url.toLowerCase() ||
            typeof issue.body !== "string"
          )
            throw new Error("issue_source");
          const fetchedAt = this.observedAt(path),
            body = cleanResearchMarkdown(
              `${issue.title}\n${issue.body}`,
              300000,
            ),
            parent: ResearchSource = {
              id: `GT${index + 1}`,
              kind: "request",
              documentType: "github-issue",
              label: issue.title.slice(0, 180),
              url: issue.html_url,
              fetchedAt,
              publishedAt: issue.created_at,
              request: requestEvidence(issue, fetchedAt),
              excerpt: body.slice(0, 4000),
              excerptTruncated: body.length > 4000,
            };
          out.push(parent);
          onRead?.({
            url: parent.url,
            status: "read",
            observedAt: fetchedAt || stamp(),
          });
          const count = parent.request!.comments,
            pages =
              count === 0
                ? []
                : count && count > 30
                  ? [1, Math.ceil(count / 30)]
                  : [1];
          const results = await Promise.allSettled(
            pages.map(async (page) => {
              const commentsPath = `${path}/comments?per_page=30&page=${page}`;
              try {
                const rows = await this.get<GitHubIssue[]>(
                  commentsPath,
                  3600000,
                );
                if (!Array.isArray(rows) || rows.length > 30)
                  throw new Error("issue_comments_format");
                onRead?.({
                  url: `https://api.github.com${commentsPath}`,
                  status: "read",
                  observedAt: this.observedAt(commentsPath) || stamp(),
                });
                return {
                  page,
                  rows,
                  observedAt: this.observedAt(commentsPath),
                };
              } catch (error) {
                onRead?.({
                  url: `https://api.github.com${commentsPath}`,
                  status:
                    error instanceof ProviderError ? "access" : "unavailable",
                  observedAt: stamp(),
                });
                throw error;
              }
            }),
          );
          const successful = results.flatMap((r) =>
            r.status === "fulfilled" ? [r.value] : [],
          );
          const comments = [
            ...new Map(
              successful.flatMap(({ rows, observedAt }) =>
                rows.flatMap((c) => {
                  if (
                    !Number.isSafeInteger(c.id) ||
                    c.id! <= 0 ||
                    c.user?.type !== "User" ||
                    !Number.isSafeInteger(c.user.id) ||
                    c.user.id! <= 0 ||
                    c.minimized ||
                    typeof c.body !== "string" ||
                    c.body.trim().length < 8 ||
                    c.html_url?.toLowerCase() !==
                      `${parent.url}#issuecomment-${c.id}`.toLowerCase() ||
                    c.issue_url?.toLowerCase() !==
                      `https://api.github.com${path}`.toLowerCase()
                  )
                    return [];
                  const text = cleanResearchMarkdown(c.body, 300000);
                  return [
                    [
                      c.id!,
                      {
                        id: `GT${index + 1}C${c.id}`,
                        kind: "request",
                        documentType: "github-comment",
                        label: `${issue.title.slice(0, 140)} · Comment`,
                        url: c.html_url,
                        parentUrl: parent.url,
                        fetchedAt: observedAt,
                        publishedAt: c.created_at,
                        request: requestEvidence(c, observedAt),
                        excerpt: text.slice(0, 1800),
                        excerptTruncated: text.length > 1800,
                      } as ResearchSource,
                    ] as const,
                  ];
                }),
              ),
            ).values(),
          ];
          // One early comment retains context; two later ones capture developments.
          const included = [
            ...new Map(
              [...comments.slice(0, 1), ...comments.slice(-2)].map((s) => [
                s.url,
                s,
              ]),
            ).values(),
          ];
          parent.request!.commentSample = {
            pages: successful.map((p) => p.page),
            pageSize: 30,
            readComments: successful.reduce((n, p) => n + p.rows.length, 0),
            includedComments: included.length,
            distinctAccounts: new Set(included.map((s) => s.request!.authorKey))
              .size,
          };
          return [...out, ...included];
        } catch (error) {
          onRead?.({
            url: source.url,
            status: error instanceof ProviderError ? "access" : "unavailable",
            observedAt: stamp(),
          });
          return out;
        }
      }),
    );
    return threads.flat();
  }
  async discussionSources(
    candidates: ResearchSource[],
    onRead?: (read: DocumentRead) => void,
  ): Promise<ResearchSource[]> {
    const selected = [
      ...new Map(
        candidates
          .filter(
            (s) =>
              s.placement === "organic" &&
              /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/discussions\/[1-9]\d*$/.test(
                s.url,
              ),
          )
          .map((s) => [s.url, s]),
      ).values(),
    ].slice(0, 2);
    const output: ResearchSource[] = [];
    for (const [index, source] of selected.entries()) {
      const key = `github-discussion:v1:${source.url}`;
      const cached = this.store.get<ResearchSource[]>(key);
      if (cached) {
        this.store.recordCall({
          provider: "github",
          operation: "discussion",
          started: stamp(),
          durationMs: 0,
          cached: true,
        });
        output.push(
          ...cached.map((s, i) => ({ ...s, id: `GD${index + 1}D${i + 1}` })),
        );
        onRead?.({
          url: source.url,
          status: "read",
          observedAt: cached[0]?.fetchedAt || stamp(),
        });
        continue;
      }
      let status: DocumentRead["status"] = "unavailable";
      const started = Date.now(),
        call: ProviderCall = {
          provider: "github",
          operation: "discussion",
          started: stamp(),
          durationMs: 0,
        };
      try {
        const parts = new URL(source.url).pathname.split("/"),
          name = validateRepo(`${parts[1]}/${parts[2]}`),
          number = Number(parts[4]);
        if (!Number.isSafeInteger(number) || number > 2147483647) continue;
        const token = await githubToken();
        if (!token) {
          call.error = "discussion_access";
          status = "access";
          continue;
        }
        const r = await fetch("https://api.github.com/graphql", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "ghtrends/0.20.0",
          },
          body: JSON.stringify({
            query: `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){isPrivate discussion(number:$number){title url bodyText createdAt updatedAt closed closedAt isAnswered author{login ... on User{databaseId}} comments{totalCount} answer{url bodyText createdAt isMinimized}}} rateLimit{remaining resetAt}}`,
            variables: { owner: parts[1], name: parts[2], number },
          }),
        });
        call.status = r.status;
        if (!r.ok) {
          call.error = `http_${r.status}`;
          if ([401, 403, 429].includes(r.status)) status = "access";
          continue;
        }
        const reader = r.body?.getReader();
        if (!reader) throw new Error("discussion_format");
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 250000) {
            await reader.cancel();
            throw new Error("discussion_size");
          }
          chunks.push(value);
        }
        call.transferBytes = bytes;
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        call.rateBucket = "graphql";
        const rate = data.data?.rateLimit;
        if (rate) {
          call.rateRemaining = Number.isSafeInteger(rate.remaining)
            ? rate.remaining
            : undefined;
          call.rateReset = Number.isFinite(Date.parse(rate.resetAt))
            ? Math.floor(Date.parse(rate.resetAt) / 1000)
            : undefined;
        }
        const repo = data.data?.repository,
          d = repo?.discussion;
        if (data.errors?.some((e: any) => e.type === "FORBIDDEN"))
          status = "access";
        if (
          data.errors?.length ||
          !repo ||
          repo.isPrivate !== false ||
          d?.url !== source.url ||
          typeof d.bodyText !== "string"
        )
          throw new Error("discussion_source");
        const fetchedAt = stamp(),
          sources: ResearchSource[] = [
            {
              id: `GD${index + 1}D1`,
              kind: "request",
              documentType: "github-discussion",
              label: String(d.title).slice(0, 180),
              url: d.url,
              fetchedAt,
              publishedAt: d.createdAt,
              request: {
                state: d.isAnswered ? "answered" : d.closed ? "closed" : "open",
                closedAt: d.closedAt || undefined,
                createdAt: d.createdAt,
                updatedAt: d.updatedAt,
                observedAt: fetchedAt,
                comments: d.comments?.totalCount,
                authorKey:
                  typeof d.author?.login === "string"
                    ? createHash("sha256")
                        .update(
                          Number.isSafeInteger(d.author.databaseId) &&
                            d.author.databaseId > 0
                            ? "github:" + d.author.databaseId
                            : "github-login:" + d.author.login.toLowerCase(),
                        )
                        .digest("hex")
                        .slice(0, 24)
                    : undefined,
              },
              excerpt: d.bodyText.slice(0, 2500),
            },
          ];
        if (
          d.answer &&
          !d.answer.isMinimized &&
          typeof d.answer.bodyText === "string" &&
          typeof d.answer.url === "string" &&
          new RegExp(
            "^" +
              source.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
              "#discussioncomment-[1-9]\\d*$",
          ).test(d.answer.url)
        )
          sources.push({
            id: `GD${index + 1}D2`,
            kind: "project",
            documentType: "github-discussion",
            label: `${String(d.title).slice(0, 140)} · Accepted answer`,
            url: d.answer.url,
            parentUrl: source.url,
            fetchedAt,
            publishedAt: d.answer.createdAt,
            excerpt: d.answer.bodyText.slice(0, 2500),
          });
        this.store.set(key, sources, 3600000);
        output.push(...sources);
        status = "read";
      } catch {
        call.error ||= "discussion_source";
      } finally {
        call.durationMs = Date.now() - started;
        this.store.recordCall(call);
        onRead?.({ url: source.url, status, observedAt: stamp() });
      }
    }
    return output;
  }
  async researchSources(
    repos: Repo[],
    gaps: Gap[],
    focus = "",
  ): Promise<ResearchSource[]> {
    // Excerpts are citable publisher text. Keep our review guidance and
    // observation metadata outside them so they cannot become source quotes.
    const selected = repos
      .filter((r) => !r.relevance || r.relevance.role === "direct")
      .slice(0, 4);
    const clean = cleanResearchMarkdown;
    const documents = await Promise.allSettled([
      ...selected.map(async (repo, i): Promise<ResearchSource> => {
        const name = validateRepo(repo.name);
        const path = `/repos/${name}/readme`;
        const doc = await this.get<{
          encoding?: string;
          content?: string;
          html_url?: string;
          size?: number;
        }>(path, 86400000);
        if (
          doc.encoding !== "base64" ||
          !doc.content ||
          (doc.size || 0) > 300000
        )
          throw new Error("README excerpt pending");
        const url = new URL(
          doc.html_url || `https://github.com/${name}#readme`,
        );
        if (
          url.origin !== "https://github.com" ||
          (url.pathname !== `/${name}` && !url.pathname.startsWith(`/${name}/`))
        )
          throw new Error("README source pending");
        return {
          id: `R${i + 1}`,
          kind: "project",
          documentType: "github-readme",
          label: `${name} · README`,
          url: url.href,
          fetchedAt: this.observedAt(path),
          ...researchExcerpt(
            clean(Buffer.from(doc.content, "base64").toString("utf8"), 300000),
            focus ? 6000 : 7000,
            focus,
          ),
        };
      }),
      ...selected.map(async (repo, i): Promise<ResearchSource> => {
        const name = validateRepo(repo.name),
          path = `/repos/${name}/releases/latest`;
        const release = await this.get<{
          tag_name?: string;
          html_url?: string;
          published_at?: string;
          body?: string;
        }>(path, 14400000);
        const url = new URL(release.html_url || "https://github.com/");
        if (
          !release.tag_name ||
          url.origin !== "https://github.com" ||
          !url.pathname.startsWith(`/${name}/releases/tag/`)
        )
          throw new Error("Release source pending");
        return {
          id: `V${i + 1}`,
          kind: "project",
          documentType: "github-release",
          label: `${name} · ${release.tag_name.slice(0, 100)}`,
          url: url.href,
          fetchedAt: this.observedAt(path),
          publishedAt: release.published_at,
          ...researchExcerpt(clean(release.body || "", 300000), 2200, focus),
        };
      }),
      ...gaps.slice(0, 3).map(async (gap, i): Promise<ResearchSource> => {
        const match =
          /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(
            gap.url,
          );
        if (!match) throw new Error("Issue source pending");
        const name = validateRepo(match[1]!);
        const path = `/repos/${name}/issues/${match[2]}`;
        const issue = await this.get<GitHubIssue>(path, 21600000);
        const observedAt = this.observedAt(path);
        return {
          id: `I${i + 1}`,
          kind: "request",
          label: gap.title,
          url: gap.url,
          fetchedAt: observedAt,
          request: requestEvidence(issue, observedAt),
          excerpt: `${issue.title}\n${clean(issue.body || gap.excerpt, 1800)}`,
        };
      }),
    ]);
    return documents.flatMap((d) =>
      d.status === "fulfilled" ? [d.value] : [],
    );
  }
  async gaps(repos: Repo[]): Promise<Gap[]> {
    if (!repos.length) return [];
    const scope = repos
      .slice(0, 5)
      .map((r) => `repo:${r.name}`)
      .join(" ");
    const recent = new Date(Date.now() - 90 * 86400000)
      .toISOString()
      .slice(0, 10);
    const paths = [
      `/search/issues?q=${encodeURIComponent(`${scope} is:issue is:open reactions:>=2`)}&sort=reactions&order=desc&per_page=30`,
      `/search/issues?q=${encodeURIComponent(`${scope} is:issue is:open updated:>=${recent}`)}&sort=updated&order=desc&per_page=30`,
    ];
    const pages = await Promise.allSettled(
      paths.map(async (path) => {
        const data = await this.get<{ items: GitHubIssue[] }>(path, 21600000);
        return data.items
          .filter((i) => !i.pull_request)
          .flatMap((i): Gap[] => {
            const match =
              /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/\d+$/.exec(
                i.html_url || "",
              );
            if (
              !match ||
              !repos
                .slice(0, 5)
                .some((r) => r.name.toLowerCase() === match[1]!.toLowerCase())
            )
              return [];
            const evidence = requestEvidence(i, this.observedAt(path)),
              body = String(i.body || "").slice(0, 10000),
              text = (i.title + " " + body).toLowerCase();
            const label: Gap["label"] =
              /alternative|replacement|instead of/.test(text)
                ? "alternative"
                : /feature|support|request|enhancement/.test(text)
                  ? "feature-request"
                  : "friction";
            return [
              {
                ...evidence,
                title: i.title,
                url: i.html_url,
                repo: match[1]!,
                reactions: evidence.reactions ?? 0,
                createdAt: evidence.createdAt || "",
                updatedAt: evidence.updatedAt || "",
                state: evidence.state || "",
                label,
                excerpt: body
                  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
                  .replace(/[#*_`]/g, "")
                  .slice(0, 260),
              },
            ];
          });
      }),
    );
    return selectGapSignals(
      pages.flatMap((p) => (p.status === "fulfilled" ? p.value : [])),
    ).slice(0, 12);
  }
}
