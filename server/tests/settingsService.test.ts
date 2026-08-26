/**
 * settingsService 单元测试：KV 读写、白名单校验、Key 打码与脱敏视图。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { runMigrate } from '../src/db/migrate';
import { runSeed, DEFAULT_SETTINGS } from '../src/db/seed';
import {
  getSetting,
  getSettingsView,
  hasTmdbApiKey,
  maskApiKey,
  setSetting,
  updateSettings,
} from '../src/services/settingsService';
import { ApiError } from '../src/middleware/errorHandler';

describe('settingsService', () => {
  before(() => {
    runMigrate();
    runSeed();
  });

  it('种子数据提供默认值（ratings_ttl_hours=72、theme_default=dark、tmdb_api_key 为空）', () => {
    assert.equal(getSetting('ratings_ttl_hours'), '72');
    assert.equal(getSetting('theme_default'), 'dark');
    assert.equal(getSetting('tmdb_api_key'), '');
    // M4 新增评分回源键：默认均为空串（未配置 → 降级为 null）
    assert.equal(getSetting('omdb_api_key'), '');
    assert.equal(getSetting('douban_api_base'), '');
    // M1 新增 Emby 键：默认均为空串（未配置 → 功能降级不可用）
    assert.equal(getSetting('emby_server_url'), '');
    assert.equal(getSetting('emby_api_key'), '');
    assert.equal(getSetting('emby_user_id'), '');
    assert.equal(getSetting('emby_last_sync'), '');
    // M3 新增日历键：服务端写入的最近刷新时间
    assert.equal(getSetting('calendar_last_sync'), '');
    assert.equal(Object.keys(DEFAULT_SETTINGS).length, 10);
  });

  it('set/get 往返写入，重复写覆盖旧值（UPSERT）', () => {
    setSetting('theme_default', 'light');
    assert.equal(getSetting('theme_default'), 'light');
    setSetting('theme_default', 'dark');
    assert.equal(getSetting('theme_default'), 'dark');
  });

  it('updateSettings 接受字符串与数字，数字统一转字符串存储', () => {
    updateSettings({ ratings_ttl_hours: '24', theme_default: 1 });
    assert.equal(getSetting('ratings_ttl_hours'), '24');
    assert.equal(getSetting('theme_default'), '1');
  });

  it('updateSettings 拒绝白名单之外的键：code=1001 / 400', () => {
    assert.throws(
      () => updateSettings({ evil_key: 'x' }),
      (e: unknown) =>
        e instanceof ApiError && e.code === 1001 && e.httpStatus === 400,
    );
  });

  it('updateSettings 拒绝非标量值类型（布尔/对象/数组）：code=1001', () => {
    for (const bad of [true, null, { a: 1 }, ['x']]) {
      assert.throws(
        // @ts-expect-error 故意传入非法类型
        () => updateSettings({ theme_default: bad }),
        (e: unknown) => e instanceof ApiError && e.code === 1001,
        `应拒绝值：${JSON.stringify(bad)}`,
      );
    }
  });

  it('maskApiKey：长 Key 保留前3后2，短 Key 全打码，空串返回空串', () => {
    assert.equal(maskApiKey('abcdefghijkl'), 'abc***kl');
    assert.equal(maskApiKey('abcdef'), '******');
    assert.equal(maskApiKey('ab'), '**');
    assert.equal(maskApiKey('   '), '');
    assert.equal(maskApiKey(''), '');
  });

  it('maskApiKey 不泄漏中间内容', () => {
    const masked = maskApiKey('0123456789abcdef');
    assert.ok(!masked.includes('456789'));
  });

  it('hasTmdbApiKey：空白视为未配置', () => {
    setSetting('tmdb_api_key', '');
    assert.equal(hasTmdbApiKey(), false);
    setSetting('tmdb_api_key', '   ');
    assert.equal(hasTmdbApiKey(), false);
    setSetting('tmdb_api_key', 'real-key-123');
    assert.equal(hasTmdbApiKey(), true);
  });

  it('getSettingsView 返回脱敏视图：只含打码 Key 与布尔标志，绝无明文', () => {
    // 恢复默认主题（前面的用例把它改成了数字 1），避免用例间耦合
    setSetting('theme_default', 'dark');
    setSetting('tmdb_api_key', 'super-secret-key-987654321');
    const view = getSettingsView() as Record<string, unknown>;
    assert.equal(view.tmdb_api_key_masked, 'sup***21');
    assert.equal(view.tmdb_api_key_set, true);
    assert.equal(view.ratings_ttl_hours, 24); // 前面用例设置为 24
    assert.equal(view.theme_default, 'dark');
    const raw = JSON.stringify(view);
    assert.ok(!raw.includes('super-secret-key-987654321'), '脱敏视图不得包含明文 Key');
    assert.ok(!('tmdb_api_key' in view), '视图中不应存在明文字段名');
  });
});
