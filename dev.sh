#!/usr/bin/env bash
# OpenLearnV2 开发环境启动脚本
# 按顺序启动三个服务：mfe-whiteboard (5174) → mfe-courseware (5175) → 主服务 (9000)

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

cleanup() {
    echo ""
    echo "正在关闭所有开发服务..."
    kill $PID_WB $PID_CW $PID_MAIN 2>/dev/null
    echo "已全部关闭"
    exit 0
}

# Trap terminal signals to clean up background processes
trap cleanup INT TERM

# ── 1. MFE Whiteboard (5174) ─────────────────────────────────
echo "⏳ 启动 MFE Whiteboard (5174)..."
cd "$ROOT/packages/mfe-whiteboard" || exit 1
pnpm run dev &
PID_WB=$!

# ── 2. MFE Courseware (5175) ─────────────────────────────────
echo "⏳ 启动 MFE Courseware (5175)..."
cd "$ROOT/packages/mfe-courseware" || exit 1
pnpm run dev &
PID_CW=$!

# ── 3. 主服务 (9000) ─────────────────────────────────────────
echo "⏳ 启动主服务 (9000)..."
cd "$ROOT" || exit 1
sleep 2  # Give MFE services a moment to warm up
pnpm run dev &
PID_MAIN=$!

sleep 10

# ── 健康检查 ──────────────────────────────────────────────────
echo ""
OK=true

if curl -s -o /dev/null -w '' http://localhost:5174/remoteEntry.js 2>/dev/null; then
    echo "✅ MFE Whiteboard   http://localhost:5174  就绪"
else
    echo "❌ MFE Whiteboard   http://localhost:5174  未响应"
    OK=false
fi

if curl -s -o /dev/null -w '' http://localhost:5175/remoteEntry.js 2>/dev/null; then
    echo "✅ MFE Courseware   http://localhost:5175  就绪"
else
    echo "❌ MFE Courseware   http://localhost:5175  未响应"
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
    echo "⚠ 部分服务未能正常启动，请检查上方错误信息"
    cleanup
fi

echo "🚀 开发环境就绪！按 Ctrl+C 停止所有服务"
wait
