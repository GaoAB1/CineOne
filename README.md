# CineOne · 影视聚合应用

个人/家庭自用的影视聚合应用：以 TMDB 为数据底座，主页四大分区（新上电影 / 新上剧集 / 热门 / 经典佳片），追剧进度管理（季/集二级追踪），详情页四源评分对比（TMDB / 豆瓣 / 烂番茄 / 爆米花）。UI 遵循 Apple HIG：毛玻璃材质、SF Pro 字体栈、深浅双主题（默认深色沉浸）。

## 技术栈

- **后端**：Node.js (Express@4) + better-sqlite3（WAL）+ JWT + bcryptjs
- **前端**：Vite + React 18 + TypeScript + Tailwind CSS + Remix Icon
- **部署**：Docker 单容器，SQLite 数据卷 `/app/data`

## 快速开始（Docker 一键运行）

```bash
docker run -d \
  --name cineone \
  -p 3000:3000 \
  -v cineone-data:/app/data \
  cineone:latest
```

本地构建镜像后运行：

```bash
docker compose up -d --build
# 或
docker build -t cineone:latest . && docker run -d -p 3000:3000 -v cineone-data:/app/data cineone:latest
```

打开 `http://localhost:3000`：

1. 首次访问自动进入**管理员初始化页**，设置账号密码；
2. 登录后前往**设置页**填入 TMDB API Key 即可开启首页与搜索。

### docker-compose

```yaml
services:
  cineone:
    build: .
    ports:
      - "3000:3000"
    environment:
      # 生产环境建议显式注入；缺省时自动生成并持久化到数据卷（见下文 JWT_SECRET）
      - JWT_SECRET=change-me-to-a-long-random-string
    volumes:
      - ./data:/app/data
```

## TMDB API Key 配置指引

1. 在 [themoviedb.org](https://www.themoviedb.org/) 免费注册账号；
2. 进入 **账户设置 → API → Create an API Key**，选择 Developer 类型；
3. 复制 **API Key (v3 auth)**（32 位十六进制字符串）；
4. 登录 CineOne → **设置 → TMDB 数据源** 粘贴保存。

Key 只存于服务端 SQLite（`settings` 表），前端永不接触明文；接口中始终以打码形式展示（如 `abc***xy`）。
未配置 Key 时应用可正常启动，首页显示配置引导；所有 TMDB 外部请求均带超时与错误降级。

## JWT_SECRET 说明

JWT 用于登录态签名，有效期 7 天。密钥来源按以下优先级：

| 方式 | 说明 |
|------|------|
| ① 环境变量 | `-e JWT_SECRET=xxx` 或 compose 中注入。**生产环境推荐** |
| ② 自动生成持久化 | 缺省时首次启动生成随机值并写入数据卷 `/app/data/.jwt_secret`，**重启不失效** |

> 若两者都未使用且未挂载数据卷，容器重建后旧 token 会全部失效（用户需重新登录，数据不受影响——密码哈希在数据库内）。

## 本地开发

```bash
npm install            # 根目录（concurrently）
npm run install:all    # 安装 server 与 client 依赖

npm run dev            # 并行启动 server(:3000) 与 client(:5173, /api 已代理)
```

单端调试：

```bash
npm run dev:server     # 仅后端，tsx watch 热重载
npm run dev:client     # 仅前端，Vite dev server
npm run typecheck      # 前后端类型检查
npm run build          # 后端 tsc 编译 + 前端 vite 构建
```

生产模式（Express 托管前端构建产物）：

```bash
npm run build && npm start   # http://localhost:3000
```

## 目录结构

```
CineOne/
├── package.json          # monorepo 脚本编排
├── Dockerfile            # 多阶段构建（node:20-alpine 运行）
├── docker-compose.yml
├── server/               # Express API + SQLite
│   └── src/{routes,services,middleware,db,types}
├── client/               # React SPA
│   └── src/{pages,components/{ui,media,layout},stores,hooks,api,styles}
└── docs/                 # PRD 与架构文档
```

## REST API 概览（17 个）

统一响应包裹 `{code, message, data}`；鉴权 `Authorization: Bearer <jwt>`。
完整清单见 `docs/ARCHITECTURE.md` §3.2。核心分组：

- **bootstrap/setup/auth**：初始化状态、管理员初始化、登录、登出、当前用户
- **settings**：系统设置读写（管理员，Key 打码）
- **tmdb**：status / home 分区聚合 / search / detail 代理（限流保护）
- **ratings**：四源评分聚合查询 + 管理员手动修正（manual_override 永不被回源覆盖）
- **watchlist**：追剧 CRUD + 进度推进（行按 user_id 隔离）
- **emby**：login（地址+用户名+密码 → AuthenticateByName，持久化 AccessToken）/ logout /
  views（媒体库分类）/ library（实时分页+分类+观看状态筛选+排序）/ history（观看记录）/
  playinfo（HLS master.m3u8，剧集自动取第一集）/ playing（播放进度上报）/
  status / sync（管理员）/ play 跳转链接
- **calendar / upcoming**：在看剧集播出日历、想看订阅 CRUD
- **moviepilot**：status / subscribed 查重 / subscribe 推送（subscribe_log 全量留痕）
- **users**：用户列表 / 创建 / 重置密码 / 删除（管理员；保留最后一个管理员保护）
- **tmdb/upcoming**：首页即将上映聚合（电影+电视 90 天内，单源失败自动降级）

错误码：`0` 成功；`1001` 参数校验失败；`1002` 认证失败；`1003` 权限不足；`1004` 不存在；
`1101` 用户名已存在(409)；`1102` 原密码错误；`1103` 不能删除当前账号；`1104` 至少保留一个管理员；
`2001` TMDB Key 未配置(428)；`2002` TMDB 请求失败(502)；`2003` 第三方评分源降级(HTTP 200 内标记)；`3000` 服务器内部错误；
`3001` Emby 未配置(428)；`3002` Emby 连接失败(502)；`3003` Emby 同步失败(502)；`3005` Emby 同步 HTTP 500 引导(502)；`3006` Emby 用户 ID 无法识别(502)。

## 外部服务集成（设置页配置，存 settings 表）

| 配置项 | 说明 |
|--------|------|
| TMDB API Key | 影视数据源（必配） |
| OMDB API Key | 烂番茄评分与外链（omdbapi.com 免费申请） |
| 豆瓣聚合地址 | 第三方豆瓣评分聚合服务（可选，填则可覆盖豆瓣/爆米花源） |
| Emby 服务器地址 / 用户名 / 密码 | 登录式接入（官方 AuthenticateByName）；「媒体库」页浏览 + 内置 HLS 播放器；兼容旧 API Key 配置 |
| MoviePilot 地址 / Token | 详情页一键订阅追更（Token 即 MoviePilot 设置页的 API_TOKEN，走 X-API-KEY 头） |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 监听端口 |
| `JWT_SECRET` | 自动生成持久化 | JWT 签名密钥 |
| `DB_PATH` | `<server>/data/cineone.db` | SQLite 文件路径 |
