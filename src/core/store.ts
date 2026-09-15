import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Market, Repo } from "./types.js";
export class Store {
  private db: DatabaseSync;
  constructor(
    directory = process.env.GHTRENDS_DATA_DIR || join(homedir(), ".ghtrends"),
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "ghtrends.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS markets(id TEXT PRIMARY KEY,topic TEXT NOT NULL,geo TEXT NOT NULL,created TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS markets_topic ON markets(topic,geo,created DESC);
      CREATE TABLE IF NOT EXISTS watch(repo TEXT PRIMARY KEY,created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS repo_snapshots(repo TEXT NOT NULL,day TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(repo,day));
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
  saveMarket(m: Market) {
    this.db
      .prepare("INSERT OR IGNORE INTO markets VALUES(?,?,?,?,?)")
      .run(m.id, m.topic.slug, m.geo, m.asOf, JSON.stringify(m));
  }
  market(topic: string, geo = ""): Market | null {
    const r = this.db
      .prepare(
        "SELECT payload FROM markets WHERE topic=? AND geo=? ORDER BY created DESC LIMIT 1",
      )
      .get(topic, geo) as { payload: string } | undefined;
    return r ? JSON.parse(r.payload) : null;
  }
  report(id: string): Market | null {
    const r = this.db
      .prepare("SELECT payload FROM markets WHERE id=?")
      .get(id) as { payload: string } | undefined;
    return r ? JSON.parse(r.payload) : null;
  }
  markets(geo = ""): Market[] {
    return (
      this.db
        .prepare(
          `SELECT payload FROM markets WHERE geo=? AND id IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER(PARTITION BY topic,geo ORDER BY created DESC) AS row FROM markets) WHERE row=1) ORDER BY created DESC`,
        )
        .all(geo) as { payload: string }[]
    ).map((r) => JSON.parse(r.payload));
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
