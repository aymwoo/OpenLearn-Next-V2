#!/usr/bin/env bash
# 本地夹具：不访问 GitHub / Gitee。覆盖对齐、GitHub 领先、分叉、快进，以及「不推送」的证据。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/sync-github-from-gitee.sh"
NEW_WF="$ROOT/.github/workflows/sync-github-from-gitee.yml"
OLD_WF="$ROOT/.github/workflows/sync-gitee-mirror.yml"
OLD_SCRIPT="$ROOT/.github/scripts/sync-gitee-mirror.sh"

if [ ! -f "$SCRIPT" ] || [ ! -f "$NEW_WF" ] || [ ! -f "$OLD_WF" ] || [ ! -f "$OLD_SCRIPT" ]; then
  echo 'missing sync files' >&2
  exit 1
fi

EMPTY_CONFIG="$(mktemp)"
export GIT_CONFIG_GLOBAL="$EMPTY_CONFIG"
export GIT_CONFIG_SYSTEM="$EMPTY_CONFIG"
export GIT_TERMINAL_PROMPT=0
export SYNC_FETCH_RETRIES=1

cleanup() {
  if [ -n "${KEEP_TMP:-}" ]; then
    return 0
  fi
  rm -rf "${TMP_DIRS[@]:-}"
  rm -f "$EMPTY_CONFIG"
}
TMP_DIRS=()
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_static_policy() {
  if grep -nE -- '--force|force-with-lease|\+refs/' "$SCRIPT" "$NEW_WF"; then
    fail 'reverse sync contains a forbidden update flag'
  fi

  if grep -n 'git push' "$SCRIPT" | grep -v 'git push origin "${gitee_sha}:refs/heads/main"'; then
    fail 'git push is not the fast-forward refspec'
  fi
  if ! grep -q 'git push origin "${gitee_sha}:refs/heads/main"' "$SCRIPT"; then
    fail 'expected an origin fast-forward push'
  fi

  if grep -E 'github\.event|client_payload|CLIENT_PAYLOAD' "$SCRIPT"; then
    fail 'sync script reads the dispatch payload'
  fi
  if awk '
    /^[[:space:]]*#/ { next }
    /client_payload|github\.event/ { found=1 }
    END { exit found ? 0 : 1 }
  ' "$NEW_WF"; then
    fail 'workflow consumes the dispatch payload'
  fi

  if grep -nE '^[[:space:]]*continue-on-error:' "$NEW_WF"; then
    fail 'reverse workflow must fail the run'
  fi
  if ! grep -F -q "cron: '47 */6 * * *'" "$NEW_WF"; then
    fail 'reverse cron is not offset to minute 47'
  fi
  if ! grep -F -q "cron: '17 */6 * * *'" "$OLD_WF"; then
    fail 'existing GitHub→Gitee cron was changed'
  fi
  if ! grep -q 'types: \[gitee_push\]' "$NEW_WF"; then
    fail 'missing repository_dispatch type gitee_push'
  fi
  if ! grep -q 'workflow_dispatch:' "$NEW_WF"; then
    fail 'missing workflow_dispatch'
  fi
  if ! grep -q 'contents: write' "$NEW_WF"; then
    fail 'missing contents: write'
  fi
  if awk '
    $0 ~ /^on:/ { in_on=1; next }
    $0 ~ /^(concurrency|permissions|jobs):/ { in_on=0 }
    in_on && $0 ~ /^[[:space:]]*push:/ { found=1 }
    END { exit found ? 0 : 1 }
  ' "$NEW_WF"; then
    fail 'reverse workflow must not trigger on push'
  fi
  if ! grep -q 'push gitee HEAD:main' "$OLD_SCRIPT"; then
    fail 'existing GitHub→Gitee push command was changed'
  fi
  echo 'ok static-policy'
}

new_tmp() {
  local dir
  dir="$(mktemp -d)"
  TMP_DIRS+=("$dir")
  printf '%s\n' "$dir"
}

gitc() {
  git -c user.email=sync-test@example.com -c user.name='Sync Test' "$@"
}

setup_pair() {
  local root seed
  root="$(new_tmp)"
  seed="$root/seed"
  git init -q -b main "$seed"
  echo base > "$seed/marker.txt"
  git -C "$seed" add marker.txt
  gitc -C "$seed" commit -q -m base
  git clone -q --bare "$seed" "$root/github.git"
  git clone -q --bare "$seed" "$root/gitee.git"
  git clone -q "$root/github.git" "$root/work"
  cat > "$root/github.git/hooks/pre-receive" << 'EOF'
#!/bin/sh
if [ -n "${GITHUB_PUSH_LOG:-}" ]; then
  cat >> "$GITHUB_PUSH_LOG"
else
  cat >/dev/null
fi
exit 0
EOF
  chmod +x "$root/github.git/hooks/pre-receive"
  : > "$root/pushes.log"
  FIX_ROOT="$root"
  FIX_LOG="$root/pushes.log"
  (
    cd "$root/work"
    env -u GITEE_TOKEN -u GITEE_USER -u GITEE_AUTH \
      GITEE_REPO="$root/gitee.git" \
      GITHUB_ENV="$root/github.env" \
      bash "$SCRIPT" prepare >/dev/null
  )
}

