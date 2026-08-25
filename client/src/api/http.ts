/**
 * fetch 封装：JWT 注入、{code,data,message} 解包、401 自动登出。
 */

export class ApiClientError extends Error {
  public readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
  }
}

const TOKEN_KEY = 'cineone_token';
const UNAUTHORIZED_EVENT = 'cineone:unauthorized';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** 401 时广播事件（AuthContext 订阅后清状态并跳登录） */
function notifyUnauthorized(): void {
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}

export function onUnauthorized(handler: () => void): () => void {
  window.addEventListener(UNAUTHORIZED_EVENT, handler);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

/** 统一请求入口：path 以 / 开头（不含 /api 前缀），返回解包后的 data */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = options;

  let url = `/api${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiClientError(-1, '网络请求失败，请检查服务是否可达');
  }

  // 鉴权失效：清 token 并通知
  if (res.status === 401) {
    clearToken();
    notifyUnauthorized();
    throw new ApiClientError(1002, '登录状态已失效，请重新登录');
  }

  let envelope: Envelope<T>;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiClientError(-1, `响应解析失败（HTTP ${res.status}）`);
  }

  if (envelope.code !== 0) {
    throw new ApiClientError(envelope.code, envelope.message || `请求失败（${res.status}）`);
  }
  return envelope.data;
}
