/**
 * 登录 / 登出 / 当前用户。
 */

import { Router } from 'express';
import { getDb } from '../db/database';
import {
  ApiError,
  asyncHandler,
  ok,
} from '../middleware/errorHandler';
import { authRequired, type AuthedRequest } from '../middleware/auth';
import { signToken, verifyPassword } from '../services/authService';

const router = Router();

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

/** POST /api/auth/login（公开） */
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as LoginBody;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) {
      throw new ApiError(1001, '用户名与密码不能为空', 400);
    }
    const row = getDb()
      .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
      .get(username) as
      | { id: number; username: string; password_hash: string; role: 'admin' | 'member' }
      | undefined;
    if (!row) {
      throw new ApiError(1002, '用户名或密码错误', 401);
    }
    verifyPassword(password, row.password_hash);
    const user = { id: row.id, username: row.username, role: row.role };
    ok(res, { token: signToken(user), user });
  }),
);

/** POST /api/auth/logout（公开：无状态 JWT，前端清 token 即可，此处仅作协议应答） */
router.post('/logout', authRequired, (req, res) => {
  void req;
  ok(res, null);
});

/** GET /api/auth/me（登录） */
router.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthedRequest).user?.id;
    const row = getDb()
      .prepare('SELECT id, username, role FROM users WHERE id = ?')
      .get(userId) as { id: number; username: string; role: 'admin' | 'member' } | undefined;
    if (!row) {
      throw new ApiError(1004, '用户不存在', 404);
    }
    ok(res, row);
  }),
);

export default router;
