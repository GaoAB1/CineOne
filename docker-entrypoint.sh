#!/bin/sh
# 容器入口：以 root 修复数据卷属主后降权运行。
# 背景：旧版镜像以 root 创建的数据卷属主为 root，node 用户无写权限，
#       better-sqlite3 报 SQLITE_READONLY_DIRECTORY 崩溃循环。
# 兼容 named volume 与宿主机 bind mount 两种场景。
#
# PUID / PGID（可选）：以指定 uid/gid 运行进程（MoviePilot 同款方案）。
# 用于媒体目录挂载场景——容器内进程需对挂载的媒体目录有读写权限才能
# 执行重命名；将 PUID/PGID 设为 NAS 媒体目录属主（群晖用 `id <用户>` 查看，
# 常见 1026:100）即可。默认 1000:1000（node 用户）。

set -e

DATA_DIR="${DB_DATA_DIR:-/app/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR"
  exec su-exec "$PUID:$PGID" "$@"
fi

# 已以非 root 运行（如 k8s securityContext 强制指定），直接执行
exec "$@"
