#!/usr/bin/env bash
# Run the docs-vs-code architecture drift audit.
#
# 两段检查:
#   1. canonical-key 比对  — extractors.py + aligner.py（保留原有逻辑）
#   2. 引用完整性          — refchecks.py（path-existence / doc-link / duplicate-docs）
#
# Exit code 0 = no drift, 1 = drift detected (or pipeline error).
set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

OUT_DIR="audit-tools/reports"
EXTRACT_JSON="${OUT_DIR}/extracts.json"
DRIFT_MD="${OUT_DIR}/drift_report.md"
DRIFT_JSON="${OUT_DIR}/drift_report.json"
SYM_MD="${OUT_DIR}/symbol_report.md"
SYM_JSON="${OUT_DIR}/symbol_report.json"
REF_MD="${OUT_DIR}/ref_report.md"
REF_JSON="${OUT_DIR}/ref_report.json"
ENV_MD="${OUT_DIR}/env_report.md"
ENV_JSON="${OUT_DIR}/env_report.json"
PLUGIN_JSON="${OUT_DIR}/plugin_docs_report.json"
PLUGIN_MD="${OUT_DIR}/plugin_docs_report.md"
EXTPT_JSON="${OUT_DIR}/extension_points_report.json"
EXTPT_MD="${OUT_DIR}/extension_points_report.md"
DOCVER_JSON="${OUT_DIR}/doc_version_report.json"
DOCVER_MD="${OUT_DIR}/doc_version_report.md"

mkdir -p "${OUT_DIR}"

# --- 1. canonical-key drift (原有检查) ---
python3 audit-tools/extractors.py \
  --docs docs \
  --packages . \
  --out "${EXTRACT_JSON}"

# --- 2. 引用完整性 drift (新增检查) ---
python3 audit-tools/refchecks.py \
  --docs docs \
  --repo . \
  --out-md "${REF_MD}" \
  --out-json "${REF_JSON}"

REF_DRIFT=$(python3 -c "import json;print(json.load(open('${REF_JSON}'))['total'])")

# --- 2.5 环境变量三方比对（配置键漂移）---
# 配置键既不是文件路径也不是代码符号，前两段检查都覆盖不到。这一段的 D1/D2/D3
# 判定刻意收得很窄（见 envcheck.py 模块文档），误报率接近 0，故计入 drift。
python3 audit-tools/envcheck.py \
  --repo . \
  --out-md "${ENV_MD}" \
  --out-json "${ENV_JSON}"

ENV_DRIFT=$(python3 -c "import json;print(json.load(open('${ENV_JSON}'))['drift_count'])" 2>/dev/null || echo 0)

# --- 2.6 插件文档代码示例校验（API 用法漂移）---
# 前三段都只看"路径/符号/键名是否存在"，不看**代码块里的调用形状**。
# 而面向插件作者的文档一旦写出 ctx.commandBus 这种宿主没有的入口，
# 照抄的 Agent 必然编译失败。P1–P4 只比对确定的契约（SDK 导出 / Context 成员），
# 误报率低，计入 drift；P5 仅提示。
python3 audit-tools/plugin_docs_check.py \
  --json "${PLUGIN_JSON}" 2>/dev/null || true

PLUGIN_DRIFT=$(python3 -c "import json;print(json.load(open('${PLUGIN_JSON}'))['stats']['drift'])" 2>/dev/null || echo 0)

# --- 2.7 扩展槽文档覆盖（新增槽位必须写进 reference/plugin-ui-extension-slots.md）---
# 槽位是插件作者唯一的接入面。代码里声明了槽位而文档没有对应说明，作者只能靠猜
# props —— 这正是 2026-10-27 发现 20 个槽位（含 assessment.* / assignment.grade.*）
# 从未进过文档的原因。本段生成槽位清单真值并逐个比对文档覆盖：
#   仅 L0（文档中完全不存在）计入 drift；L1/L2 只作提示，避免门禁被噪声训练掉。
python3 audit-tools/extract_slots.py --repo . --out "${OUT_DIR}/slots_inventory.json" >/dev/null
python3 audit-tools/slots_coverage.py --repo . \
  --out "${OUT_DIR}/slots_coverage.json" \
  --md "${OUT_DIR}/slots_coverage.md" >/dev/null || true

