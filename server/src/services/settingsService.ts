/**
 * settings 表读写封装。
 * 已知键白名单：tmdb_api_key / omdb_api_key / douban_api_base /
 * emby_server_url / emby_api_key / emby_user_id / emby_last_sync /
 * ratings_ttl_hours / theme_default
 */

import { getDb } from '../db/database';
import { DEFAULT_SETTINGS } from '../db/seed';
import { ApiError } from '../middleware/errorHandler';

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[];
export type SettingKey = (typeof SETTING_KEYS)[number];

function isSettingKey(key: string): key is SettingKey {
  return (SETTING_KEYS as string[]).includes(key);
}

export function getSetting(key: SettingKey): string {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string | null } | undefined;
  if (row && row.value != null) return row.value;
  return DEFAULT_SETTINGS[key] ?? '';
}

export function setSetting(key: SettingKey, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value);
}

/** 局部更新（仅接受白名单键，非法键抛 1001） */
export function updateSettings(patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!isSettingKey(key)) {
      throw new ApiError(1001, `未知的设置项：${key}`, 400);
    }
    if (typeof value !== 'string') {
      // 数字等标量统一转字符串存储
      if (typeof value !== 'number') {
        throw new ApiError(1001, `设置项 ${key} 的值类型非法`, 400);
      }
    }
    setSetting(key, String(value));
  }
}

/** TMDB Key 是否已配置 */
export function hasTmdbApiKey(): boolean {
  return getSetting('tmdb_api_key').trim().length > 0;
}

/** 打码展示：abc***xy（长度不足则全打码） */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 6) return '*'.repeat(trimmed.length);
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
}

/** 面向 GET /api/settings 的脱敏视图 */
export function getSettingsView(): Record<string, unknown> {
  const apiKey = getSetting('tmdb_api_key');
  const omdbKey = getSetting('omdb_api_key');
  const doubanBase = getSetting('douban_api_base').trim();
  const embyUrl = getSetting('emby_server_url').trim();
  const embyKey = getSetting('emby_api_key');
  const embyUserId = getSetting('emby_user_id').trim();
  return {
    tmdb_api_key_masked: maskApiKey(apiKey),
    tmdb_api_key_set: apiKey.trim().length > 0,
    omdb_api_key_masked: maskApiKey(omdbKey),
    omdb_api_key_set: omdbKey.trim().length > 0,
    // douban_api_base 非密钥，直接回显明文便于用户核对
    douban_api_base: doubanBase,
    douban_api_base_set: doubanBase.length > 0,
    // Emby：地址/用户 ID 非密钥回显明文；API Key 只给打码与 set 标志
    emby_server_url: embyUrl,
    emby_server_url_set: embyUrl.length > 0,
    emby_api_key_masked: maskApiKey(embyKey),
    emby_api_key_set: embyKey.trim().length > 0,
    emby_user_id: embyUserId,
    emby_user_id_set: embyUserId.length > 0,
    ratings_ttl_hours: Number.parseInt(getSetting('ratings_ttl_hours'), 10) || 72,
    theme_default: getSetting('theme_default') || 'dark',
  };
}
