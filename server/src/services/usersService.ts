/**
 * 用户管理：创建/删除/改密/列表。仅管理员可管理；密码哈希复用 authService。
 * 保护规则：不能删除自己、至少保留一个管理员；删除依赖 FK CASCADE 清理其追剧/想看。
 */

import bcrypt from 'bcryptjs';
import { getDb } from '../db/database';
import { ApiError } from '../middleware/errorHandler';
import { hashPassword } from './authService';
import type { UserPublic } from '../types/domain';

export interface AdminUserView {
  id: number;
  username: string;
  role: 'admin' | 'member';
  createdAt: string;
}

interface UserRow {
  id: number;
  username: string;
  role: 'admin' | 'member';
  created_at: string;
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;

function toView(row: UserRow): AdminUserView {
  return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
}

function requireRow(id: number): UserRow {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!row) throw new ApiError(1004, '用户不存在', 404);
  return row;
}

/** 用户列表（按 id 升序） */
export function listUsers(): AdminUserView[] {
  const rows = getDb()
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY id ASC')
    .all() as UserRow[];
  return rows.map(toView);
}

/** 创建用户（admin 操作）；重名抛 1101 */
export function createUser(input: {
  username: string;
  password: string;
  role?: 'admin' | 'member';
}): AdminUserView {
  const username = input.username.trim();
  const password = input.password;
  if (!USERNAME_RE.test(username)) {
    throw new ApiError(1001, '用户名须为 3-32 位字母、数字、下划线或连字符', 400);
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new ApiError(1001, '密码长度至少 6 位', 400);
  }
  const role = input.role === 'admin' ? 'admin' : input.role === 'member' ? 'member' : 'member';
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO users (username, password_hash, role, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
      )
      .run(username, hash, role);
    const created = getDb()
      .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
      .get(info.lastInsertRowid) as UserRow;
    return toView(created);
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
    ) {
      throw new ApiError(1101, '用户名已存在', 409);
    }
    throw err;
  }
}

/**
 * 修改密码。
 * - 管理员改他人：免 oldPassword；
 * - 本人改自己：必须提供正确 oldPassword（错误 1102）；
 * - 非管理员改他人：1003。
 */
export function changePassword(
  actor: UserPublic,
  targetId: number,
  input: { oldPassword?: string; newPassword: string },
): void {
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new ApiError(1001, '非法的用户 ID', 400);
  }
  const target = requireRow(targetId);
  const newPassword = input.newPassword;
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new ApiError(1001, '密码长度至少 6 位', 400);
  }

  const isSelf = actor.id === targetId;
  if (!isSelf && actor.role !== 'admin') {
    throw new ApiError(1003, '权限不足，仅管理员可修改他人密码', 403);
  }
  if (isSelf) {
    if (typeof input.oldPassword !== 'string' || input.oldPassword.length === 0) {
      throw new ApiError(1001, '修改本人密码必须提供原密码', 400);
    }
    const hash = getDb()
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(targetId) as { password_hash: string };
    const ok = bcrypt.compareSync(input.oldPassword, hash.password_hash);
    if (!ok) throw new ApiError(1102, '原密码错误', 400);
  }

  getDb()
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(newPassword), targetId);
}

/** 删除用户（admin）；不能删自己、至少保留一个管理员；FK CASCADE 清理其数据 */
export function deleteUser(actor: UserPublic, targetId: number): void {
  if (!Number.isInteger(targetId) || targetId <= 0) {
    throw new ApiError(1001, '非法的用户 ID', 400);
  }
  const target = requireRow(targetId);
  if (actor.id === targetId) {
    throw new ApiError(1103, '不能删除当前登录账号', 400);
  }
  if (target.role === 'admin') {
    const adminCount = (
      getDb().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }
    ).n;
    if (adminCount <= 1) {
      throw new ApiError(1104, '至少保留一个管理员账号', 400);
    }
  }
  getDb().prepare('DELETE FROM users WHERE id = ?').run(targetId);
}
