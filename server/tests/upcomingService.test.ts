/**
 * upcomingService 单元测试：唯一约束（4091）、release_date 升序（空值最后）、
 * user_id 行隔离、删除 404。不发真实网络请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb, getDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import {
  createUpcomingItem,
  deleteUpcomingItem,
  listUpcoming,
} from '../src/services/upcomingService';
import { ApiError } from '../src/middleware/errorHandler';

/** 断言 fn 抛出指定 code / httpStatus 的 ApiError */
function assertApiError(fn: () => unknown, code: number, httpStatus: number): void {
  try {
    fn();
    assert.fail(`期望抛出 ApiError(code=${code})，但未抛出任何异常`);
  } catch (err) {
    assert.ok(err instanceof ApiError, `期望 ApiError，实际得到：${String(err)}`);
    assert.equal((err as ApiError).code, code);
    assert.equal((err as ApiError).httpStatus, httpStatus);
  }
}

describe('upcomingService · 想看列表', () => {
  before(() => {
    runMigrate();
    // upcoming.user_id 外键指向 users，先种出测试用户
    const insertUser = getDb().prepare(
      `INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'member')`,
    );
    for (const id of [1, 20, 30, 31]) {
      insertUser.run(id, `u${id}`, 'x');
    }
  });
  after(() => closeDb());

  it('创建条目：字段齐全，缺省 title 落库为「未命名条目」', () => {
    const item = createUpcomingItem(1, { tmdbId: 500, mediaType: 'movie' });
    assert.equal(item.tmdbId, 500);
    assert.equal(item.mediaType, 'movie');
    assert.equal(item.title, '未命名条目');
    assert.equal(item.posterPath, undefined);
    assert.equal(item.releaseDate, undefined);
  });

  it('重复添加同一条目 → code=4091 / HTTP 409；非法入参 → 1001 / 400', () => {
    createUpcomingItem(1, { tmdbId: 501, mediaType: 'tv', releaseDate: '2026-03-01' });
    assertApiError(
      () => createUpcomingItem(1, { tmdbId: 501, mediaType: 'tv' }),
      4091,
      409,
    );
    assertApiError(() => createUpcomingItem(1, { tmdbId: -5, mediaType: 'movie' }), 1001, 400);
    assertApiError(
      () => createUpcomingItem(1, { tmdbId: 9, mediaType: 'book' as never }),
      1001,
      400,
    );
    assertApiError(
      () => createUpcomingItem(1, { tmdbId: 9, mediaType: 'movie', releaseDate: '01/02/2026' }),
      1001,
      400,
    );
  });

  it('列表按 release_date 升序，空值排最后', () => {
    const user = 20;
    createUpcomingItem(user, { tmdbId: 3, mediaType: 'movie', releaseDate: '2026-05-10' });
    createUpcomingItem(user, { tmdbId: 1, mediaType: 'movie', releaseDate: '2026-01-02' });
    createUpcomingItem(user, { tmdbId: 2, mediaType: 'movie', releaseDate: '2026-03-15' });
    createUpcomingItem(user, { tmdbId: 4, mediaType: 'tv' }); // 无日期 → 最后
    const items = listUpcoming(user);
    assert.deepEqual(
      items.map((i) => i.tmdbId),
      [1, 2, 3, 4],
    );
  });

  it('行隔离：userB 看不到也删不掉 userA 的条目；删除不存在 → 1004 / 404', () => {
    const mine = createUpcomingItem(30, { tmdbId: 700, mediaType: 'movie' });
    assert.equal(listUpcoming(31).some((i) => i.id === mine.id), false);
    assertApiError(() => deleteUpcomingItem(31, mine.id), 1004, 404);
    deleteUpcomingItem(30, mine.id); // 本人正常删除
    assertApiError(() => deleteUpcomingItem(30, mine.id), 1004, 404);
  });
});
