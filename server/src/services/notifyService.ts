/**
 * 通知推送调度：Bark 承载，四类通知 ——
 *  1. qBittorrent 下载完成
 *  2. 115 离线下载完成
 *  3. 想看（watchlist planned）剧集/电影上线当天
 *  4. 在看（watching tv）剧集的待播集播出当天
 *
 * 设计：
 *  - 原生 setInterval（unref），无 cron 依赖；下载监控 5 分钟一轮，剧集检查 30 分钟一轮
 *  - 下载完成检测靠「上一轮快照 → 本轮快照」对比，notify_state 表持久化已通知的任务 key，
 *    重启后不会把历史已完成任务再推一遍
 *  - 剧集上线/待播按「天」去重（key 含 yyyy-MM-dd，Asia/Shanghai 时区），每天只会推一次
 *  - Bark 未配置时全部静默跳过；单条失败不影响其他条目
 */

import { getDb, sqlNow } from '../db/database';
import { getSetting, hasBarkConfig, hasPan115Config, hasQbConfig } from './settingsService';
import { sendBark } from './barkService';
import { listPan115Tasks } from './pan115Service';
import { listTorrents } from './qbService';
import { getCalendar } from './calendarService';
import { tmdbGet } from './tmdbService';

const DL_INTERVAL_MS = 5 * 60_000;
const AIR_INTERVAL_MS = 30 * 60_000;
const DL_INITIAL_DELAY_MS = 30_000;
/** 首轮快照时：完成时间在该窗口内的任务视为「刚完成」，补发通知（覆盖 115 等快完成场景） */
const RECENT_DONE_WINDOW_MS = 15 * 60_000;

/**
 * 完成时间是否落在通知窗口内（epoch 秒 → 毫秒对比；导出供单测）。
 * 背景：115 离线下载通常几分钟完成，等首轮快照时任务已是完成态，
 * 「状态翻转」检测会永久漏推；窗口内补发 + notify_state 去重解决。
 */
export function isRecentlyDone(doneTsSec: number, nowMs: number, windowMs = RECENT_DONE_WINDOW_MS): boolean {
  if (!Number.isFinite(doneTsSec) || doneTsSec <= 0) return false;
  const doneMs = doneTsSec * 1000;
  return doneMs > 0 && nowMs - doneMs >= 0 && nowMs - doneMs <= windowMs;
}

/** qB 完成态判定：进度 100% 且不在下载/校验/移动类状态（导出供单测） */
export function qbTorrentDone(state: string, progress: number): boolean {
  if (progress < 1) return false;
  if (/download|DL|meta|check|moving|alloc|error|missing/i.test(state)) return false;
  return /UP|upload|stopped|paused/i.test(state) || progress >= 1;
}

