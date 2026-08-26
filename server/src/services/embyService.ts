/**
 * Emby 媒体库接入：连接校验 / 媒体库分页拉取 / 同步入库 / 播放跳转。
 * 认证：全部请求 header `X-Emby-Token`；基址 `{emby_server_url}/emby`。
 * 外部故障统一抛 ApiError(3xxx)：未配置 3001（HTTP 428）、连接失败 3002（HTTP 502），
 * 同步失败 3003（HTTP 502）；绝不中断主流程之外的事务。
 */

import { getDb, sqlNow } from '../db/database';
import { ApiError } from '../middleware/errorHandler';
import { getSetting, setSetting } from './settingsService';
import {
  embyItemAdapter,
  resolvePlaybackState,
  type EmbyMappedItem,
  type EmbyRawItem,
} from './embyItemAdapter';

const REQUEST_TIMEOUT_MS = 6000;
/** 分页拉取页大小（Emby 官方推荐上限内） */
const PAGE_SIZE = 500;
/** 标准媒体库查询参数（Movie+Series，含播放状态与 ProviderIds） */
const ITEMS_BASE_QUERY =
  '?IncludeItemTypes=Movie,Series&Recursive=true' +
  '&Fields=ProviderIds,ProductionYear,Overview&ImageTypeLimit=1&EnableImages=true';

export interface EmbyConfig {
  baseUrl: string;
  apiKey: string;
  userId: string;
}

/** 三键齐备才算配置完成（拉取媒体库必须 user_id） */
export function isEmbyConfigured(): boolean {
  return (
    getSetting('emby_server_url').trim().length > 0 &&
    getSetting('emby_api_key').trim().length > 0 &&
    getSetting('emby_user_id').trim().length > 0
  );
}

function getConfig(): EmbyConfig {
  return {
    baseUrl: getSetting('emby_server_url').trim().replace(/\/+$/, ''),
    apiKey: getSetting('emby_api_key').trim(),
    userId: getSetting('emby_user_id').trim(),
  };
}

function requireConfig(): EmbyConfig {
  if (!isEmbyConfigured()) {
    throw new ApiError(3001, 'Emby 未配置，请先在设置页填写服务器地址、API Key 与用户 ID', 428);
  }
  return getConfig();
}

/** 统一 GET 封装：X-Emby-Token 头 + 超时；非 2xx/网络错误 → 3002 */
async function embyGet<T>(cfg: EmbyConfig, pathName: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/emby${pathName}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'X-Emby-Token': cfg.apiKey },
    });
  } catch {
    throw new ApiError(3002, 'Emby 连接失败（网络错误或超时），请检查服务器地址', 502);
  }
  if (!res.ok) {
    throw new ApiError(3002, `Emby 连接失败（HTTP ${res.status}），请检查地址与 API Key`, 502);
  }
  return (await res.json()) as T;
}

export interface VerifyResult {
  serverId: string | null;
  serverName: string | null;
}

interface SystemInfoResponse {
  Id?: string;
  ServerName?: string;
}

/** 连接校验：GET /System/Info，200 即有效 */
export async function verifyConnection(cfg?: EmbyConfig): Promise<VerifyResult> {
  const target = cfg ?? requireConfig();
  const info = await embyGet<SystemInfoResponse>(target, '/System/Info');
  return {
    serverId: typeof info.Id === 'string' ? info.Id : null,
    serverName: typeof info.ServerName === 'string' ? info.ServerName : null,
  };
}

/**
 * 分页拉取媒体库条目并映射。extraQuery 用于增量参数 MinDateLastSavedForUser。
 * 返回映射成功条目与被跳过（无 Tmdb 映射）计数；serverId 全程只探测一次。
 */
async function fetchAndMap(
  cfg: EmbyConfig,
  extraQuery?: string,
): Promise<{ items: EmbyMappedItem[]; skipped: number }> {
  const items: EmbyMappedItem[] = [];
  let skipped = 0;
  let startIndex = 0;
  let total = Number.POSITIVE_INFINITY;

  while (startIndex < total) {
    const query =
      `/Users/${encodeURIComponent(cfg.userId)}/Items${ITEMS_BASE_QUERY}${extraQuery ?? ''}` +
      `&StartIndex=${startIndex}&Limit=${PAGE_SIZE}`;
    const page = await embyGet<{ Items?: EmbyRawItem[]; TotalRecordCount?: number }>(cfg, query);
    total =
      typeof page.TotalRecordCount === 'number' && page.TotalRecordCount >= 0
        ? page.TotalRecordCount
        : startIndex + (page.Items?.length ?? 0);
    for (const raw of page.Items ?? []) {
      const mapped = embyItemAdapter(raw, cfg.baseUrl);
      if (mapped) items.push(mapped);
      else skipped += 1;
    }
    if ((page.Items?.length ?? 0) < PAGE_SIZE) break; // 末页
    startIndex += PAGE_SIZE;
  }

  // serverId 只探测一次，失败不阻断同步
  let serverId: string | null = null;
  try {
    serverId = (await verifyConnection(cfg)).serverId;
  } catch {
    serverId = null;
  }
  for (const item of items) item.serverId = serverId;
  return { items, skipped };
}

