/**
 * 启动时执行 DDL 建表（幂等 IF NOT EXISTS）。
 */

import { getDb } from './database';

const DDL_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'admin'
                          CHECK (role IN ('admin','member')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS watchlist (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tmdb_id          INTEGER NOT NULL,
    media_type       TEXT    NOT NULL CHECK (media_type IN ('movie','tv')),
    title            TEXT    NOT NULL,
    poster_path      TEXT,
    status           TEXT    NOT NULL DEFAULT 'watching'
                             CHECK (status IN ('watching','finished','dropped','planned')),
    current_season   INTEGER NOT NULL DEFAULT 1,
    current_episode  INTEGER NOT NULL DEFAULT 0,
    seasons_snapshot TEXT,
    total_episodes   INTEGER,
    added_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, tmdb_id, media_type)
  )`,
  `CREATE TABLE IF NOT EXISTS ratings_cache (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tmdb_id         INTEGER NOT NULL,
    media_type      TEXT    NOT NULL CHECK (media_type IN ('movie','tv')),
    source          TEXT    NOT NULL CHECK (source IN ('douban','tomato','popcorn')),
    score           REAL,
    raw_text        TEXT,
    source_url      TEXT,
    manual_override INTEGER NOT NULL DEFAULT 0,
    fetched_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT    NOT NULL,
    UNIQUE (tmdb_id, media_type, source)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ratings_expires ON ratings_cache(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id, status)`,
  // ---- M1 Emby 接入 ----
  `CREATE TABLE IF NOT EXISTS emby_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id           TEXT    NOT NULL,
    server_id         TEXT,
    tmdb_id           INTEGER,
    media_type        TEXT    CHECK (media_type IN ('movie','tv')),
    title             TEXT    NOT NULL,
    year              INTEGER,
    poster_url        TEXT,
    played_percentage REAL    DEFAULT 0,
    played            INTEGER NOT NULL DEFAULT 0,
    synced_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (item_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_emby_tmdb ON emby_items(tmdb_id, media_type)`,
  // ---- M3 追剧日历与想看 ----
  `CREATE TABLE IF NOT EXISTS upcoming (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tmdb_id      INTEGER NOT NULL,
    media_type   TEXT    NOT NULL CHECK (media_type IN ('movie','tv')),
    title        TEXT    NOT NULL,
    poster_path  TEXT,
    release_date TEXT,
    note         TEXT,
    added_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, tmdb_id, media_type)
  )`,
  // ---- M2 MoviePilot 订阅 ----
  `CREATE TABLE IF NOT EXISTS subscribe_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tmdb_id    INTEGER NOT NULL,
    media_type TEXT    NOT NULL CHECK (media_type IN ('movie','tv')),
    payload    TEXT,
    ok         INTEGER NOT NULL DEFAULT 0,
    message    TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_subscribe_log_user ON subscribe_log(user_id, created_at)`,
  // ---- M4 豆瓣条目直查缓存（filmparser 查找资源） ----
  `CREATE TABLE IF NOT EXISTS douban_resolve_cache (
    tmdb_id    INTEGER NOT NULL,
    media_type TEXT    NOT NULL CHECK (media_type IN ('movie','tv')),
    subject_url TEXT,
    title       TEXT,
    year        INTEGER,
    fetched_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tmdb_id, media_type)
  )`,
];

export function runMigrate(): void {
  const db = getDb();
  const runAll = db.transaction(() => {
    for (const ddl of DDL_STATEMENTS) {
      db.exec(ddl);
    }
  });
  runAll();
}
