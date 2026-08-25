/**
 * 登录态 / bootstrap 状态 + login/logout/setup 动作。
 * 启动流程：fetchBootstrap → 未初始化引导 /setup；有 token 则 fetchMe 恢复会话。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  apiLogin as apiLoginRequest,
  apiLogout,
  apiSetup as apiSetupRequest,
  fetchBootstrap,
  fetchMe,
} from '../api/endpoints';
import { clearToken, getToken, onUnauthorized, setToken } from '../api/http';
import type { UserPublic } from '../api/types';

interface AuthState {
  /** 首次 bootstrap + 会话恢复是否完成 */
  ready: boolean;
  /** 系统是否已有管理员 */
  initialized: boolean;
  user: UserPublic | null;
}

export interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshInitialized: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ready: false,
    initialized: true,
    user: null,
  });

  // 启动：bootstrap + token 恢复
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let initialized = true;
      try {
        const boot = await fetchBootstrap();
        initialized = boot.initialized;
      } catch {
        initialized = true; // 后端不可达时按"已初始化"处理，避免误入 /setup 死循环
      }
      if (cancelled) return;

      let user: UserPublic | null = null;
      const token = getToken();
      if (token && initialized) {
        try {
          user = await fetchMe();
        } catch {
          clearToken();
        }
      }
      if (cancelled) return;
      setState({ ready: true, initialized, user });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 任何 API 返回 401 时清空登录态（http.ts 广播事件）
  useEffect(() => {
    const off = onUnauthorized(() => {
      setState((prev) => ({ ...prev, user: null }));
    });
    return off;
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await apiLoginRequest(username, password);
    setToken(data.token);
    setState((prev) => ({ ...prev, initialized: true, user: data.user }));
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const data = await apiSetupRequest(username, password);
    setToken(data.token);
    setState((prev) => ({ ...prev, initialized: true, user: data.user }));
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // 无状态 JWT：即使后端报错也照常清理本地
    }
    clearToken();
    setState((prev) => ({ ...prev, user: null }));
  }, []);

  const refreshInitialized = useCallback(async () => {
    try {
      const boot = await fetchBootstrap();
      setState((prev) => ({ ...prev, initialized: boot.initialized }));
    } catch {
      // 忽略网络错误，保持现状
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, setup, logout, refreshInitialized }),
    [state, login, setup, logout, refreshInitialized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