advance() {
  local bare="$1"
  local marker="$2"
  local tmp repo
  tmp="$(new_tmp)"
  repo="$tmp/repo"
  git clone -q "$bare" "$repo"
  echo "$marker" >> "$repo/marker.txt"
  git -C "$repo" add marker.txt
  gitc -C "$repo" commit -q -m "$marker"
  if [ "${3:-}" = 'tag' ]; then
    git -C "$repo" tag "tag-$marker"
    git -C "$repo" push -q origin "refs/tags/tag-$marker"
  fi
  git -C "$repo" push -q origin HEAD:refs/heads/main
}

run_sync() {
  local status output
  set +e
  output="$(
    cd "$FIX_ROOT/work"
    env -u GITEE_TOKEN -u GITEE_USER \
      GITEE_REPO="$FIX_ROOT/gitee.git" \
      GITHUB_PUSH_LOG="$FIX_LOG" \
      SYNC_FETCH_RETRIES=1 \
      ${EXTRA_ENV:-} \
      bash "$SCRIPT" sync 2>&1
  )"
  status=$?
  set -e
  LAST_OUTPUT="$output"
  LAST_STATUS="$status"
}

push_count() {
  if [ ! -s "$FIX_LOG" ]; then
    printf '0\n'
    return 0
  fi
  wc -l < "$FIX_LOG" | tr -d ' '
}

github_sha() {
  git -C "$FIX_ROOT/github.git" rev-parse refs/heads/main
}

assert_static_policy

# 两侧相同：不推送。这是防止和 GitHub→Gitee 工作流打转的空操作。
setup_pair
before="$(github_sha)"
EXTRA_ENV= run_sync
[ "$LAST_STATUS" -eq 0 ] || fail "equal sync failed: $LAST_OUTPUT"
printf '%s\n' "$LAST_OUTPUT" | grep -q 'SYNC_STATE=equal' || fail "equal state missing: $LAST_OUTPUT"
[ "$(push_count)" -eq 0 ] || fail 'equal case pushed'
[ "$(github_sha)" = "$before" ] || fail 'equal case moved GitHub main'
echo 'ok loop-safe-when-equal'

# GitHub 领先：不把 Gitee 的旧尖端推回 GitHub。
setup_pair
advance "$FIX_ROOT/github.git" github-only
before="$(github_sha)"
EXTRA_ENV= run_sync
[ "$LAST_STATUS" -eq 0 ] || fail "github-ahead sync failed: $LAST_OUTPUT"
printf '%s\n' "$LAST_OUTPUT" | grep -q 'SYNC_STATE=github-ahead' || fail "github-ahead state missing: $LAST_OUTPUT"
[ "$(push_count)" -eq 0 ] || fail 'github-ahead case pushed'
[ "$(github_sha)" = "$before" ] || fail 'github-ahead case moved GitHub main'
echo 'ok github-ahead-does-not-push'

# 分叉：失败，且 GitHub main 不变。
setup_pair
advance "$FIX_ROOT/github.git" github-side
advance "$FIX_ROOT/gitee.git" gitee-side
before="$(github_sha)"
EXTRA_ENV= run_sync
[ "$LAST_STATUS" -ne 0 ] || fail "diverged sync succeeded: $LAST_OUTPUT"
printf '%s\n' "$LAST_OUTPUT" | grep -q '分叉' || fail "diverged message missing: $LAST_OUTPUT"
[ "$(push_count)" -eq 0 ] || fail 'diverged case pushed'
[ "$(github_sha)" = "$before" ] || fail 'diverged case moved GitHub main'
echo 'ok diverged-fails-without-push'

# Gitee 领先：快进一次。标签不跟着走。再跑一次必须变成空操作。
setup_pair
advance "$FIX_ROOT/gitee.git" gitee-ahead tag
gitee_tip="$(git -C "$FIX_ROOT/gitee.git" rev-parse refs/heads/main)"
EXTRA_ENV='GITEE_AUTH=dXNlcjp0b2tlbg==' run_sync
[ "$LAST_STATUS" -eq 0 ] || fail "fast-forward sync failed: $LAST_OUTPUT"
printf '%s\n' "$LAST_OUTPUT" | grep -q 'SYNC_STATE=fast-forward' || fail "fast-forward state missing: $LAST_OUTPUT"
[ "$(github_sha)" = "$gitee_tip" ] || fail 'GitHub main did not fast-forward to Gitee'
[ "$(push_count)" -eq 1 ] || fail "expected one push, got $(push_count)"
base_sha="$(git -C "$FIX_ROOT/seed" rev-parse HEAD)"
set +e
rewind="$(
  cd "$FIX_ROOT/work"
  GITHUB_PUSH_LOG="$FIX_LOG" git push origin "${base_sha}:refs/heads/main" 2>&1
)"
rewind_status=$?
set -e
[ "$rewind_status" -ne 0 ] || fail "non-fast-forward push was accepted: $rewind"
[ "$(github_sha)" = "$gitee_tip" ] || fail 'rejected rewind still moved GitHub main'
[ "$(push_count)" -eq 1 ] || fail 'rejected rewind was recorded as an update'
if git -C "$FIX_ROOT/github.git" rev-parse --verify --quiet refs/tags/tag-gitee-ahead >/dev/null; then
  fail 'tag was copied onto GitHub'
