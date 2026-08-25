/**
 * 统一错误处理：所有响应一律 {code, message, data} 包裹。
 */

import type { NextFunction, Request, Response } from 'express';

/** 业务错误：携带约定错误码与 HTTP 状态 */
export class ApiError extends Error {
  public readonly code: number;
  public readonly httpStatus: number;

  constructor(code: number, message: string, httpStatus = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** 成功响应助手 */
export function ok(res: Response, data: unknown, httpStatus = 200): Response {
  return res.status(httpStatus).json({ code: 0, message: 'ok', data });
}

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

/** 包装 async 路由处理器，将 rejection 交给 errorHandler */
export function asyncHandler(fn: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 404 兜底（未匹配任何路由） */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ code: 1004, message: '资源不存在', data: null });
}

/** 全局错误兜底中间件 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.httpStatus).json({ code: err.code, message: err.message, data: null });
    return;
  }
  // JSON body 解析失败
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ code: 1001, message: '请求体不是合法 JSON', data: null });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[error] unhandled:', err);
  res.status(500).json({ code: 3000, message: '服务器内部错误', data: null });
}
