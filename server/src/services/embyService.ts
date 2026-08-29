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
    getAuthToken().length > 0 &&
    getSetting('emby_user_id').trim().length > 0
  );
}

/** 认证令牌：登录 AccessToken 优先，兼容旧 API Key 配置 */
export function getAuthToken(): string {
  const token = getSetting('emby_access_token').trim();
  if (token) return token;
  return getSetting('emby_api_key').trim();
}

function getConfig(): EmbyConfig {
  return {
    baseUrl: getSetting('emby_server_url').trim().replace(/\/+$/, ''),
    apiKey: getAuthToken(),
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
  /** 校验并（必要时自动解析）后的用户 ID；解析成功会回写 settings */
  userId: string | null;
}

interface SystemInfoResponse {
  Id?: string;
  ServerName?: string;
}

interface EmbyUserSummary {
  Id?: string;
  Name?: string;
}

/** 探测某用户 ID 是否有效（GET /Users/{id}，非 2xx 视为无效，不抛错） */
async function probeUser(cfg: EmbyConfig, userId: string): Promise<boolean> {
  try {
    await embyGet<unknown>(cfg, `/Users/${encodeURIComponent(userId)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验 emby_user_id 并尽量自动修正：
 * 1. 已配置且有效 → 直接用；
 * 2. 无效 → 拉 /Users 列表：settings 配了 emby_username 则按用户名（忽略大小写）匹配；
 *    否则列表恰有 1 个用户时采用该用户；都失败抛 3004 引导用户手动填 GUID。
 * 解析成功会 setSetting('emby_user_id', id) 回填，后续同步直接复用。
 */
export async function resolveEmbyUser(cfg?: EmbyConfig): Promise<EmbyConfig> {
  const target = cfg ?? requireConfig();
  if (target.userId && (await probeUser(target, target.userId))) return target;

  const users = await embyGet<EmbyUserSummary[]>(target, '/Users');
  const username = getSetting('emby_username').trim().toLowerCase();
  let match: EmbyUserSummary | undefined;
  if (username) {
    match = users.find(
      (u) => typeof u.Name === 'string' && u.Name.trim().toLowerCase() === username,
    );
  } else if (users.length === 1) {
    match = users[0];
  }
  if (!match || typeof match.Id !== 'string' || match.Id.length === 0) {
    throw new ApiError(
      3006,
      'Emby 用户 ID 无效且无法自动识别：请在 Emby 控制台→用户 页面复制用户 GUID 填入设置；或填写「用户名」后重新测试连接',
      502,
    );
  }
  setSetting('emby_user_id', match.Id);
  return { ...target, userId: match.Id };
}

/** 连接校验：GET /System/Info（200 即有效）+ 用户 ID 校验/自动解析 */
export async function verifyConnection(cfg?: EmbyConfig): Promise<VerifyResult> {
  const target = cfg ?? requireConfig();
  const info = await embyGet<SystemInfoResponse>(target, '/System/Info');
  const resolved = await resolveEmbyUser(target);
  return {
    serverId: typeof info.Id === 'string' ? info.Id : null,
    serverName: typeof info.ServerName === 'string' ? info.ServerName : null,
    userId: resolved.userId,
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
  // 先校验/自动解析用户 ID（无效会抛 3004 或自动回填），避免 /Users/{id}/Items 触发 HTTP 500
  let cfg = requireConfig();
  try {
    cfg = await resolveEmbyUser(cfg);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.httpStatus === 502 && err.message.includes('HTTP 500')) {
        throw new ApiError(
          3005,
          'Emby 同步失败（HTTP 500）：通常是「用户 ID」无效，请点击「测试连接」自动校验修正，或核对用户 GUID',
          502,
        );
      }
      throw err;
    }
    throw new ApiError(3003, 'Emby 同步失败（网络错误或超时）', 502);
  }

  const sinceIso = incrementalSince();
  const extraQuery = sinceIso ? `&MinDateLastSavedForUser=${encodeURIComponent(sinceIso)}` : '';

  let fetched: { items: EmbyMappedItem[]; skipped: number };
  try {
    fetched = await fetchAndMap(cfg, extraQuery || undefined);
  } catch (err) {
    if (err instanceof ApiError) {
      // 用户 ID 无效导致的 500 是常见误配，给出可操作提示
      if (err.message.includes('HTTP 500')) {
        throw new ApiError(
          3005,
          'Emby 同步失败（HTTP 500）：通常是「用户 ID」无效，请点击「测试连接」自动校验修正，或核对用户 GUID',
          502,
        );
      }
      throw err;
    }
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

/* ==================== 登录式接入 / 媒体库浏览 / 内置播放 ==================== */

/** 登录/播放会话使用的固定设备标识 */
const EMBY_DEVICE_ID = 'cineone-web';
const EMBY_AUTH_HEADER =
  `MediaBrowser Client="CineOne", Device="CineOne Web", DeviceId="${EMBY_DEVICE_ID}", Version="1.0.0"`;

export interface EmbyLoginInput {
  serverUrl: string;
  username: string;
  password: string;
}

export interface EmbyLoginResult {
  serverName: string | null;
  serverId: string | null;
  userId: string;
  username: string;
}

interface AuthByNameResponse {
  AccessToken?: string;
  ServerId?: string;
  User?: { Id?: string; Name?: string };
}

/**
 * Emby 登录（地址 + 用户名 + 密码 → AuthenticateByName）：
 * 成功后把 AccessToken / userId / username / baseUrl 写入 settings，
 * 后续所有 Emby 请求以 AccessToken（X-Emby-Token）认证，替代手填 API Key。
 */
export async function loginEmby(input: EmbyLoginInput): Promise<EmbyLoginResult> {
  const base = input.serverUrl.trim().replace(/\/+$/, '');
  const username = input.username.trim();
  if (!base || !username || !input.password) {
    throw new ApiError(1001, '服务器地址、用户名与密码均为必填', 400);
  }
  let res: Response;
  try {
    res = await fetch(`${base}/emby/Users/AuthenticateByName`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Emby-Authorization': EMBY_AUTH_HEADER,
      },
      body: JSON.stringify({ Username: username, Pw: input.password }),
    });
  } catch {
    throw new ApiError(3002, 'Emby 连接失败（网络错误或超时），请检查服务器地址', 502);
  }
  if (res.status === 401) {
    throw new ApiError(3011, 'Emby 用户名或密码错误', 401);
  }
  if (!res.ok) {
    throw new ApiError(3012, `Emby 登录失败（HTTP ${res.status}）`, 502);
  }
  const body = (await res.json()) as AuthByNameResponse;
  const token = body.AccessToken;
  const userId = body.User?.Id;
  if (!token || !userId) {
    throw new ApiError(3012, 'Emby 登录响应缺少 AccessToken 或用户 ID', 502);
  }

  // 登录成功 → 持久化接入信息（AccessToken 优先于 API Key）
  setSetting('emby_server_url', base);
  setSetting('emby_access_token', token);
  setSetting('emby_user_id', userId);
  setSetting('emby_username', body.User?.Name?.trim() || username);

  // 探测服务器名称（失败不阻断登录）
  let serverName: string | null = null;
  const cfg: EmbyConfig = { baseUrl: base, apiKey: token, userId };
  try {
    serverName = (await verifyConnection(cfg)).serverName;
  } catch {
    serverName = null;
  }
  return {
    serverName,
    serverId: typeof body.ServerId === 'string' ? body.ServerId : null,
    userId,
    username: body.User?.Name?.trim() || username,
  };
}

/** 退出登录：清空 AccessToken 与用户 ID（保留地址与 API Key 旧配置） */
export function logoutEmby(): void {
  setSetting('emby_access_token', '');
  setSetting('emby_user_id', '');
}

export interface LibraryItem {
  itemId: string;
  title: string;
  year: number | null;
  mediaType: 'movie' | 'tv';
  posterUrl: string | null;
  overview: string | null;
  played: boolean;
  playedPercentage: number;
}

export interface LibraryPayload {
  total: number;
  items: LibraryItem[];
}

interface LibraryRawItem {
  Id?: string;
  Name?: string;
  Type?: string;
  ProductionYear?: number;
  Overview?: string;
  ImageTags?: { Primary?: string };
  UserData?: { Played?: boolean; PlayedPercentage?: number };
}

export interface LibraryView {
  id: string;
  name: string;
  /** Emby 虚拟库类型：movies / tvshows / music / homevideos 等 */
  collectionType: string | null;
  /** 媒体库封面（浏览器直连图片端点） */
  posterUrl: string | null;
}

export interface EmbyHistoryItem {
  itemId: string;
  /** 展示标题：电影=片名；剧集=S季·E集 集名 */
  title: string;
  /** 剧集所属剧名（电影为 null） */
  seriesName: string | null;
  mediaType: 'movie' | 'tv';
  /** 剧集优先用本集剧照，缺省回退剧封面 */
  posterUrl: string | null;
  year: number | null;
  /** 观看完成时间（Emby LastPlayedDate 原值，ISO 字符串） */
  watchedDate: string | null;
}

interface HistoryRawItem {
  Id?: string;
  Name?: string;
  Type?: string;
  ProductionYear?: number;
  SeriesName?: string;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ImageTags?: { Primary?: string };
  UserData?: { LastPlayedDate?: string };
}

/**
 * 观看记录：已看完条目按 LastPlayedDate 倒序（电影 + 剧集单集）。
 * 复用 /Users/{id}/Items 的 IsPlayed 筛选 + DatePlayed 排序，不依赖 Sessions 历史。
 */
export async function getWatchHistory(limit = 30): Promise<EmbyHistoryItem[]> {
  const cfg = requireConfig();
  const q = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Episode',
    Filters: 'IsPlayed',
    SortBy: 'DatePlayed',
    SortOrder: 'Descending',
    Fields: 'ProductionYear',
    ImageTypeLimit: '1',
    EnableImages: 'true',
    Limit: String(Math.min(100, Math.max(1, limit))),
  });
  const page = await embyGet<{ Items?: HistoryRawItem[] }>(
    cfg,
    `/Users/${encodeURIComponent(cfg.userId)}/Items?${q.toString()}`,
  );
  return (page.Items ?? [])
    .filter((r) => r.Id && r.Name)
    .map((r) => {
      const isEpisode = r.Type === 'Episode';
      const seasonNum = typeof r.ParentIndexNumber === 'number' ? r.ParentIndexNumber : null;
      const epNum = typeof r.IndexNumber === 'number' ? r.IndexNumber : null;
      const title =
        isEpisode && seasonNum != null && epNum != null
          ? `S${seasonNum}·E${epNum} ${r.Name}`
          : (r.Name as string);
      const posterUrl = r.ImageTags?.Primary
        ? `${cfg.baseUrl}/emby/Items/${encodeURIComponent(r.Id as string)}/Images/Primary?maxWidth=342`
        : isEpisode && r.SeriesId
          ? `${cfg.baseUrl}/emby/Items/${encodeURIComponent(r.SeriesId)}/Images/Primary?maxWidth=342`
          : null;
      return {
        itemId: r.Id as string,
        title,
        seriesName: isEpisode ? (r.SeriesName ?? null) : null,
        mediaType: isEpisode ? ('tv' as const) : ('movie' as const),
        posterUrl,
        year: typeof r.ProductionYear === 'number' ? r.ProductionYear : null,
        watchedDate: r.UserData?.LastPlayedDate ?? null,
      };
    });
}

interface ViewRawItem {
  Id?: string;
  Name?: string;
  CollectionType?: string;
  ImageTags?: { Primary?: string };
}

/**
 * 用户媒体库分类（Emby 官方 /Users/{id}/Views）：
 * 返回每个虚拟媒体库（电影/剧集/…）及其封面，供浏览页侧栏分类导航。
 */
export async function getLibraryViews(): Promise<LibraryView[]> {
  const cfg = requireConfig();
  const page = await embyGet<{ Items?: ViewRawItem[] }>(
    cfg,
    `/Users/${encodeURIComponent(cfg.userId)}/Views`,
  );
  return (page.Items ?? [])
    .filter((r) => r.Id && r.Name)
    .map((r) => ({
      id: r.Id as string,
      name: r.Name as string,
      collectionType: typeof r.CollectionType === 'string' ? r.CollectionType : null,
      posterUrl: r.ImageTags?.Primary
        ? `${cfg.baseUrl}/emby/Items/${encodeURIComponent(r.Id as string)}/Images/Primary?maxWidth=300`
        : null,
    }));
}

export type LibraryPlayedFilter = 'all' | 'unplayed' | 'played';
export type LibrarySortBy = 'SortName' | 'DateCreated' | 'ProductionYear' | 'Random' | 'CommunityRating';

/**
 * 实时分页拉取 Emby 媒体库（浏览页用，不落库）：
 * 支持 ParentId（媒体库分类）/ SearchTerm / 观看状态筛选 / 排序；
 * 海报 URL 由浏览器直连 Emby 图片端点。
 */
export async function getLibraryItems(opts: {
  startIndex: number;
  limit: number;
  search?: string;
  itemType?: 'movie' | 'tv' | 'all';
  /** 媒体库分类（虚拟库 Id，对应 /Users/{id}/Views 条目） */
  parentId?: string;
  played?: LibraryPlayedFilter;
  sortBy?: LibrarySortBy;
  sortOrder?: 'Ascending' | 'Descending';
}): Promise<LibraryPayload> {
  const cfg = requireConfig();
  const typeParam =
    opts.itemType === 'movie' ? 'Movie' : opts.itemType === 'tv' ? 'Series' : 'Movie,Series';
  const q = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: typeParam,
    SortBy: opts.sortBy ?? 'SortName',
    SortOrder: opts.sortOrder ?? 'Ascending',
    Fields: 'ProductionYear,Overview',
    ImageTypeLimit: '1',
    EnableImages: 'true',
    StartIndex: String(Math.max(0, opts.startIndex)),
    Limit: String(Math.min(200, Math.max(1, opts.limit))),
  });
  if (opts.parentId && opts.parentId.trim()) q.set('ParentId', opts.parentId.trim());
  if (opts.played === 'played') q.set('Filters', 'IsPlayed');
  else if (opts.played === 'unplayed') q.set('Filters', 'IsUnPlayed');
  if (opts.search && opts.search.trim()) q.set('SearchTerm', opts.search.trim());

  const page = await embyGet<{ Items?: LibraryRawItem[]; TotalRecordCount?: number }>(
    cfg,
    `/Users/${encodeURIComponent(cfg.userId)}/Items?${q.toString()}`,
  );
  const items: LibraryItem[] = (page.Items ?? [])
    .filter((r) => r.Id && r.Name && (r.Type === 'Movie' || r.Type === 'Series'))
    .map((r) => ({
      itemId: r.Id as string,
      title: r.Name as string,
      year: typeof r.ProductionYear === 'number' ? r.ProductionYear : null,
      mediaType: r.Type === 'Series' ? ('tv' as const) : ('movie' as const),
      posterUrl: r.ImageTags?.Primary
        ? `${cfg.baseUrl}/emby/Items/${encodeURIComponent(r.Id as string)}/Images/Primary?maxWidth=342`
        : null,
      overview: typeof r.Overview === 'string' && r.Overview.trim() ? r.Overview : null,
      played: r.UserData?.Played === true,
      playedPercentage:
        typeof r.UserData?.PlayedPercentage === 'number'
          ? Math.min(100, Math.max(0, r.UserData.PlayedPercentage))
          : 0,
    }));
  return {
    total:
      typeof page.TotalRecordCount === 'number' && page.TotalRecordCount >= 0
        ? page.TotalRecordCount
        : items.length,
    items,
  };
}

export interface EmbyPlayInfo {
  title: string;
  hlsUrl: string;
  runtimeTicks: number | null;
  playSessionId: string;
}

interface ItemDetailResponse {
  Id?: string;
  Name?: string;
  Type?: string;
  RunTimeTicks?: number;
  MediaSources?: Array<{ Id?: string }>;
}

/** 生成随机 PlaySessionId（进度上报对齐用） */
function newPlaySessionId(): string {
  return `cineone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 播放信息：HLS（master.m3u8，Emby 自动按需转码）。
 * Series 自动取第一集播放；MediaSourceId 缺省用条目自身 Id。
 * URL 携带 api_key（HLS 切片请求无法自定义请求头，与 Emby 官方 Web 行为一致）。
 */
export async function getPlayInfo(itemId: string): Promise<EmbyPlayInfo> {
  const cfg = requireConfig();
  if (!itemId.trim()) throw new ApiError(1001, '非法的条目 ID', 400);

  const detail = await embyGet<ItemDetailResponse>(
    cfg,
    `/Users/${encodeURIComponent(cfg.userId)}/Items/${encodeURIComponent(itemId)}?Fields=MediaSources`,
  );
  if (!detail.Id || !detail.Name) throw new ApiError(3013, '条目不存在或不可访问', 404);

  let videoId = detail.Id;
  let title = detail.Name;
  let runtimeTicks = typeof detail.RunTimeTicks === 'number' ? detail.RunTimeTicks : null;
  let mediaSourceId = detail.MediaSources?.[0]?.Id ?? detail.Id;

  if (detail.Type === 'Series') {
    // 剧集 → 取第一集
    const eps = await embyGet<{ Items?: ItemDetailResponse[] }>(
      cfg,
      `/Shows/${encodeURIComponent(detail.Id)}/Episodes?UserId=${encodeURIComponent(cfg.userId)}` +
        `&Fields=MediaSources&Limit=1&SortBy=ParentIndexNumber,IndexNumber&SortOrder=Ascending`,
    );
    const ep = eps.Items?.[0];
    if (!ep?.Id) throw new ApiError(3013, '该剧集暂无可播放的剧集', 404);
    videoId = ep.Id;
    title = `${detail.Name} · ${ep.Name ?? '第 1 集'}`;
    runtimeTicks = typeof ep.RunTimeTicks === 'number' ? ep.RunTimeTicks : null;
    mediaSourceId = ep.MediaSources?.[0]?.Id ?? ep.Id;
  }

  const hlsUrl =
    `${cfg.baseUrl}/emby/Videos/${encodeURIComponent(videoId)}/master.m3u8` +
    `?MediaSourceId=${encodeURIComponent(mediaSourceId)}` +
    `&api_key=${encodeURIComponent(cfg.apiKey)}` +
    `&DeviceId=${EMBY_DEVICE_ID}&PlaySessionId=${newPlaySessionId()}`;

  return { title, hlsUrl, runtimeTicks, playSessionId: newPlaySessionId() };
}

export interface PlaybackReport {
  event: 'start' | 'progress' | 'stop';
  positionTicks?: number;
  paused?: boolean;
  playSessionId?: string;
}

/**
 * 播放进度上报（Sessions/Playing|Progress|Stopped）。
 * 非致命链路：失败静默返回 false，不抛错。
 */
export async function reportPlayback(itemId: string, report: PlaybackReport): Promise<boolean> {
  const cfg = requireConfig();
  const suffix =
    report.event === 'start' ? '' : report.event === 'progress' ? 'Progress' : 'Stopped';
  const body: Record<string, unknown> = {
    ItemId: itemId,
    PlaySessionId: report.playSessionId ?? newPlaySessionId(),
    DeviceId: EMBY_DEVICE_ID,
  };
  if (typeof report.positionTicks === 'number') body.PositionTicks = Math.max(0, report.positionTicks);
  if (typeof report.paused === 'boolean') body.IsPaused = report.paused;

  try {
    const res = await fetch(`${cfg.baseUrl}/emby/Sessions/Playing${suffix}`, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Emby-Token': cfg.apiKey,
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
