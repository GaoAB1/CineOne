#!/bin/sh
# 容器入口：以 root 修复数据卷属主后降权到 node 运行。
# 背景：旧版镜像以 root 创建的数据卷属主为 root，node 用户无写权限，
#       better-sqlite3 报 SQLITE_READONLY_DIRECTORY 崩溃循环。
# 兼容 named volume 与宿主机 bind mount 两种场景。

set -e

DATA_DIR="${DB_DATA_DIR:-/app/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su-exec node:node "$@"
fi

# 已以非 root 运行（如 k8s securityContext 强制指定），直接执行
exec "$@"
