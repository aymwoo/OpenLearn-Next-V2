#!/usr/bin/env bash
# For each PR: check out its branch, run eslint on the files it touches,
# and report the warning delta vs main for those same files.
set -uo pipefail
cd /tmp/ol-merge

declare -A H=(
  [284]=codebuddy/course-package-any-asset
  [263]=mavis/fix-229-ci-route-scope-gate
  [262]=mavis/fix-228-url-protocol-whitelist
  [261]=mavis/fix-227-user-create-bcrypt
  [260]=mavis/fix-226-unify-admin-role-check
  [259]=mavis/fix-224-plugin-granted-capabilities
  [258]=mavis/fix-225-points-write-capability-block
  [257]=mavis/fix-223-quiz-submit-authz
  [255]=mavis/fix-221-classroom-peer-review-authz
  [253]=mavis/fix-220-preset-polls-lesson-authz
  [249]=mavis/fix-217-peer-review-self-guard
)

# main per-file baseline
git checkout -q main && git reset -q --hard origin/main
npx eslint . --ext .ts,.tsx --ignore-pattern dist --ignore-pattern node_modules --format json 2>/dev/null \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const m={};for(const f of j){if(f.messages.length)m[f.filePath.replace('/tmp/ol-merge/','')]=f.messages.length;}require('fs').writeFileSync('/tmp/ol-merge/.main-per-file.json',JSON.stringify(m));});"

for pr in "$@"; do
  b=${H[$pr]}
  git checkout -q -B "tmp-lint-$pr" "origin/$b"
  git reset -q --hard "origin/$b"
  files=$(git diff --name-only "origin/main...origin/$b" | grep -E '\.tsx?$' | tr '\n' ' ')
  [ -z "$files" ] && { echo "PR $pr: no ts files"; continue; }
  npx eslint $files --format json 2>/dev/null \
  | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const main=require('/tmp/ol-merge/.main-per-file.json');
  const j=JSON.parse(s); const pr=$pr;
  let delta=0; const lines=[];
  for(const f of j){
    const rel=f.filePath.replace('/tmp/ol-merge/','');
    const base=main[rel]||0;
    const now=f.messages.length;
    if(now!==base){delta+=now-base;
      const rules={};
      for(const m of f.messages) rules[m.ruleId]=(rules[m.ruleId]||0)+1;
      lines.push('      '+rel+': '+base+' -> '+now+'  {'+Object.entries(rules).map(([k,v])=>k+'x'+v).join(', ')+'}');
    }
  }
  console.log('PR '+pr+'  netDelta='+delta);
  lines.forEach(l=>console.log(l));
});"
done
git checkout -q main && git reset -q --hard origin/main
for pr in "$@"; do git branch -D "tmp-lint-$pr" >/dev/null 2>&1; done
