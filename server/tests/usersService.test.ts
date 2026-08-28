/**
 * usersService 单元测试：创建校验/重名、改密（本人需原密码/管理员重置/越权）、
 * 删除保护（不能删自己/保留最后一个管理员/FK CASCADE）、列表。不发真实网络请求。
 */

import './helpers/testenv';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';

import { closeDb, getDb } from '../src/db/database';
import { runMigrate } from '../src/db/migrate';
import { ApiError } from '../src/middleware/errorHandler';
import { hashPassword } from '../src/services/authService';
import {
  changePassword,
  createUser,
  deleteUser,
  listUsers,
} from '../src/services/usersService';
import type { UserPublic } from '../src/types/domain';

const ADMIN: UserPublic = { id: 1, username: 'admin', role: 'admin' };
const MEMBER: UserPublic = { id: 2, username: 'member', role: 'member' };

function assertApiError(fn: () => unknown, code: number, httpStatus: number): void {
  try {
    fn();
    assert.fail(`期望抛出 ApiError(code=${code})，但未抛出任何异常`);
  } catch (err) {
    assert.ok(err instanceof ApiError, `期望 ApiError，实际得到：${String(err)}`);
    assert.equal((err as ApiError).code, code);
    assert.equal((err as ApiError).httpStatus, httpStatus);
  }
}

function passwordMatches(userId: number, plain: string): boolean {
  const row = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as {
    password_hash: string;
  };
  return bcrypt.compareSync(plain, row.password_hash);
}

describe('usersService · 用户管理', () => {
  before(() => {
    runMigrate();
    const insert = getDb().prepare(
      `INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`,
    );
    insert.run(1, 'admin', hashPassword('admin123'), 'admin');
    insert.run(2, 'member', hashPassword('member123'), 'member');
  });
  after(() => closeDb());

  it('列表：返回脱敏用户视图（不含密码哈希）', () => {
    const users = listUsers();
    assert.equal(users.length, 2);
    assert.equal(users[0].username, 'admin');
    assert.equal(users[0].role, 'admin');
    assert.ok(typeof users[0].createdAt === 'string');
    assert.ok(!('password_hash' in users[0]), '不得泄露 password_hash');
  });

  it('创建：非法用户名/短密码 → 1001；重名 → 1101/409；成功返回视图', () => {
    assertApiError(() => createUser({ username: 'ab', password: '123456' }), 1001, 400);
    assertApiError(() => createUser({ username: 'ok_user', password: '12345' }), 1001, 400);
    assertApiError(() => createUser({ username: 'admin', password: '123456' }), 1101, 409);
    const created = createUser({ username: 'newbie', password: 'secret6', role: 'member' });
    assert.equal(created.role, 'member');
    assert.equal(listUsers().some((u) => u.id === created.id), true);
  });

  it('改密：本人改自己原密码错误 → 1102；正确 → 生效', () => {
    assertApiError(
      () => changePassword(MEMBER, 2, { oldPassword: 'wrong', newPassword: 'newpass6' }),
      1102,
      400,
    );
    changePassword(MEMBER, 2, { oldPassword: 'member123', newPassword: 'newpass6' });
    assert.equal(passwordMatches(2, 'newpass6'), true);
  });

  it('改密：非管理员改他人 → 1003；管理员重置他人免原密码', () => {
    assertApiError(() => changePassword(MEMBER, 1, { newPassword: 'hack1234' }), 1003, 403);
    changePassword(ADMIN, 2, { newPassword: 'reset123' });
    assert.equal(passwordMatches(2, 'reset123'), true);
  });

  it('删除：不能删自己 → 1103；仅剩一个管理员时拦截 → 1104；不存在 → 1004', () => {
    assertApiError(() => deleteUser(ADMIN, 1), 1103, 400);
    // 此刻系统只有 id=1 一个管理员：任何删除该管理员的尝试都会被最后管理员保护拦截
    assertApiError(() => deleteUser(MEMBER, 1), 1104, 400);
    assertApiError(() => deleteUser(ADMIN, 999), 1004, 404);
  });

  it('删除：可删除普通成员，且 FK CASCADE 清理其追剧数据', () => {
    getDb()
      .prepare(
        `INSERT INTO watchlist (user_id, tmdb_id, media_type, title, status, added_at)
         VALUES (2, 100, 'movie', 'x', 'planned', datetime('now'))`,
      )
      .run();
    deleteUser(ADMIN, 2);
    const remains = getDb()
      .prepare('SELECT COUNT(*) AS n FROM watchlist WHERE user_id = 2')
      .get() as { n: number };
    assert.equal(remains.n, 0);
    assert.equal(listUsers().some((u) => u.id === 2), false);
  });
});