SLOT_DRIFT=$(python3 -c "import json;print(json.load(open('${OUT_DIR}/slots_coverage.json'))['grades'].get('L0',0))" 2>/dev/null || echo 0)
SLOT_HINTS=$(python3 -c "
import json
g = json.load(open('${OUT_DIR}/slots_coverage.json'))['grades']
print(g.get('L1', 0) + g.get('L2', 0))
" 2>/dev/null || echo 0)

# --- 2.8 插件可注册的领域扩展点覆盖（新增扩展点必须写进文档）---
#
# 槽位（2.7）只覆盖 UI 那一类接入面。插件还能往**内核注册表**里注册领域扩展点
# （题库题型、课堂阶段门禁、课堂互动提供者…），这一类此前没有任何门禁：
# 2026-10-27 实测 9 个真实扩展点里有 6 个在插件文档中从未出现，其中 3 个只出现在
# docs/architecture/ 下。第三方作者的合理结论是「平台只支持 UI 槽位」。
#
# 真值从源码推导（PLUGIN_RESOLVABLE_TOKENS + 接口体里的 register* 方法），
# 不靠人手维护清单；豁免必须指明覆盖文档，门禁核对该文档确实提到该方法。
# 判定与 2.7 同构：L0（文档中完全不存在）计入 drift，L1/L2 只作提示。
python3 audit-tools/extension_points_coverage.py \
  --json "${EXTPT_JSON}" --md "${EXTPT_MD}" 2>/dev/null || true

EXTPT_DRIFT=$(python3 -c "import json;print(json.load(open('${EXTPT_JSON}'))['stats']['drift'])" 2>/dev/null || echo 0)

# --- 2.9 doc-version 一致性（文档声明的包版本必须等于 package.json）---
# 覆盖 docs/ 的 doc-version 标记 + 根 CHANGELOG 顶部的版本注记（后者 2026-10-27 补入）。
#
# `<!-- doc-version: sdk=X.Y.Z -->` 此前**全仓零校验** —— 除 docs/ 外没有任何脚本读它，
# 它只是个注释。于是它安静地烂掉：2026-10-27 实测 SDK 已发到 3.7.3，26 篇文档仍写
# `sdk=3.7.2`，其中 scaffold-cli.md 顶着旧版本号描述着当时 npm 上根本没有的构建期
# 守卫。这不是「文档过时」，是**文档承诺了 registry 上不存在的能力**，而门禁、CI、
# 发版三处都不报。
#
# 判据就一条：标记里的版本号 == 对应包 package.json 的 version。抬版本就得抬标记，
# 一件本该在发版 PR 里顺手做完的事。误报率为零，故计入 drift。
node scripts/check-doc-version.mjs --json "${DOCVER_JSON}" --md "${DOCVER_MD}" || true
DOCVER_DRIFT=$(python3 -c "import json;print(json.load(open('${DOCVER_JSON}'))['drift'])" 2>/dev/null || echo 0)

# --- 3. 符号存在性提示（L2 语义层）---
# 刻意**不计入** drift：它能抓到枚举改名/Token 消失这类语义漂移，但仍有约
# 15-20% 精度（JS 全局、第三方包导出、历史文档引用已删除子系统）。
# 当门禁会训练团队忽略告警，故只作为逐篇审阅的清单输出。
python3 audit-tools/symbolcheck.py \
  --docs docs \
  --repo . \
  --out-md "${SYM_MD}" \
  --out-json "${SYM_JSON}" 2>/dev/null || true
SYM_HINTS=$(python3 -c "import json;print(json.load(open('${SYM_JSON}'))['hint_count'])" 2>/dev/null || echo 0)

python3 audit-tools/aligner.py \
  --extracts "${EXTRACT_JSON}" \
  --out-md "${DRIFT_MD}" \
  --out-json "${DRIFT_JSON}" \
  --ref-md "${REF_MD}" \
  --ref-drift "${REF_DRIFT}" \
  --sym-md "${SYM_MD}"

# 合计 drift 数。以 JSON 为准（robust），并与报告里的合计行交叉校验。
DRIFT_COUNT=$(python3 -c "
import json
total = 0
for p in ('${DRIFT_JSON}', '${REF_JSON}'):
    try:
        total += json.load(open(p)).get('total', 0)
    except Exception:
        pass
print(total)
")

# 交叉校验：报告正文的「实际 drift 项」应与 JSON 合计一致
REPORT_COUNT=$(grep -E "^- 实际 drift 项" "${DRIFT_MD}" | grep -oE "[0-9]+" || echo "")
if [ "${REPORT_COUNT}" != "${DRIFT_COUNT}" ]; then
  echo "::error::报告合计 (${REPORT_COUNT:-无}) 与 JSON 合计 (${DRIFT_COUNT}) 不一致"
  exit 1
fi

# 覆盖量摘要
python3 -c "
import json
s = json.load(open('${REF_JSON}'))['stats']
p = s['path_existence']
print('---- 引用完整性覆盖 ----')
print(f\"  扫描文档      : {p['docs_scanned']} 篇\")
print(f\"  路径引用      : {p['refs_total']} 条 (去重 {p['refs_unique']}, 存在 {p['refs_exist']}, 缺失 {p['refs_missing']})\")
print(f\"  文档内链      : {s['doc_link']['links_total']} 条 (失效 {s['doc_link']['links_broken']})\")
print(f\"  重复文档分组  : {s['duplicate_docs']['duplicate_groups']} 组\")
"

# 全仓合计：canonical + ref + 环境变量 + 插件文档示例 + 扩展槽覆盖。
# envcheck / plugin_docs_check / slots_coverage 的判定都已收窄到近乎无假阳性，故与另两段同列门禁；
# symbolcheck 仍只作提示。
TOTAL_DRIFT=$((DRIFT_COUNT + ENV_DRIFT + PLUGIN_DRIFT + SLOT_DRIFT + EXTPT_DRIFT + DOCVER_DRIFT))

echo "canonical_drift=$(python3 -c "import json;print(json.load(open('${DRIFT_JSON}'))['total'])")"
echo "ref_drift=${REF_DRIFT}"
echo "env_drift=${ENV_DRIFT}  （见 ${ENV_MD}）"
echo "plugin_docs_drift=${PLUGIN_DRIFT}  （见 ${PLUGIN_MD}）"
echo "slot_drift=${SLOT_DRIFT}  （见 ${OUT_DIR}/slots_coverage.md）"
echo "ext_point_drift=${EXTPT_DRIFT}  （见 ${EXTPT_MD}）"
echo "doc_version_drift=${DOCVER_DRIFT}  （见 ${DOCVER_MD}）"
echo "slot_hints=${SLOT_HINTS}  （仅提示，不计入 drift）"
echo "symbol_hints=${SYM_HINTS}  （仅提示，不计入 drift）"
echo "drift_count=${TOTAL_DRIFT}"

if [ "${TOTAL_DRIFT}" -gt 0 ]; then
  echo "::error::Architecture docs drift detected: ${TOTAL_DRIFT} item(s). See ${DRIFT_MD}, ${ENV_MD}, ${PLUGIN_MD}, ${OUT_DIR}/slots_coverage.md, ${EXTPT_MD} and ${DOCVER_MD}."
  exit 1
fi

echo "✅ No architecture drift detected."
