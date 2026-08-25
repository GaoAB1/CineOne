/**
 * watchlistService 单元测试：唯一约束（4090）、进度推进边界、换季归零、
 * progressPercent 计算、user_id 行隔离。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import {
  createWatchItem,
  deleteWatchItem,
  listWatchlist,
  updateWatchItem,
} from '../src/services/watchlistService';
import { ApiError } from '../src/middleware/errorHandler';

const SNAPSHOT_2SEASONS = [
  { seasonNumber: 1, episodeCount: 10 },
  { seasonNumber: 2, episodeCount: 24 },
];

function insertUser(username: string): number {
  const info = getDb()
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, 'x', 'admin')")
    .run(username);
  return Number(info.lastInsertRowid);
}

/** 直接改库模拟时间流逝，保证 updated_at 排序确定 */
function touch(userId: number, id: number, ts: string): void {
  getDb()
    .prepare('UPDATE watchlist SET updated_at = ? WHERE user_id = ? AND id = ?')
    .run(ts, userId, id);
}

describe('watchlistService · 创建与唯一约束', () => {
  let uid: number;

  before(() => {
    runMigrate();
    uid = insertUser(`u1_${process.pid}`);
  });

  it('创建条目：默认 watching / S1E0，驼峰字段齐全，totalEpisodes 为快照求和', () => {
    const item = createWatchItem(uid, {
      tmdbId: 1396,
      mediaType: 'tv',
      title: 'Breaking Bad',
      seasonsSnapshot: SNAPSHOT_2SEASONS,
    });
    assert.equal(item.tmdbId, 1396);
    assert.equal(item.mediaType, 'tv');
    assert.equal(item.status, 'watching');
    assert.equal(item.currentSeason, 1);
    assert.equal(item.currentEpisode, 0);
    assert.equal(item.totalEpisodes, 34); // 10 + 24
    assert.equal(item.progressPercent, 0);
    assert.ok(typeof item.id === 'number' && item.id > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(item.updatedAt), `updatedAt 应为 ISO 形态：${item.updatedAt}`);
  });

  it('重复添加同一条目 → code=4090 / HTTP 409', () => {
    createWatchItem(uid, { tmdbId: 42, mediaType: 'movie' });
    try {
      createWatchItem(uid, { tmdbId: 42, mediaType: 'movie' });
      assert.fail('期望抛出 4090');
    } catch (e) {
      assert.ok(e instanceof ApiError);
      assert.equal((e as ApiError).code, 4090);
      assert.equal((e as ApiError).httpStatus, 409);
    }
  });

  it('同一 tmdbId 但媒体类型不同（movie vs tv）不冲突', () => {
    const a = createWatchItem(uid, { tmdbId: 777, mediaType: 'movie' });
    const b = createWatchItem(uid, { tmdbId: 777, mediaType: 'tv' });
    assert.notEqual(a.id, b.id);
  });

  it('非法入参校验：tmdbId≤0 / 非整数 / mediaType 越界 → 1001 / 400', () => {
    for (const bad of [{ tmdbId: 0 }, { tmdbId: -1 }, { tmdbId: 1.5 }]) {
      assert.throws(
        () =>
          createWatchItem(uid, {
            ...bad,
            mediaType: bad.mediaType ?? ('movie' as const),
          } as Parameters<typeof createWatchItem>[1]),
        (e: unknown) => e instanceof ApiError && e.code === 1001 && e.httpStatus === 400,
      );
    }
    assert.throws(
      () => createWatchItem(uid, { tmdbId: 1, mediaType: 'book' as never }),
      (e: unknown) => e instanceof ApiError && e.code === 1001,
    );
  });

  it('title 缺省时落库为「未命名条目」', () => {
    const item = createWatchItem(uid, { tmdbId: 555, mediaType: 'movie' });
    assert.equal(item.title, '未命名条目');
  });
});

