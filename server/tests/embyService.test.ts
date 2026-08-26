/**
 * embyService / embyItemAdapter 单元测试：未配置降级、条目映射、播放状态解析、
 * 播放跳转 URL。不发真实网络请求（未配置路径在触网前短路返回）。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeDb, getDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import {
  embyItemAdapter,
  resolvePlaybackState,
  type EmbyRawItem,
} from '../src/services/embyItemAdapter';
import { getEmbyStatus, getPlayUrl } from '../src/services/embyService';
import { setSetting } from '../src/services/settingsService';

function rawItem(overrides: Partial<EmbyRawItem>): EmbyRawItem {
  return {
    Id: 'emby-001',
    Name: '沙丘',
    Type: 'Movie',
    ProductionYear: 2021,
    Overview: '  ',
    ProviderIds: { Tmdb: '438631' },
    ImageTags: { Primary: 'a1b2.jpg' },
    UserData: { Played: false, PlayedPercentage: 45.5 },
    ...overrides,
  };
}

describe('embyService · 未配置状态', () => {
  before(() => {
    runMigrate();
    // 确保三键均为空（未配置）
    setSetting('emby_server_url', '');
    setSetting('emby_api_key', '');
    setSetting('emby_user_id', '');
    setSetting('emby_last_sync', '');
  });

  after(() => closeDb());

  it('getEmbyStatus 未配置时 configured=false 且不触网（verified=false、serverName=null）', async () => {
    const status = await getEmbyStatus();
    assert.deepEqual(status, {
      configured: false,
      verified: false,
      serverName: null,
      itemCount: 0,
      lastSync: null,
    });
  });
});

describe('embyItemAdapter · 条目映射', () => {
  it('完整映射：Tmdb/标题/年份/海报 URL/播放百分比，空白 Overview 归一为 null', () => {
    const mapped = embyItemAdapter(rawItem({}), 'http://emby.local:8096/');
    assert.ok(mapped);
    assert.equal(mapped.itemId, 'emby-001');
    assert.equal(mapped.tmdbId, 438631);
    assert.equal(mapped.mediaType, 'movie');
    assert.equal(mapped.title, '沙丘');
    assert.equal(mapped.year, 2021);
    assert.equal(
      mapped.posterUrl,
      'http://emby.local:8096/emby/Items/emby-001/Images/Primary?maxWidth=342',
    );
    assert.equal(mapped.overview, null); // 空白字符串不视为有效简介
    assert.equal(mapped.playedPercentage, 45.5);
    assert.equal(mapped.played, false);
  });

  it('Series 类型映射为 tv；无 Tmdb 映射返回 null（调用方跳过计数）', () => {
    const series = embyItemAdapter(
      rawItem({ Type: 'Series', Name: '幕府将军' }),
      'http://emby.local',
    );
    assert.ok(series);
    assert.equal(series.mediaType, 'tv');

    assert.equal(embyItemAdapter(rawItem({ ProviderIds: {} }), 'http://x'), null);
    assert.equal(embyItemAdapter(rawItem({ Id: undefined }), 'http://x'), null);
    assert.equal(embyItemAdapter(rawItem({ Type: 'MusicAlbum' }), 'http://x'), null);
  });

  it('resolvePlaybackState：已看→finished、部分观看→watching、未播放→null 不回写', () => {
    const base = embyItemAdapter(rawItem({}), 'http://x');
    assert.ok(base);
    assert.deepEqual(resolvePlaybackState(base), { status: 'watching' });
    assert.deepEqual(
      resolvePlaybackState({ ...base, played: true, playedPercentage: 100 }),
      { status: 'finished' },
    );
    assert.equal(resolvePlaybackState({ ...base, playedPercentage: 0 }), null);
    assert.equal(resolvePlaybackState({ ...base, playedPercentage: 100 }), null);
  });
});

describe('embyService · 播放跳转', () => {
  before(() => {
    runMigrate();
    setSetting('emby_server_url', 'http://emby.local:8096');
  });

  after(() => closeDb());

  it('未同步条目返回 null；入库后拼出 web 播放页 URL（含 serverId）', () => {
    assert.equal(getPlayUrl(999999, 'movie'), null);

    getDb()
      .prepare(
        `INSERT INTO emby_items (item_id, server_id, tmdb_id, media_type, title, year, poster_url, played_percentage, played, synced_at)
         VALUES ('it-9', 'srv-1', 999999, 'movie', '测试片', 2020, NULL, 0, 0, datetime('now'))`,
      )
      .run();

    const url = getPlayUrl(999999, 'movie');
    assert.equal(url, 'http://emby.local:8096/web/index.html#!/item?id=it-9&serverId=srv-1');
  });

  it('同一 tmdb_id 不同 media_type 不互相命中', () => {
    assert.equal(getPlayUrl(999999, 'tv'), null);
  });
});
