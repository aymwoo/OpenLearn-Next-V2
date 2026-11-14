#!/usr/bin/env bash
# Gitee 镜像单向快进 —— 由 .github/workflows/sync-gitee-mirror.yml 调用。
#
# 抽成独立脚本而非 workflow 内的多行 `run:` 块，是为了避免 GitHub Actions
# 把脚本源码逐行回显进日志：回显里会出现 `SKIP_SYNC=1`、`::error` 等字面量，
# 看起来像真的报了错，实际只是脚本文本，极易误判同步结果。
#
# 子命令：
#   prepare  准备远端与凭据；Secret 缺失时置 SKIP_SYNC=1
#   push     只快进 main 与 tag（镜像 main 必须是 HEAD 的祖先，绝不 force-push）
#   verify   回读远端 main 并与 github.sha 比对
#   summary  汇总三态结果到 $GITHUB_STEP_SUMMARY，失败时打 ::error
#
# 所有凭据仅通过 GITEE_AUTH（Basic base64）经 http.extraheader 传递，
# 不写入 .git/config、不出现在命令行参数里。
set -euo pipefail

GITEE_REPO='https://gitee.com/aymwoo/openlearn-next.git'

auth_header() {
  printf 'Authorization: Basic %s' "$GITEE_AUTH"
}

cmd_prepare() {
  if [ -z "${GITEE_TOKEN:-}" ] || [ -z "${GITEE_USER:-}" ]; then
    echo 'SKIP_SYNC=1' >> "$GITHUB_ENV"
    echo '::notice title=跳过镜像同步::未配置 GITEE_TOKEN / GITEE_USERNAME secret。镜像同步是可选项，未配置不影响主干 CI。配置方法见 workflow 文件头部注释。'
    exit 0
  fi
  git remote add gitee "$GITEE_REPO"
  local encoded
  encoded="$(printf '%s' "$GITEE_USER:$GITEE_TOKEN" | base64 -w0)"
  echo "GITEE_AUTH=$encoded" >> "$GITHUB_ENV"
}

cmd_push() {
  # 防御误触发：workflow_dispatch 可用 --ref <非默认分支> 触发，此时 github.sha
  # 是该分支 HEAD；若放行会把未合并的 PR 提交快进到镜像（main 恰好是其祖先，
  # 祖先校验拦不住）。本 workflow 只负责把 GitHub main 推往 Gitee。
  if [ "${GITHUB_REF:-}" != 'refs/heads/main' ]; then
    echo "::error title=拒绝同步非 main 引用::当前 GITHUB_REF=${GITHUB_REF:-<空>} 不是 refs/heads/main。本 workflow 只把 GitHub main 快进到 Gitee 镜像，拒绝把分支 / PR 提交写入镜像；请在 main 上触发。"
    exit 1
  fi

  local auth
  auth="$(auth_header)"
  git -c http.extraheader="$auth" fetch gitee --tags --prune --force

  # 铁律 ②：只快进。镜像的 main 必须是当前 HEAD 的祖先，否则停下来交给人。
  if git rev-parse --verify --quiet gitee/main >/dev/null; then
    if ! git merge-base --is-ancestor gitee/main HEAD; then
      echo '::error title=镜像分叉，已停止同步::Gitee 镜像的 main 不是当前 HEAD 的祖先（镜像可能被改写或回退）。已停止，绝不 force-push。请人工核对镜像历史后再决定如何处理。'
      exit 1
    fi
  fi

  git -c http.extraheader="$auth" push gitee HEAD:main
  git -c http.extraheader="$auth" push gitee --tags
  echo "✅ 已推送 $(git rev-parse --short HEAD)"
}

cmd_verify() {
  local auth actual expected
  auth="$(auth_header)"
  expected="${EXPECTED:-$(git rev-parse HEAD)}"
  actual="$(git -c http.extraheader="$auth" ls-remote gitee refs/heads/main | cut -f1)"
  if [ "$actual" != "$expected" ]; then
    echo "::error title=镜像未对齐::期望 $expected，实际 $actual"
    exit 1
  fi
  echo "✅ 镜像 main = ${actual:0:7}（与 GitHub main 一致）"
}

# 三态：skipped（未配 Secret） / success / failure。
# job 级 continue-on-error 会把失败吞成 success，所以结果必须由本步骤显式写进
# Step Summary 并打 annotation，否则从 run 结论上看不出同步到底有没有成功。
cmd_summary() {
  local prepare_o="${OUTCOME_PREPARE:-skipped}"
  local push_o="${OUTCOME_PUSH:-skipped}"
  local verify_o="${OUTCOME_VERIFY:-skipped}"
  local state detail

  if [ "${SKIP_SYNC:-0}" = '1' ]; then
    state='⏭️ 已跳过'
    detail='未配置 `GITEE_TOKEN` / `GITEE_USERNAME`，本次未连接 Gitee。配置方法见 workflow 文件头部注释。'
  elif [ "$prepare_o" = 'success' ] && [ "$push_o" = 'success' ] && [ "$verify_o" = 'success' ]; then
    state='✅ 成功'
    detail="GitHub main 已快进到 Gitee 镜像（HEAD ${EXPECTED:-}），tag 同步完成。"
  else
    state='❌ 失败'
    detail="准备凭据=${prepare_o}、快进=${push_o}、复核=${verify_o}。本次未确认镜像对齐，6 小时 cron 会自动重试。"
  fi

  {
    echo '## Gitee 镜像同步结果'
    echo
    echo "| 结果 | 说明 |"
    echo '| --- | --- |'
    echo "| ${state} | ${detail} |"
    echo
    echo '| 步骤 | outcome |'
    echo '| --- | --- |'
    echo "| 准备远端与凭据 | \`${prepare_o}\` |"
    echo "| 快进 main 与 tag | \`${push_o}\` |"
    echo "| 复核镜像 HEAD | \`${verify_o}\` |"
    echo
    if [ "$state" = '❌ 失败' ]; then
      echo '**常见原因**：Gitee 网络瞬断（`Recv failure: Connection reset by peer`，重试通常即可恢复）、令牌失效或缺少 `projects` 权限、镜像分叉。'
      echo
      echo '> ⚠️ 本 job 设置了 `continue-on-error`（push / schedule 触发时），因此 run 结论仍可能显示 success；**请以本表的「结果」与 ANNOTATIONS 为准**。手动触发时可用 `strict=true` 让失败直接反映到 run 结论。'
    fi
  } >> "$GITHUB_STEP_SUMMARY"

  if [ "$state" = '❌ 失败' ]; then
    echo "::error title=Gitee 镜像同步失败::${detail}（不影响主干 CI，详见 Step Summary 与「快进 main 与 tag」日志）"
  fi
}

case "${1:-}" in
  prepare) cmd_prepare ;;
  push)    cmd_push ;;
  verify)  cmd_verify ;;
  summary) cmd_summary ;;
  *)
    echo "usage: $0 {prepare|push|verify|summary}" >&2
    exit 2
    ;;
esac
