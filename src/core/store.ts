import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveTopic } from "./topics.js";
import type { Market, Repo } from "./types.js";
export class Store {
  private db: DatabaseSync;
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
    `);
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
