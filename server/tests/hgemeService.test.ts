/**
 * hgemeService 单元测试：
 * PoW 求解、Cookie 解析、搜索内联解析（影片/种子/网盘三分支）、影片详情、
 * 资源映射（画质分组 / 网盘索引 / 失效标记 / 在线线路）、单条种子磁力、统一条目映射。
 * 全部为纯函数测试，不发真实网络请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { closeDb } from '../src/db/database';
import {
  mapDetailInline,
  mapDownurl,
  mapSearchInline,
  parseBtPage,
  parseCookieString,
  parseDetailInline,
  parseSearchInline,
  solvePow,
} from '../src/services/hgemeService';
import { mapHgemeItems } from '../src/services/resourceService';

after(() => {
  closeDb();
});

/** 影片维度搜索页（ty 0）：_obj.search.l 为影片候选 */
const TITLE_HTML = `<script>_obj.header={"u":{"n":"tester"}};_obj.search={"q":"%E5%A5%A5%E6%9C%AC%E6%B5%B7%E9%BB%98","ns":[19,17,2,0,51,234],"ty":0,"zy":[],"zy_cur":"","l":{"title":["奥本海默","诺曼"],"name":["Oppenheimer","Norman"],"year":[2023,2016],"d":["mv","mv"],"i":["PdaD","WeEK"],"info":["美国 / 英国 / 剧情 / 传记","以色列 / 美国 / 剧情"],"daoyan":["克里斯托弗·诺兰","约瑟夫·斯达"],"zhuyan":["基里安·墨菲 / 艾米莉·布朗特","理查·基尔 / 利奥尔·阿什肯纳齐"],"pf":{"db":{"s":[8.8,7.2]}}}};_obj.page={};</script>`;

/** 种子维度（ty 4）：l 为跨影片的种子条目 */
const TORRENT_HTML = `<script>_obj.search={"ns":[19,17,2,0,"51",234],"ty":4,"zy":{"1080P":2,"中字1080P":32,"4K":1},"zy_cur":"1080P","l":{"title":["奥本海默[国英多音轨+简繁英特效字幕].Oppenheimer.2023.V3.BluRay.1080p"],"size":["9.55G"],"seeds":[0],"k":[0],"time":["1月前"],"d":["bt"],"i":["vYGWX"]}};</script>`;

/** 网盘维度（ty 5）：l 为跨影片的网盘条目 */
const PAN_HTML = `<script>_obj.search={"ns":[19,17,2,0,51,"234"],"ty":5,"zy":{"百度网盘":51,"夸克网盘":98},"zy_cur":"","l":{"tname":["迅雷网盘"],"title":["🚨🚨【奥本海默 Oppenheimer (2023)】【1080P+4K】"],"url":["https://pan.xunlei.com/s/VOzqravj2GyaDjMhzQdkAXdNA1?pwd=dwgi"],"pw":["🔥🔥5579"],"time":["今天"],"user":["大头影视"],"gid":[2]}};</script>`;

/** 详情页（_obj.d） */
const DETAIL_HTML = `<script>_obj.header={};_obj.d={"title":"奥本海默","name":" Oppenheimer","year":2023,"dir":"mv","status":"最后更新于<em>28天前</em>","fa":1,"daoyan":["克里斯托弗·诺兰"],"zhuyan":["基里安·墨菲","艾米莉·布朗特"],"leixing":["剧情","传记","历史"],"diqu":["美国","英国"],"yuyan":["英语","德语"],"stime":"2023-08-30(中国大陆)","summary":"故事围绕着...","pf":{"db":{"s":8.8}},"id":"PdaD","dname":"电影"};_obj.cblist={};</script>`;

const DOWNURL_PAYLOAD = {
  code: 200,
  downlist: {
    type: {
      a: ['720P', '1080P', '中字1080P', '4K', '中字4K', '原盘'],
      b: ['i7', 'i3', 'i2', 'i5', 'i9', 'i6'],
    },
    list: {
      m: [
        '634D3482971995B49627BF261A45B2353FC08D21',
        '634d3482971995b49627bf261a45b2353fc08d21',
        '0a16510705a12d253d0be8a8a3cfe8575e3e8056',
        'not-a-valid-hash',
      ],
      t: ['UIndex - Oppenheimer 2023 1080p NF WEB-DL', '重复条目', 'Oppenheimer 2023 中字1080P', '非法'],
      s: ['4.15G', '4.15G', '9.55G', ''],
      p: ['i3', 'i3', 'i2', ''],
      n: ['1月前', '1月前', '2月前', ''],
      e: [16, 16, 0, 0],
    },
  },
  panlist: {
    id: ['Wnq6D', 'P2evg', 'L8lnA'],
    name: ['🚨 【奥本海默 (2023)】【1080P+4K】', '百度分享', '失效资源'],
    url: [
      'https://pan.xunlei.com/s/VOzqravj2GyaDjMhzQdkAXdNA1?pwd=dwgi',
      'https://pan.baidu.com/s/1zcDcJS4PZY19zYmGtVZGhQ?pwd=6666',
      'https://pan.quark.cn/s/xyz',
    ],
    tname: ['迅雷网盘', '百度网盘', '夸克网盘'],
    user: ['大头影视', '高老汉', '匿名'],
    time: ['今天', '今天', '3天前'],
    p: ['🔥🔥5579', '', ''],
    type: [0, 1, 2],
    gid: [2, 5, 6],
  },
  playlist: [
    { i: 'EwxDmX', t: '西瓜线路(1)', list: ['HD中字'] },
    { i: 'AYv5G', t: '暴风线路(3)', list: ['HD', 'HDTS', 'TC'] },
  ],
};

