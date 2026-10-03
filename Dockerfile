# ── Build Stage ────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# 安装构建原生模块（如 better-sqlite3）所需的编译工具
RUN apk add --no-cache python3 make g++ gcc

# 启用并准备 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖声明文件利用 Docker 层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/plugin-sdk/package.json ./packages/plugin-sdk/
COPY packages/plugin-test-kit/package.json ./packages/plugin-test-kit/

# 安装全量依赖执行构建
RUN pnpm install --frozen-lockfile

# 复制源码并构建（前端、插件、服务端 bundle）
COPY . .
RUN pnpm run build

# 修剪仅保留生产依赖以优化运行时体积
RUN pnpm prune --prod

# ── Production Stage ───────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# 安装轻量健康检查工具并创建必要持久化目录
RUN apk add --no-cache wget && \
    mkdir -p /app/packages/core/db /app/storage /app/backups

# 从构建阶段复制必要产物、生产依赖与数据库迁移文件
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/migrations ./migrations

# 目录权限配置并使用非 root 运行
RUN chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=9000
ENV OPENLEARN_DB_PATH=/app/packages/core/db/educational_os.db

EXPOSE 9000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9000/health || exit 1

CMD ["node", "dist/server.cjs"]
