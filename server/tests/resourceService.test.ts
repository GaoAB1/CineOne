/**
 * resourceService 单元测试：URL 构建、1lou 搜索页解析、缓存与并发去重。
 * 网络请求以 globalThis.fetch mock 注入，不发真实请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  buildSearchUrl,
  clearResourceCache,
  decodeEntities,
  downloadTorrent,
  fetchThreadAttachments,
  parseSearchHtml,
  parseThreadAttachments,
  searchResources,
} from '../src/services/resourceService';

/** 取真实结构裁剪的 fixture：2 条有效 + 分页到第 3 页 */
const FIXTURE = `
<div class="card-body">
 <ul class="list-unstyled threadlist mb-0">
  <li class="media thread tap  " data-href="thread-1018487.htm" data-tid="1018487">
   <div class="media-body">
    <div class="subject break-all">
     <a href="thread-1018487.htm">撒哈拉[国语音轨/中英字幕].Sahara.2005.BluRay.1080p&amp;DTS 15.10GB</a>
     <a href="forum-3-1.htm?tagids=1015" class="badge badge-pill badge-light">2005</a>
     <a href="forum-3-1.htm?tagids=193" class="badge badge-pill badge-light">剧情</a>
    </div>
    <div class="d-flex justify-content-between small mt-1">
     <div>
      <span class="haya-post-info-username ">
       <span class="username text-grey mr-1 " uid="20912">RAY20920M</span>
       <span class="date text-grey">2026-07-19 02:39</span>
      </span>
     </div>
     <div class="text-muted small">
      <span class="ml-2 d-none"><i class="icon-eye"></i> 9,116</span>
      <span class="ml-2"><i class="icon-comment-o"></i> 3</span>
     </div>
    </div>
   </div>
  </li>
  <li class="media thread tap  " data-href="thread-1019001.htm" data-tid="1019001">
   <div class="media-body">
    <div class="subject break-all">
     <a href="thread-1019001.htm">奥本海默.Oppenheimer.2023.2160p.WEB-DL</a>
    </div>
    <div class="d-flex justify-content-between small mt-1">
     <div>
      <span class="haya-post-info-username ">
       <span class="username text-grey mr-1 " uid="1">admin</span>
       <span class="date text-grey">2026-08-01 10:00</span>
      </span>
     </div>
     <div class="text-muted small"></div>
    </div>
   </div>
  </li>
 </ul>
</div>
<a href="search-%E5%A5%A5%E6%9C%AC%E6%B5%B7%E9%BB%98-1-2.htm">2</a>
<a href="search-%E5%A5%A5%E6%9C%AC%E6%B5%B7%E9%BB%98-1-3.htm">3</a>
`;

const originalFetch = globalThis.fetch;
let fetchCount = 0;
let fetchHandler:
  | (() => {
      ok: boolean;
      status?: number;
      text?: () => Promise<string>;
      arrayBuffer?: () => Promise<ArrayBuffer>;
    })
  | null = null;

