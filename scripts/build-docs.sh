#!/usr/bin/env bash
# 严格构建文档站（Sphinx + MyST）。
#
# 两个消费方共用这一组参数，避免「CI 过得去、RTD 过不去」这类两处漂移：
#   · Read the Docs  —— .readthedocs.yaml 的 fail_on_warning: true
#   · CI             —— .github/workflows/ci.yml 的 docs-drift-audit job
# 本地复现同样用它（用法见 docs/contributing/contributing.md §4.1）。
#
# 用法：
#   bash scripts/build-docs.sh [输出目录]
#     输出目录默认 docs/_build/html（已在 .gitignore 中）。
#   DOCS_BUILD_DIR=/path bash scripts/build-docs.sh
#
# 退出码：0 = 零警告构建通过；非 0 = 有警告/错误，或依赖未安装。
set -euo pipefail

cd "$(dirname "$0")/.."

OUT="${1:-${DOCS_BUILD_DIR:-docs/_build/html}}"

# 依赖不在 docs/requirements.txt 之外另立清单：RTD 装什么，这里就装什么。
if ! python3 -c 'import sphinx, myst_parser' >/dev/null 2>&1; then
  echo "未找到 sphinx / myst-parser。先安装文档依赖：" >&2
  echo "  python3 -m pip install -r docs/requirements.txt" >&2
  exit 1
fi

echo "构建 docs/ → ${OUT}（-W：任何警告即失败）"

# -W            : 警告即错误，等价于 .readthedocs.yaml 的 fail_on_warning: true。
# --keep-going  : 一次把全部问题暴露出来。不加它，第一个警告就中断构建，
#                 「修一个跑一次」会把发现问题的成本放大到问题个数那么多倍。
exec python3 -m sphinx -b html docs "${OUT}" -W --keep-going
