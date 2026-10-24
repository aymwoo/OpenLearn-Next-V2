#!/usr/bin/env bash
# Per-PR merge workflow for openlearnv2.
#   usage: pr.sh <pr-number> <head-branch>
# Steps: merge origin/main into the PR branch, prettier-format the PR's own
# files, then report prettier / eslint / tsc status.
set -uo pipefail
export PATH="/home/wuxf/.local/share/fnm/node-versions/v24.1.0/installation/bin:$PATH"
cd /tmp/ol-merge

PR=$1
BR=$2
LOCAL="work-$PR"

git checkout -q main && git reset -q --hard origin/main
git checkout -q -B "$LOCAL" "origin/$BR"
git reset -q --hard "origin/$BR"

echo "--- merging origin/main into $BR ---"
git merge --no-commit --no-ff origin/main >/tmp/ol-merge/.m-$PR.log 2>&1
rc=$?
if [ $rc -ne 0 ]; then
  echo "CONFLICTS:"
  git diff --name-only --diff-filter=U | sed 's/^/  /'
  exit 10
fi
git commit -q --no-verify -m "chore: merge main into $BR" 2>/dev/null

# The PR's own files (vs the PR's original base) are what CI's Format check inspects.
FILES=$(git diff --name-only "origin/$BR...HEAD~1" 2>/dev/null | grep -E '\.(ts|tsx|md|mjs|js|json|yml|yaml|css)$' | tr '\n' ' ')
PRFILES=$(git diff --name-only "$(git merge-base origin/$BR origin/main)" "origin/$BR" | grep -E '\.(ts|tsx|md|mjs|js|json|yml|yaml|css)$' | tr '\n' ' ')

echo "--- prettier --write on PR files ---"
npx prettier --write $PRFILES 2>&1 | grep -vE '^(npm warn|.*ms$|$)' | tail -8
git add -A && git commit -q --no-verify -m "style: prettier" 2>/dev/null

echo "--- prettier --check ---"
npx prettier --check $PRFILES 2>&1 | grep -vE '^npm warn' | tail -4

echo "--- eslint delta (PR files vs main baseline) ---"
npx eslint $PRFILES --format json 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const main=require('/tmp/ol-merge/.main-per-file.json');
  const j=JSON.parse(s); let d=0;
  for(const f of j){const rel=f.filePath.replace('/tmp/ol-merge/','');
    const b=main[rel]||0, n=f.messages.length;
    if(n!==b){d+=n-b;
      const rules={}; for(const m of f.messages) rules[m.ruleId]=(rules[m.ruleId]||0)+1;
      console.log('   '+rel+': '+b+' -> '+n+'  {'+Object.entries(rules).map(([k,v])=>k+'x'+v).join(', ')+'}');}}
  console.log('   netDelta='+d+' (must be 0)');});"
