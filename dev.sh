#!/usr/bin/env bash
# OpenLearnV2 开发环境启动脚本（v5.0 简化版）
# 白板和课件已内聚为主应用本地模块，只需启动一个服务

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

cleanup() {
    echo ""
    echo "正在关闭服务..."
    kill $PID_MAIN 2>/dev/null
    echo "已关闭"
    exit 0
}

trap cleanup INT TERM

echo "⏳ 启动 OpenLearnV2 (9000)..."
cd "$ROOT" || exit 1
npx tsx --no-cache server.ts &
PID_MAIN=$!

sleep 6

if curl -s -o /dev/null -w '' http://localhost:9000/ 2>/dev/null; then
    echo "✅ 主服务 http://localhost:9000 就绪"
    echo "🚀 开发环境就绪！按 Ctrl+C 停止"
else
    echo "❌ 主服务未响应"
    cleanup
fi

wait
