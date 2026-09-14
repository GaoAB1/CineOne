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
import { sendBark } from '../src/services/barkService';
import { qbTorrentDone } from '../src/services/notifyService';

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
