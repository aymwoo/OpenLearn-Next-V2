#!/usr/bin/env bash
# List the no-explicit-any warnings (with source lines) introduced by a PR.
#   usage: anys.sh <pr:branch>
set -uo pipefail
export PATH="/home/wuxf/.local/share/fnm/node-versions/v24.1.0/installation/bin:$PATH"
cd /tmp/ol-merge
PR="${1%%:*}"; BR="${1##*:}"
git checkout -q -B "an-$PR" "origin/$BR" && git reset -q --hard "origin/$BR"
BASE=$(git merge-base "origin/$BR" origin/main)
TSFILES=$(git diff --name-only "$BASE" "origin/$BR" | grep -E '\.(ts|tsx)$' | tr '\n' ' ')
npx eslint $TSFILES --format json 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const main=require('/tmp/ol-data/main-per-file.json');
  const j=JSON.parse(s);
  for(const f of j){
    const rel=f.filePath.replace('/tmp/ol-merge/','');
    const base=main[rel]||0;
    const anys=f.messages.filter(m=>m.ruleId==='@typescript-eslint/no-explicit-any');
    if(anys.length<=base) continue;
    console.log('### '+rel+'  (base '+base+', now '+f.messages.length+')');
    for(const m of anys){
      const line=(f.source||'').split('\n')[m.line-1]||'';
      console.log('  L'+m.line+': '+line.trim());
    }
  }
});"
git checkout -q main && git reset -q --hard origin/main
