# ============ 阶段 1：构建前端 ============
FROM node:20-alpine AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY client/ ./
# API 走同源 /api（生产由 Express 托管 SPA），无需代理
RUN npm run build

# ============ 阶段 2：编译后端 ============
FROM node:20-alpine AS server-build
WORKDIR /build/server
# better-sqlite3 在 musl 下可能需要源码编译
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY server/ ./
RUN npx tsc

# ============ 阶段 3：生产依赖（含原生模块） ============
FROM node:20-alpine AS prod-deps
WORKDIR /deps/server
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

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

VOLUME ["/app/data"]
EXPOSE 3000

WORKDIR /app/server
CMD ["node", "dist/index.js"]
