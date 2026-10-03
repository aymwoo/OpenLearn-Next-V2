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
REF_MD="${OUT_DIR}/ref_report.md"
REF_JSON="${OUT_DIR}/ref_report.json"

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

python3 audit-tools/aligner.py \
  --extracts "${EXTRACT_JSON}" \
  --out-md "${DRIFT_MD}" \
  --out-json "${DRIFT_JSON}" \
  --ref-md "${REF_MD}" \
  --ref-drift "${REF_DRIFT}"

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

echo "canonical_drift=$(python3 -c "import json;print(json.load(open('${DRIFT_JSON}'))['total'])")"
echo "ref_drift=${REF_DRIFT}"
echo "drift_count=${DRIFT_COUNT}"

if [ "${DRIFT_COUNT}" -gt 0 ]; then
  echo "::error::Architecture docs drift detected: ${DRIFT_COUNT} item(s). See ${DRIFT_MD}."
  exit 1
fi

echo "✅ No architecture drift detected."
