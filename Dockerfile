# ============ 阶段 1：构建前端 ============
FROM node:20-alpine AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY client/ ./
# API 走同源 /api（生产由 Express 托管 SPA），无需代理
RUN npm run build

# ============ 阶段 2：编译后端 ============
FROM node:20-alpine AS server-build
WORKDIR /build/server
# better-sqlite3 在 musl 下可能需要源码编译
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY server/ ./
RUN npx tsc

# ============ 阶段 3：生产依赖（含原生模块） ============
FROM node:20-alpine AS prod-deps
WORKDIR /deps/server
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json* ./
RUN (npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund)

# ============ 阶段 4：运行时 ============
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/cineone.db

# 仅复制运行所需产物
COPY --from=prod-deps /deps/server/node_modules ./server/node_modules
COPY --from=server-build /build/server/dist ./server/dist
COPY server/package.json ./server/package.json
COPY --from=client-build /build/client/dist ./client/dist

# su-exec：入口脚本以 root 修复数据卷属主后降权到 node（兼容旧 root 卷/bind mount）
RUN apk add --no-cache su-exec \
    && mkdir -p /app/data \
    && chown -R node:node /app/data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/bootstrap || exit 1

# 入口脚本内部完成降权（root 修属主 → su-exec node），进程仍以 node 运行
ENTRYPOINT ["docker-entrypoint.sh"]
WORKDIR /app/server
CMD ["node", "dist/index.js"]
