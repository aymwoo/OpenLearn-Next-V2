#!/usr/bin/env bash
# Gitee main → GitHub main，只快进。
# 由 .github/workflows/sync-github-from-gitee.yml 调用。
#
# 抽成独立脚本，避免 Actions 把多行 run: 源码逐行回显进日志。
#
# 子命令：
#   prepare  配置名为 gitee 的远端。两个 Secret 都在时用 Basic 头，否则匿名读取。
#   sync     读取两侧 main，再决定空操作、快进或失败。
#   summary  把结果写入 Step Summary。失败步骤的环境变量不会带过来，结论以 outcome 为准。
#
# 判定（只看刚 fetch 到的两个 main，不看工作区 HEAD，也不看调度事件附带的字段）：
#   · SHA 相同            → 空操作，不推送（避免和 GitHub→Gitee 工作流来回触发）
#   · GitHub 是 Gitee 的祖先 → 把 GitHub main 快进到 Gitee 的 SHA
#   · Gitee 是 GitHub 的祖先 → 空操作（GitHub 领先，交给另一条工作流）
#   · 互不为祖先          → 失败退出，不推送
#
# 凭据只经 http.extraheader 传递，不写入 git config，不放进远端 URL。
# 推送目标固定为 origin 的 refs/heads/main。refspec 没有前导加号，命令也不带
# 强制更新参数，因此 Git 会拒绝非快进。不使用较新版本才提供的 push 快进开关：
# Git 2.43（托管运行器上常见）会把那个开关当成未知参数，快进本身就会失败。
set -euo pipefail

DEFAULT_GITEE_REPO='https://gitee.com/aymwoo/openlearn-next.git'
# 测试夹具会把 GITEE_REPO 指到本地裸仓库。工作流不设置它。
GITEE_REPO="${GITEE_REPO:-$DEFAULT_GITEE_REPO}"
FETCH_RETRIES="${SYNC_FETCH_RETRIES:-3}"

auth_header() {
  printf 'Authorization: Basic %s' "$GITEE_AUTH"
}

# 单行、去掉 URL 里的 userinfo，避免失败日志带出令牌或伪造工作流命令。
plain() {
  local text
  text="$(printf '%s' "$1" | tr '\r\n' '  ')"
  text="$(printf '%s' "$text" | sed -E 's#https://[^[:space:]@]+@#https://***@#g')"
  text="${text//|//}"
  text="${text//::/：}"
  printf '%s' "${text:0:400}"
}

