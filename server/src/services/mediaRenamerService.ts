/**
 * 媒体重命名服务（源自 Media-Renamer 项目合并）：
 *  - parser：自研正则解析文件名，支持 Emby 全部命名约定
 *    （SxxExx / 1x02 / 102 / 日期命名 / 多集 / 多版本 / 特典 / 中文季集号）
 *  - scanner：递归扫描媒体目录（跳过隐藏目录），解析结果入库 media_items
 *  - match：TMDB 自动匹配（zh-CN + en-US 双查合并，年份优先）与手动修正
 *  - renamer：生成 Emby 规范目标路径（电影 `Title (year) [tmdbid=xx].ext`、
 *    剧集 `Show (year)\Season N\Show SxxExx.ext`）、预览 diff、执行重命名并清理空目录
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb, sqlNow } from '../db/database';
import { ApiError } from '../middleware/errorHandler';
import { getSetting, hasTmdbApiKey } from './settingsService';
import { tmdbGet } from './tmdbService';

// ==================== parser ====================

const VIDEO_EXT = new Set([
  '.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.wmv', '.flv', '.mov', '.rmvb',
  '.webm', '.iso', '.dvd', '.bluray', '.strm', '.m4v', '.mpeg', '.mpg', '.vob',
]);

const EXTRA_DIRS = new Set([
  'extras', 'specials', 'shorts', 'scenes', 'featurettes', 'behind the scenes',
  'behindthescenes', 'deleted scenes', 'deletedscenes', 'interviews', 'trailers',
]);

const RES_RE = /(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10|hdr|dv|bluray|blu-ray|remux|web-?dl|webrip|hdtv|dvdrip|bdrip)/i;

const VERSION_WORDS = [
  'theatrical', 'extended', 'directors cut', "director's cut", 'unrated',
  'unrated cut', 'remastered', '1080p', '2160p', '720p', '4k', '3d', 'imax',
  'hdr', 'bluray', 'blu-ray', 'web', 'webdl', 'web-dl', 'webrip', 'hdtv',
  'dvd', 'dvdrip', 'bdrip', 'remux', 'ultimate', 'collector', 'criterion',
  'special edition', '4k hdr', 'dolby vision', 'x264', 'x265', 'hevc', 'avc',
];

export function isVideoExt(ext: string): boolean {
  return VIDEO_EXT.has((ext || '').toLowerCase());
}

export function isExtraDir(dirName: string): boolean {
  return EXTRA_DIRS.has((dirName || '').toLowerCase());
}

function normalizeTitle(str: string): string {
  return str
    .replace(/[\._]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[-–—]{1,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractYear(str: string): number | null {
  const m = str.match(/\b(19|20)\d{2}\b/);
  return m ? Number.parseInt(m[0], 10) : null;
}

function extractResolution(str: string): string | null {
  const m = str.match(RES_RE);
  return m ? m[1].toLowerCase() : null;
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnNum(s: string): number | null {
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10);
  if (s === '十') return 10;
  if (CN_NUM[s] != null) return CN_NUM[s];
  let m = s.match(/^十([一二三四五六七八九])$/);
  if (m) return 10 + (CN_NUM[m[1]] ?? 0);
  m = s.match(/^([一二三四五六七八九])十([一二三四五六七八九])?$/);
  if (m) return (CN_NUM[m[1]] ?? 0) * 10 + (m[2] ? (CN_NUM[m[2]] ?? 0) : 0);
  return null;
}

function extractCnSeason(str: string): number | null {
  const m = str.match(/第\s*([0-9一二三四五六七八九十]{1,3})\s*[季部]/);
  if (!m) return null;
  const n = cnNum(m[1]);
  return Number.isFinite(n) && (n as number) > 0 ? (n as number) : null;
}

interface EpisodeParsed {
  type: 'tv';
  name: string;
  season: number | null;
  epStart: number | null;
  epEnd: number | null;
  epName: string | null;
  epDate: string | null;
}

function parseEpisode(str: string): EpisodeParsed | null {
  const original = str;

  // 中文集号：第187话 / 第 187 集 / 第12期 / 第5回 / 187话（必须在三位简写之前）
  const cn = str.match(/(?<![0-9])(?:第\s*)?(\d{1,4})(?:\s*[-~到至]\s*(\d{1,4}))?\s*[话話集期回]/);
  if (cn) {
    const epStart = Number.parseInt(cn[1], 10);
    const epEnd = cn[2] ? Number.parseInt(cn[2], 10) : null;
    const marker = cn[0];
    const left = original.slice(0, original.indexOf(marker));
    const season = extractCnSeason(original) || 1;
    const name = normalizeTitle(left.replace(/第\s*[0-9一二三四五六七八九十]{1,3}\s*[季部]/g, ' '));
    return { type: 'tv', name: name || 'Unknown', season, epStart, epEnd, epName: null, epDate: null };
  }

  // SxxExx 系列
  let m = str.match(/(?<![0-9A-Za-z])S(\d{1,2})[x._\- ]?E(\d{1,3})(?:[x._\-]?E(\d{1,3}))?(?:[-x](\d{1,3}))?(?![0-9])/i);
  let sep: string | null = null;
  if (!m) {
    // 1x02 / 01x02x03
    m = str.match(/(?<![0-9])(\d{1,2})[xX](\d{1,3})(?:[xX](\d{1,3}))?(?![0-9])/);
    if (m) sep = 'x';
  }
  if (!m) {
    // 3 位简写 102 => S01E02（先剔除分辨率标记避免 720p 误配）
    const noRes = str.replace(/\b\d{3,4}p\b/i, ' ');
    m = noRes.match(/(?<![0-9A-Za-z])(\d{1})(\d{2})(?![0-9])/);
    if (m) sep = 'short';
  }
  void sep;

  if (!m) {
    // 日期命名
    const dm = str.match(/\b((19|20)\d{2})[-.](\d{1,2})[-.](\d{1,2})\b/);
    if (dm) {
      const name = normalizeTitle(str.replace(dm[0], ' '));
      return {
        type: 'tv',
        name,
        season: null,
        epStart: null,
        epEnd: null,
        epName: null,
        epDate: dm[1] + '-' + String(dm[3]).padStart(2, '0') + '-' + String(dm[4]).padStart(2, '0'),
      };
    }
    // 整季/合集
    const sm = str.match(/(?<![0-9A-Za-z])S(\d{1,2})(?![0-9])|(?<![0-9A-Za-z])Season[\._\- ]?(\d{1,2})(?![0-9])/i);
    if (sm) {
      const season = Number.parseInt(sm[1] ?? sm[2] ?? '0', 10);
      const marker = sm[0];
      const left = original.slice(0, original.indexOf(marker));
      return { type: 'tv', name: normalizeTitle(left) || 'Unknown', season, epStart: null, epEnd: null, epName: null, epDate: null };
    }
    return null;
  }

  const season = Number.parseInt(m[1], 10);
  const epStart = Number.parseInt(m[2], 10);
  const epEnd = m[3] ? Number.parseInt(m[3], 10) : null;

  const marker = m[0];
  const left = original.slice(0, original.indexOf(marker));
  let right = original.slice(original.indexOf(marker) + marker.length);

  let epName: string | null = null;
  right = right.replace(/^[-_ .]+/, '').replace(/[-_ .]+$/, '');
  if (right && !/^\d+$/.test(right) && right.toLowerCase() !== 'extras') {
    epName = right.replace(/[\._]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const name = normalizeTitle(left);
  return { type: 'tv', name: name || 'Unknown', season, epStart, epEnd, epName, epDate: null };
}

interface MovieParsed {
  type: 'movie';
  name: string;
  year: number | null;
  version: string | null;
}

function parseMovie(str: string): MovieParsed {
  const year = extractYear(str);
  let title = str;
  if (year) {
    title = title.replace(new RegExp('\\s*\\(?\\b' + year + '\\b\\)?\\s*'), ' ');
  }
  let version: string | null = null;
  const vMatch = title.match(/\s*[-–—]\s*(.+?)\s*$/);
  if (vMatch) {
    const cand = vMatch[1].trim();
    const low = cand.toLowerCase();
    if (VERSION_WORDS.some((w) => low.includes(w)) || RES_RE.test(cand)) {
      version = cand;
      title = title.slice(0, vMatch.index).trim();
    }
  }
  return { type: 'movie', name: normalizeTitle(title) || 'Unknown', year, version };
}

function isTvDirChain(dir: string | undefined): boolean {
  if (!dir) return false;
  let cur = dir;
  for (let i = 0; i < 4; i++) {
    const name = path.basename(cur);
    if (/^season\s*\d{1,2}$/i.test(name)) return true;
    if (/^s\d{1,2}$/i.test(name)) return true;
    if (/^specials?$/i.test(name)) return true;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return false;
}

function extractSeasonFromChain(dir: string | undefined): number | null {
  if (!dir) return null;
  let cur = dir;
  for (let i = 0; i < 4; i++) {
    const name = path.basename(cur);
    const m = name.match(/^season\s*(\d{1,2})$/i) ?? name.match(/^s(\d{1,2})$/i);
    if (m) return Number.parseInt(m[1], 10);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ParsedFile {
  type: 'movie' | 'tv';
  name: string;
  year: number | null;
  season: number | null;
  epStart: number | null;
  epEnd: number | null;
  epName: string | null;
  epDate: string | null;
  resolution: string | null;
  version: string | null;
  extension: string;
}

export function parseFile(fileName: string, options: { hint?: string; dirChain?: string } = {}): ParsedFile {
  const { hint, dirChain } = options;
  const extMatch = fileName.match(/\.([A-Za-z0-9]+)$/);
  const extension = extMatch ? extMatch[1].toLowerCase() : '';
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, '');

  const resolution = extractResolution(base);

  const ep = parseEpisode(base);
  if (ep) {
    return {
      type: 'tv',
      name: ep.name,
      year: extractYear(base),
      season: ep.season,
      epStart: ep.epStart,
      epEnd: ep.epEnd,
      epName: ep.epName,
      epDate: ep.epDate,
      resolution,
      version: null,
      extension,
    };
  }

  const inTvContext = hint === 'tv' || isTvDirChain(dirChain);
  if (inTvContext) {
    const mv = parseMovie(base);
    let name = mv.name;
    if (resolution) {
      name = name.replace(new RegExp('\\b' + escapeReg(resolution) + '\\b', 'i'), ' ').replace(/\s+/g, ' ').trim();
    }
    return {
      type: 'tv',
      name: name || 'Unknown',
      year: mv.year,
      season: extractSeasonFromChain(dirChain),
      epStart: null,
      epEnd: null,
      epName: null,
      epDate: null,
      resolution,
      version: mv.version,
      extension,
    };
  }

  const movie = parseMovie(base);
  return {
    type: 'movie',
    name: movie.name,
    year: movie.year,
    season: null,
    epStart: null,
    epEnd: null,
    epName: null,
    epDate: null,
    resolution,
    version: movie.version,
    extension,
  };
}

// ==================== 设置与目录 ====================

export interface RenamerMediaDir {
  type: 'movie' | 'tv';
  path: string;
}

function mediaDirs(): RenamerMediaDir[] {
  const raw = getSetting('renamer_media_dirs').trim();
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as RenamerMediaDir[];
    return Array.isArray(arr) ? arr.filter((d) => d && d.path) : [];
  } catch {
    return [];
  }
}

function renameMode(): 'file' | 'full' {
  return getSetting('renamer_mode') === 'full' ? 'full' : 'file';
}

// ==================== scanner ====================

const HIDDEN = new Set(['.git', '.DS_Store', '@eaDir', '$RECYCLE.BIN', 'System Volume Information', 'lost+found', '.thumbnails']);

interface MediaItemRow {
  id: number;
  type: 'movie' | 'tv';
  path: string;
  orig_path: string | null;
  name: string;
  year: number | null;
  season: number | null;
  ep_start: number | null;
  ep_end: number | null;
  ep_name: string | null;
  ep_date: string | null;
  resolution: string | null;
  version: string | null;
  extension: string | null;
  is_extra: number;
  tmdb_id: number | null;
  imdb_id: string | null;
  tmdb_title: string | null;
  tmdb_original_title: string | null;
  tmdb_year: number | null;
  tmdb_poster: string | null;
  tmdb_overview: string | null;
  tmdb_kind: string | null;
  match_method: string | null;
  status: 'unmatched' | 'matched' | 'renamed' | 'error';
  new_path: string | null;
  renamed_at: string | null;
  matched_at: string | null;
  created_at: string;
}

let scanState = { running: false, progress: 0, total: 0, found: 0, message: '' };

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!HIDDEN.has(ent.name)) walk(full, acc);
    } else if (ent.isFile() && isVideoExt(path.extname(ent.name))) {
      acc.push(full);
    }
  }
  return acc;
}

export function startScan(): { ok: boolean; message: string } {
  if (scanState.running) return { ok: false, message: '扫描已在运行中' };
  const dirs = mediaDirs();
  if (dirs.length === 0) {
    return { ok: false, message: '尚未配置媒体目录，请先在设置中添加' };
  }

  scanState = { running: true, progress: 0, total: 0, found: 0, message: '开始扫描...' };

  setTimeout(() => {
    try {
      const db = getDb();
      const allFiles: string[] = [];
      for (const d of dirs) {
        if (!fs.existsSync(d.path)) {
          scanState.message = `目录不存在: ${d.path}`;
          continue;
        }
        scanState.message = `扫描目录: ${d.path}`;
        allFiles.push(...walk(d.path));
      }
      scanState.total = allFiles.length;

      db.prepare('DELETE FROM media_items').run();
      const insert = db.prepare(`INSERT OR IGNORE INTO media_items
        (type, path, orig_path, name, year, season, ep_start, ep_end, ep_name, ep_date, resolution, version, extension, is_extra, created_at)
        VALUES (@type, @path, @path, @name, @year, @season, @epStart, @epEnd, @epName, @epDate, @resolution, @version, @extension, @isExtra, datetime('now'))`);

      const items = allFiles.map((f) => {
        const dirConfig = dirs
          .filter((d) => f.startsWith(d.path))
          .sort((a, b) => b.path.length - a.path.length)[0];
        const p = parseFile(path.basename(f), {
          hint: dirConfig ? dirConfig.type : undefined,
          dirChain: path.dirname(f),
        });
        const isExtra = isExtraDir(path.basename(path.dirname(f))) ? 1 : 0;
        scanState.progress += 1;
        return {
          type: p.type,
          path: f,
          name: p.name,
          year: p.year,
          season: p.season,
          epStart: p.epStart,
          epEnd: p.epEnd,
          epName: p.epName,
          epDate: p.epDate,
          resolution: p.resolution,
          version: p.version,
          extension: p.extension,
          isExtra,
        };
      });

      const insertAll = db.transaction((rows: typeof items) => {
        for (const it of rows) insert.run(it);
      });
      insertAll(items);
      scanState.found = items.length;
      scanState.message = `扫描完成，共发现 ${items.length} 个视频文件`;
    } catch (e) {
      scanState.message = '扫描出错: ' + (e instanceof Error ? e.message : String(e));
    } finally {
      scanState.running = false;
    }
  }, 0);

  return { ok: true, message: '扫描已启动' };
}

export function getScanState(): typeof scanState {
  return { ...scanState };
}

// ==================== 条目读取 ====================

export interface MediaItem {
  id: number;
  type: 'movie' | 'tv';
  path: string;
  name: string;
  year: number | null;
  season: number | null;
  epStart: number | null;
  epEnd: number | null;
  epName: string | null;
  epDate: string | null;
  resolution: string | null;
  version: string | null;
  extension: string | null;
  isExtra: boolean;
  tmdbId: number | null;
  tmdbTitle: string | null;
  tmdbYear: number | null;
  tmdbPoster: string | null;
  matchMethod: string | null;
  status: string;
  newPath: string | null;
}

function toItem(row: MediaItemRow): MediaItem {
  return {
    id: row.id,
    type: row.type,
    path: row.path,
    name: row.name,
    year: row.year,
    season: row.season,
    epStart: row.ep_start,
    epEnd: row.ep_end,
    epName: row.ep_name,
    epDate: row.ep_date,
    resolution: row.resolution,
    version: row.version,
    extension: row.extension,
    isExtra: row.is_extra === 1,
    tmdbId: row.tmdb_id,
    tmdbTitle: row.tmdb_title,
    tmdbYear: row.tmdb_year,
    tmdbPoster: row.tmdb_poster,
    matchMethod: row.match_method,
    status: row.status,
    newPath: row.new_path,
  };
}

export function listMediaItems(opts: { status?: string; type?: string } = {}): MediaItem[] {
  const db = getDb();
  const conds: string[] = [];
  const params: string[] = [];
  if (opts.status) {
    conds.push('status = ?');
    params.push(opts.status);
  }
  if (opts.type) {
    conds.push('type = ?');
    params.push(opts.type);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM media_items ${where} ORDER BY name, season, ep_start, id`)
    .all(...params) as unknown as MediaItemRow[];
  return rows.map(toItem);
}

function getRow(id: number): MediaItemRow | undefined {
  return getDb().prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItemRow | undefined;
}

// ==================== TMDB 匹配 ====================

interface TmdbHit {
  id: number;
  title: string;
  original_title: string;
  year: number | null;
  overview: string;
  poster: string | null;
  kind: 'movie' | 'tv';
}

async function searchKind(kind: 'movie' | 'tv', query: string, year?: number): Promise<TmdbHit[]> {
  const results: TmdbHit[] = [];
  let lastErr: unknown = null;
  let okCount = 0;
  const path = kind === 'tv' ? '/search/tv' : '/search/movie';
  for (const lang of ['zh-CN', 'en-US']) {
    try {
      const data = await tmdbGet<{ results?: Array<Record<string, unknown>> }>(path, {
        query,
        ...(year ? { year: String(year) } : {}),
        include_adult: 'false',
        language: lang,
      });
      okCount++;
      for (const r of data.results ?? []) {
        const date = (kind === 'tv' ? r.first_air_date : r.release_date) as string | undefined;
        results.push({
          id: Number(r.id),
          title: String(kind === 'tv' ? r.name : r.title ?? ''),
          original_title: String(kind === 'tv' ? r.original_name : r.original_title ?? ''),
          year: date ? Number.parseInt(date.slice(0, 4), 10) : null,
          overview: String(r.overview ?? ''),
          poster: (r.poster_path as string) ?? null,
          kind,
        });
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (okCount === 0 && lastErr) throw lastErr;
  const seen = new Set<number>();
  return results.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

async function getDetails(kind: 'movie' | 'tv', tmdbId: number): Promise<TmdbHit & { imdbId: string | null }> {
  const data = await tmdbGet<Record<string, unknown>>(`/${kind}/${tmdbId}`, {
    append_to_response: 'external_ids',
    language: 'zh-CN',
  });
  const external = data.external_ids as { imdb_id?: string } | undefined;
  const date = (kind === 'tv' ? data.first_air_date : data.release_date) as string | undefined;
  return {
    id: Number(data.id),
    title: String(data.title ?? data.name ?? ''),
    original_title: String(data.original_title ?? data.original_name ?? ''),
    year: date ? Number.parseInt(date.slice(0, 4), 10) : null,
    overview: String(data.overview ?? ''),
    poster: (data.poster_path as string) ?? null,
    kind,
    imdbId: external?.imdb_id ?? null,
  };
}

function applyMatch(rowId: number, kind: 'movie' | 'tv', detail: TmdbHit & { imdbId?: string | null }, method: 'auto' | 'manual'): void {
  getDb()
    .prepare(
      `UPDATE media_items SET tmdb_id=@id, imdb_id=@imdb, tmdb_title=@title, tmdb_original_title=@otitle,
       tmdb_year=@year, tmdb_poster=@poster, tmdb_overview=@overview, tmdb_kind=@kind,
       match_method=@method, matched_at=datetime('now'), status='matched' WHERE id=@rowid`,
    )
    .run({
      id: detail.id,
      imdb: detail.imdbId ?? null,
      title: detail.title,
      otitle: detail.original_title,
      year: detail.year,
      poster: detail.poster,
      overview: detail.overview,
      kind,
      method,
      rowid: rowId,
    });
}

export async function autoMatchItem(id: number): Promise<MediaItem> {
  const item = getRow(id);
  if (!item) throw new ApiError(1004, '记录不存在', 404);
  if (!hasTmdbApiKey()) throw new ApiError(2001, 'TMDB API Key 未配置，请先在设置页配置', 428);

  const hits = await searchKind(item.type, item.name, item.year ?? undefined);
  if (hits.length === 0) throw new ApiError(1004, 'TMDB 未找到匹配项，请手动匹配', 404);
  let hit = hits.find((r) => r.year && item.year && r.year === item.year);
  if (!hit && item.ep_date) {
    hit = hits.find((r) => r.year === Number.parseInt(item.ep_date!.slice(0, 4), 10));
  }
  const final = hit ?? hits[0];
  const detail = await getDetails(final.kind, final.id);
  applyMatch(item.id, item.type, detail, 'auto');
  const updated = getRow(item.id);
  if (!updated) throw new ApiError(1004, '记录不存在', 404);
  return toItem(updated);
}

export async function manualMatchItem(id: number, kind: 'movie' | 'tv', tmdbId: number): Promise<MediaItem> {
  const item = getRow(id);
  if (!item) throw new ApiError(1004, '记录不存在', 404);
  if (!hasTmdbApiKey()) throw new ApiError(2001, 'TMDB API Key 未配置，请先在设置页配置', 428);
  const detail = await getDetails(kind, tmdbId);
  applyMatch(item.id, kind, detail, 'manual');
  const updated = getRow(item.id);
  if (!updated) throw new ApiError(1004, '记录不存在', 404);
  return toItem(updated);
}

export interface BatchMatchResult {
  matched: number;
  failed: number;
  errors: Array<{ id: number; message: string }>;
}

export async function autoMatchBatch(ids: number[]): Promise<BatchMatchResult> {
  const result: BatchMatchResult = { matched: 0, failed: 0, errors: [] };
  for (const id of ids.slice(0, 50)) {
    const item = getRow(id);
    if (!item || item.tmdb_id) continue;
    try {
      await autoMatchItem(id);
      result.matched++;
    } catch (err) {
      result.failed++;
      result.errors.push({ id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

export function searchTmdb(kind: 'movie' | 'tv', query: string, year?: number): Promise<TmdbHit[]> {
  if (!hasTmdbApiKey()) {
    return Promise.reject(new ApiError(2001, 'TMDB API Key 未配置，请先在设置页配置', 428));
  }
  return searchKind(kind, query, year);
}

// ==================== renamer ====================

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitize(name: string): string {
  return (name || '')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
}

function idTag(tmdbId: number | null): string {
  return tmdbId ? ` [tmdbid=${tmdbId}]` : '';
}

function buildNewPath(item: MediaItemRow, mode: 'file' | 'full'): string {
  const title = item.tmdb_title || item.name;
  const year = item.tmdb_year || item.year;
  const ext = '.' + (item.extension || 'mkv');
  const dirs = mediaDirs();
  const movieRoot = dirs.find((d) => d.type === 'movie')?.path || '';
  const tvRoot = dirs.find((d) => d.type === 'tv')?.path || '';

  if (item.type === 'movie') {
    const base = `${sanitize(title)} (${year ?? ''})`.trim();
    const fileName = item.version
      ? `${base} - ${sanitize(item.version)}${idTag(item.tmdb_id)}${ext}`
      : `${base}${idTag(item.tmdb_id)}${ext}`;

    if (mode === 'full' && movieRoot) {
      return path.join(movieRoot, base, fileName);
    }
    return path.join(path.dirname(item.path), fileName);
  }

  const showName = sanitize(title);
  const season = item.season ?? 0;
  const ss = String(season).padStart(2, '0');

  let epPart: string;
  if (item.ep_date) {
    epPart = `${showName} ${item.ep_date}`;
  } else {
    const ep = String(item.ep_start ?? 1).padStart(2, '0');
    let seq = `S${ss}E${ep}`;
    if (item.ep_end) seq += `-E${String(item.ep_end).padStart(2, '0')}`;
    const epName = item.ep_name ? ` - ${sanitize(item.ep_name)}` : '';
    epPart = `${showName} ${seq}${epName}`;
  }
  const fileName = `${epPart}${ext}`;

  if (mode === 'full' && tvRoot) {
    const seriesDir = year ? `${showName} (${year})` : showName;
    if (item.ep_date) return path.join(tvRoot, seriesDir, fileName);
    const seasonDir = season > 0 ? `Season ${season}` : 'Specials';
    return path.join(tvRoot, seriesDir, seasonDir, fileName);
  }
  return path.join(path.dirname(item.path), fileName);
}

export interface RenamePlanEntry {
  id: number;
  oldPath: string;
  newPath: string;
}

export function buildPreview(ids: number[]): { plan: RenamePlanEntry[]; mode: string } {
  const mode = renameMode();
  const plan: RenamePlanEntry[] = [];
  for (const id of ids) {
    const row = getRow(id);
    if (!row || !row.tmdb_id) continue;
    plan.push({ id: row.id, oldPath: row.path, newPath: buildNewPath(row, mode) });
  }
  return { plan, mode };
}

function cleanupEmptyDirs(startDir: string): number {
  const roots = mediaDirs().map((d) => d.path.replace(/[\\/]+$/, '').toLowerCase());
  let removed = 0;
  let dir = startDir;
  let guard = 0;
  while (dir && guard++ < 64) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    if (roots.includes(dir.replace(/[\\/]+$/, '').toLowerCase())) break;
    try {
      if (fs.readdirSync(dir).length > 0) break;
      try {
        fs.rmdirSync(dir);
      } catch {
        /* 部分环境删除后仍抛错，忽略 */
      }
      if (fs.existsSync(dir)) break;
      removed++;
    } catch {
      break;
    }
    dir = parent;
  }
  return removed;
}

