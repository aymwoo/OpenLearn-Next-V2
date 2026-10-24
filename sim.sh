#!/usr/bin/env bash
# Simulate merging a list of PR branches sequentially onto origin/main,
# reporting conflicts per PR. Non-destructive to the real repo.
set -uo pipefail
cd /tmp/ol-merge

declare -A H=(
  [284]=codebuddy/course-package-any-asset
  [270]=mavis/fix-236-prettier-hygiene
  [264]=mavis/fix-230-ci-e2e-full-coverage
  [263]=mavis/fix-229-ci-route-scope-gate
  [262]=mavis/fix-228-url-protocol-whitelist
  [261]=mavis/fix-227-user-create-bcrypt
  [260]=mavis/fix-226-unify-admin-role-check
  [259]=mavis/fix-224-plugin-granted-capabilities
  [258]=mavis/fix-225-points-write-capability-block
  [257]=mavis/fix-223-quiz-submit-authz
  [256]=mavis/fix-222-whiteboard-sync-lesson-filter
  [255]=mavis/fix-221-classroom-peer-review-authz
  [253]=mavis/fix-220-preset-polls-lesson-authz
  [252]=mavis/fix-219-exam-score-academic-year
  [251]=mavis/fix-218-plugin-bundle-path-confinement
  [249]=mavis/fix-217-peer-review-self-guard
)

ORDER=("$@")
SIM=sim-$$
git branch -D "$SIM" >/dev/null 2>&1
git checkout -q -B "$SIM" origin/main

total_conf=0
for pr in "${ORDER[@]}"; do
  b=${H[$pr]}
  git merge --no-commit --no-ff "origin/$b" >/tmp/ol-merge/.merge-$pr.log 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then
    files=$(git diff --name-only --diff-filter=U)
    n=$(echo "$files" | grep -c . || true)
    total_conf=$((total_conf + n))
    echo "PR $pr  -> CONFLICT ($n files)"
    echo "$files" | sed 's/^/      /'
    git merge --abort >/dev/null 2>&1
  else
    echo "PR $pr  -> clean"
    git commit -q --no-verify -m "sim: merge PR $pr" >/dev/null 2>&1
  fi
done
echo "TOTAL_CONFLICT_FILES=$total_conf"
git checkout -q main 2>/dev/null || true
git branch -D "$SIM" >/dev/null 2>&1
