/**
 * JWT 校验中间件 + requireAdmin。
 */

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { ApiError } from './errorHandler';
import type { UserPublic } from '../types/domain';

/** JWT payload 形状 */
export interface TokenPayload {
  sub: number;
  role: 'admin' | 'member';
}

/** 挂载了已认证用户的 Request */
export interface AuthedRequest extends Request {
  user?: UserPublic;
}

function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, getConfig().jwtSecret);
    if (typeof decoded === 'string' || decoded.sub == null) {
      throw new Error('bad payload');
    }
    const role = decoded.role === 'member' ? 'member' : 'admin';
    return { sub: Number(decoded.sub), role };
  } catch {
    throw new ApiError(1002, '登录状态无效或已过期', 401);
  }
}

/** 登录必需 */
export function authRequired(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(new ApiError(1002, '未登录或缺少 Authorization 头', 401));
    return;
  }
  try {
    const payload = verifyToken(header.slice('Bearer '.length).trim());
    // MVP 单管理员：sub=1 即管理员；预留多用户角色
    (req as AuthedRequest).user = { id: payload.sub, username: '', role: payload.role };
    next();
  } catch (err) {
    next(err);
  }
}

/** 管理员必需（须在 authRequired 之后使用） */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user) {
    next(new ApiError(1002, '未登录', 401));
    return;
  }
  if (user.role !== 'admin') {
    next(new ApiError(1003, '权限不足，需要管理员身份', 403));
    return;
  }
  next();
}