write_env() {
  local key="$1"
  local value="$2"
  # GITEE_AUTH 是凭据，只进 GITHUB_ENV，不进日志。
  if [ "$key" != 'GITEE_AUTH' ]; then
    printf '%s=%s\n' "$key" "$value"
  fi
  if [ -n "${GITHUB_ENV:-}" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_ENV"
  fi
}

git_gitee() {
  if [ -n "${GITEE_AUTH:-}" ]; then
    git -c "http.extraheader=$(auth_header)" "$@"
  else
    git "$@"
  fi
}

retry() {
  local attempt=1
  local max="$FETCH_RETRIES"
  if ! printf '%s' "$max" | grep -Eq '^[1-9][0-9]*$'; then
    max=3
  fi
  while true; do
    if "$@"; then
      return 0
    fi
    if [ "$attempt" -ge "$max" ]; then
      return 1
    fi
    sleep $((attempt * 2))
    attempt=$((attempt + 1))
  done
}

require_sha() {
  local label="$1"
  local sha="$2"
  if ! printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
    fail "${label} 不是 40 位提交号" "$(plain "$sha")"
  fi
}

is_ancestor() {
  local status=0
  git merge-base --is-ancestor "$1" "$2" || status=$?
  MERGE_BASE_STATUS=$status
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  if [ "$status" -eq 1 ]; then
    return 1
  fi
  return 2
}

classify() {
  local github_sha="$1"
  local gitee_sha="$2"
  local status=0
  if [ "$github_sha" = "$gitee_sha" ]; then
    printf 'equal\n'
    return 0
  fi
  is_ancestor "$github_sha" "$gitee_sha" || status=$?
  if [ "$status" -eq 2 ]; then
    printf 'error:%s\n' "$MERGE_BASE_STATUS"
    return 0
  fi
  if [ "$status" -eq 0 ]; then
    printf 'fast-forward\n'
    return 0
  fi
  status=0
  is_ancestor "$gitee_sha" "$github_sha" || status=$?
  if [ "$status" -eq 2 ]; then
    printf 'error:%s\n' "$MERGE_BASE_STATUS"
    return 0
  fi
  if [ "$status" -eq 0 ]; then
    printf 'github-ahead\n'
    return 0
  fi
  printf 'diverged\n'
}

fail() {
  local title="$1"
  local detail
  detail="$(plain "$2")"
  echo "::error title=${title}::${detail}"
  write_env SYNC_STATE failed
  write_env SYNC_DETAIL "$detail"
  exit 1
}

cmd_prepare() {
  if git remote get-url gitee >/dev/null 2>&1; then
    git remote set-url gitee "$GITEE_REPO"
  else
    git remote add gitee "$GITEE_REPO"
  fi

  if [ -n "${GITEE_TOKEN:-}" ] && [ -n "${GITEE_USER:-}" ]; then
    local encoded
    encoded="$(printf '%s' "$GITEE_USER:$GITEE_TOKEN" | base64 -w0)"
    write_env GITEE_AUTH "$encoded"
    write_env GITEE_AUTH_MODE token
    return 0
  fi

  write_env GITEE_AUTH_MODE anonymous
  echo '::notice title=匿名读取 Gitee::未同时配置 GITEE_TOKEN 与 GITEE_USERNAME。公开仓库可以匿名 fetch；私有仓库请复用这两个已有 Secret。'
}

fetch_main() {
  local which="$1"
  local log status
  set +e
  if [ "$which" = 'gitee' ]; then
    log="$(retry git_gitee fetch gitee 'refs/heads/main:refs/remotes/gitee/main' 2>&1)"
  else
    log="$(retry git fetch origin 'refs/heads/main:refs/remotes/origin/main' 2>&1)"
  fi
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    fail "读取 ${which} main 失败" "${log:-git fetch 失败，且没有输出。}"
  fi
}

fast_forward() {
  local gitee_sha="$1"
  local err status relation new_sha
  set +e
  err="$(git push origin "${gitee_sha}:refs/heads/main" 2>&1)"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    set +e
    git fetch origin 'refs/heads/main:refs/remotes/origin/main' >/dev/null 2>&1
    set -e
    new_sha="$(git rev-parse refs/remotes/origin/main)"
    require_sha 'GitHub main' "$new_sha"
    relation="$(classify "$new_sha" "$gitee_sha")"
    case "$relation" in
      equal)
        write_env SYNC_STATE equal
        write_env SYNC_DETAIL "推送前 GitHub main 已是 ${gitee_sha}，不再推送。"
        echo "✅ GitHub main 已与 Gitee 对齐（${gitee_sha:0:7}），空操作。"
        return 0
        ;;
      github-ahead)
        write_env SYNC_STATE github-ahead
        write_env SYNC_DETAIL "快进被拒绝时 GitHub main ${new_sha} 已领先 Gitee ${gitee_sha}，不再推送。"
        echo "✅ GitHub main 已领先（${new_sha:0:7}），本次不推送。"
        return 0
        ;;
      error:*)
        fail '无法计算祖先关系' "git merge-base 退出 ${relation#error:}。已停止，不会推送。"
        ;;
      fast-forward)
        set +e
        err="$(git push origin "${gitee_sha}:refs/heads/main" 2>&1)"
        status=$?
        set -e
        if [ "$status" -ne 0 ]; then
          fail '快进 GitHub main 被拒绝' "${err:-没有输出。} 常见原因是 GITHUB_TOKEN 没有内容写权限，或 main 的规则拦住了 github-actions[bot]。本次没有改写历史。"
        fi
        ;;
      diverged)
        fail 'main 历史已分叉' "推送被拒绝，且 GitHub main ${new_sha} 与 Gitee main ${gitee_sha} 互不为祖先。已停止，不会推送。"
        ;;
      *)
        fail '无法判断 main 关系' "relation=${relation}"
        ;;
    esac
  fi

  local actual
  actual="$(git ls-remote origin refs/heads/main | awk 'NR==1 { print $1 }')"
  if [ "$actual" != "$gitee_sha" ]; then
    fail '复核失败' "期望 GitHub main 为 ${gitee_sha}，实际 ${actual:-空}。"
  fi
  write_env SYNC_STATE fast-forward
  write_env SYNC_DETAIL "已将 GitHub main 快进到 ${gitee_sha}。"
  echo "✅ 已快进 GitHub main → ${gitee_sha:0:7}"
}

