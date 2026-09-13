/**
 * app 路由挂载回归测试：/api/pan115/* 必须被 pan115 路由接住。
 *
 * 背景：pan115Routes 在 app.ts 中已 import 但漏了 app.use 挂载，导致所有
 * /api/pan115/* 请求落到 404 兜底（code 1004「资源不存在」），设置页
 * 「测试连接」一直报「资源不存在 / 登录态无效」。本测试防止再次发生。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app';
import { runMigrate } from '../src/db/migrate';
import { runSeed } from '../src/db/seed';
import { signToken } from '../src/services/authService';

let server: Server;
let baseUrl = '';

before(async () => {
  runMigrate();
  runSeed();
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

describe('app 路由挂载：/api/pan115', () => {
  it('未登录访问 /status 返回 401（而非 404 资源不存在）', async () => {
    const res = await fetch(`${baseUrl}/api/pan115/status`);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { code: number };
    assert.equal(body.code, 1002);
  });

  it('带登录态访问 /status 返回 200 且为业务响应（未配置 Cookie）', async () => {
    const token = signToken({ id: 1, username: 'admin', role: 'admin' });
    const res = await fetch(`${baseUrl}/api/pan115/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      code: number;
      data: { configured: boolean; loggedIn: boolean };
    };
    assert.equal(body.code, 0);
    assert.equal(body.data.configured, false);
    assert.equal(body.data.loggedIn, false);
  });

  it('带登录态访问 /paths 返回 200（路由组其余端点同样可达）', async () => {
    const token = signToken({ id: 1, username: 'admin', role: 'admin' });
    const res = await fetch(`${baseUrl}/api/pan115/paths`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
  });
});
