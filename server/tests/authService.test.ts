/**
 * authService 单元测试：密码哈希/校验、JWT 签发与校验、authRequired 中间件 401 行为。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import type { NextFunction } from 'express';

import { getConfig } from '../src/config';
import { ApiError } from '../src/middleware/errorHandler';
import { authRequired, type AuthedRequest } from '../src/middleware/auth';
import {
  hashPassword,
  signToken,
  verifyPassword,
} from '../src/services/authService';

/** 断言 fn 抛出指定 code / httpStatus 的 ApiError */
function assertApiError(fn: () => unknown, code: number, httpStatus: number): ApiError {
  try {
    fn();
    assert.fail(`期望抛出 ApiError(code=${code})，但未抛出任何异常`);
  } catch (err) {
    assert.ok(err instanceof ApiError, `期望 ApiError，实际得到：${String(err)}`);
    assert.equal((err as ApiError).code, code);
    assert.equal((err as ApiError).httpStatus, httpStatus);
    return err as ApiError;
  }
}

describe('authService · 密码哈希', () => {
  it('生成 bcrypt 哈希，成本因子为 10', () => {
    const hash = hashPassword('S3cret!pass');
    assert.match(hash, /^\$2[aby]\$10\$/);
    assert.notEqual(hash, 'S3cret!pass');
    assert.ok(hash.length >= 60);
  });

  it('同一密码两次哈希结果不同（随机盐）', () => {
    assert.notEqual(hashPassword('same-password'), hashPassword('same-password'));
  });
});

describe('authService · 密码校验', () => {
  const hash = hashPassword('correct-horse');

  it('正确密码校验通过（不抛异常）', () => {
    assert.doesNotThrow(() => verifyPassword('correct-horse', hash));
  });

  it('错误密码拒绝：code=1002、HTTP 401', () => {
    assertApiError(() => verifyPassword('wrong-password', hash), 1002, 401);
  });

  it('空密码拒绝：code=1002、HTTP 401', () => {
    assertApiError(() => verifyPassword('', hash), 1002, 401);
  });
});

describe('authService · JWT 签发与校验', () => {
  it('签发的 token 可被服务端密钥验证，payload 携带 sub/role', () => {
    const token = signToken({ id: 7, username: 'admin', role: 'admin' });
    const decoded = jwt.verify(token, getConfig().jwtSecret) as jwt.JwtPayload;
    assert.equal(decoded.sub, 7);
    assert.equal(decoded.role, 'admin');
  });

  it('有效期为 7 天', () => {
    const token = signToken({ id: 1, username: 'admin', role: 'member' });
    const decoded = jwt.verify(token, getConfig().jwtSecret) as jwt.JwtPayload;
    const spanSeconds = Number(decoded.exp) - Number(decoded.iat);
    // 容忍签发耗时数秒
    assert.ok(
      Math.abs(spanSeconds - 7 * 24 * 3600) < 30,
      `exp-iat 应约等于 604800 秒，实际 ${spanSeconds}`,
    );
  });

  it('用错误密钥验证失败', () => {
    const token = signToken({ id: 1, username: 'admin', role: 'admin' });
    assert.throws(() => jwt.verify(token, 'definitely-not-the-secret'));
  });
});

describe('middleware · authRequired', () => {
  function runMiddleware(header?: string): { user?: unknown; err?: unknown } {
    const req = {
      headers: header === undefined ? {} : { authorization: header },
    } as AuthedRequest;
    let captured: { user?: unknown; err?: unknown } = {};
    const next: NextFunction = (err?) => {
      if (err) captured.err = err;
      else captured.user = req.user;
    };
    authRequired(req, {} as never, next);
    return captured;
  }

  it('有效 token → req.user 被挂载，放行', () => {
    const token = signToken({ id: 3, username: 'u', role: 'admin' });
    const { user, err } = runMiddleware(`Bearer ${token}`);
    assert.equal(err, undefined);
    assert.deepEqual(user, { id: 3, username: '', role: 'admin' });
  });

  it('缺少 Authorization 头 → 1002 / 401', () => {
    const { err } = runMiddleware();
    assert.ok(err instanceof ApiError);
    assert.equal((err as ApiError).code, 1002);
    assert.equal((err as ApiError).httpStatus, 401);
  });

  it('非 Bearer 前缀 → 1002 / 401', () => {
    const token = signToken({ id: 3, username: 'u', role: 'admin' });
    const { err } = runMiddleware(`Basic ${token}`);
    assert.ok(err instanceof ApiError && (err as ApiError).httpStatus === 401);
  });

  it('已过期 token → 1002 / 401', () => {
    const expired = jwt.sign(
      { sub: 3, role: 'admin' },
      getConfig().jwtSecret,
      { expiresIn: '-60s' },
    );
    const { err } = runMiddleware(`Bearer ${expired}`);
    assert.ok(err instanceof ApiError);
    assert.equal((err as ApiError).code, 1002);
    assert.equal((err as ApiError).httpStatus, 401);
  });

  it('被篡改的 token → 1002 / 401', () => {
    const token = signToken({ id: 3, username: 'u', role: 'admin' });
    const tampered = `${token.slice(0, -3)}abc`;
    const { err } = runMiddleware(`Bearer ${tampered}`);
    assert.ok(err instanceof ApiError && (err as ApiError).httpStatus === 401);
  });

  it('缺少 sub 的非法 payload → 1002 / 401', () => {
    const bad = jwt.sign({ role: 'admin' }, getConfig().jwtSecret, { expiresIn: '1h' });
    const { err } = runMiddleware(`Bearer ${bad}`);
    assert.ok(err instanceof ApiError && (err as ApiError).httpStatus === 401);
  });

  // ---- role 白名单（fail-closed）加固用例 ----

  it('非法 role（superadmin）→ 白名单拒绝：1002 / 401', () => {
    const forged = jwt.sign(
      { sub: 3, role: 'superadmin' },
      getConfig().jwtSecret,
      { expiresIn: '1h' },
    );
    const { err } = runMiddleware(`Bearer ${forged}`);
    assert.ok(err instanceof ApiError);
    assert.equal((err as ApiError).code, 1002);
    assert.equal((err as ApiError).httpStatus, 401);
  });

  it('缺失 role 字段 → 白名单拒绝：1002 / 401', () => {
    const noRole = jwt.sign({ sub: 3 }, getConfig().jwtSecret, { expiresIn: '1h' });
    const { err } = runMiddleware(`Bearer ${noRole}`);
    assert.ok(err instanceof ApiError && (err as ApiError).code === 1002);
  });

  it('白名单内的 member 角色 → 正常放行且 role 保持 member', () => {
    const token = signToken({ id: 5, username: 'm', role: 'member' });
    const { user, err } = runMiddleware(`Bearer ${token}`);
    assert.equal(err, undefined);
    assert.deepEqual(user, { id: 5, username: '', role: 'member' });
  });
});
