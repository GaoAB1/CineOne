/**
 * 环境配置读取。
 * - PORT：默认 3000
 * - DB_PATH：默认 <server>/data/cineone.db
 * - JWT_SECRET：环境变量优先；缺省时首次启动生成随机值持久化到数据目录 .jwt_secret，重启不失效。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** server 目录（dev = src/..，prod = dist/..），两种场景均指向 server/ */
const SERVER_ROOT = path.resolve(__dirname, '..');
/** 数据目录（SQLite 与密钥文件所在） */
const DATA_DIR = process.env.DB_DIR ? path.resolve(process.env.DB_DIR) : path.join(SERVER_ROOT, 'data');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** 从数据目录读取或生成并持久化 JWT secret */
function loadOrCreateJwtSecret(): string {
  const envValue = process.env.JWT_SECRET;
  if (envValue && envValue.trim().length > 0) {
    return envValue.trim();
  }
  ensureDataDir();
  const secretFile = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync(secretFile)) {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length > 0) {
      return existing;
    }
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[config] JWT_SECRET 未配置，已自动生成随机密钥并持久化到 %s',
    secretFile,
  );
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

export interface AppConfig {
  port: number;
  dbPath: string;
  dataDir: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  nodeEnv: 'development' | 'production';
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  ensureDataDir();
  cachedConfig = {
    port: Number.parseInt(process.env.PORT ?? '3000', 10) || 3000,
    dbPath: process.env.DB_PATH
      ? path.resolve(process.env.DB_PATH)
      : path.join(DATA_DIR, 'cineone.db'),
    dataDir: DATA_DIR,
    jwtSecret: loadOrCreateJwtSecret(),
    jwtExpiresIn: '7d',
    nodeEnv: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  };
  return cachedConfig;
}
