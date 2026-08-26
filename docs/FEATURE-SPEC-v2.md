# CineOne 功能扩展规格 v2 —— Emby / MoviePilot / 日历与想看 / 评分修复

> 本文档是四大模块实施的唯一契约。所有外部调用走独立 service 层；UI 遵循 docs/UI-SPEC.md；
> 图标锁定 remixicon；颜色一律 Token 变量；单文件 ≤300 行。

## 全局约定

- 设置存储复用 `settings` 表（键白名单 = `db/seed.ts` 的 DEFAULT_SETTINGS）。
- 新增设置键（M1/M2/M4 共用）：`omdb_api_key`、`douban_api_base`、`emby_server_url`、`emby_api_key`、`emby_user_id`、`moviepilot_server_url`、`moviepilot_token`、`emby_last_sync`、`calendar_last_refresh`。
- 外部 HTTP 统一 `fetch` + `AbortSignal.timeout(6000)` + try/catch 降级，任何第三方故障不得中断主流程。
- 新表迁移追加到 `db/migrate.ts` DDL 数组（幂等 IF NOT EXISTS），不修改已有列。

## M4 评分修复（根因：ratingsProvider 为 mock 空实现）

后端（services/ratingsProvider.ts 重写，保持 RatingsProvider 接口不变）：
1. **OmdbProvider**：settings 读 `omdb_api_key`；先经 tmdbService 取 external_ids.imdb_id
   （新增 tmdbService 导出 `fetchExternalIds(tmdbId, mediaType)`，GET /3/{type}/{id}/external_ids）；
   调 `https://www.omdbapi.com/?i={imdb}&apikey={key}`：
   - Ratings[] 中 Source==="Rotten Tomatoes" → tomato：score=百分比值/10，rawText 原值如 "85%"，sourceUrl=tomatoURL 字段
   - popcorn：OMDb 无观众分 → 置 null（由聚合接口兜底）
   - imdb_id 缺失 / OMDb 报错 / 未配 key → 两源均 null，绝不抛错
2. **AggregatorProvider**（豆瓣+全源兜底）：settings 读 `douban_api_base`（社区聚合服务地址，
   形如 {base}/{mediaType}/{tmdbId} 返回 {douban:{score,raw_text,url},tomato:{…},popcorn:{…}}）；
   配置了才请求，解析容错同现有 parseSource。
3. 组合顺序：Aggregator（有配置时）→ Omdb 补缺（仅填仍为 null 的源）；两者都未配置 → 保持现"暂无"降级。
4. seed.ts 增加 `omdb_api_key: ''`、`douban_api_base: ''`；settingsService 状态响应补充两键 masked/set 字段。
5. .env.example 注释说明两键也可用环境变量注入的方式不需要——统一走 settings。

前端：
1. RatingBadge：`data.sourceUrl` 存在且 score!=null 时整颗胶囊渲染为 `<a href target="_blank" rel="noreferrer">`
   （外链图标 ri-external-link-line 11px 追加在尾部）；无链接维持现状。TMDB 胶囊不加链接。
2. DetailPage 评分区无需改动（sourceUrl 已随 payload 下发）。

## M1 Emby 接入

service/embyService.ts：
- 认证：全部请求 header `X-Emby-Token: {emby_api_key}`，基址 `{emby_server_url}/emby`。
- `verifyConnection()`：GET /System/Info → 200 即有效，返回 {serverId, serverName}。
- `fetchLibraries()`：GET /Users/{userId}/Items?IncludeItemTypes=Movie,Series&Recursive=true&
  Fields=ProviderIds,ProductionYear,Overview&ImageTypeLimit=1&EnableImages=true（分页 startIndex/limit 循环）。
- 条目映射（适配器 embyItemAdapter）：Emby ProviderIds.Tmdb ↔ 本地 tmdb_id 匹配；
  无 Tmdb 映射的条目跳过并计数。字段映射：Name→title、ProductionYear→year、
  PrimaryImageAspectRatio/ImagePath→poster（{url}/emby/Items/{Id}/Images/Primary?maxWidth=342）、Genres→genres、Overview→overview。
- 播放状态：UserData.Played→已看；0<PlayedPercentage<100→在看（position=百分比）；系列取 playedpercentage 聚合。
- 同步任务：POST /api/emby/sync（管理员）手动触发；全量拉取后按 tmdb_id UPSERT 进 emby_items 表；
  增量：settings 键 `emby_last_sync`，请求加 MinDateLastSavedForUser 参数。同步结果返回 {synced, skipped, matchedToWatchlist}。
- 播放记录回写 watchlist：匹配到的条目若已在 watchlist → 更新 current_season/current_episode/status（watching↔finished）；
  不在 → 不自动加入（避免污染），仅在响应中报告数量。

