/**
 * 已登录布局壳：桌面左侧悬浮 Icon Dock / 移动底部 Dock + 内容区。
 * 无顶栏 —— 沉浸式画布直通内容顶部；用户入口在 Dock 头像。
 */

import { Outlet } from 'react-router-dom';
import SideDock from './SideDock';
import TabBar from './TabBar';

export default function AppShell() {
  return (
    <div className="flex min-h-screen flex-col lg:pl-[104px]">
      <SideDock />
      <main
        className="mx-auto w-full max-w-[1200px] flex-1 pt-2 pb-36 lg:pt-4"
        style={{ paddingLeft: 'var(--margin-page)', paddingRight: 'var(--margin-page)' }}
      >
        <Outlet />
      </main>

      <TabBar />
    </div>
  );
}
