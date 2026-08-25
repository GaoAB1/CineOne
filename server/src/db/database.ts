/**
 * better-sqlite3 连接单例 + WAL 配置。
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config';

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  const config = getConfig();
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  instance = new Database(config.dbPath);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.pragma('busy_timeout = 5000');
  return instance;
}

/** 关闭连接（测试/优雅退出用） */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/**
 * 以 SQLite datetime('now') 同构格式（UTC "YYYY-MM-DD HH:MM:SS"）序列化时间，
 * 保证 expires_at 等字段的字典序比较可靠。
 */
export function toSqlTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** 解析 SQLite UTC 时间字符串为 JS Date */
export function fromSqlTime(s: string): Date {
  return new Date(`${s.replace(' ', 'T')}Z`);
}

/** 当前 UTC 时间（SQLite 格式） */
export function sqlNow(): string {
  return toSqlTime(new Date());
}
