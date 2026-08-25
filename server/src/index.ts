/**
 * 入口：加载配置 → 初始化 DB（迁移+种子）→ 注册路由 → 监听端口。
 */

import { createApp, getConfig } from './app';
import { runMigrate } from './db/migrate';
import { runSeed } from './db/seed';
import { closeDb } from './db/database';

function main(): void {
  const config = getConfig();
  runMigrate();
  runSeed();

  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[cineone] server listening on http://localhost:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`[cineone] db: ${config.dbPath}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    // 兜底强制退出
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
