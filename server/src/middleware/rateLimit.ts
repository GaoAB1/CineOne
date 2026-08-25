/**
 * TMDB 代理简易限流（固定窗口计数，防滥用）。
 * 进程内实现即可满足单容器部署形态。
 */

import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './errorHandler';

interface RateLimitOptions {
  /** 时间窗口毫秒数 */
  windowMs: number;
  /** 窗口内最大请求数 */
  max: number;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

// 定期清理过期桶，避免内存缓慢增长
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = Date.now();

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max } = options;
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastSweepAt > SWEEP_INTERVAL_MS) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastSweepAt = now;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${ip}:${req.baseUrl || req.path}`;
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    existing.count += 1;
    if (existing.count > max) {
      next(new ApiError(1001, '请求过于频繁，请稍后再试', 429));
      return;
    }
    next();
  };
}
