/**
 * Express 实例：中间件链 + 路由挂载 + 生产环境静态托管 client/dist。
 */

import express, { type Express } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

import bootstrapRoutes from './routes/bootstrap.routes';
import setupRoutes from './routes/setup.routes';
import authRoutes from './routes/auth.routes';
import settingsRoutes from './routes/settings.routes';
import tmdbRoutes from './routes/tmdb.routes';
import ratingsRoutes from './routes/ratings.routes';
import watchlistRoutes from './routes/watchlist.routes';
import embyRoutes from './routes/emby.routes';
import calendarRoutes from './routes/calendar.routes';
import upcomingRoutes from './routes/upcoming.routes';
import moviepilotRoutes from './routes/moviepilot.routes';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  // ---- API 路由 ----
  app.use('/api/bootstrap', bootstrapRoutes);
  app.use('/api/setup', setupRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/tmdb', tmdbRoutes);
  app.use('/api/ratings', ratingsRoutes);
  app.use('/api/watchlist', watchlistRoutes);
  app.use('/api/emby', embyRoutes);
  app.use('/api/calendar', calendarRoutes);
  app.use('/api/upcoming', upcomingRoutes);
  app.use('/api/moviepilot', moviepilotRoutes);

  // ---- 生产静态托管：server/dist → ../../client/dist ----
  const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    // SPA fallback：非 /api 的 GET 一律回 index.html
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // API 未匹配 → 404 包裹格式
  app.use('/api', notFoundHandler);

  app.use(errorHandler);
  return app;
}

/** 导出配置读取（供 index.ts 使用，避免重复解析） */
export { getConfig };
