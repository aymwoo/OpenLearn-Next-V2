#!/usr/bin/env bash
# Install the docs-drift audit as a git pre-commit hook.
# Re-run this script after cloning to enable the check.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_PATH="${REPO_ROOT}/.git/hooks/pre-commit"

if [ -f "${HOOK_PATH}" ] && ! grep -q "audit-tools/run.sh" "${HOOK_PATH}" 2>/dev/null; then
  echo "::warning::Existing pre-commit hook detected at ${HOOK_PATH}."
  echo "         Backing it up to ${HOOK_PATH}.bak and chaining audit-tools/run.sh."
  cp "${HOOK_PATH}" "${HOOK_PATH}.bak"
fi

cat > "${HOOK_PATH}" <<'HOOK'
#!/usr/bin/env bash
# Pre-commit hook: block commits that introduce architecture docs drift.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

# Only run when docs or source code under packages/core/ or src/features/
# is staged. This keeps unrelated commits (style fixes, README typos) fast.
STAGED="$(git diff --cached --name-only)"
if echo "${STAGED}" | grep -qE '^(docs/|packages/core/|src/features/|packages/plugins/)'; then
  echo "[pre-commit] Architecture docs drift audit..."
  if ! bash audit-tools/run.sh; then
    echo ""
    echo "::error::Commit blocked: docs drift detected."
    echo "  Fix the drift (see audit-tools/reports/drift_report.md) and re-commit."
    echo "  To bypass in an emergency: git commit --no-verify"
    exit 1
  fi
fi
HOOK

chmod +x "${HOOK_PATH}"
echo "✅ Installed pre-commit hook at ${HOOK_PATH}"
echo "   Run 'bash audit-tools/run.sh' to verify drift is zero before committing."
