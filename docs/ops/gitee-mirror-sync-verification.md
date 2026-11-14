# Gitee 镜像同步加固验证报告

> **文档标识**: `docs/ops/gitee-mirror-sync-verification.md`  
> **关联 PR**: [#516 chore(gitee-mirror): 让镜像同步失败可见并支持严格模式](https://github.com/aymwoo/OpenLearn-Next-V2/pull/516)  
> **执行日期**: 2026-11-14  
> **验证状态**: ✅ **全项通过 (ALL PASSED)**  
> **最终镜像**: `5d1995d47ca53b4c5c0fcd893a88df7c0f247dbb`

---

## 1. 背景与目标

平台采用 GitHub 主仓 + Gitee 镜像的双平台布局，镜像由
[`../../.github/workflows/sync-gitee-mirror.yml`](../../.github/workflows/sync-gitee-mirror.yml)
在每次 `main` 推送后**单向快进**同步。2026-11-14 排查镜像滞后时发现两类可观测性缺陷：

1. **绿勾不等于成功**：该 job 的 `continue-on-error: true` 会把同步失败吞成 run 结论
   `success`。实测一次 `push gitee --tags` 因 `Recv failure: Connection reset by peer`
   失败（exit 128），run 却仍显示成功，且「复核镜像 HEAD」被跳过。
2. **日志误判**：多行 `run:` 脚本被 GitHub Actions 逐行回显，回显中的 `SKIP_SYNC=1`、
   `::error title=镜像分叉…` 等**脚本文字**看起来像真实报错，与真实输出混杂。

此外，复现验证时还发现第三类缺陷：`gh workflow run --ref <非默认分支>` 触发时
`github.sha` 是该分支 HEAD，且 `main` 恰为其祖先，`merge-base --is-ancestor` 祖先校验
**无法拦截**，会把未合并的 PR 提交快进到镜像。

PR #516 针对上述三点做了加固，本文档归档其端到端验证结论与运维口径。

---

## 2. 加固内容概要

| 项           | 实现                                                                                                                                       | 位置                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 三态结果可见 | 新增 `if: always()` 的「同步结果」步骤，把 `⏭️ 已跳过` / `✅ 成功` / `❌ 失败` 写入 Step Summary，失败时附 `::error` annotation 与排查线索 | 见 workflow                                                                                |
| 日志误判消除 | 逻辑抽为 `prepare` / `push` / `verify` / `summary` 四个子命令，`run:` 只剩一行 `bash … <cmd>`                                              | [`../../.github/scripts/sync-gitee-mirror.sh`](../../.github/scripts/sync-gitee-mirror.sh) |
| 手动严格模式 | `workflow_dispatch` 增加 `strict` 选项；仅手动 `strict=true` 时关闭 `continue-on-error`，让失败真实反映到 run 结论                         | 见 workflow                                                                                |
| 只同步 main  | `cmd_push` 开头校验 `GITHUB_REF == refs/heads/main`，拒绝把 PR 提交写入镜像；校验位于 `fetch` / `push` 之前                                | 见脚本                                                                                     |
| 铁律不变     | 单向、只快进（`merge-base --is-ancestor`）、失败不阻塞主干 CI；`push` 后 `ls-remote` 回读复核 HEAD                                         | 见 workflow                                                                                |

凭据仅经 `GITEE_AUTH`（Basic base64）与 `http.extraheader` 传递，不写入 `.git/config`、
不出现在命令行参数中。行为口径同步记录于
[`../contributing/contributing.md`](../contributing/contributing.md) 的镜像段落。

---

## 3. 前置条件

| 项                               | 状态                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GITEE_USERNAME` / `GITEE_TOKEN` | 仓库级 Actions Secret 已配置（Gitee 私人令牌勾 `projects`）                                                                    |
| GitHub `main` branch protection  | 未启用，同步 workflow 失败不会阻塞合并                                                                                         |
| 三条铁律                         | 未变（见 §2）                                                                                                                  |
| 校验工具                         | `bash -n`、PyYAML、`pnpm format:check` / `lint` / `lint:strict` / `test`、`build-docs.sh`（Sphinx `-W`）、`audit-tools/run.sh` |

---

## 4. 验证矩阵

前 3 项为**加固前的问题发现阶段**，后 4 项为**加固后的验收阶段**。

| #   | 场景                                                      | run           | 结论                                                                                                                                                                     |
| --- | --------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 缺 Secret 触发（旧版）                                    | `43587845766` | `⏭️ 已跳过`，两个同步 step 被 skip，run success                                                                                                                          |
| 2   | 配置 Secret 后首跑（旧版）                                | `43588392051` | `push gitee --tags` 遭 `Recv failure: Connection reset by peer`，step failure，**run 仍 success** —— 缺陷 1 复现                                                         |
| 3   | 网络恢复后重试（旧版）                                    | `43588619429` | 5 step 全绿，`Everything up-to-date` ×2、`✅ 已推送`、`✅ 镜像 main = ab274f4（与 GitHub main 一致）`                                                                    |
| 4   | 加固成功路径（PR 分支 `strict=true`）                     | `43590485823` | 5 step 全绿，日志只回显一行 `bash … <cmd>`；**暴露 `--ref <分支>` 把分支 HEAD 推入镜像的缺口**（缺陷 3）                                                                 |
| 5   | 加固失败路径（补 `GITHUB_REF` 校验后 `strict=true`）      | `43590777226` | `##[error]当前 GITHUB_REF=… 不是 refs/heads/main`；push step failure、**run `conclusion: failure`**、「同步结果」仍执行并写出 ❌ Summary                                 |
| 6   | 合并后生产 `on.push`（宽松路径）                          | `43592401559` | Gitee `fetch` 阶段 `Connection timed out after 300038 ms`，job 内部 failure；**annotation 明确写出三态**、Step Summary ❌，run 保持 success 不阻塞主干                   |
| 7   | **最终验收：main 上 `workflow_dispatch` + `strict=true`** | `43593671801` | 17s 完成，5 step 全绿：`Everything up-to-date` ×2、`✅ 已推送 5d1995d4`、`✅ 镜像 main = 5d1995d（与 GitHub main 一致）`；`conclusion: success`，无 `::error` annotation |

### 4.1 本地静态与行为验证

- `bash -n` 脚本语法 ✅
- PyYAML 解析 workflow：触发器、`continue-on-error` 表达式、5 个 step、`strict` 选项与默认值 ✅
- 本地模拟 `summary` 三态（无需连接 Gitee）：⏭️ / ✅ / ❌ 的 Summary 表格与 `::error` annotation 均符合预期 ✅
- 未知子命令返回 exit 2 ✅
- 全套仓库门禁：`format:check` / `lint` / `lint:strict` / lint budget / `pnpm test` / Sphinx `-W` / `audit-tools/run.sh`（`drift_count=0`）全部通过 ✅

---

## 5. 加固效果断言

| 断言                                          | 验证依据                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 三态可见：失败不再被绿勾掩盖                  | #2（缺陷复现）、#5、#6（annotation 明确列出 `准备凭据=success、快进=failure、复核=skipped`） |
| 严格模式：`strict=true` 让失败反映到 run 结论 | #5 的 `conclusion: failure`                                                                  |
| 宽松不变：`push` / `schedule` 不阻塞主干      | #6 的 run 保持 success                                                                       |
| 日志回显消除                                  | #4、#7 中 `run:` 仅一行命令，不再逐行回显脚本源码                                            |
| 只同步 main                                   | #5 的 `GITHUB_REF` 拒绝；#7 在 main 上正常通过                                               |
| 镜像复核有效                                  | #7 的 `✅ 镜像 main = 5d1995d（与 GitHub main 一致）`                                        |

---

## 6. 事故记录：误触发与修复

在补上 `GITHUB_REF` 校验**之前**，#4 用 `--ref <PR 分支>` 触发验证，把未合并的提交
`d7f832c` 快进到了 Gitee main，造成镜像与 GitHub main 分叉：

```text
GitHub main: ab274f436
Gitee main : d7f832cf5   ← 多了 1 个提交
```

修复方式（经维护者授权的一次性例外，**仅动 `main` 这一个 ref**）：

1. `git push --force-with-lease="refs/heads/main:<current>" gitee ab274f4:refs/heads/main`
   —— 精确回退到 `ab274f4`；
2. `git push gitee <current-github-main>:refs/heads/main`
   —— **常规快进**（不 force）对齐到当时的 GitHub main `b20384a`。

修复后双向差异 0、tag 各 67 个且集合一致。PR #516 合并后的 squash 提交因此可正常快进，
不会触发「镜像分叉」拒止。加固后的 `GITHUB_REF` 校验即为防止同类误操作再次发生。

> 说明：这是纠正验证操作造成偏差的一次性例外，不属于常规同步流程；日常同步始终
> 遵循「只快进、绝不 force-push」铁律。

---

## 7. 最终状态

```text
GitHub main: 5d1995d47ca53b4c5c0fcd893a88df7c0f247dbb
Gitee main : 5d1995d47ca53b4c5c0fcd893a88df7c0f247dbb
双向差异 0 / 0，tag 各 67 个且集合一致
```

PR #516 已 squash 合并为 `5d1995d`，状态 `MERGED`，本地/远端临时分支与 worktree 已清理。

---

## 8. 运维口径

- **判断同步是否成功**：查看 run 页面的 **Step Summary「Gitee 镜像同步结果」** 与
  **ANNOTATIONS**。`push` / `schedule` 触发时 job 级 `continue-on-error` 会让失败显示
  为 success，**不要只看绿勾**。
- **手动验证**：在 **main** 上执行 `gh workflow run sync-gitee-mirror.yml -f strict=true`。
  在 PR 分支触发会被 `GITHUB_REF` 校验正确拒绝，这是预期行为。
- **网络抖动**：Gitee 侧偶发 `Connection reset by peer` / `Connection timed out`，
  属外部网络问题，重试通常即可恢复；workflow 有 6 小时 cron 兜底，且不阻塞主干 CI。
- **Secret 维护**：`GITEE_TOKEN` 失效或缺少 `projects` 权限时，Summary 会显示 ❌ 并提示
  「令牌失效或缺少 `projects` 权限」；令牌轮换后建议按上述手动验证命令复验一次。
- **手动兜底**（需 Gitee 写权限）：参见
  [`../contributing/contributing.md`](../contributing/contributing.md) 的镜像段落。