cmd_sync() {
  fetch_main gitee
  fetch_main origin

  local github_sha gitee_sha relation
  github_sha="$(git rev-parse refs/remotes/origin/main)"
  gitee_sha="$(git rev-parse refs/remotes/gitee/main)"
  require_sha 'GitHub main' "$github_sha"
  require_sha 'Gitee main' "$gitee_sha"
  relation="$(classify "$github_sha" "$gitee_sha")"

  case "$relation" in
    equal)
      write_env SYNC_STATE equal
      write_env SYNC_DETAIL "两侧 main 同为 ${github_sha}，不推送。"
      echo "✅ 两侧 main 已一致（${github_sha:0:7}），空操作，不推送。"
      ;;
    github-ahead)
      write_env SYNC_STATE github-ahead
      write_env SYNC_DETAIL "GitHub main ${github_sha} 领先 Gitee main ${gitee_sha}，反向同步不推送。"
      echo "✅ GitHub main 领先（${github_sha:0:7}），留给 GitHub→Gitee 工作流，本次不推送。"
      ;;
    fast-forward)
      fast_forward "$gitee_sha"
      ;;
    diverged)
      fail 'main 历史已分叉' "GitHub main ${github_sha} 与 Gitee main ${gitee_sha} 互不为祖先。已停止，不会推送。"
      ;;
    error:*)
      fail '无法计算祖先关系' "git merge-base 退出 ${relation#error:}。已停止，不会推送。"
      ;;
    *)
      fail '无法判断 main 关系' "relation=${relation}"
      ;;
  esac
}

cmd_summary() {
  local prepare_o="${OUTCOME_PREPARE:-skipped}"
  local sync_o="${OUTCOME_SYNC:-skipped}"
  local state="${SYNC_STATE:-}"
  local detail
  detail="$(plain "${SYNC_DETAIL:-}")"
  local label

  if [ "$prepare_o" = 'failure' ] || [ "$sync_o" = 'failure' ] || [ "$state" = 'failed' ]; then
    label='❌ 失败'
    if [ -z "$detail" ]; then
      detail="准备=${prepare_o}、快进判定=${sync_o}。分叉、读取失败或快进被拒绝时都不会推送。"
    fi
  elif [ "$state" = 'equal' ]; then
    label='✅ 已对齐（空操作）'
  elif [ "$state" = 'github-ahead' ]; then
    label='✅ GitHub 领先（空操作）'
  elif [ "$state" = 'fast-forward' ]; then
    label='✅ 已快进'
  else
    label='❌ 失败'
    detail="准备=${prepare_o}、快进判定=${sync_o}、状态=${state:-空}。没有可确认的快进结果。"
  fi

  {
    echo '## Gitee → GitHub main 快进结果'
    echo
    echo '| 结果 | 说明 |'
    echo '| --- | --- |'
    echo "| ${label} | ${detail:-（无）} |"
    echo
    echo '| 步骤 | outcome |'
    echo '| --- | --- |'
    echo "| 准备 Gitee 远端 | \`${prepare_o}\` |"
    echo "| 快进判定 | \`${sync_o}\` |"
    echo
    echo '本工作流没有 continue-on-error。运行结论为失败，就表示没有快进 GitHub main。'
    echo
    echo '两侧 SHA 相同时空操作，不推送，因此不会和「GitHub → Gitee」工作流循环触发。'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

  if [ "$label" = '❌ 失败' ]; then
    echo "::error title=Gitee → GitHub 快进失败::${detail}"
    if [ "$prepare_o" != 'failure' ] && [ "$sync_o" != 'failure' ]; then
      exit 1
    fi
  fi
}

case "${1:-}" in
  prepare) cmd_prepare ;;
  sync) cmd_sync ;;
  summary) cmd_summary ;;
  *)
    echo "usage: $0 {prepare|sync|summary}" >&2
    exit 2
    ;;
esac