/** 北京时间（Asia/Shanghai）的 yyyy-MM-dd */
function todayCN(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** 去重：key 已存在返回 false（已通知过），否则记录并返回 true */
function markNotifiedOnce(key: string): boolean {
  const db = getDb();
  const info = db
    .prepare('INSERT OR IGNORE INTO notify_state (key, notified_at) VALUES (?, ?)')
    .run(key, sqlNow());
  return info.changes > 0;
}

// ---- 下载完成监控 ----

interface DownloadSnapshot {
  done: boolean;
  /** 完成时间参考（用于通知正文），未完成时为空 */
  name: string;
}

const qbSnapshot = new Map<string, DownloadSnapshot>();
const pan115Snapshot = new Map<string, DownloadSnapshot>();

async function checkQbDownloads(): Promise<void> {
  if (!hasQbConfig()) return;
  let torrents;
  try {
    torrents = await listTorrents();
  } catch {
    return; // qB 不可达时静默跳过本轮
  }
  for (const t of torrents) {
    const key = `dl:qb:${t.hash}`;
    const done = qbTorrentDone(t.state, t.progress);
    const prev = qbSnapshot.get(key);
    // 通知条件：状态翻转；或首轮快照就是完成态且完成时间在窗口内（补发）
    const shouldNotify =
      done &&
      ((prev && !prev.done) || (!prev && isRecentlyDone(t.completionOn, Date.now()))) &&
      markNotifiedOnce(key);
    if (shouldNotify) {
      await sendBark('qB 下载完成', t.name);
    }
    qbSnapshot.set(key, { done, name: t.name });
  }
  // 清理已消失任务的快照，避免长期运行内存膨胀
  const alive = new Set(torrents.map((t) => t.hash));
  for (const key of qbSnapshot.keys()) {
    if (!alive.has(key.slice('dl:qb:'.length))) qbSnapshot.delete(key);
  }
}

async function checkPan115Downloads(): Promise<void> {
  if (!hasPan115Config()) return;
  let tasks;
  try {
    tasks = await listPan115Tasks();
  } catch {
    return; // 115 拉取失败静默跳过
  }
  for (const t of tasks) {
    const key = `dl:115:${t.infoHash}`;
    const done = t.bucket === 'completed';
    const prev = pan115Snapshot.get(key);
    // 通知条件：状态翻转；或首轮快照就是完成态且完成时间在窗口内（补发）。
    // 115 离线任务常在轮询间隔内完成，首轮即 completed，仅靠状态翻转会永久漏推。
    const shouldNotify =
      done &&
      ((prev && !prev.done) || (!prev && isRecentlyDone(t.lastUpdate, Date.now()))) &&
      markNotifiedOnce(key);
    if (shouldNotify) {
      await sendBark('115 离线下载完成', t.name);
    }
    pan115Snapshot.set(key, { done, name: t.name });
  }
  const alive = new Set(tasks.map((t) => t.infoHash));
  for (const key of pan115Snapshot.keys()) {
    if (!alive.has(key.slice('dl:115:'.length))) pan115Snapshot.delete(key);
  }
}

// ---- 剧集上线 / 待播检查 ----

interface PlannedRow {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
}

/** 想看条目上线当天：movie 比对 release_date，tv 比对 first_air_date */
async function checkPlannedPremieres(today: string): Promise<void> {
  const rows = getDb()
    .prepare(
      `SELECT tmdb_id, media_type, MAX(title) AS title
       FROM watchlist WHERE status = 'planned' GROUP BY tmdb_id, media_type`,
    )
    .all() as PlannedRow[];

  for (const row of rows) {
    const key = `air:${today}:${row.media_type}:${row.tmdb_id}`;
    if (!markNotifiedOnce(key)) continue; // 该条目今天已处理
    try {
      if (row.media_type === 'movie') {
        const d = await tmdbGet<{ release_date?: string }>(`/movie/${row.tmdb_id}`, {
          language: 'zh-CN',
        });
        if (d.release_date?.slice(0, 10) === today) {
          await sendBark('想看的电影今天上映', `${row.title} 已于今天（${today}）上映，去片单看看吧`);
        }
      } else {
        const d = await tmdbGet<{ first_air_date?: string; next_episode_to_air?: { air_date?: string; season_number?: number; episode_number?: number } }>(
          `/tv/${row.tmdb_id}`,
          { language: 'zh-CN' },
        );
        const next = d.next_episode_to_air;
        if (d.first_air_date?.slice(0, 10) === today) {
          await sendBark('想看的剧集今天首播', `${row.title} 今天（${today}）首播，记得去看`);
        } else if (next?.air_date?.slice(0, 10) === today && Number.isInteger(next.season_number)) {
          await sendBark(
            '想看的剧集今天更新',
            `${row.title} 今天更新 S${next.season_number}E${next.episode_number ?? '?'}，可以直接开追了`,
          );
        }
      }
    } catch {
      // 单条 TMDB 回源失败不影响其他条目；key 已占位，次日不再重试当天
    }
  }
}

/** 在看剧集待播集播出当天（复用播出日历，60 天窗口含今天） */
async function checkWatchingAirs(today: string): Promise<void> {
  try {
    const calendar = await getCalendar();
    for (const ep of calendar.items) {
      if (ep.airDate !== today) continue;
      const key = `air:${today}:tv-ep:${ep.tmdbId}:${ep.season}:${ep.episode}`;
      if (!markNotifiedOnce(key)) continue;
      await sendBark('追剧中剧集今天更新', `${ep.title} 今天播出 S${ep.season}E${ep.episode}，记得追更`);
    }
  } catch {
    // TMDB Key 未配置 / 回源失败：静默跳过本轮
  }
}

async function checkAirs(): Promise<void> {
  if (!hasBarkConfig()) return;
  if (!getSetting('tmdb_api_key').trim()) return;
  const today = todayCN();
  await checkPlannedPremieres(today);
  await checkWatchingAirs(today);
}

// ---- 115 任务跟随检测（推送按钮触发，20s 即时盯梢） ----

const PAN115_WATCH_INTERVAL_MS = 20_000;
const PAN115_WATCH_TIMEOUT_MS = 30 * 60_000;

interface WatchEntry {
  name: string;
  startedAt: number;
}

const pan115Watch = new Map<string, WatchEntry>();
let pan115WatchTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 跟随检测一轮：所有被关注任务合并为一次 listPan115Tasks 全量查询
 * （不按任务数放大请求），完成/失败即推送并移出；全部结束自动停表。
 */
async function runPan115Watch(): Promise<void> {
  if (pan115Watch.size === 0) return;
  let tasks;
  try {
    tasks = await listPan115Tasks();
  } catch {
    return; // 本轮拉取失败静默跳过，下轮再试
  }
  const byHash = new Map(tasks.map((t) => [t.infoHash, t]));
  const now = Date.now();

  for (const [hash, entry] of [...pan115Watch.entries()]) {
    const task = byHash.get(hash);
    if (!task) continue; // 任务尚未出现在列表（排队中），继续等
    if (task.bucket === 'downloading') {
      if (now - entry.startedAt > PAN115_WATCH_TIMEOUT_MS) {
        pan115Watch.delete(hash); // 超时放弃跟随，回退全局轮询兜底
      }
      continue;
    }
    pan115Watch.delete(hash);
    // 与全局轮询共用去重 key：谁先检测到谁推，不会重复
    if (markNotifiedOnce(`dl:115:${hash}`)) {
      const name = task.name || entry.name;
      if (task.bucket === 'completed') {
        await sendBark('115 离线下载完成', name);
      } else if (task.bucket === 'error') {
        await sendBark('115 离线任务失败', `${name}（可在 115 客户端查看原因）`);
      }
    }
  }

  if (pan115Watch.size === 0 && pan115WatchTimer) {
    clearInterval(pan115WatchTimer);
    pan115WatchTimer = null;
  }
}

/** 注册一个 115 任务进入即时跟随（推送成功后调用；重复注册幂等） */
export function watchPan115Task(infoHash: string, name: string): void {
  const hash = infoHash.trim();
  if (!hash) return;
  pan115Watch.set(hash, { name: name.trim(), startedAt: Date.now() });
  if (!pan115WatchTimer) {
    pan115WatchTimer = setInterval(() => void runPan115Watch(), PAN115_WATCH_INTERVAL_MS);
    pan115WatchTimer.unref?.();
  }
}

// ---- 定时器 ----

let dlTimer: ReturnType<typeof setInterval> | null = null;
let airTimer: ReturnType<typeof setInterval> | null = null;
let dlInitialTimer: ReturnType<typeof setTimeout> | null = null;

/** 启动通知调度（index.ts 启动时调用；重复调用无副作用） */
export function initNotifyTimers(): void {
  if (dlTimer) return;
  dlInitialTimer = setTimeout(() => {
    void checkQbDownloads();
    void checkPan115Downloads();
  }, DL_INITIAL_DELAY_MS);
  dlInitialTimer.unref?.();
  dlTimer = setInterval(() => {
    void checkQbDownloads();
    void checkPan115Downloads();
  }, DL_INTERVAL_MS);
  dlTimer.unref?.();

  airTimer = setInterval(() => {
    void checkAirs();
  }, AIR_INTERVAL_MS);
  airTimer.unref?.();
  // 启动后先查一次（进程可能在播出日中段重启）
  setTimeout(() => void checkAirs(), 5_000).unref?.();
}

/** 停止全部定时器（进程退出前调用） */
export function stopNotifyTimers(): void {
  if (dlTimer) clearInterval(dlTimer);
  if (airTimer) clearInterval(airTimer);
  if (dlInitialTimer) clearTimeout(dlInitialTimer);
  if (pan115WatchTimer) clearInterval(pan115WatchTimer);
  dlTimer = null;
  airTimer = null;
  dlInitialTimer = null;
  pan115WatchTimer = null;
}
