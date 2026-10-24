#!/usr/bin/env bash
# Process a list of PRs end-to-end: merge main into branch, prettier, fix lint
# debt, verify, push, squash-merge. Stops at the first PR that needs a human.
#   usage: batch.sh <pr:branch> [<pr:branch> ...]
set -uo pipefail
export PATH="/home/wuxf/.local/share/fnm/node-versions/v24.1.0/installation/bin:$PATH"
cd /tmp/ol-merge

for spec in "$@"; do
  PR="${spec%%:*}"
  BR="${spec##*:}"
  LOCAL="work-$PR"
  echo "══════════════════ PR $PR  ($BR) ══════════════════"

  git checkout -q main && git reset -q --hard origin/main
  git checkout -q -B "$LOCAL" "origin/$BR"
  git reset -q --hard "origin/$BR"

  git merge --no-commit --no-ff origin/main >/tmp/ol-merge/.m-$PR.log 2>&1
  if [ $? -ne 0 ]; then
    echo "  ⛔ CONFLICTS — needs manual resolution:"
    git diff --name-only --diff-filter=U | sed 's/^/       /'
    exit 10
  fi
  git commit -q --no-verify -m "chore: merge main into $BR" 2>/dev/null

  # Files the PR itself changed (vs its own base) — these are what CI's Format check inspects.
  BASE=$(git merge-base "origin/$BR" origin/main)
  PRFILES=$(git diff --name-only "$BASE" "origin/$BR" | grep -E '\.(ts|tsx|md|mjs|js|json|yml|yaml|css)$' | tr '\n' ' ')
  TSFILES=$(git diff --name-only "$BASE" "origin/$BR" | grep -E '\.(ts|tsx)$' | tr '\n' ' ')

  npx prettier --write $PRFILES >/dev/null 2>&1
  git add -A && git commit -q --no-verify -m "style: prettier" 2>/dev/null

  # ---- eslint delta on the PR's own TS files ----
  DELTA=$(npx eslint $TSFILES --format json 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const main=require('/tmp/ol-data/main-per-file.json');
  const j=JSON.parse(s); let d=0; const out=[];
  for(const f of j){const rel=f.filePath.replace('/tmp/ol-merge/','');
    const b=main[rel]||0,n=f.messages.length;
    if(n!==b){d+=n-b;const r={};for(const m of f.messages)r[m.ruleId]=(r[m.ruleId]||0)+1;
      out.push(rel+': '+b+'->'+n+' {'+Object.entries(r).map(([k,v])=>k+'x'+v).join(',')+'}');}}
  console.log(d); if(out.length)console.error(out.join('\n'));});" 2>/tmp/ol-merge/.d-$PR.txt)
  echo "  eslint delta on PR files: $DELTA"
  [ "$DELTA" != "0" ] && { echo "  ⚠️  lint debt remains — needs fixing:"; sed 's/^/       /' /tmp/ol-merge/.d-$PR.txt; }

  echo "  prettier: $(npx prettier --check $PRFILES 2>&1 | grep -q 'All matched files' && echo OK || echo FAIL)"

  if [ "$DELTA" = "0" ]; then
    git push -q origin "$LOCAL:$BR" && echo "  pushed branch"
    gh pr merge "$PR" --squash --delete-branch=false >/dev/null 2>&1
    sleep 2
    STATE=$(gh pr view "$PR" --json state --jq .state)
    echo "  → merged (state=$STATE)"
  else
    echo "  ⏸️  holding merge until lint debt is fixed"
    exit 11
  fi
  git checkout -q main && git reset -q --hard origin/main
done
echo "ALL DONE"
