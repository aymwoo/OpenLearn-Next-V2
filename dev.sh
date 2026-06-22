#!/usr/bin/env bash
# OpenLearnV2 开发环境启动脚本
# 按顺序启动三个服务：mfe-whiteboard (5174) → mfe-courseware (5175) → 主服务 (9000)

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

cleanup() {
    echo ""
    echo "正在关闭所有开发服务..."
    kill $PID_MAIN 2>/dev/null
    echo "已全部关闭"
    exit 0
}

# Trap terminal signals to clean up background processes
trap cleanup INT TERM

# ── 1. 静态构建 MFE 子项目 (方案C) ───────────────────────────
echo "⏳ 正在构建 MFE Whiteboard 与 Courseware 静态资源 (方案C)..."
cd "$ROOT" || exit 1
pnpm --filter mfe-whiteboard build || exit 1
pnpm --filter mfe-courseware build || exit 1

# ── 2. 启动主服务 (9000) ───────────────────────────────────────
echo "⏳ 启动主服务 (9000)..."
cd "$ROOT" || exit 1
pnpm run dev &
PID_MAIN=$!

sleep 5

# ── 健康检查 ──────────────────────────────────────────────────
echo ""
OK=true

if curl -s -o /dev/null -w '' http://localhost:9000/mfe/whiteboard/remoteEntry.js 2>/dev/null; then
    echo "✅ MFE Whiteboard   http://localhost:9000/mfe/whiteboard/remoteEntry.js 就绪"
else
    echo "❌ MFE Whiteboard   http://localhost:9000/mfe/whiteboard/remoteEntry.js 未响应"
    OK=false
fi

if curl -s -o /dev/null -w '' http://localhost:9000/mfe/courseware/remoteEntry.js 2>/dev/null; then
    echo "✅ MFE Courseware   http://localhost:9000/mfe/courseware/remoteEntry.js 就绪"
else
    echo "❌ MFE Courseware   http://localhost:9000/mfe/courseware/remoteEntry.js 未响应"
    OK=false
fi

if curl -s -o /dev/null -w '' http://localhost:9000/ 2>/dev/null; then
    echo "✅ 主服务           http://localhost:9000  就绪"
else
    echo "❌ 主服务           http://localhost:9000  未响应"
    OK=false
fi

echo ""

if [ "$OK" = false ]; then
    echo "⚠ 服务未能正常启动，请检查上方错误信息"
    cleanup
fi

echo "🚀 开发环境就绪！按 Ctrl+C 停止服务"
wait
