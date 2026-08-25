/**
 * POST /api/setup —— 创建首个管理员并签发 JWT（仅未初始化时可调用）。
 */

import { Router } from 'express';
import { getDb } from '../db/database';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { hashPassword, signToken } from '../services/authService';

const router = Router();

interface SetupBody {
  username?: unknown;
  password?: unknown;
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as SetupBody;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]{2,32}$/.test(username)) {
      throw new ApiError(1001, '用户名须为 2-32 位字母、数字、下划线或中文', 400);
    }
    if (password.length < 6 || password.length > 72) {
      throw new ApiError(1001, '密码长度须为 6-72 位', 400);
    }

    const db = getDb();
    const adminCount = (
      db.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'").get() as { cnt: number }
    ).cnt;
    if (adminCount > 0) {
      throw new ApiError(1003, '系统已完成初始化，禁止重复设置', 403);
    }
    const nameTaken = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (nameTaken) {
      throw new ApiError(1001, '用户名已存在', 409);
    }

    const info = db
      .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
      .run(username, hashPassword(password));
    const user = {
      id: Number(info.lastInsertRowid),
      username,
      role: 'admin' as const,
    };
    ok(res, { token: signToken(user), user }, 201);
  }),
);

export default router;
