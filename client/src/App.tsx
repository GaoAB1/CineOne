/**
 * 根组件：AuthProvider + 路由接线 + 守卫。
 * 分流规则：bootstrap 未初始化 → /setup；未登录访问受保护页 → /login。
 */

import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import AppShell from './components/layout/AppShell';
import Spinner from './components/ui/Spinner';
import { useAuth } from './stores/AuthContext';
import SetupPage from './pages/SetupPage';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import DetailPage from './pages/DetailPage';
import WatchlistPage from './pages/WatchlistPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';

/** 启动分流：ready 前显示启动画面 */
function BootstrapGate({ children }: { children: ReactNode }) {
  const { ready } = useAuth();
  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app">
        <i className="ri-film-fill text-[44px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        <Spinner label="CineOne 正在启动" />
      </div>
    );
  }
  return <>{children}</>;
}

/** 受保护路由：未登录 → /login */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** /setup 仅未初始化时可进；已初始化 → 首页或登录 */
function SetupRoute() {
  const { initialized, user } = useAuth();
  if (initialized) {
    return user ? <Navigate to="/" replace /> : <LoginPage />;
  }
  return <SetupPage />;
}

/** /login 仅已初始化时展示；已登录 → 首页 */
function LoginRoute() {
  const { initialized, user } = useAuth();
  if (!initialized) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupRoute />} />
      <Route path="/login" element={<LoginRoute />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<HomePage />} />
        <Route path="/detail/:type/:id" element={<DetailPage />} />
        <Route path="/watchlist" element={<WatchlistPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BootstrapGate>
      <Router>
        <AppRoutes />
      </Router>
    </BootstrapGate>
  );
}
