/**
 * 网络代理测试：设置读写、proxy_resource_sites 开关语义、
 * TMDB 与资源站请求按配置注入 dispatcher 的行为（以 undici ProxyAgent 实例为准）。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { runMigrate } from '../src/db/migrate';
import { runSeed } from '../src/db/seed';
import { getSettingsView, updateSettings } from '../src/services/settingsService';
import { proxyDispatcherFor } from '../src/services/proxyAgent';

describe('网络代理：设置与 dispatcher 注入', () => {
  before(() => {
    runMigrate();
    runSeed();
  });

  it('未配置代理时：TMDB 与资源站均直连（无 dispatcher）', () => {
    updateSettings({ proxy_url: '', proxy_resource_sites: '0' });
    assert.equal(proxyDispatcherFor('tmdb'), undefined);
    assert.equal(proxyDispatcherFor('resource'), undefined);
  });

  it('配置代理后：TMDB 拿到 ProxyAgent 实例', () => {
    updateSettings({ proxy_url: 'http://127.0.0.1:7890' });
    const d = proxyDispatcherFor('tmdb');
    assert.ok(d, 'TMDB 应返回 dispatcher');
  });

  it('开关关闭时资源站不走代理，开启后走', () => {
    updateSettings({ proxy_url: 'http://127.0.0.1:7890', proxy_resource_sites: '0' });
    assert.equal(proxyDispatcherFor('resource'), undefined);
    updateSettings({ proxy_resource_sites: '1' });
    assert.ok(proxyDispatcherFor('resource'), '开关开启后资源站应返回 dispatcher');
  });

  it('非法代理地址静默降级为直连', () => {
    updateSettings({ proxy_url: 'not-a-valid-url' });
    assert.equal(proxyDispatcherFor('tmdb'), undefined);
    updateSettings({ proxy_url: '' });
  });

  it('设置视图回显代理地址与资源站开关', () => {
    updateSettings({ proxy_url: 'http://127.0.0.1:7890', proxy_resource_sites: '1' });
    const view = getSettingsView();
    assert.equal(view.proxy_url, 'http://127.0.0.1:7890');
    assert.equal(view.proxy_resource_sites, true);
    updateSettings({ proxy_url: '', proxy_resource_sites: '0' });
  });
});
