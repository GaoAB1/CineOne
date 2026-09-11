/**
 * hgemeService / 多源聚合 单元测试：
 * PoW 求解、Cookie 解析、搜索内联数据解析、资源（磁力/网盘）映射、统一条目映射。
 * 全部为纯函数测试，不发真实网络请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb } from '../src/db/database';
import {
  mapDownurl,
  mapSearchInline,
  parseCookieString,
  parseSearchInline,
  solvePow,
} from '../src/services/hgemeService';
import { mapHgemeItems } from '../src/services/resourceService';

after(() => {
  closeDb();
});

/** 真实结构裁剪的搜索页 fixture（_obj.search 内联） */
const SEARCH_HTML = `<script>_obj.header={"u":{"n":"tester"}};_obj.search={"q":"%E5%A5%A5%E6%9C%AC%E6%B5%B7%E9%BB%98","wd":["奥","本","海","默"],"ns":[19,17,2,0,51,234],"ty":0,"zy":[],"zy_cur":"","l":{"title":["奥本海默","诺曼"],"name":["Oppenheimer","Norman"],"year":[2023,2016],"d":["mv","mv"],"i":["PdaD","WeEK"],"info":["美国 / 英国 / 剧情 / 传记","以色列 / 美国 / 剧情"],"daoyan":["克里斯托弗·诺兰","约瑟夫·斯达"],"zhuyan":["基里安·墨菲 / 艾米莉·布朗特","理查·基尔 / 利奥尔·阿什肯纳齐"],"pf":{"db":{"s":[8.8,7.2],"r":[81.6,2130]}}}};_obj.page={"p":1};</script>`;

const DOWNURL_PAYLOAD = {
  code: 200,
  downlist: {
    imdb: '',
    hex: '6aa410de000082d06e7a03501f546f37c603c3831412',
    list: {
      m: [
        '634D3482971995B49627BF261A45B2353FC08D21',
        '634d3482971995b49627bf261a45b2353fc08d21',
        'not-a-valid-hash',
      ],
      t: ['UIndex - Oppenheimer 2023 1080p NF WEB-DL', '重复条目', '非法'],
      s: ['4.15G', '4.15G', ''],
      p: ['i3', 'i3', ''],
      n: ['1月前', '1月前', ''],
    },
  },
  panlist: {
    id: ['Wnq6D'],
    name: ['🚨【奥本海默 (2023)】【1080P+4K】'],
    url: ['https://pan.xunlei.com/s/VOzqravj2GyaDjMhzQdkAXdNA1?pwd=dwgi'],
    tname: ['迅雷网盘'],
    user: ['大头影视'],
    time: ['今天'],
  },
};

describe('hgmeService 基础工具', () => {
  it('parseCookieString 解析浏览器复制的 Cookie 串（忽略空白）', () => {
    const jar = parseCookieString(
      ' browser_verified=abc123; PHPSESSID=xyz789 ; app_auth=tok-1; ; bad',
    );
    assert.deepEqual(jar, { browser_verified: 'abc123', PHPSESSID: 'xyz789', app_auth: 'tok-1' });
  });

  it('solvePow 计算 y = x^(2^t) mod N', async () => {
    // N=0x23(35), x=2, t=3 → 2^8 = 256 ≡ 11 (mod 35) → 0xb
    const y = await solvePow('23', '2', 3);
    assert.equal(BigInt('0x' + y), 11n);
  });

  it('solvePow 处理较大 t 仍返回一致结果（与一次性计算对齐）', async () => {
    const N = 'fffffffb'; // 4294967291
    const x = '7';
    const t = 25_000;
    const n = BigInt('0x' + N);
    let expect = BigInt('0x' + x);
    for (let i = 0; i < t; i += 1) expect = (expect * expect) % n;
    const y = await solvePow(N, x, t);
    assert.equal(BigInt('0x' + y), expect);
  });
});

describe('hgmeService 搜索解析', () => {
  it('parseSearchInline 从 HTML 中提取 _obj.search（括号匹配）', () => {
    const inline = parseSearchInline(SEARCH_HTML);
    assert.ok(inline, '应解析出内联对象');
    assert.equal((inline as { q: string }).q, '%E5%A5%A5%E6%9C%AC%E6%B5%B7%E9%BB%98');
    assert.deepEqual((inline as { ns: number[] }).ns?.slice(0, 3), [19, 17, 2]);
  });

  it('无内联数据时返回 null', () => {
    assert.equal(parseSearchInline('<html><body>无结果</body></html>'), null);
  });

  it('mapSearchInline 映射为条目（片名/年份/id/评分/导演/主演/类型段）', () => {
    const inline = parseSearchInline(SEARCH_HTML);
    assert.ok(inline);
    const items = mapSearchInline(inline as Record<string, unknown>);
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], {
      id: 'PdaD',
      dir: 'mv',
      title: '奥本海默',
      ename: 'Oppenheimer',
      year: 2023,
      rating: 8.8,
      info: '美国 / 英国 / 剧情 / 传记',
      directors: ['克里斯托弗·诺兰'],
      actors: ['基里安·墨菲', '艾米莉·布朗特'],
    });
    assert.equal(items[1].id, 'WeEK');
    assert.equal(items[1].year, 2016);
  });

  it('缺少 id 的条目被过滤', () => {
    const items = mapSearchInline({
      l: { title: ['有 id', '无 id'], i: ['AAA', ''], d: ['mv', 'mv'] },
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 'AAA');
  });
});

describe('hgmeService 资源映射', () => {
  it('mapDownurl 提取磁力（去重 + 过滤非法哈希）与网盘', () => {
    const res = mapDownurl(DOWNURL_PAYLOAD);
    assert.equal(res.magnets.length, 1, '重复哈希与非法哈希应被过滤');
    const m = res.magnets[0];
    assert.equal(m.magnet, 'magnet:?xt=urn:btih:634d3482971995b49627bf261a45b2353fc08d21&dn=UIndex%20-%20Oppenheimer%202023%201080p%20NF%20WEB-DL');
    assert.equal(m.size, '4.15G');
    assert.equal(m.tag, 'i3');
    assert.equal(m.time, '1月前');

    assert.equal(res.pans.length, 1);
    assert.equal(res.pans[0].netdisk, '迅雷网盘');
    assert.ok(res.pans[0].url.startsWith('https://pan.xunlei.com/'));
  });

  it('空资源返回空数组', () => {
    const res = mapDownurl({});
    assert.deepEqual(res, { magnets: [], pans: [] });
  });
});

describe('多源聚合条目映射', () => {
  it('mapHgemeItems 生成统一 ResourceItem（source/dir/url/标签）', () => {
    const items = mapHgemeItems([
      {
        id: 'PdaD',
        dir: 'mv',
        title: '奥本海默',
        ename: 'Oppenheimer',
        year: 2023,
        rating: 8.8,
        info: '美国 / 英国 / 剧情 / 传记',
        directors: ['克里斯托弗·诺兰'],
        actors: ['基里安·墨菲'],
      },
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].source, 'hgeme');
    assert.equal(items[0].tid, 'PdaD');
    assert.equal(items[0].dir, 'mv');
    assert.equal(items[0].url, 'https://www.hgeme.com/mv/PdaD');
    assert.equal(items[0].year, 2023);
    assert.equal(items[0].rating, 8.8);
    assert.equal(items[0].author, '克里斯托弗·诺兰');
    assert.ok(items[0].tags.includes('2023'));
    assert.ok(items[0].tags.includes('美国'));
  });
});
