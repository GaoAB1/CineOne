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
  /** Emby 服务器地址（如 http://192.168.1.10:8096；空串表示未配置） */
  emby_server_url: '',
  /** Emby API Key（空串表示未配置，对应功能降级不可用） */
  emby_api_key: '',
  /** Emby 用户 ID（媒体库拉取走 /Users/{id}/Items；空串表示未配置） */
  emby_user_id: '',
  /** Emby 用户名（登录时写入，自动解析用户 ID 时按此匹配） */
  emby_username: '',
  /** Emby 登录 AccessToken（AuthenticateByName 获得优先于 API Key 使用） */
  emby_access_token: '',
  /** Emby 上次全量/增量同步时间（服务端写入，用户无需手填） */
  emby_last_sync: '',
  /** 播出日历最近一次成功刷新时间（服务端写入；内存缓存 TTL 1 小时） */
  calendar_last_sync: '',
  /** MoviePilot 服务器地址（如 http://192.168.1.10:3000；空串表示未配置） */
  moviepilot_server_url: '',
  /** MoviePilot API Token（对应其设置项 API_TOKEN；空串表示未配置） */
  moviepilot_token: '',
  /** 第三方评分缓存 TTL（小时） */
  ratings_ttl_hours: '72',
  /** 豆瓣条目直查开关（'1' 开启：无聚合豆瓣链接时经 movie.douban.com suggest 反查） */
  douban_search_enabled: '1',
  /** 默认主题偏好 */
  theme_default: 'dark',
  /** qBittorrent WebUI 地址（如 http://192.168.1.10:8080；空串表示未配置） */
  qb_server_url: '',
  /** qBittorrent WebUI 用户名（留空表示免认证环境，跳过登录） */
  qb_username: '',
  /** qBittorrent WebUI 密码 */
  qb_password: '',
  /** 电影默认下载目录（下载弹窗按“电影”类型预选） */
  qb_save_path_movie: '',
  /** 剧集默认下载目录（下载弹窗按“剧集”类型预选） */
  qb_save_path_tv: '',
  /** 预设下载目录列表（每行一个，下载弹窗下拉选择） */
  qb_save_paths: '',
  /** 电影任务分类（qB 分类名，留空则不设置） */
  qb_category_movie: '',
  /** 剧集任务分类（qB 分类名，留空则不设置） */
  qb_category_tv: '',
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
