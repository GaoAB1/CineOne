/**
 * 通知推送相关测试：
 *  - migrate 一次性迁移：upcoming「想看」并入 watchlist(status='planned')
 *  - qbTorrentDone 完成态判定（notifyService 导出）
 *  - Bark 未配置时 sendBark 静默跳过
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { getDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import { runSeed } from '../src/db/seed';
import { setSetting } from '../src/services/settingsService';
import { sendBark, isBarkAccepted } from '../src/services/barkService';
import { qbTorrentDone, isRecentlyDone } from '../src/services/notifyService';

describe('migrate：upcoming → watchlist(planned) 一次性迁移', () => {
  before(() => {
    runMigrate();
    runSeed();
    const db = getDb();
    // 插入 upcoming 假数据（一个新条目 + 一个已在 watchlist 的重复条目）
    db.prepare(
      `INSERT INTO users (username, password_hash) VALUES ('mig-user', 'x')`,
    ).run();
    const user = db.prepare(`SELECT id FROM users WHERE username = 'mig-user'`).get() as {
      id: number;
    };
    db.prepare(
      `INSERT INTO upcoming (user_id, tmdb_id, media_type, title, poster_path, release_date)
       VALUES (?, 1001, 'movie', '迁移新片', null, '2026-10-01')`,
    ).run(user.id);
    db.prepare(
      `INSERT INTO upcoming (user_id, tmdb_id, media_type, title, poster_path, release_date)
       VALUES (?, 1002, 'tv', '已有条目', null, '2026-10-02')`,
    ).run(user.id);
    db.prepare(
      `INSERT INTO watchlist (user_id, tmdb_id, media_type, title, status)
       VALUES (?, 1002, 'tv', '已有条目', 'watching')`,
    ).run(user.id);

    // 再次执行 runMigrate 触发迁移（幂等：重复执行不重复插入）
    runMigrate();
  });

  it('upcoming 条目迁移为 watchlist planned', () => {
    const row = getDb()
      .prepare(`SELECT * FROM watchlist WHERE tmdb_id = 1001 AND media_type = 'movie'`)
      .get() as { status: string; title: string } | undefined;
    assert.ok(row, '迁移后的条目应存在');
    assert.equal(row.status, 'planned');
    assert.equal(row.title, '迁移新片');
  });

  it('迁移幂等：重复执行不产生重复行，且不覆盖已有状态', () => {
    const count = getDb()
      .prepare(`SELECT COUNT(*) AS c FROM watchlist WHERE tmdb_id = 1001`)
      .get() as { c: number };
    assert.equal(count.c, 1);
    const kept = getDb()
      .prepare(`SELECT status FROM watchlist WHERE tmdb_id = 1002`)
      .get() as { status: string };
    assert.equal(kept.status, 'watching', '已存在的 watchlist 条目应保持原状态');
  });
});

describe('notifyService.qbTorrentDone', () => {
  it('进度 100% 的上传/完成态为完成', () => {
    assert.equal(qbTorrentDone('stalledUP', 1), true);
    assert.equal(qbTorrentDone('pausedUP', 1), true);
    assert.equal(qbTorrentDone('stoppedUP', 1), true);
    assert.equal(qbTorrentDone('uploading', 1), true);
    assert.equal(qbTorrentDone('forcedUP', 1), true);
  });

  it('未完成或下载/异常态不为完成', () => {
    assert.equal(qbTorrentDone('stalledUP', 0.5), false);
    assert.equal(qbTorrentDone('downloading', 1), false);
    assert.equal(qbTorrentDone('stalledDL', 0.99), false);
    assert.equal(qbTorrentDone('error', 1), false);
    assert.equal(qbTorrentDone('moving', 1), false);
    assert.equal(qbTorrentDone('checkingUP', 1), false);
  });
});

describe('notifyService.isRecentlyDone（首轮补发窗口）', () => {
  const now = Date.parse('2026-09-14T16:20:00+08:00');
  const WINDOW = 15 * 60_000;

  it('完成时间在窗口内（如 3 分钟前）判为刚完成', () => {
    assert.equal(isRecentlyDone((now - 3 * 60_000) / 1000, now, WINDOW), true);
    assert.equal(isRecentlyDone((now - WINDOW) / 1000, now, WINDOW), true);
  });

  it('完成时间早于窗口（如 1 小时前）不补发', () => {
    assert.equal(isRecentlyDone((now - 60 * 60_000) / 1000, now, WINDOW), false);
  });

  it('未来时间与非法值不补发', () => {
    assert.equal(isRecentlyDone((now + 60_000) / 1000, now, WINDOW), false);
    assert.equal(isRecentlyDone(0, now, WINDOW), false);
    assert.equal(isRecentlyDone(NaN, now, WINDOW), false);
  });

  it('默认窗口 15 分钟', () => {
    assert.equal(isRecentlyDone((now - 14 * 60_000) / 1000, now), true);
    assert.equal(isRecentlyDone((now - 16 * 60_000) / 1000, now), false);
  });

  it('毫秒时间戳（如 115 last_update）自动识别，不误乘 1000', () => {
    // 3 分钟前，毫秒表示（>1e12）
    assert.equal(isRecentlyDone(now - 3 * 60_000, now, WINDOW), true);
    // 1 小时前，毫秒表示
    assert.equal(isRecentlyDone(now - 60 * 60_000, now, WINDOW), false);
  });
});

describe('barkService.sendBark 未配置路径', () => {
  before(() => {
    runMigrate();
    runSeed();
    setSetting('bark_device_key', '');
  });

  it('未配置 device_key 时静默跳过且不抛错', async () => {
    const result = await sendBark('标题', '内容');
    assert.equal(result.ok, false);
    assert.match(result.message, /未配置/);
  });
});

describe('barkService.isBarkAccepted（响应判定）', () => {
  it('Bark 官方成功响应 code=200 message=success 判为成功', () => {
    assert.equal(isBarkAccepted({ code: 200, message: 'success' }), true);
  });

  it('旧版 code=0 判为成功', () => {
    assert.equal(isBarkAccepted({ code: 0, message: 'success' }), true);
  });

  it('无 code 字段时以 HTTP 状态为准（判为成功）', () => {
    assert.equal(isBarkAccepted({ message: 'success' }), true);
    assert.equal(isBarkAccepted(null), true);
  });

  it('非 200/0 的 code 判为拒绝', () => {
    assert.equal(isBarkAccepted({ code: 400, message: 'Bad Key' }), false);
  });
});
