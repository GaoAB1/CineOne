/**
 * 媒体重命名测试：parser 文件名解析（Emby 全部命名约定核心场景）、
 * sanitize 非法字符清洗、renamer 路由挂载。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseFile, sanitize } from '../src/services/mediaRenamerService';

function parse(name: string, hint?: 'movie' | 'tv'): ReturnType<typeof parseFile> {
  return parseFile(name, { hint });
}

describe('mediaRenamer.parser：剧集', () => {
  it('SxxExx：Glee.S01E01.Pilot.mkv', () => {
    const r = parse('Glee.S01E01.Pilot.mkv');
    assert.equal(r.type, 'tv');
    assert.equal(r.name, 'Glee');
    assert.equal(r.season, 1);
    assert.equal(r.epStart, 1);
    assert.equal(r.epName, 'Pilot');
  });

  it('多集：Breaking Bad S01E02-E03.mkv', () => {
    const r = parse('Breaking Bad S01E02-E03.mkv');
    assert.equal(r.season, 1);
    assert.equal(r.epStart, 2);
    assert.equal(r.epEnd, 3);
  });

  it('特典：The Blue Planet s00e01.mkv', () => {
    const r = parse('The Blue Planet s00e01.mkv');
    assert.equal(r.season, 0);
    assert.equal(r.epStart, 1);
  });

  it('日期命名：Daily.Show.1996-11-14.mp4', () => {
    const r = parse('Daily.Show.1996-11-14.mp4');
    assert.equal(r.type, 'tv');
    assert.equal(r.epDate, '1996-11-14');
  });

  it('3 位简写：Seinfeld.102.mkv → S01E02（不被 720p 干扰）', () => {
    const r = parse('Seinfeld.102.mkv');
    assert.equal(r.season, 1);
    assert.equal(r.epStart, 2);
    const r2 = parse('Show.720p.102.mkv');
    assert.equal(r2.season, 1);
    assert.equal(r2.epStart, 2);
  });

  it('1x02 简写', () => {
    const r = parse('anything_1x02.ext');
    assert.equal(r.season, 1);
    assert.equal(r.epStart, 2);
  });

  it('中文集号：某动画 第187话.mkv', () => {
    const r = parse('某动画 第187话.mkv');
    assert.equal(r.type, 'tv');
    assert.equal(r.name, '某动画');
    assert.equal(r.epStart, 187);
    assert.equal(r.season, 1);
  });

  it('中文季号：剧名 第二季 第05集.mkv', () => {
    const r = parse('剧名 第二季 第05集.mkv');
    assert.equal(r.season, 2);
    assert.equal(r.epStart, 5);
    assert.equal(r.name, '剧名');
  });
});

describe('mediaRenamer.parser：电影', () => {
  it('Avatar (2009).mkv', () => {
    const r = parse('Avatar (2009).mkv');
    assert.equal(r.type, 'movie');
    assert.equal(r.name, 'Avatar');
    assert.equal(r.year, 2009);
  });

  it('多版本：Avatar (2009) - 1080p.mkv', () => {
    const r = parse('Avatar (2009) - 1080p.mkv');
    assert.equal(r.type, 'movie');
    assert.equal(r.name, 'Avatar');
    assert.equal(r.version, '1080p');
  });
});

describe('mediaRenamer.sanitize', () => {
  it('Windows 非法字符替换为空格，尾部点/空格清除', () => {
    assert.equal(sanitize('A<B>C:D?*'), 'A B C D');
    assert.equal(sanitize('Title. '), 'Title');
  });
});

describe('mediaRenamer.isRecentlyDone 兼容（回归占位）', () => {
  it('parser 提取分辨率', () => {
    const r = parse('Show.S01E01.1080p.mkv');
    assert.equal(r.resolution, '1080p');
  });
});
