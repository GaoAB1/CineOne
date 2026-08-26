/**
 * MoviePilot v2 订阅推送：连接校验 / 查重 / 推送订阅（含 subscribe_log 落库）。
 *
 * 契约核对（以官方源码 v2 分支为准，与 spec 出入处已修正）：
 * - 认证：`Authorization: Bearer` 头在 MoviePilot 中承载登录 JWT，第三方集成
 *   凭据 API_TOKEN 的正确用法是请求头 `X-API-KEY: {API_TOKEN}`（app/core/security.py
 *   verify_apikey，通过后视为超级用户），本服务采用该方式；
 * - POST /api/v1/subscribe/：body 字段 name/type/tmdbid/year/season，
 *   type 取值中文「电影」/「电视剧」；成功为 HTTP 200 且响应体 success=true
 *   （非 spec 所写 201），业务拒绝时 success=false + message。
 *
 * 错误码：未配置 4001（428）/ 不可达或超时 4002（502）/ 认证失败 4003（502）/
 * 业务拒绝 4004（502）。全部请求 6s 超时，绝不静默吞错。
 */

import { getDb, sqlNow } from '../db/database';
import { ApiError } from '../middleware/errorHandler';
import { getSetting } from './settingsService';
import type { MediaType } from '../types/domain';

const REQUEST_TIMEOUT_MS = 6000;

export interface MoviePilotConfig {
  baseUrl: string;
  token: string;
}

/** 地址与 Token 均非空才算配置完成 */
export function isMoviePilotConfigured(): boolean {
  return (
    getSetting('moviepilot_server_url').trim().length > 0 &&
    getSetting('moviepilot_token').trim().length > 0
  );
}

function requireConfig(): MoviePilotConfig {
  if (!isMoviePilotConfigured()) {
    throw new ApiError(4001, 'MoviePilot 未配置，请先在设置页填写服务器地址与 API Token', 428);
  }
  return {
    baseUrl: getSetting('moviepilot_server_url').trim().replace(/\/+$/, ''),
    token: getSetting('moviepilot_token').trim(),
  };
}

interface MpResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** 统一请求封装：X-API-KEY 认证头 + 超时；网络错误 → 4002 */
async function mpFetch(
  cfg: MoviePilotConfig,
  method: 'GET' | 'POST',
  pathName: string,
  body?: unknown,
): Promise<MpResponseLike> {
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl}/api/v1${pathName}`, {
      method,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        'X-API-KEY': cfg.token,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(4002, 'MoviePilot 连接失败（网络错误或超时），请检查服务器地址', 502);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError(4003, 'MoviePilot 认证失败，请检查 API Token 是否正确', 502);
  }
  return res;
}

export interface MpSubscribeItem {
  id?: number;
  name?: string;
  tmdbid?: number | null;
  type?: string;
}

/**
 * 拉取订阅列表（GET /subscribe/）。仅用于查重；HTTP 非 2xx 抛结构化错误。
 */
export async function listSubscribed(cfg?: MoviePilotConfig): Promise<MpSubscribeItem[]> {
  const target = cfg ?? requireConfig();
  const res = await mpFetch(target, 'GET', '/subscribe/');
  if (!res.ok) {
    throw new ApiError(4002, `MoviePilot 订阅列表拉取失败（HTTP ${res.status}）`, 502);
  }
  const body = await res.json();
  return Array.isArray(body) ? (body as MpSubscribeItem[]) : [];
}

/** mediaType → MoviePilot MediaType 枚举值（中文） */
export function toMpType(mediaType: MediaType): '电影' | '电视剧' {
  return mediaType === 'tv' ? '电视剧' : '电影';
}

export interface SubscribePushInput {
  title: string;
  mediaType: MediaType;
  tmdbId: number;
  year?: number | null;
  season?: number | null;
}

export interface SubscribePushResult {
  ok: true;
  /** MoviePilot 返回的提示消息 */
  message: string;
  /** 新订阅 ID（若返回） */
  subscribeId: number | null;
}

/**
 * 推送订阅（POST /subscribe/）。成功 = HTTP 200 且 body.success===true；
 * HTTP 200 但 success=false 视为业务拒绝（4004）。
 */
export async function pushSubscribe(
  input: SubscribePushInput,
  cfg?: MoviePilotConfig,
): Promise<SubscribePushResult> {
  const target = cfg ?? requireConfig();
  const bodyPayload: Record<string, unknown> = {
    name: input.title,
    type: toMpType(input.mediaType),
    tmdbid: input.tmdbId,
  };
  if (input.year != null && Number.isInteger(input.year)) bodyPayload.year = input.year;
  if (input.season != null && Number.isInteger(input.season) && input.mediaType === 'tv') {
    bodyPayload.season = input.season;
  }

  const res = await mpFetch(target, 'POST', '/subscribe/', bodyPayload);
  if (!res.ok) {
    throw new ApiError(4002, `MoviePilot 订阅推送失败（HTTP ${res.status}）`, 502);
  }
  const body = (await res.json()) as { success?: boolean; message?: string; data?: { id?: number } };
  if (body.success !== true) {
    throw new ApiError(
      4004,
      `MoviePilot 拒绝了订阅请求：${typeof body.message === 'string' ? body.message : '未知原因'}`,
      502,
    );
  }
  return {
    ok: true,
    message: typeof body.message === 'string' ? body.message : '订阅成功',
    subscribeId: typeof body.data?.id === 'number' ? body.data.id : null,
  };
}

export interface SubscribeAndLogResult extends SubscribePushResult {
  logged: boolean;
}

/**
 * 推送订阅并写 subscribe_log：无论成败都记录（ok=1/0 + message + payload 快照）。
 * 未配置时抛 4001 且不产生日志行（无外部交互发生）。
 */
export async function subscribeAndLog(
  userId: number,
  input: SubscribePushInput,
): Promise<SubscribeAndLogResult> {
  requireConfig(); // 未配置直接抛出，不写日志
  const payloadJson = JSON.stringify({
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
    title: input.title,
    year: input.year ?? null,
    season: input.season ?? null,
  });
  try {
    const result = await pushSubscribe(input);
    insertLog(userId, input.tmdbId, input.mediaType, payloadJson, 1, result.message);
    return { ...result, logged: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
    insertLog(userId, input.tmdbId, input.mediaType, payloadJson, 0, message);
    throw err;
  }
}

function insertLog(
  userId: number,
  tmdbId: number,
  mediaType: MediaType,
  payload: string,
  ok: 0 | 1,
  message: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO subscribe_log (user_id, tmdb_id, media_type, payload, ok, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, tmdbId, mediaType, payload, ok, message, sqlNow());
}

export interface MoviePilotStatusPayload {
  configured: boolean;
  reachable: boolean;
}

/** 状态视图：configured 静态判定；reachable 为 GET /subscribe/ 实时探测结果 */
export async function getMoviePilotStatus(): Promise<MoviePilotStatusPayload> {
  const configured = isMoviePilotConfigured();
  if (!configured) return { configured: false, reachable: false };
  try {
    await listSubscribed();
    return { configured, reachable: true };
  } catch {
    return { configured, reachable: false };
  }
}

/** 查重：按 tmdbid + type 匹配订阅列表 */
export async function isSubscribed(
  tmdbId: number,
  mediaType: MediaType,
  cfg?: MoviePilotConfig,
): Promise<boolean> {
  const items = await listSubscribed(cfg);
  const type = toMpType(mediaType);
  return items.some((it) => it.tmdbid === tmdbId && it.type === type);
}