fi
EXTRA_ENV= run_sync
[ "$LAST_STATUS" -eq 0 ] || fail "second sync failed: $LAST_OUTPUT"
printf '%s\n' "$LAST_OUTPUT" | grep -q 'SYNC_STATE=equal' || fail "second sync was not a no-op: $LAST_OUTPUT"
[ "$(push_count)" -eq 1 ] || fail 'second sync pushed again'
[ "$(github_sha)" = "$gitee_tip" ] || fail 'second sync moved GitHub main'
echo 'ok fast-forward-once-then-equal'

# Gitee 没有 main：失败，不推送。
setup_pair
rm -rf "$FIX_ROOT/gitee.git"
git init -q --bare -b main "$FIX_ROOT/gitee.git"
before="$(github_sha)"
(
  cd "$FIX_ROOT/work"
  env -u GITEE_TOKEN -u GITEE_USER -u GITEE_AUTH \
    GITEE_REPO="$FIX_ROOT/gitee.git" \
    GITHUB_ENV="$FIX_ROOT/github.env" \
    bash "$SCRIPT" prepare >/dev/null
)
EXTRA_ENV= run_sync
[ "$LAST_STATUS" -ne 0 ] || fail "missing gitee main succeeded: $LAST_OUTPUT"
printf '%s\n' "$LAST_OUTPUT" | grep -q '读取 gitee main 失败' || fail "missing main message: $LAST_OUTPUT"
[ "$(push_count)" -eq 0 ] || fail 'missing main case pushed'
[ "$(github_sha)" = "$before" ] || fail 'missing main case moved GitHub main'
echo 'ok missing-gitee-main-fails'

# prepare 不把令牌写进标准输出或除 GITEE_AUTH 以外的环境记录。
secret_root="$(new_tmp)"
git init -q -b main "$secret_root/repo"
secret_env="$secret_root/github.env"
secret_out="$(
  cd "$secret_root/repo"
  GITEE_USER=aymwoo GITEE_TOKEN='super-secret-token' \
    GITEE_REPO="$secret_root/unused.git" \
    GITHUB_ENV="$secret_env" \
    bash "$SCRIPT" prepare 2>&1
)"
if printf '%s\n' "$secret_out" | grep -q 'super-secret-token'; then
  fail 'prepare printed the token'
fi
if grep -q 'super-secret-token' "$secret_env"; then
  fail 'GITHUB_ENV stored the raw token'
fi
grep -q '^GITEE_AUTH_MODE=token$' "$secret_env" || fail 'token mode not recorded'
decoded="$(awk -F= '/^GITEE_AUTH=/{print substr($0, index($0, "=") + 1)}' "$secret_env" | base64 -d)"
[ "$decoded" = 'aymwoo:super-secret-token' ] || fail "auth header decoded to $decoded"
echo 'ok token-not-logged'

summary_root="$(new_tmp)"
summary_file="$summary_root/summary.md"
GITHUB_STEP_SUMMARY="$summary_file" \
  OUTCOME_PREPARE=success \
  OUTCOME_SYNC=success \
  SYNC_STATE=equal \
  SYNC_DETAIL='两侧 main 同为 abc，不推送。' \
  bash "$SCRIPT" summary >/dev/null
grep -q '已对齐（空操作）' "$summary_file" || fail 'summary missing equal state'
echo 'ok summary-equal'

summary_fail="$summary_root/fail.md"
set +e
fail_out="$(
  GITHUB_STEP_SUMMARY="$summary_fail" \
    OUTCOME_PREPARE=success \
    OUTCOME_SYNC=failure \
    bash "$SCRIPT" summary 2>&1
)"
fail_status=$?
set -e
[ "$fail_status" -eq 0 ] || fail "summary changed the failed-step result: $fail_out"
grep -q '失败' "$summary_fail" || fail 'summary missing failure'
printf '%s\n' "$fail_out" | grep -q 'Gitee → GitHub 快进失败' || fail "summary annotation missing: $fail_out"
echo 'ok summary-failure'

echo 'all sync-github-from-gitee cases passed'
