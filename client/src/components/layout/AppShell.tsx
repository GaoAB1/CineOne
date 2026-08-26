/**
 * 已登录布局壳：毛玻璃顶栏 + 底部居中悬浮 Dock 导航（全断点）+ 内容区。
 */

import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import TabBar from './TabBar';
import TopBar from './TopBar';
import { useAuth } from '../../stores/AuthContext';

const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, '首页'],
  [/^\/watchlist/, '我的追剧'],
  [/^\/search/, '搜索'],
  [/^\/settings/, '设置'],
  [/^\/detail\/movie\//, '电影详情'],
  [/^\/detail\/tv\//, '剧集详情'],
];

function resolveTitle(pathname: string): string {
  for (const [re, title] of TITLES) {
    if (re.test(pathname)) return title;
  }
  return 'CineOne';
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex min-h-screen flex-col bg-app">
      <TopBar
        title={resolveTitle(location.pathname)}
        username={user?.username ?? ''}
        onLogout={handleLogout}
      />
      <main
        className="mx-auto w-full max-w-[1200px] flex-1 pt-4 pb-36"
        style={{ paddingLeft: 'var(--margin-page)', paddingRight: 'var(--margin-page)' }}
      >
        <Outlet />
      </main>

      <TabBar />
    </div>
  );
}
