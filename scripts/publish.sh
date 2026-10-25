#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0.31m'
GREEN='\033[0.32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[publish]${NC} $*"; }
warn() { echo -e "${YELLOW}[publish]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*"; exit 1; }

usage() {
  cat <<'EOF'
用法: scripts/publish.sh [--dry-run]

  --dry-run   走完整发布流程但不真正发布：npm publish --dry-run + 跳过镜像同步。
              用于发布前验证产物（包内容、版本、依赖改写结果）。
  -h,--help   显示本帮助。

发布顺序: @openlearn/plugin-sdk → @openlearn/plugin-test-kit → openlearn-next → npmmirror 同步。
EOF
}

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    *) err "未知参数: ${arg}（用 --help 查看用法）" ;;
  esac
done

if [ "$DRY_RUN" = true ]; then
  warn "DRY-RUN 模式：不会真正发布到 npm，也不会同步镜像。"
fi

# ── 0. Preflight Quality Gate & Version Consistency ─────────────────
log "Running Preflight Quality Gates (lint & version-consistency)..."
pnpm lint || err "TypeScript check failed"
pnpm vitest run packages/core/__tests__/version-consistency.test.ts || err "Version consistency gate failed! Check package.json vs packages/core/version.ts"

# ── 0b. 版本占用门禁（防「tag 与 npm 包指向不同代码」）─────────────
#
# 为什么需要这道门禁：同一个版本号可能同时存在于 git tag 与 npm 上，而
# **两者可以指向两批不同的代码** —— 已发布的 npm 版本不可覆盖、不可逆。
# npm 侧有自己的保护（不允许覆盖已发布版本），git 侧没有。
#
# 判据不是「tag 不能存在」，而是「**tag 必须与本次发布的提交同源**」：
#
#   · tag 不存在             → 通过（尚未打 tag，允许先发后补）
#   · tag 存在且指向本次提交 → 通过（正是想要的状态：tag 与 npm 包同源）
#   · tag 存在但指向别的提交 → 拒绝（同一个版本号会指向两批不同的代码）
#
# 为什么不能简单写成「tag 存在即拒绝」：仓库既定的发布顺序是
# 「提交（含版本提升）→ 打 tag → 执行 publish.sh」（见审计报告的发布流程）。
# 若按「tag 存在即拒绝」，**tag 一打就再也发不出去** —— 门禁与流程自相矛盾。
# v0.7.2 首次实现的就是后者，直到 v0.7.3 真正执行发布时才暴露出来。
#
# 只对**即将发布**的包调用：已发布且版本未变的包走「跳过发布」分支，不该被拦。
assert_version_not_taken() {
  local pkg_name="$1" version="$2"

  local tag_commit head_commit
  tag_commit="$(git rev-parse -q --verify "refs/tags/v${version}^{commit}" 2>/dev/null || true)"
  head_commit="$(git rev-parse HEAD 2>/dev/null || true)"
  if [ -n "$tag_commit" ]; then
    if [ "$tag_commit" != "$head_commit" ]; then
      err "版本占用：git tag v${version} 已存在但指向 ${tag_commit:0:12}，与本次发布的提交 ${head_commit:0:12} 不同 —— 同一个版本号会指向两批不同的代码。请提升版本号。"
    fi
    log "git tag v${version} 与本次发布的提交同源（${tag_commit:0:12}）—— tag 与 npm 包指向同一批代码，允许发布。"
  fi

  local remote_versions
  # 必须查权威 registry：本机的默认 registry 是 npmmirror，镜像滞后会让「已发布」误判成「未占用」
  remote_versions="$(npm view "${pkg_name}" versions --json --registry=https://registry.npmjs.org 2>/dev/null || echo '[]')"
  if printf '%s' "$remote_versions" | grep -q "\"${version}\""; then
    err "版本占用：npm 上 ${pkg_name}@${version} 已发布。请提升版本号。"
  fi
}

log "Checking version occupancy (git tags & npm registry)..."
APP_VER="$(node -p "require('./package.json').version")"
# 平台包每次都会发布 → 占用检查在预检阶段就做（早失败，别等 build 完才发现）。
assert_version_not_taken openlearn-next "$APP_VER"

