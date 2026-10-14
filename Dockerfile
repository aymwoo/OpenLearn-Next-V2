# ── Build Stage ────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# 安装构建原生模块（如 better-sqlite3）所需的编译工具
RUN apk add --no-cache python3 make g++ gcc

# 钉住与锁文件配套的 pnpm。@latest 会带上默认的 minimumReleaseAge，
# 在没有 .npmrc 时拒绝锁文件里当天发布的传递依赖，镜像构建直接失败。
RUN corepack enable && corepack prepare pnpm@10.33.4 --activate

# 复制依赖声明文件利用 Docker 层缓存。
# .npmrc 必须在 install 之前进入镜像（minimum-release-age=0）。
# prepare 会调用 scripts/build-plugin-sdk.mjs；源码尚未复制时该脚本会跳过。
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/build-plugin-sdk.mjs ./scripts/build-plugin-sdk.mjs
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY packages/plugin-test-kit/package.json ./packages/plugin-test-kit/
COPY packages/bridge-sdk/package.json ./packages/bridge-sdk/

# 安装全量依赖执行构建
RUN pnpm install --frozen-lockfile

# 复制源码并构建（SDK dist、前端、插件、服务端 bundle）
COPY . .
RUN pnpm run build && node scripts/verify-plugin-sdk-entry.mjs

# esbuild 必须留在 dependencies：安装插件时宿主会动态 import('esbuild')。
# 修剪仅保留生产依赖以优化运行时体积。
# pnpm 10 在没有 TTY 时会拒绝删除 node_modules，必须声明这是 CI。
# --ignore-scripts：prune 会再跑 prepare，而 prepare 需要已删掉的 typescript。
# plugin-sdk 的 dist 在上一步 pnpm run build 里已经生成。
RUN CI=true pnpm prune --prod --ignore-scripts

# ── Production Stage ───────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# wget：健康检查。su-exec：入口以 root 修正卷属主后再降权到 node。
RUN apk add --no-cache wget su-exec && \
    mkdir -p /data/storage /data/plugins /data/uploads /backups /app/scripts

# 从构建阶段复制必要产物、生产依赖与数据库迁移文件。
# server.cjs 运行时 require("@openlearn/plugin-sdk")，入口在 workspace 包的 dist/。
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
COPY --from=build /app/packages/plugin-sdk/dist ./packages/plugin-sdk/dist
COPY --from=build /app/scripts/verify-plugin-sdk-entry.mjs ./scripts/verify-plugin-sdk-entry.mjs
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY scripts/site-backup.mjs scripts/site-restore.mjs scripts/backfill-class-owners.mjs ./scripts/

# 入口以 root 运行，确认 /data 与 /backups 可写后 su-exec 到 node。
# 命名卷首次创建时属主是 root，若直接 USER node，空库会因无法建库而启动失败。
# NODE_ENV 必须在校验 SDK 之前设置：未设置时 logger 会去加载已被 prune 的 pino-pretty。
ENV NODE_ENV=production
ENV PORT=9000
ENV OPENLEARN_DATA_DIR=/data
ENV OPENLEARN_DB_PATH=/data/educational_os.db
ENV BACKUP_DIR=/backups
ENV LOG_DIR=/data/logs
ENV OPENLEARN_PLUGINS_DIR=/data/plugins

# 镜像里必须能按发布入口加载 SDK；符号链接断了就在这里失败，而不是等到运行时。
RUN node scripts/verify-plugin-sdk-entry.mjs && chmod 755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9000/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.cjs"]