const BT_HTML = `<!DOCTYPE html><html><head><title>Loading...</title></head><body><script>_obj.d={"title":"奥本海默[国英多音轨].Oppenheimer.2023.V3","size":"9.55G"};</script><a href="magnet:?xt=urn:btih:0A16510705A12D253D0BE8A8A3CFE8575E3E8056">磁力</a></body></html>`;

describe('hgmeService 基础工具', () => {
  it('parseCookieString 解析浏览器复制的 Cookie 串（忽略空白与非法项）', () => {
    const jar = parseCookieString(
      ' browser_verified=abc123; PHPSESSID=xyz789 ; app_auth=tok-1; ; bad',
    );
    assert.deepEqual(jar, { browser_verified: 'abc123', PHPSESSID: 'xyz789', app_auth: 'tok-1' });
  });

  it('solvePow 计算 y = x^(2^t) mod N', async () => {
    const y = await solvePow('23', '2', 3); // 2^8 = 256 ≡ 11 (mod 35)
    assert.equal(BigInt('0x' + y), 11n);
  });

  it('solvePow 大 t 分片计算与一次性计算一致', async () => {
    const N = 'fffffffb';
    const x = '7';
    const t = 25_000;
    const n = BigInt('0x' + N);
    let expect = BigInt('0x' + x);
    for (let i = 0; i < t; i += 1) expect = (expect * expect) % n;
    assert.equal(BigInt('0x' + (await solvePow(N, x, t))), expect);
  });
});

describe('hgmeService 搜索解析（分类三分支）', () => {
  it('影片分类：映射片名/年份/类型段/评分/导演主演', () => {
    const inline = parseSearchInline(TITLE_HTML);
    assert.ok(inline);
    const items = mapSearchInline(inline as Record<string, unknown>);
    assert.equal(items.length, 2);
    assert.deepEqual(items[0], {
      kind: 'title',
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
  });

  it('种子分类：映射标题/体积/做种数与 /bt id', () => {
    const inline = parseSearchInline(TORRENT_HTML);
    assert.ok(inline);
    const items = mapSearchInline(inline as Record<string, unknown>);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      kind: 'torrent',
      id: 'vYGWX',
      title: '奥本海默[国英多音轨+简繁英特效字幕].Oppenheimer.2023.V3.BluRay.1080p',
      size: '9.55G',
      seeds: 0,
      time: '1月前',
    });
  });

  it('网盘分类：映射网盘名/直链/分享者/热度', () => {
    const inline = parseSearchInline(PAN_HTML);
    assert.ok(inline);
    const items = mapSearchInline(inline as Record<string, unknown>);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      kind: 'pan',
      title: '🚨🚨【奥本海默 Oppenheimer (2023)】【1080P+4K】',
      url: 'https://pan.xunlei.com/s/VOzqravj2GyaDjMhzQdkAXdNA1?pwd=dwgi',
      netdisk: '迅雷网盘',
      user: '大头影视',
      time: '今天',
      hot: '🔥🔥5579',
    });
  });

  it('无内联数据返回 null / 空数组', () => {
    assert.equal(parseSearchInline('<html>无结果</html>'), null);
    assert.deepEqual(mapSearchInline({}), []);
  });
});

describe('hgmeService 影片详情', () => {
  it('parseDetailInline + mapDetailInline 映射元数据', () => {
    const raw = parseDetailInline(DETAIL_HTML);
    assert.ok(raw);
    const detail = mapDetailInline(raw as Record<string, unknown>, 'mv', 'PdaD');
    assert.equal(detail.title, '奥本海默');
    assert.equal(detail.ename, 'Oppenheimer');
    assert.equal(detail.typename, '电影');
    assert.equal(detail.rating, 8.8);
    assert.deepEqual(detail.genres, ['剧情', '传记', '历史']);
    assert.deepEqual(detail.regions, ['美国', '英国']);
    assert.equal(detail.releaseDate, '2023-08-30(中国大陆)');
    assert.equal(detail.hasResources, true);
    assert.equal(detail.directors[0], '克里斯托弗·诺兰');
  });

  it('缺失 _obj.d 时返回 null', () => {
    assert.equal(parseDetailInline('<html></html>'), null);
  });
});