/** 全量拉取媒体库 */
export function fetchLibraries(cfg?: EmbyConfig): Promise<{
  items: EmbyMappedItem[];
  skipped: number;
}> {
  return fetchAndMap(cfg ?? requireConfig());
}

export interface SyncResult {
  /** UPSERT 进 emby_items 的条数 */
  synced: number;
  /** 无 Tmdb 映射被跳过的条数 */
  skipped: number;
  /** 回写 watchlist 的匹配条数 */
  matchedToWatchlist: number;
}

/** settings 键 emby_last_sync（'YYYY-MM-DD HH:MM:SS'）→ Emby ISO 参数；空表示首次全量 */
function incrementalSince(): string | null {
  const last = getSetting('emby_last_sync').trim();
  if (!last) return null;
  return `${last.replace(' ', 'T')}Z`;
}

/**
 * 同步任务：全量（或增量 MinDateLastSavedForUser）拉取后按 item_id UPSERT 进 emby_items，
 * 再回写 watchlist：已匹配条目按播放状态更新 status（watching↔finished）；
 * 未在 watchlist 的条目不自动加入（避免污染），仅在结果中报告 matchedToWatchlist。
 * 成功后写入 emby_last_sync。串行执行即可，数据量可控。
 */
export async function syncEmbyLibrary(): Promise<SyncResult> {
  const cfg = requireConfig();
  const sinceIso = incrementalSince();
  const extraQuery = sinceIso ? `&MinDateLastSavedForUser=${encodeURIComponent(sinceIso)}` : '';

  let fetched: { items: EmbyMappedItem[]; skipped: number };
  try {
    fetched = await fetchAndMap(cfg, extraQuery || undefined);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(3003, 'Emby 同步失败（网络错误或超时）', 502);
  }

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO emby_items (item_id, server_id, tmdb_id, media_type, title, year, poster_url, played_percentage, played, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       server_id=excluded.server_id, tmdb_id=excluded.tmdb_id, media_type=excluded.media_type,
       title=excluded.title, year=excluded.year, poster_url=excluded.poster_url,
       played_percentage=excluded.played_percentage, played=excluded.played, synced_at=excluded.synced_at`,
  );
  const findWatchRows = db.prepare(
    'SELECT id FROM watchlist WHERE tmdb_id = ? AND media_type = ?',
  );
  const writeback = db.prepare('UPDATE watchlist SET status=?, updated_at=? WHERE id=?');

  let matchedToWatchlist = 0;
  const nowStr = sqlNow();
  const runSync = db.transaction(() => {
    for (const item of fetched.items) {
      upsert.run(
        item.itemId,
        item.serverId,
        item.tmdbId,
        item.mediaType,
        item.title,
        item.year,
        item.posterUrl,
        item.playedPercentage,
        item.played ? 1 : 0,
        nowStr,
      );
      const state = resolvePlaybackState(item);
      if (!state) continue; // 无播放记录不回写，保留用户手动状态
      for (const row of findWatchRows.all(item.tmdbId, item.mediaType) as Array<{ id: number }>) {
        writeback.run(state.status, nowStr, row.id);
        matchedToWatchlist += 1;
      }
    }
  });
  runSync();

  setSetting('emby_last_sync', nowStr);
  return { synced: fetched.items.length, skipped: fetched.skipped, matchedToWatchlist };
}

export interface EmbyStatusPayload {
  configured: boolean;
  verified: boolean;
  serverName: string | null;
  itemCount: number;
  lastSync: string | null;
}

/** 状态视图：configured 为静态三键判定；verified/serverName 为实时探测结果 */
export async function getEmbyStatus(): Promise<EmbyStatusPayload> {
  const configured = isEmbyConfigured();
  const itemCount = (
    getDb().prepare('SELECT COUNT(*) AS n FROM emby_items').get() as { n: number }
  ).n;
  const lastSync = getSetting('emby_last_sync').trim() || null;

  if (!configured) {
    return { configured: false, verified: false, serverName: null, itemCount, lastSync };
  }
  try {
    const verify = await verifyConnection(getConfig());
    return { configured, verified: true, serverName: verify.serverName, itemCount, lastSync };
  } catch {
    return { configured, verified: false, serverName: null, itemCount, lastSync };
  }
}

/** 播放跳转 URL；条目未同步返回 null（路由层 404） */
export function getPlayUrl(tmdbId: number, mediaType: 'movie' | 'tv'): string | null {
  const row = getDb()
    .prepare(
      'SELECT item_id, server_id FROM emby_items WHERE tmdb_id = ? AND media_type = ? LIMIT 1',
    )
    .get(tmdbId, mediaType) as { item_id: string; server_id: string | null } | undefined;
  if (!row) return null;
  const base = getSetting('emby_server_url').trim().replace(/\/+$/, '');
  let url = `${base}/web/index.html#!/item?id=${encodeURIComponent(row.item_id)}`;
  if (row.server_id) url += `&serverId=${encodeURIComponent(row.server_id)}`;
  return url;
}
