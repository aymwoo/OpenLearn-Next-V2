#!/bin/sh
# 容器入口：准备数据目录，确认 node 用户可写，再降权启动。
# 失败时把原因打到 stderr 并立刻退出，方便 docker logs / 重启策略排障。
set -eu

DATA_DIR="${OPENLEARN_DATA_DIR:-/data}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

echo "[Startup] data=${DATA_DIR} db=${OPENLEARN_DB_PATH:-<default>} backup=${BACKUP_DIR} trust_proxy=${TRUST_PROXY:-<unset, direct>}"

if ! mkdir -p "$DATA_DIR/storage" "$DATA_DIR/plugins" "$DATA_DIR/uploads" "$DATA_DIR/logs" "$BACKUP_DIR"; then
  echo "[Startup] FATAL: 无法创建数据目录 ${DATA_DIR} 或备份目录 ${BACKUP_DIR}。卷可能不存在或为只读。" >&2
  exit 1
fi

probe_writable() {
  dir="$1"
  probe="${dir}/.write-probe"
  if ! touch "$probe"; then
    return 1
  fi
  rm -f "$probe"
  return 0
}

if [ "$(id -u)" = "0" ]; then
  # chown 在只读卷上会按文件刷屏。失败原因只保留一行 FATAL，明细最多 5 行。
  if ! chown_err=$(chown -R node:node "$DATA_DIR" "$BACKUP_DIR" 2>&1); then
    echo "[Startup] FATAL: 无法把 ${DATA_DIR} 与 ${BACKUP_DIR} 的属主改为 node（uid $(id -u node 2>/dev/null || echo 1000)）。卷可能是只读挂载。" >&2
    printf '%s\n' "$chown_err" | head -n 5 >&2
    exit 1
  fi
  if ! su-exec node sh -c "touch '${DATA_DIR}/.write-probe' && rm -f '${DATA_DIR}/.write-probe' && touch '${BACKUP_DIR}/.write-probe' && rm -f '${BACKUP_DIR}/.write-probe'"; then
    echo "[Startup] FATAL: node 用户无法写入 ${DATA_DIR} 或 ${BACKUP_DIR}。命名卷默认属主是 root，入口必须先 chown 再降权。" >&2
    exit 1
  fi
  echo "[Startup] 数据目录已交给 node，开始启动。"
  exec su-exec node "$@"
fi

if ! probe_writable "$DATA_DIR" || ! probe_writable "$BACKUP_DIR"; then
  echo "[Startup] FATAL: 当前用户 $(id -un)（uid $(id -u)）无法写入 ${DATA_DIR} 或 ${BACKUP_DIR}。" >&2
  echo "[Startup] FATAL: 请使用镜像入口（root 启动后降权到 node），或把卷的属主改为 uid 1000。" >&2
  exit 1
fi

echo "[Startup] 以 uid $(id -u) 启动。"
exec "$@"