export interface RenameExecuteResult {
  renamed: number;
  failed: number;
  removedDirs: number;
  results: RenamePlanEntry[];
  errors: Array<{ id: number; message: string; oldPath?: string }>;
}

export function executeRename(plan: Array<{ id: number; newPath: string }>): RenameExecuteResult {
  const db = getDb();
  const logStmt = db.prepare(
    `INSERT INTO rename_logs (item_id, old_path, new_path, status, message, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  );
  const result: RenameExecuteResult = {
    renamed: 0,
    failed: 0,
    removedDirs: 0,
    results: [],
    errors: [],
  };

  for (const p of plan) {
    const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(p.id) as MediaItemRow | undefined;
    if (!item) {
      result.errors.push({ id: p.id, message: '记录不存在' });
      result.failed++;
      continue;
    }
    try {
      const oldPath = item.path;
      const newPath = p.newPath;
      if (!fs.existsSync(oldPath)) throw new Error('源文件不存在');
      if (oldPath === newPath) throw new Error('文件名未变化');

      if (process.platform === 'win32' && oldPath.toLowerCase() === newPath.toLowerCase()) {
        const tmp = oldPath + '.rename-tmp-' + Date.now();
        fs.renameSync(oldPath, tmp);
        fs.renameSync(tmp, newPath);
      } else {
        fs.mkdirSync(path.dirname(newPath), { recursive: true });
        fs.renameSync(oldPath, newPath);
      }

      db.prepare(
        `UPDATE media_items SET path = ?, status = 'renamed', new_path = ?, renamed_at = ? WHERE id = ?`,
      ).run(newPath, newPath, sqlNow(), item.id);
      logStmt.run(item.id, oldPath, newPath, 'success', '');
      result.results.push({ id: item.id, oldPath, newPath });
      result.renamed++;

      result.removedDirs += cleanupEmptyDirs(path.dirname(oldPath));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logStmt.run(item.id, item.path, p.newPath, 'error', msg);
      db.prepare(`UPDATE media_items SET status = 'error' WHERE id = ?`).run(item.id);
      result.errors.push({ id: item.id, oldPath: item.path, message: msg });
      result.failed++;
    }
  }
  return result;
}

// ==================== 日志 / 目录浏览 / 设置视图 ====================

export function listRenameLogs(limit = 100): Array<{
  id: number;
  itemId: number | null;
  oldPath: string | null;
  newPath: string | null;
  status: string;
  message: string | null;
  createdAt: string;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM rename_logs ORDER BY id DESC LIMIT ?')
    .all(limit) as Array<{
    id: number;
    item_id: number | null;
    old_path: string | null;
    new_path: string | null;
    status: string;
    message: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    oldPath: r.old_path,
    newPath: r.new_path,
    status: r.status,
    message: r.message,
    createdAt: r.created_at,
  }));
}

/** 目录浏览（供前端目录选择器）：列出指定路径下的子目录 */
export function listDirs(targetPath: string): { path: string; parent: string | null; dirs: string[] } {
  const p = targetPath && targetPath.trim() ? targetPath.trim() : path.parse(process.platform === 'win32' ? 'C:\\' : '/').root;
  const abs = path.resolve(p);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    throw new ApiError(1004, `无法读取目录：${abs}`, 404);
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !HIDDEN.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent === abs ? null : parent, dirs };
}

export function getRenamerSettings(): { dirs: RenamerMediaDir[]; mode: string } {
  return { dirs: mediaDirs(), mode: renameMode() };
}

export function saveRenamerSettings(input: { dirs?: RenamerMediaDir[]; mode?: string }): void {
  if (input.dirs !== undefined) {
    const clean = (Array.isArray(input.dirs) ? input.dirs : [])
      .filter((d) => d && typeof d.path === 'string' && d.path.trim() && (d.type === 'movie' || d.type === 'tv'))
      .map((d) => ({ type: d.type, path: d.path.trim() }));
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('renamer_media_dirs', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run(JSON.stringify(clean));
  }
  if (input.mode !== undefined) {
    const mode = input.mode === 'full' ? 'full' : 'file';
    getDb()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('renamer_mode', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run(mode);
  }
}
