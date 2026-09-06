#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log()  { echo -e "${GREEN}[publish]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── 0. Preflight Quality Gate & Version Consistency ────────────────
log "Running Preflight Quality Gates (lint & version-consistency)..."
pnpm lint || err "TypeScript check failed"
pnpm vitest run packages/core/__tests__/version-consistency.test.ts || err "Version consistency gate failed! Check package.json vs packages/core/version.ts"

# ── 1. Publish @openlearn/plugin-sdk ───────────────────────────────
log "Building @openlearn/plugin-sdk..."
cd packages/plugin-sdk
npm publish --registry=https://registry.npmjs.org || err "plugin-sdk publish failed"
SDK_VER=$(node -p "require('./package.json').version")
log "@openlearn/plugin-sdk@${SDK_VER} published"
cd ../..

# ── 2. Publish @openlearn/plugin-test-kit ──────────────────────────
log "Publishing @openlearn/plugin-test-kit..."
sed -i 's|"@openlearn/plugin-sdk": "workspace:\*"|"@openlearn/plugin-sdk": "^'"$SDK_VER"'"|' packages/plugin-test-kit/package.json
cd packages/plugin-test-kit
npm publish --registry=https://registry.npmjs.org || err "plugin-test-kit publish failed"
TK_VER=$(node -p "require('./package.json').version")
log "@openlearn/plugin-test-kit@${TK_VER} published"
cd ../..
# Restore workspace protocol for local dev
git checkout -- packages/plugin-test-kit/package.json

# ── 3. Build & publish openlearn-next ──────────────────────────────
log "Building openlearn-next..."
pnpm build || err "build failed"
# 将 workspace 协议重写为精确 SDK 版本再发布：npx/npm 消费者安装时按
# 精确 pin 解析，与 server.cjs 构建时所用的 SDK 版本强绑定，防止版本漂移。
sed -i 's|"@openlearn/plugin-sdk": "workspace:\*"|"@openlearn/plugin-sdk": "'"${SDK_VER}"'"|' package.json
npm publish --registry=https://registry.npmjs.org || err "openlearn-next publish failed"
APP_VER=$(node -p "require('./package.json').version")
log "openlearn-next@${APP_VER} published"
# Restore workspace protocol for local dev
git checkout -- package.json

# ── 4. Sync to npmmirror ──────────────────────────────────────────
log "Syncing to npmmirror..."
cnpm sync openlearn-next        || log "sync openlearn-next failed (non-fatal)"
cnpm sync @openlearn/plugin-sdk || log "sync @openlearn/plugin-sdk failed (non-fatal)"
cnpm sync @openlearn/plugin-test-kit || log "sync @openlearn/plugin-test-kit failed (non-fatal)"

log "Done. Packages published and synced."
