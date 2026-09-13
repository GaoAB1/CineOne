/**
 * pan115Service 单元测试：Cookie 规范化、登录态判定、预设目录解析与错误映射。
 * 不发起真实网络请求（仅覆盖纯函数与未配置路径）。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { runMigrate } from '../src/db/migrate';
import { runSeed } from '../src/db/seed';
import {
  addPan115Url,
  getPan115Status,
  hasAuthCookie,
  normalizeCookie,
  parsePresetPaths,
  resolvePresetCid,
} from '../src/services/pan115Service';

describe('pan115Service.normalizeCookie', () => {
  it('去掉 "Cookie: " 前缀并规范化分隔符', () => {
    assert.equal(
      normalizeCookie('Cookie: UID=123; CID=abc; SEID=xyz'),
      'UID=123; CID=abc; SEID=xyz',
    );
  });

  it('换行分隔的 Cookie 会被合并为单行', () => {
    assert.equal(normalizeCookie('UID=1\r\nCID=2\r\nSEID=3'), 'UID=1; CID=2; SEID=3');
  });

  it('多余空格与空段被清理', () => {
    assert.equal(normalizeCookie('  UID=1 ;; CID=2 ;  '), 'UID=1; CID=2');
  });

  it('空串返回空串', () => {
    assert.equal(normalizeCookie(''), '');
  });
});

describe('pan115Service.hasAuthCookie', () => {
  it('同时含 UID 与 CID 才算已登录', () => {
    assert.equal(hasAuthCookie('UID=1; CID=2; SEID=3'), true);
    assert.equal(hasAuthCookie('CID=2; SEID=3'), false);
    assert.equal(hasAuthCookie('UID=1; SEID=3'), false);
    assert.equal(hasAuthCookie(''), false);
  });

  it('带 Cookie 前缀的串也能识别', () => {
    assert.equal(hasAuthCookie('Cookie: UID=1; CID=2'), true);
  });
});

describe('pan115Service.parsePresetPaths', () => {
  it('解析「名称:CID」格式', () => {
    const result = parsePresetPaths('电影:123456\n剧集:789012');
    assert.equal(result.length, 2);
    assert.deepEqual(result[0], { name: '电影', cid: '123456' });
    assert.deepEqual(result[1], { name: '剧集', cid: '789012' });
  });

  it('支持中文全角冒号', () => {
    const result = parsePresetPaths('电影：123456');
    assert.deepEqual(result[0], { name: '电影', cid: '123456' });
  });

  it('纯 CID 行生成占位名称', () => {
    const result = parsePresetPaths('998877');
    assert.equal(result.length, 1);
    assert.equal(result[0].cid, '998877');
  });

  it('忽略空行与非法行', () => {
    const result = parsePresetPaths('\n\n电影:123\n不是CID的行\n\n');
    assert.equal(result.length, 1);
    assert.equal(result[0].name, '电影');
  });

  it('空配置返回空数组', () => {
    assert.deepEqual(parsePresetPaths(''), []);
  });
});

describe('pan115Service 未配置路径', () => {
  before(() => {
    runMigrate();
    runSeed();
  });

  it('未配置 Cookie 时 getPan115Status 返回 configured=false', async () => {
    const status = await getPan115Status();
    assert.equal(status.configured, false);
    assert.equal(status.reachable, false);
    assert.equal(status.loggedIn, false);
    assert.equal(status.error, null);
  });

  it('未配置 Cookie 时添加磁力抛 428（提示先配置）', async () => {
    await assert.rejects(
      () => addPan115Url({ url: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567' }),
      (err: any) => {
        assert.equal(err.httpStatus, 428);
        assert.match(err.message, /未配置/);
        return true;
      },
    );
  });

  it('resolvePresetCid 对空串返回根目录 0', async () => {
    assert.equal(await resolvePresetCid(''), '0');
  });

  it('resolvePresetCid 对纯数字直接返回该 CID', async () => {
    assert.equal(await resolvePresetCid('123456789'), '123456789');
  });
});