新表 emby_items：
```sql
CREATE TABLE IF NOT EXISTS emby_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,            -- Emby ItemId
  server_id TEXT,
  tmdb_id INTEGER,
  media_type TEXT CHECK (media_type IN ('movie','tv')),
  title TEXT NOT NULL,
  year INTEGER,
  poster_url TEXT,
  played_percentage REAL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id)
);
CREATE INDEX IF NOT EXISTS idx_emby_tmdb ON emby_items(tmdb_id, media_type);
```

路由 routes/emby.routes.ts（JWT 保护，sync 仅 admin）：
- GET /api/emby/status → {configured, verified, serverName, itemCount, lastSync}
- POST /api/emby/sync → 执行同步（同步过程串行即可，数据量可控）
- GET /api/emby/play/:tmdbId/:mediaType → 按 tmdb_id 查 emby_items 返回播放跳转 URL：
  `{emby_server_url}/web/index.html#!/item?id={item_id}&serverId={server_id}`（404 若未同步）

前端：
- 设置页新增「Emby 媒体库」分区：地址/API Key/用户 ID 三输入框 +「测试连接」按钮（调 status）
  +「立即同步」按钮（进度文案 + 结果反馈）。
- DetailPage：挂载时查 /api/emby/play/{tmdbId}/{mediaType}，200 则在操作区显示
  「在 Emby 中播放」按钮（ri-play-fill，accent filled），点击 window.open 链接。

## M3 追剧日历与想看

数据源：TMDB 已集成（tv 详情含 next_episode_to_air / seasons[].episodes[].air_date）。
- service/calendarService.ts：从 watchlist 取 status='watching' 的 tv → 复用 tmdbService 拉详情
  → 收集每部剧未来 60 天内的播出集 {tmdbId, title, season, episode, airDate, posterPath}
  → 内存缓存 + settings 键 `calendar_last_refresh` 记录刷新时间。
- 路由 GET /api/calendar → 上述列表（按 airDate 升序）。

路由/页面：
- GET /api/upcoming 与 watchlist 表分离的新表 upcoming：
```sql
CREATE TABLE IF NOT EXISTS upcoming (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('movie','tv')),
  title TEXT NOT NULL,
  poster_path TEXT,
  release_date TEXT,
  note TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, tmdb_id, media_type)
);
```
- POST /api/upcoming、GET /api/upcoming（本人列表）、DELETE /api/upcoming/:id。
- 首页「即将上映」模块：tmdbService 新增 fetchUpcoming（GET /3/movie/upcoming +
  /3/tv/on_the_air，合并取 release_date 未来 30~90 天，升序，限 10 条）→ 首页新 MediaRow
  「即将上映」置于分区最前。
- WatchlistPage 顶部新增「播出日历」入口卡（本周 N 集待播）→ 展开月视图列表（简化为时间线列表：
  日期分组 + 海报缩略图 + SxxExx + 剧名，点击跳详情）；手动刷新按钮。
- DetailPage：release_date 在未来 → 显示「想看」按钮（ri-bookmark-line）替代追剧按钮，点击 POST upcoming。

## M2 MoviePilot 订阅

service/moviepilotService.ts（MoviePilot v2 REST，token 认证）：
- 基址 `{moviepilot_server_url}/api/v1`，header `Authorization: Bearer {token}`。
- GET /subscribe/ 列表（检查重复订阅：按 tmdbid+type 匹配）。
- POST /subscribe/ body：{name, type: '电影'|'电视剧', tmdbid, season?(电视剧), year} → 201 成功。
- 容错：连接失败/401/参数错误分别返回结构化错误码，路由层转译为可读中文消息。

路由 routes/moviepilot.routes.ts：
- GET /api/moviepilot/status → {configured, reachable}
- GET /api/moviepilot/subscribed/:tmdbId/:mediaType → {subscribed: boolean}
- POST /api/moviepilot/subscribe body {tmdbId, mediaType, title, year, season?} → 推送订阅，
  写 subscribe_log 表（新表：id, user_id, tmdb_id, media_type, payload TEXT, ok INTEGER, message TEXT, created_at）。

前端：
- 设置页「MoviePilot」分区：地址 + Token 输入 + 测试连接。
- DetailPage：「订阅」按钮（ri-notification-3-line）——已订阅描边态「已订阅」；点击弹确认
  GlassPanel 对话框（电影直接确认；剧集选季 SegmentedControl，季列表来自详情 seasons）；
  成功 Toast「订阅成功，MoviePilot 将自动追更」。

## 实施顺序

M4 → M1 → M3 → M2，每模块端到端（后端自检 tsc + 测试 → 前端 tsc + build → 总监验收提交）。
