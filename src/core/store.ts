import type { EngagementEvent } from "./engagement.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveTopic } from "./topics.js";
import type { Market, Repo } from "./types.js";
import {
  operationContext,
  type ProviderCall,
  type RunRecord,
  type RunState,
} from "./operations.js";
export class Store {
  private db: DatabaseSync;
  private lastPruned = 0;
  constructor(
    directory = process.env.GHTRENDS_DATA_DIR || join(homedir(), ".ghtrends"),
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "ghtrends.sqlite"));
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = join(directory, "ghtrends.sqlite" + suffix);
      if (existsSync(file)) chmodSync(file, 0o600);
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS markets(id TEXT PRIMARY KEY,topic TEXT NOT NULL,geo TEXT NOT NULL,created TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS markets_topic ON markets(topic,geo,created DESC);
      CREATE TABLE IF NOT EXISTS watch(repo TEXT PRIMARY KEY,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS repo_snapshots(repo TEXT NOT NULL,day TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(repo,day));
      CREATE TABLE IF NOT EXISTS report_visibility(report_id TEXT PRIMARY KEY,public INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO report_visibility SELECT id,1 FROM markets;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_reports(user_id TEXT NOT NULL,report_id TEXT NOT NULL,input TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(user_id,report_id));
      CREATE TABLE IF NOT EXISTS report_owners(report_id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_watch(user_id TEXT NOT NULL,repo TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(user_id,repo));
      CREATE TABLE IF NOT EXISTS usage_daily(user_id TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(user_id,day));
      CREATE TABLE IF NOT EXISTS engagement_daily(day TEXT NOT NULL,event TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(day,event));
      CREATE TABLE IF NOT EXISTS operations_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scan_runs(id TEXT PRIMARY KEY,user_id TEXT,input TEXT NOT NULL,geo TEXT NOT NULL,background INTEGER NOT NULL,created TEXT NOT NULL,started TEXT,finished TEXT,state TEXT NOT NULL,report_id TEXT,error TEXT,warnings TEXT);
      CREATE INDEX IF NOT EXISTS scan_runs_created ON scan_runs(created DESC);
      CREATE INDEX IF NOT EXISTS scan_runs_user ON scan_runs(user_id,created);
      CREATE TABLE IF NOT EXISTS provider_calls(id INTEGER PRIMARY KEY,run_id TEXT,user_id TEXT,provider TEXT NOT NULL,operation TEXT NOT NULL,started TEXT NOT NULL,duration_ms INTEGER NOT NULL,cached INTEGER NOT NULL,status INTEGER,error TEXT,model TEXT,input_tokens INTEGER,output_tokens INTEGER,cached_tokens INTEGER,cost_usd REAL,rate_bucket TEXT,rate_remaining INTEGER,rate_reset INTEGER);
      CREATE INDEX IF NOT EXISTS provider_calls_started ON provider_calls(started DESC);
      CREATE INDEX IF NOT EXISTS provider_calls_run ON provider_calls(run_id);
      CREATE INDEX IF NOT EXISTS provider_calls_user ON provider_calls(user_id,started);
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO operations_meta VALUES('since',?)")
      .run(new Date().toISOString());
    this.db
      .prepare(
        "INSERT OR IGNORE INTO operations_meta VALUES('engagement_since',?)",
      )
      .run(new Date().toISOString());
    this.pruneOperations();
  }
  get retentionDays() {
    return Math.min(
      365,
      Math.max(
        1,
        Math.floor(Number(process.env.GHTRENDS_LOG_RETENTION_DAYS) || 30),
      ),
    );
  }
  pruneOperations() {
    this.lastPruned = Date.now();
    const before = new Date(
      Date.now() - this.retentionDays * 86400000,
    ).toISOString();
    this.db
      .prepare("DELETE FROM engagement_daily WHERE day<?")
      .run(before.slice(0, 10));
    this.db.prepare("DELETE FROM provider_calls WHERE started<?").run(before);
    this.db
      .prepare(
        "DELETE FROM scan_runs WHERE created<? AND state NOT IN ('queued','running')",
      )
      .run(before);
    this.db
      .prepare("DELETE FROM cache WHERE expires<? AND key NOT LIKE 'trends:%'")
      .run(Date.now() - 86400000);
  }
  recordEvent(event: EngagementEvent) {
    this.db
      .prepare(
        "INSERT INTO engagement_daily VALUES(?,?,1) ON CONFLICT(day,event) DO UPDATE SET count=count+1",
      )
      .run(new Date().toISOString().slice(0, 10), event);
  }
  hasHistory(user: string, id: string) {
    return !!this.db
      .prepare("SELECT 1 FROM user_reports WHERE user_id=? AND report_id=?")
      .get(user, id);
  }
  recordCall(c: ProviderCall) {
    if (Date.now() - this.lastPruned > 3600000) this.pruneOperations();
    const context = operationContext.getStore();
    this.db
      .prepare(
        "INSERT INTO provider_calls(run_id,user_id,provider,operation,started,duration_ms,cached,status,error,model,input_tokens,output_tokens,cached_tokens,cost_usd,rate_bucket,rate_remaining,rate_reset) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        context?.runId ?? null,
        context?.userId ?? null,
        c.provider,
        c.operation,
        c.started,
        Math.max(0, Math.round(c.durationMs)),
        Number(!!c.cached),
        c.status ?? null,
        c.error ?? null,
        c.model ?? null,
        c.inputTokens ?? null,
        c.outputTokens ?? null,
        c.cachedTokens ?? null,
        c.costUsd ?? null,
        c.rateBucket ?? null,
        c.rateRemaining ?? null,
        c.rateReset ?? null,
      );
  }
  startRun(r: RunRecord) {
    this.db
      .prepare(
        "INSERT INTO scan_runs(id,user_id,input,geo,background,created,state) VALUES(?,?,?,?,?,?,'queued')",
      )
      .run(
        r.id,
        r.userId ?? null,
        r.input,
        r.geo,
        Number(r.background),
        r.created,
      );
  }
  updateRun(
    id: string,
    state: RunState,
    result?: { reportId?: string; error?: string; warnings?: string[] },
  ) {
    this.db
      .prepare(
        "UPDATE scan_runs SET state=?,started=CASE WHEN ?='running' THEN ? ELSE started END,finished=CASE WHEN ? IN ('complete','failed','interrupted') THEN ? ELSE finished END,report_id=COALESCE(?,report_id),error=?,warnings=? WHERE id=?",
      )
      .run(
        state,
        state,
        new Date().toISOString(),
        state,
        new Date().toISOString(),
        result?.reportId ?? null,
        result?.error?.slice(0, 600) ?? null,
        JSON.stringify(result?.warnings || []),
        id,
      );
  }
  interruptRuns() {
    this.db
      .prepare(
        "UPDATE scan_runs SET state='interrupted',finished=?,error='Server restarted before this scan completed.' WHERE state IN ('queued','running')",
      )
      .run(new Date().toISOString());
  }
  adminOverview(days: number, page: number, state: string) {
    if (Date.now() - this.lastPruned > 3600000) this.pruneOperations();
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const engagementDay = new Date(Date.now() - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
    const filter = "r.created>=? AND (?='' OR r.state=?)";
    return {
      recordedSince: (
        this.db
          .prepare("SELECT value FROM operations_meta WHERE key='since'")
          .get() as { value: string }
      ).value,
      engagement: {
        since: (
          this.db
            .prepare(
              "SELECT value FROM operations_meta WHERE key='engagement_since'",
            )
            .get() as { value: string }
        ).value,
        events: this.db
          .prepare(
            "SELECT event,SUM(count) AS count FROM engagement_daily WHERE day>=? GROUP BY event",
          )
          .all(engagementDay),
        scans: this.db
          .prepare(
            "SELECT state,COUNT(*) AS count FROM scan_runs WHERE background=0 AND created>=? GROUP BY state",
          )
          .all(since),
      },
      retentionDays: this.retentionDays,
      days,
      page,
      totals: this.db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM markets) AS reports,(SELECT COUNT(*) FROM report_visibility WHERE public=0) AS privateReports,(SELECT page_count*page_size FROM pragma_page_count(),pragma_page_size()) AS databaseBytes",
        )
        .get(),
      runsSummary: this.db
        .prepare(
          "SELECT state,COUNT(*) AS count FROM scan_runs WHERE created>=? GROUP BY state",
        )
        .all(since),
      providers: this.db
        .prepare(
          "SELECT provider,COUNT(*) AS calls,SUM(cached) AS cacheHits,SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors,AVG(CASE WHEN cached=0 THEN duration_ms END) AS averageMs FROM provider_calls WHERE started>=? GROUP BY provider",
        )
        .all(since),
      models: this.db
        .prepare(
          "SELECT model,operation,COUNT(*) AS requests,SUM(cached) AS cacheHits,SUM(input_tokens) AS inputTokens,SUM(output_tokens) AS outputTokens,SUM(cached_tokens) AS cachedTokens,SUM(cost_usd) AS estimatedUsd,SUM(CASE WHEN cached=0 AND (input_tokens IS NULL OR output_tokens IS NULL) THEN 1 ELSE 0 END) AS unknownUsage,SUM(CASE WHEN cached=0 AND cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced FROM provider_calls WHERE provider='deepseek' AND started>=? GROUP BY model,operation",
        )
        .all(since),
      users: this.db
        .prepare(
          "SELECT u.id,u.name,u.created,(SELECT COUNT(*) FROM user_reports WHERE user_id=u.id) AS reports,(SELECT COUNT(*) FROM scan_runs WHERE user_id=u.id AND created>=?) AS scans,(SELECT SUM(cost_usd) FROM provider_calls WHERE user_id=u.id AND started>=?) AS estimatedUsd FROM users u ORDER BY scans DESC,u.created DESC LIMIT 100",
        )
        .all(since, since),
      runCount: (
        this.db
          .prepare(`SELECT COUNT(*) AS n FROM scan_runs r WHERE ${filter}`)
          .get(since, state, state) as { n: number }
      ).n,
      runs: this.db
        .prepare(
          `SELECT r.*,u.name AS user_name,(SELECT SUM(cost_usd) FROM provider_calls WHERE run_id=r.id) AS estimated_usd FROM scan_runs r LEFT JOIN users u ON u.id=r.user_id WHERE ${filter} ORDER BY r.created DESC,r.id DESC LIMIT 20 OFFSET ?`,
        )
        .all(since, state, state, page * 20),
      recentErrors: this.db
        .prepare(
          "SELECT provider,operation,started,status,error,run_id FROM provider_calls WHERE started>=? AND error IS NOT NULL ORDER BY started DESC LIMIT 20",
        )
        .all(since),
      githubLimits: this.db
        .prepare(
          "SELECT rate_bucket,rate_remaining,rate_reset,started FROM (SELECT rate_bucket,rate_remaining,rate_reset,started,ROW_NUMBER() OVER(PARTITION BY rate_bucket ORDER BY id DESC) AS n FROM provider_calls WHERE provider='github' AND rate_bucket IS NOT NULL AND started>=?) WHERE n=1",
        )
        .all(since),
    };
  }
  get<T>(key: string, allowExpired = false): T | null {
    const row = this.db
      .prepare("SELECT value,expires FROM cache WHERE key=?")
      .get(key) as { value: string; expires: number } | undefined;
    if (!row || (!allowExpired && row.expires < Date.now())) return null;
    return JSON.parse(row.value) as T;
  }
  set(key: string, value: unknown, ttlMs: number) {
    this.db
      .prepare("INSERT OR REPLACE INTO cache VALUES(?,?,?)")
      .run(key, JSON.stringify(value), Date.now() + ttlMs);
  }
  saveMarket(m: Market, isPublic = true, owner?: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT OR IGNORE INTO markets VALUES(?,?,?,?,?)")
        .run(m.id, m.topic.slug, m.geo, m.asOf, JSON.stringify(m));
      this.db
        .prepare("INSERT OR IGNORE INTO report_visibility VALUES(?,?)")
        .run(m.id, Number(isPublic));
      if (owner)
        this.db
          .prepare("INSERT OR IGNORE INTO report_owners VALUES(?,?)")
          .run(m.id, owner);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  isPublic(id: string) {
    return (
      this.db
        .prepare(
          "SELECT 1 FROM report_visibility WHERE report_id=? AND public=1",
        )
        .get(id) !== undefined
    );
  }
  canRead(id: string, user?: string) {
    return this.isPublic(id) || !!(user && this.ownsReport(user, id));
  }
  ownsReport(user: string, id: string) {
    return (
      this.db
        .prepare("SELECT 1 FROM report_owners WHERE user_id=? AND report_id=?")
        .get(user, id) !== undefined
    );
  }
  shareReport(user: string, id: string, shared: boolean) {
    if (!this.ownsReport(user, id)) return false;
    this.db
      .prepare("UPDATE report_visibility SET public=? WHERE report_id=?")
      .run(Number(shared), id);
    return true;
  }
  saveUser(id: string, name: string) {
    this.db
      .prepare(
        "INSERT INTO users VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
      )
      .run(id, name, new Date().toISOString());
  }
  addHistory(user: string, report: string, input: string) {
    this.db
      .prepare(
        "INSERT INTO user_reports VALUES(?,?,?,?) ON CONFLICT(user_id,report_id) DO UPDATE SET input=excluded.input,created=excluded.created",
      )
      .run(user, report, input.slice(0, 300), new Date().toISOString());
  }
  history(user: string) {
    return (
      this.db
        .prepare(
          "SELECT h.input,h.created,m.payload,v.public FROM user_reports h JOIN markets m ON m.id=h.report_id JOIN report_visibility v ON v.report_id=m.id LEFT JOIN report_owners o ON o.report_id=m.id WHERE h.user_id=? AND (v.public=1 OR o.user_id=h.user_id) ORDER BY h.created DESC LIMIT 100",
        )
        .all(user) as {
        input: string;
        created: string;
        payload: string;
        public: number;
      }[]
    ).map((r) => {
      const m = JSON.parse(r.payload) as Market;
      return {
        id: m.id,
        input: r.input,
        created: r.created,
        topic: m.topic.name,
        keyword: m.demand.keyword,
        geo: m.geo,
        headline: m.headline,
        kind: m.kind,
        public: !!r.public,
      };
    });
  }
  removeHistory(user: string, id: string) {
    // Revoke public sharing before removing the owner's reference.
    if (this.ownsReport(user, id)) this.shareReport(user, id, false);
    this.db
      .prepare("DELETE FROM user_reports WHERE user_id=? AND report_id=?")
      .run(user, id);
  }
  userWatch(user: string) {
    return (
      this.db
        .prepare(
          "SELECT repo FROM user_watch WHERE user_id=? ORDER BY created DESC",
        )
        .all(user) as { repo: string }[]
    ).map((r) => r.repo);
  }
  setUserWatch(user: string, repo: string, added: boolean) {
    if (added)
      this.db
        .prepare("INSERT OR IGNORE INTO user_watch VALUES(?,?,?)")
        .run(user, repo, new Date().toISOString());
    else
      this.db
        .prepare("DELETE FROM user_watch WHERE user_id=? AND repo=?")
        .run(user, repo);
  }
  usage(user: string, day = new Date().toISOString().slice(0, 10)) {
    return (
      (
        this.db
          .prepare("SELECT count FROM usage_daily WHERE user_id=? AND day=?")
          .get(user, day) as { count: number } | undefined
      )?.count || 0
    );
  }
  consumeUsage(user: string, limit: number) {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.db
      .prepare(
        "INSERT INTO usage_daily VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET count=count+1 WHERE count<? RETURNING count",
      )
      .get(user, day, limit);
    return !!row;
  }
  take<T>(key: string): T | null {
    const row = this.db
      .prepare("DELETE FROM cache WHERE key=? RETURNING value,expires")
      .get(key) as { value: string; expires: number } | undefined;
    return row && row.expires > Date.now() ? JSON.parse(row.value) : null;
  }
  market(
    topic: string,
    geo = "",
    keyword = resolveTopic(topic).keyword,
    publicOnly = false,
  ): Market | null {
    const r = this.db
      .prepare(
        "SELECT payload FROM markets WHERE topic=? AND geo=? AND LOWER(json_extract(payload,'$.topic.keyword'))=LOWER(?) AND (?=0 OR id IN (SELECT report_id FROM report_visibility WHERE public=1)) ORDER BY created DESC LIMIT 1",
      )
      .get(topic, geo, keyword, Number(publicOnly)) as
      { payload: string } | undefined;
    return r ? JSON.parse(r.payload) : null;
  }
  report(id: string): Market | null {
    const r = this.db
      .prepare("SELECT payload FROM markets WHERE id=?")
      .get(id) as { payload: string } | undefined;
    return r ? JSON.parse(r.payload) : null;
  }
  markets(geo = "", publicOnly = false): Market[] {
    return (
      this.db
        .prepare(
          `SELECT payload FROM markets WHERE geo=? AND id IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY topic,geo,LOWER(json_extract(payload,'$.topic.keyword')) ORDER BY created DESC) AS row FROM markets WHERE (?=0 OR id IN (SELECT report_id FROM report_visibility WHERE public=1))) WHERE row=1) ORDER BY created DESC`,
        )
        .all(geo, Number(publicOnly)) as { payload: string }[]
    )
      .map((r) => JSON.parse(r.payload) as Market)
      .filter(
        (m) =>
          m.topic.keyword.toLowerCase() ===
          resolveTopic(m.topic.slug).keyword.toLowerCase(),
      );
  }
  watchList(): string[] {
    return (
      this.db.prepare("SELECT repo FROM watch ORDER BY created").all() as {
        repo: string;
      }[]
    ).map((x) => x.repo);
  }
  watchAdd(repo: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO watch VALUES(?,?)")
      .run(repo, new Date().toISOString());
  }
  watchRemove(repo: string) {
    this.db.prepare("DELETE FROM watch WHERE repo=?").run(repo);
  }
  saveRepo(repo: Repo) {
    this.db
      .prepare("INSERT OR REPLACE INTO repo_snapshots VALUES(?,?,?)")
      .run(repo.name, repo.fetchedAt.slice(0, 10), JSON.stringify(repo));
  }
  close() {
    this.db.close();
  }
}