# npm 采集 gitHead 要求包目录下的 .git 是**目录**；linked worktree 里 .git 是一个
# 指向真实 gitdir 的文本文件 → 采集落空，registry 上该版本没有 gitHead 字段，
# 消费者无从追溯来源提交（产物内容不受影响）。
if [ -e .git ] && [ ! -d .git ]; then
  warn "当前目录是 git linked worktree（.git 是文件而非目录）—— npm 采集不到 gitHead，发布后 registry 不会记录来源提交。建议改在普通 checkout（.git 是目录）里发布。"
fi

SDK_DIR="packages/plugin-sdk"
TK_DIR="packages/plugin-test-kit"
SDK_VER="$(node -p "require('./$SDK_DIR/package.json').version")"
TK_VER="$(node -p "require('./$TK_DIR/package.json').version")"
log "Version occupancy check passed (openlearn-next@${APP_VER})."

# ── 发布辅助：dry-run 时走 npm publish --dry-run ───────────────────
publish_pkg() {
  local dir="$1" name="$2"
  if [ "$DRY_RUN" = true ]; then
    warn "[dry-run] npm publish --dry-run --registry=https://registry.npmjs.org （${name}，不会真正发布）"
    (cd "$dir" && npm publish --dry-run --registry=https://registry.npmjs.org)
  else
    (cd "$dir" && npm publish --registry=https://registry.npmjs.org)
  fi
}

# ── 发布清单核对（dry-run 专用）────────────────────────────────────
#
# 断言四件事，缺一即视为「这次发布不能发」：
#   1. package.json 的 version 与待发布版本一致（防止改写错版本号）；
#   2. @openlearn/plugin-sdk 是**精确 pin**（不是 workspace:* —— 消费者装不上）；
#   3. files 清单含 dist/plugin-net-preload.cjs（P0-1 的回归护栏）；
#   4. 该文件在构建产物里真实存在（files 指向空气同样会炸）。
verify_release_manifest() {
  local dir="$1" expected_version="$2" expected_sdk="$3"
  local report
  report="$(cd "$dir" && node -e '
    const fs = require("fs");
    const path = require("path");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
    const out = [];
    const version = pkg.version;
    const sdk = (pkg.dependencies || {})["@openlearn/plugin-sdk"];
    const files = pkg.files || [];
    const preload = "dist/plugin-net-preload.cjs";
    out.push(`version=${version}`);
    out.push(`sdk=${sdk}`);
    out.push(`preloadInFiles=${files.includes(preload)}`);
    out.push(`preloadExists=${fs.existsSync(path.join("dist", "plugin-net-preload.cjs"))}`);
    console.log(out.join(" "));
  ')"
  log "[dry-run] 发布清单核对：${report}"

  local version sdk preload_in_files preload_exists
  version="$(printf '%s' "$report" | sed -n 's/.*version=\([^ ]*\).*/\1/p')"
  sdk="$(printf '%s' "$report" | sed -n 's/.*sdk=\([^ ]*\).*/\1/p')"
  preload_in_files="$(printf '%s' "$report" | sed -n 's/.*preloadInFiles=\([^ ]*\).*/\1/p')"
  preload_exists="$(printf '%s' "$report" | sed -n 's/.*preloadExists=\([^ ]*\).*/\1/p')"

  [ "$version" = "$expected_version" ] || err "发布清单核对失败：version=${version}（期望 ${expected_version}）"
  [ "$sdk" = "$expected_sdk" ] || err "发布清单核对失败：@openlearn/plugin-sdk=${sdk}（期望精确 pin ${expected_sdk}；workspace:* 消费者装不上）"
  [ "$preload_in_files" = "true" ] || err "发布清单核对失败：files 清单缺 dist/plugin-net-preload.cjs（npm 用户的第三方插件会起不来，见 P0-1）"
  [ "$preload_exists" = "true" ] || err "发布清单核对失败：dist/plugin-net-preload.cjs 在构建产物里不存在（files 指向了空气）"
  log "[dry-run] 发布清单核对通过。"
}

# ── 1. Publish @openlearn/plugin-sdk ─────────────────────────────────
log "Checking @openlearn/plugin-sdk..."
REMOTE_SDK_VER="$(npm view @openlearn/plugin-sdk version --registry=https://registry.npmjs.org 2>/dev/null || echo "")"
if [ "$SDK_VER" != "$REMOTE_SDK_VER" ]; then
  # 即将发布 → 才需要占用检查（已发布且版本不变的包走下面的跳过分支，不该被拦）。
  assert_version_not_taken @openlearn/plugin-sdk "$SDK_VER"
  publish_pkg "$SDK_DIR" "@openlearn/plugin-sdk@${SDK_VER}"
  log "@openlearn/plugin-sdk@${SDK_VER} published"
else
  log "@openlearn/plugin-sdk@${SDK_VER} already published on npm, skipping publish"
fi

# ── 2. Publish @openlearn/plugin-test-kit ──────────────────────────
log "Checking @openlearn/plugin-test-kit..."
REMOTE_TK_VER="$(npm view @openlearn/plugin-test-kit version --registry=https://registry.npmjs.org 2>/dev/null || echo "")"
if [ "$TK_VER" != "$REMOTE_TK_VER" ]; then
  assert_version_not_taken @openlearn/plugin-test-kit "$TK_VER"
  # workspace 协议改写为精确 SDK 版本后再发布（发布后还原）。
  sed -i 's|"@openlearn/plugin-sdk": "workspace:\*"|"@openlearn/plugin-sdk": "^'"$SDK_VER"'"|' "$TK_DIR/package.json"
  publish_pkg "$TK_DIR" "@openlearn/plugin-test-kit@${TK_VER}"
  log "@openlearn/plugin-test-kit@${TK_VER} published"
  # Restore workspace protocol for local dev
  git checkout -- "$TK_DIR/package.json"
else
  log "@openlearn/plugin-test-kit@${TK_VER} already published on npm, skipping publish"
fi

# ── 3. Build & publish openlearn-next ──────────────────────────────
log "Building openlearn-next..."
pnpm build || err "build failed"
# 将 workspace 协议重写为精确 SDK 版本再发布：npx/npm 消费者安装时按
# 精确 pin 解析，与 server.cjs 构建时所用的 SDK 版本强绑定，防止版本漂移。
sed -i 's|"@openlearn/plugin-sdk": "workspace:\*"|"@openlearn/plugin-sdk": "'"${SDK_VER}"'"|' package.json
publish_pkg "." "openlearn-next@${APP_VER}"
log "openlearn-next@${APP_VER} published"
# Dry-run 额外核对：消费者实际看到的清单（package.json 原样进包）。
# 这一步不是形式主义 —— P0-1（发布包缺 plugin-net-preload.cjs）正是「产物内容对不上」
# 这一类缺陷，而 npm publish --dry-run 只打印文件清单，不会替你断言清单本身对不对。
if [ "$DRY_RUN" = true ]; then
  verify_release_manifest "." "$APP_VER" "$SDK_VER"
fi
# Restore workspace protocol for local dev
sed -i 's|"@openlearn/plugin-sdk": "'"${SDK_VER}"'"|"@openlearn/plugin-sdk": "workspace:\*"|' package.json

# ── 4. Sync to npmmirror ──────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
  warn "[dry-run] 跳过 npmmirror 同步（镜像同步只对已发布版本有意义）。"
else
  log "Syncing to npmmirror..."
  cnpm sync openlearn-next        || log "sync openlearn-next failed (non-fatal)"
  cnpm sync @openlearn/plugin-sdk || log "sync @openlearn/plugin-sdk failed (non-fatal)"
  cnpm sync @openlearn/plugin-test-kit || log "sync @openlearn/plugin-test-kit failed (non-fatal)"
fi

if [ "$DRY_RUN" = true ]; then
  warn "DRY-RUN 完成：以上产物与元数据均可发布，但**没有**任何内容被发布到 npm。"
else
  log "Done. Packages published and synced."
fi