describe('watchlistService · 进度推进与 progressPercent', () => {
  let uid: number;
  let itemId: number;

  before(() => {
    runMigrate();
    uid = insertUser(`u2_${process.pid}`);
    itemId = createWatchItem(uid, {
      tmdbId: 1001,
      mediaType: 'tv',
      title: 'Show A',
      seasonsSnapshot: SNAPSHOT_2SEASONS,
    }).id;
  });

  it('S1 推进到 E7 → progressPercent = 70%', () => {
    const item = updateWatchItem(uid, itemId, { currentEpisode: 7 });
    assert.equal(item.currentEpisode, 7);
    assert.equal(item.progressPercent, 70);
  });

  it('currentEpisode 超出该季集数（E15 > S1 共10集）→ 封顶 100%', () => {
    const item = updateWatchItem(uid, itemId, { currentEpisode: 15 });
    assert.equal(item.progressPercent, 100);
  });

  it('换季：patch currentSeason=2 → 集数自动归零，百分比按新季集数计算', () => {
    const item = updateWatchItem(uid, itemId, { currentSeason: 2 });
    assert.equal(item.currentSeason, 2);
    assert.equal(item.currentEpisode, 0);
    assert.equal(item.progressPercent, 0);

    const item2 = updateWatchItem(uid, itemId, { currentEpisode: 12 });
    assert.equal(item2.progressPercent, Math.round((12 / 24) * 100)); // 50%
  });

  it('无快照时回退 total_episodes 作为分母；两者皆无且有进度 → 100%', () => {
    runMigrate();
    const u = insertUser(`u3_${process.pid}`);
    const noSnap = createWatchItem(u, { tmdbId: 2001, mediaType: 'tv', title: 'B' });
    const patched = updateWatchItem(u, noSnap.id, { currentEpisode: 5 });
    // 无快照无 total_episodes → 有进度视为 100
    assert.equal(patched.progressPercent, 100);

    // 手写一行只有 total_episodes 的数据验证回退分母
    getDb()
      .prepare(
        "UPDATE watchlist SET seasons_snapshot = NULL, total_episodes = 8 WHERE id = ?",
      )
      .run(noSnap.id);
    const withTotal = updateWatchItem(u, noSnap.id, { currentEpisode: 4 });
    assert.equal(withTotal.progressPercent, 50);
  });

  it('损坏的 seasons_snapshot JSON 不致崩溃，回退 total_episodes', () => {
    runMigrate();
    const u = insertUser(`u4_${process.pid}`);
    const item = createWatchItem(u, { tmdbId: 3001, mediaType: 'tv', title: 'C' });
    getDb()
      .prepare('UPDATE watchlist SET seasons_snapshot = ?, total_episodes = 20 WHERE id = ?')
      .run('{not-valid-json!!', item.id);
    const patched = updateWatchItem(u, item.id, { currentEpisode: 10 });
    assert.equal(patched.progressPercent, 50);
  });

  it('进度边界值校验：currentEpisode<0 或非整数、currentSeason<1 → 1001 / 400', () => {
    for (const patch of [
      { currentEpisode: -1 },
      { currentEpisode: 2.5 },
      { currentSeason: 0 },
      { currentSeason: -3 },
      { status: 'bingeing' as never },
    ]) {
      assert.throws(
        () => updateWatchItem(uid, itemId, patch),
        (e: unknown) => e instanceof ApiError && e.code === 1001 && e.httpStatus === 400,
        `应拒绝 patch：${JSON.stringify(patch)}`,
      );
    }
  });

  it('更新不存在的条目 → 1004 / 404', () => {
    assert.throws(
      () => updateWatchItem(uid, 999999, { currentEpisode: 1 }),
      (e: unknown) => e instanceof ApiError && e.code === 1004 && e.httpStatus === 404,
    );
  });
});

describe('watchlistService · 列表过滤与行隔离', () => {
  let userA: number;
  let userB: number;
  let itemA: number;
  let itemA2: number;

  before(() => {
    runMigrate();
    userA = insertUser(`a_${process.pid}`);
    userB = insertUser(`b_${process.pid}`);
    itemA = createWatchItem(userA, { tmdbId: 601, mediaType: 'movie', title: 'A-movie' }).id;
    touch(userA, itemA, '2025-01-01 00:00:00');
    itemA2 = createWatchItem(userA, {
      tmdbId: 602,
      mediaType: 'tv',
      title: 'A-tv',
      seasonsSnapshot: SNAPSHOT_2SEASONS,
    }).id;
    touch(userA, itemA2, '2025-01-02 00:00:00');
    updateWatchItem(userA, itemA2, { status: 'finished' });
    createWatchItem(userB, { tmdbId: 601, mediaType: 'movie', title: 'B-movie' });
  });

  it('列表按用户隔离：userB 看不到 userA 的条目', () => {
    const listB = listWatchlist(userB);
    assert.equal(listB.length, 1);
    assert.equal(listB[0].title, 'B-movie');
    const listA = listWatchlist(userA);
    assert.equal(listA.length, 2);
  });

  it('status 过滤合法且按 updated_at 倒序；非法 status → 1001', () => {
    const finished = listWatchlist(userA, 'finished');
    assert.equal(finished.length, 1);
    assert.equal(finished[0].id, itemA2);

    const all = listWatchlist(userA);
    assert.deepEqual(all.map((i) => i.id), [itemA2, itemA]); // 倒序

    assert.throws(
      () => listWatchlist(userA, "watching' OR '1'='1"),
      (e: unknown) => e instanceof ApiError && e.code === 1001,
    );
  });

  it('跨用户更新/删除被拒绝（1004），同用户正常操作成功', () => {
    assert.throws(
      () => updateWatchItem(userB, itemA, { currentEpisode: 1 }),
      (e: unknown) => e instanceof ApiError && e.code === 1004,
    );
    assert.throws(
      () => deleteWatchItem(userB, itemA),
      (e: unknown) => e instanceof ApiError && e.code === 1004,
    );

    const ok = updateWatchItem(userA, itemA, { status: 'dropped' });
    assert.equal(ok.status, 'dropped');

    deleteWatchItem(userA, itemA);
    assert.throws(
      () => deleteWatchItem(userA, itemA),
      (e: unknown) => e instanceof ApiError && e.code === 1004,
    );
  });
});