before(() => {
  globalThis.fetch = (async () => {
    fetchCount += 1;
    if (!fetchHandler) throw new Error('test fetch stub not configured');
    return fetchHandler() as unknown as Response;
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

describe('resourceService 工具', () => {
  it('buildSearchUrl：中文关键词编码，分页段仅 page>1 出现', () => {
    assert.equal(
      buildSearchUrl('奥本海默'),
      'https://1lou.cc/search-%E5%A5%A5%E6%9C%AC%E6%B5%B7%E9%BB%98.htm',
    );
    assert.equal(
      buildSearchUrl('奥本海默', 3),
      'https://1lou.cc/search-%E5%A5%A5%E6%9C%AC%E6%B5%B7%E9%BB%98-1-3.htm',
    );
  });

  it('decodeEntities：去标签并解码实体', () => {
    assert.equal(decodeEntities('<b>A&amp;B</b>&nbsp;2005'), 'A&B 2005');
    assert.equal(decodeEntities('&#34;引号&#34;'), '"引号"');
  });
});

describe('resourceService 解析', () => {
  it('解析条目字段（标题/标签/作者/日期/查看/评论）与总页数', () => {
    const { items, totalPages } = parseSearchHtml(FIXTURE);
    assert.equal(items.length, 2);
    assert.equal(totalPages, 3);

    const first = items[0];
    assert.equal(first.tid, '1018487');
    assert.equal(first.url, 'https://1lou.cc/thread-1018487.htm');
    assert.ok(first.title.includes('Sahara.2005'));
    assert.ok(first.title.includes('&DTS'), '实体应被解码');
    assert.deepEqual(first.tags, ['2005', '剧情']);
    assert.equal(first.author, 'RAY20920M');
    assert.equal(first.date, '2026-07-19 02:39');
    assert.equal(first.views, 9116);
    assert.equal(first.comments, 3);

    const second = items[1];
    assert.equal(second.tid, '1019001');
    assert.deepEqual(second.tags, []);
    assert.equal(second.views, null);
    assert.equal(second.comments, null);
  });

  it('无结果页返回空列表且不抛错', () => {
    const { items, totalPages } = parseSearchHtml('<html><body>无结果</body></html>');
    assert.deepEqual(items, []);
    assert.equal(totalPages, 1);
  });
});

describe('resourceService 搜索与缓存', () => {
  it('首次请求写入缓存，20 分钟内二次请求命中缓存且不再外呼', async () => {
    clearResourceCache();
    fetchCount = 0;
    fetchHandler = () => ({ ok: true, text: async () => FIXTURE });

    const first = await searchResources('奥本海默');
    assert.equal(first.items.length, 2);
    assert.equal(first.cached, false);
    assert.equal(fetchCount, 1);

    const second = await searchResources('奥本海默');
    assert.equal(second.cached, true);
    assert.equal(fetchCount, 1, '命中缓存不应再次请求源站');
  });

  it('并发同 key 请求只外呼一次（in-flight 去重）', async () => {
    clearResourceCache();
    fetchCount = 0;
    fetchHandler = () => ({
      ok: true,
      text: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return FIXTURE;
      },
    });

    const [a, b] = await Promise.all([searchResources('并行'), searchResources('并行')]);
    assert.equal(fetchCount, 1);
    assert.equal(a.items.length, b.items.length);
  });

  it('空关键词抛 400 业务错误；源站异常抛 2003', async () => {
    await assert.rejects(
      () => searchResources('   '),
      (err: { code?: number }) => err.code === 1001,
    );

    clearResourceCache();
    fetchHandler = () => ({ ok: false, status: 503, text: async () => '' });
    await assert.rejects(
      () => searchResources('任意'),
      (err: { code?: number }) => err.code === 2003,
    );
  });
});

/** 帖子页附件区块 fixture：1 个 .torrent + 1 个非种子附件 */
const THREAD_FIXTURE = `
<fieldset class="fieldset">
<legend>上传的附件：</legend>
<ul class="attachlist">
<li aid="2995163">
  <a href="attach-download-2995163.htm" target="_blank">
   <i class="icon filetype torrent"></i>
   撒哈拉[国语音轨+中英字幕].Sahara.2005.BluRay.1080p&amp;DTS 15.10GB[1lou.me].torrent
  </a>
</li>
<li aid="2995164">
  <a href="attach-download-2995164.htm" target="_blank">
   <i class="icon filetype image"></i>
   poster.jpg
  </a>
</li>
</ul>
</fieldset>
`;

describe('resourceService 帖子附件与种子', () => {
  it('parseThreadAttachments 仅提取 .torrent 附件并解码实体', () => {
    const items = parseThreadAttachments(THREAD_FIXTURE);
    assert.equal(items.length, 1, '非 .torrent 附件应被过滤');
    assert.equal(items[0].aid, '2995163');
    assert.equal(items[0].url, 'https://1lou.cc/attach-download-2995163.htm');
    assert.ok(items[0].filename.endsWith('.torrent'));
    assert.ok(items[0].filename.includes('&DTS'), '实体应被解码');
  });

  it('fetchThreadAttachments 结果走缓存（同 tid 只抓一次）', async () => {
    clearResourceCache();
    fetchCount = 0;
    fetchHandler = () => ({ ok: true, text: async () => THREAD_FIXTURE });

    const first = await fetchThreadAttachments('1018487');
    assert.equal(first.length, 1);
    assert.equal(fetchCount, 1);

    const second = await fetchThreadAttachments('1018487');
    assert.equal(second.length, 1);
    assert.equal(fetchCount, 1, '命中缓存不应再次抓取');
  });

  it('downloadTorrent 校验 bencode 头：非种子内容抛 2005', async () => {
    fetchHandler = () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode('<html>请先登录</html>').buffer as ArrayBuffer,
    });
    await assert.rejects(
      () =>
        downloadTorrent({
          aid: '1',
          filename: 'x.torrent',
          url: 'https://1lou.cc/attach-download-1.htm',
        }),
      (err: { code?: number; message?: string }) =>
        err.code === 2005 && String(err.message).includes('有效的种子文件'),
    );
  });

  it('downloadTorrent 正常返回种子字节与文件名', async () => {
    const payload = new TextEncoder().encode('d8:announce39:http://tracker.example/announce');
    fetchHandler = () => ({ ok: true, arrayBuffer: async () => payload.buffer as ArrayBuffer });
    const file = await downloadTorrent({
      aid: '2995163',
      filename: 'demo.torrent',
      url: 'https://1lou.cc/attach-download-2995163.htm',
    });
    assert.equal(file.filename, 'demo.torrent');
    assert.ok(file.data.length > 20);
  });
});