describe('hgmeService 资源映射（画质/网盘/线路）', () => {
  it('磁力：画质键映射中文标签、去重、非法过滤、分组统计', () => {
    const res = mapDownurl(DOWNURL_PAYLOAD);
    assert.equal(res.magnets.length, 2, '重复哈希与非法哈希应被过滤');
    assert.equal(res.magnets[0].qualityKey, 'i3');
    assert.equal(res.magnets[0].quality, '1080P');
    assert.equal(res.magnets[0].size, '4.15G');
    assert.equal(res.magnets[0].seeds, 16);
    assert.ok(res.magnets[0].magnet.startsWith('magnet:?xt=urn:btih:634d3482971995b49627bf261a45b2353fc08d21'));
    assert.equal(res.magnets[1].quality, '中字1080P');
    assert.deepEqual(res.magnetGroups.map((g) => `${g.label}:${g.count}`), ['1080P:1', '中字1080P:1']);
  });

  it('网盘：网盘名按索引字典映射、gid=6 标记失效、分组统计', () => {
    const res = mapDownurl(DOWNURL_PAYLOAD);
    assert.equal(res.pans.length, 3);
    assert.equal(res.pans[0].netdisk, '迅雷网盘');
    assert.equal(res.pans[1].netdisk, '百度网盘');
    assert.equal(res.pans[2].netdisk, '夸克网盘');
    assert.equal(res.pans[2].invalid, true);
    assert.equal(res.pans[0].invalid, false);
    assert.equal(res.pans[0].hot, '🔥🔥5579');
    assert.equal(res.panGroups.length, 3);
  });

  it('在线播放线路映射', () => {
    const res = mapDownurl(DOWNURL_PAYLOAD);
    assert.equal(res.playlists.length, 2);
    assert.equal(res.playlists[1].name, '暴风线路(3)');
    assert.deepEqual(res.playlists[1].episodes, ['HD', 'HDTS', 'TC']);
  });

  it('空资源返回空结构', () => {
    const res = mapDownurl({});
    assert.deepEqual(res, { magnets: [], magnetGroups: [], pans: [], panGroups: [], playlists: [] });
  });
});

describe('hgmeService 单条种子', () => {
  it('parseBtPage 提取磁力哈希（小写）与标题', () => {
    const item = parseBtPage(BT_HTML, 'vYGWX');
    assert.ok(item);
    assert.equal(item.id, 'vYGWX');
    assert.equal(item.magnet, 'magnet:?xt=urn:btih:0a16510705a12d253d0be8a8a3cfe8575e3e8056');
    assert.equal(item.size, '9.55G');
  });

  it('无磁力时返回 null', () => {
    assert.equal(parseBtPage('<html>无</html>', 'x'), null);
  });
});

describe('多源聚合条目映射（三分支）', () => {
  it('mapHgemeItems：影片候选', () => {
    const items = mapHgemeItems([
      {
        kind: 'title',
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
    assert.equal(items[0].kind, 'title');
    assert.equal(items[0].source, 'hgeme');
    assert.equal(items[0].url, 'https://www.hgeme.com/mv/PdaD');
    assert.equal(items[0].rating, 8.8);
    assert.ok(items[0].tags.includes('2023'));
  });

  it('mapHgemeItems：种子条目（带体积与做种数）', () => {
    const items = mapHgemeItems([
      { kind: 'torrent', id: 'vYGWX', title: '奥本海默 1080p', size: '9.55G', seeds: 12, time: '1月前' },
    ]);
    assert.equal(items[0].kind, 'torrent');
    assert.equal(items[0].tid, 'vYGWX');
    assert.equal(items[0].dir, 'bt');
    assert.equal(items[0].url, 'https://www.hgeme.com/bt/vYGWX');
    assert.equal(items[0].size, '9.55G');
    assert.equal(items[0].seeds, 12);
    assert.ok(items[0].tags.includes('9.55G'));
  });

  it('mapHgemeItems：网盘条目（直链与网盘名）', () => {
    const items = mapHgemeItems([
      {
        kind: 'pan',
        title: '奥本海默 4K+1080P',
        url: 'https://pan.xunlei.com/s/abc',
        netdisk: '迅雷网盘',
        user: '大头影视',
        time: '今天',
        hot: '🔥🔥5579',
      },
    ]);
    assert.equal(items[0].kind, 'pan');
    assert.equal(items[0].url, 'https://pan.xunlei.com/s/abc');
    assert.equal(items[0].netdisk, '迅雷网盘');
    assert.deepEqual(items[0].tags, ['迅雷网盘']);
    assert.equal(items[0].hot, '🔥🔥5579');
  });
});
