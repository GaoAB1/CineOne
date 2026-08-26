/**
 * 默认 settings 种子数据写入（INSERT OR IGNORE 幂等）。
 */

import { getDb } from './database';

export const DEFAULT_SETTINGS: Record<string, string> = {
  /** TMDB API Key（用户在设置页配置；空串表示未配置） */
  tmdb_api_key: '',
  /** OMDb API Key（烂番茄评分回源；空串表示未配置，对应源降级为 null） */
  omdb_api_key: '',
  /** 社区评分聚合接口基址（豆瓣+全源兜底；空串表示未配置） */
  douban_api_base: '',
  /** 第三方评分缓存 TTL（小时） */
  ratings_ttl_hours: '72',
  /** 默认主题偏好 */
  theme_default: 'dark',
};

export function runSeed(): void {
  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))',
  );
  const runAll = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insert.run(key, value);
    }
  });
  runAll();
}
