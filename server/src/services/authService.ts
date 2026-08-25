/**
 * 鉴权服务：密码哈希校验、JWT 签发。
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getConfig } from '../config';
import { ApiError } from '../middleware/errorHandler';
import type { UserPublic } from '../types/domain';

const SALT_ROUNDS = 10;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

/** 校验密码；失败抛 1002 */
export function verifyPassword(plain: string, hash: string): void {
  const passed = bcrypt.compareSync(plain, hash);
  if (!passed) {
    throw new ApiError(1002, '用户名或密码错误', 401);
  }
}

/** 为用户签发 7 天 JWT */
export function signToken(user: UserPublic): string {
  return jwt.sign({ sub: user.id, role: user.role }, getConfig().jwtSecret, {
    expiresIn: '7d',
  });
}
