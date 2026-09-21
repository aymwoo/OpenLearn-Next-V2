#!/usr/bin/env bash
# Run the docs-vs-code architecture drift audit.
# Exit code 0 = no drift, 1 = drift detected (or pipeline error).
set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

OUT_DIR="audit-tools/reports"
EXTRACT_JSON="${OUT_DIR}/extracts.json"
DRIFT_MD="${OUT_DIR}/drift_report.md"
DRIFT_JSON="${OUT_DIR}/drift_report.json"

mkdir -p "${OUT_DIR}"

python3 audit-tools/extractors.py \
  --docs docs \
  --packages . \
  --out "${EXTRACT_JSON}"

python3 audit-tools/aligner.py \
  --extracts "${EXTRACT_JSON}" \
  --out-md "${DRIFT_MD}" \
  --out-json "${DRIFT_JSON}"

# Parse drift count from the human-readable report header.
# Format: "实际 drift 项: **N**"
DRIFT_COUNT=$(grep -E "实际 drift 项" "${DRIFT_MD}" | grep -oE "[0-9]+" || echo "0")

echo "drift_count=${DRIFT_COUNT}"

if [ "${DRIFT_COUNT}" -gt 0 ]; then
  echo "::error::Architecture docs drift detected: ${DRIFT_COUNT} item(s). See ${DRIFT_MD}."
  exit 1
fi

echo "✅ No architecture drift detected."
