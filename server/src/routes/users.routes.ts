/**
 * 用户管理路由：列表 / 创建 / 改密 / 删除。除改密外均为管理员操作。
 */

import { Router } from 'express';
import { ApiError, asyncHandler, ok } from '../middleware/errorHandler';
import { authRequired, requireAdmin, type AuthedRequest } from '../middleware/auth';
import {
  changePassword,
  createUser,
  deleteUser,
  listUsers,
} from '../services/usersService';

const router = Router();
router.use(authRequired);

function requireActor(req: AuthedRequest): NonNullable<AuthedRequest['user']> {
  if (!req.user) throw new ApiError(1002, '未登录', 401);
  return req.user;
}

function parseId(raw: string): number {
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(1001, '非法的用户 ID', 400);
  return id;
}

/** GET /api/users —— 管理员查看用户列表 */
router.get(
  '/',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    ok(res, { users: listUsers() });
  }),
);

/** POST /api/users —— 管理员创建用户 */
router.post(
  '/',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown; role?: unknown };
    const user = createUser({
      username: typeof body.username === 'string' ? body.username : '',
      password: typeof body.password === 'string' ? body.password : '',
      role: body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : undefined,
    });
    ok(res, { user }, 201);
  }),
);

/** PATCH /api/users/:id/password —— 本人改密（需原密码）/ 管理员重置他人 */
router.patch(
  '/:id/password',
  asyncHandler(async (req, res) => {
    const actor = requireActor(req as AuthedRequest);
    const body = (req.body ?? {}) as { oldPassword?: unknown; newPassword?: unknown };
    changePassword(actor, parseId(req.params.id), {
      oldPassword: typeof body.oldPassword === 'string' ? body.oldPassword : undefined,
      newPassword: typeof body.newPassword === 'string' ? body.newPassword : '',
    });
    ok(res, null);
  }),
);

/** DELETE /api/users/:id —— 管理员删除用户 */
router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    deleteUser(requireActor(req as AuthedRequest), parseId(req.params.id));
    ok(res, null);
  }),
);

export default router;
