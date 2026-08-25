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

# 数据目录对 node 用户可写（降权前以 root 完成 chown）
RUN mkdir -p /app/data && chown -R node:node /app

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/bootstrap || exit 1

# 降权运行（官方镜像内置 node 用户）
USER node
WORKDIR /app/server
CMD ["node", "dist/index.js"]
