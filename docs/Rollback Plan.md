# OpenLearn Composition Root Rollback Plan (回滚与应急预案)

## 1. Executive Summary (概述)

本方案定义了在极端的生产环境异常或集成测试失败时，Composition Root 实施过程中的无损回滚策略。

---

## 2. Commit-Level Rollback Strategies (针对各 Commit 的回滚方案)

1. **Commit 4 (server.ts 接入) 故障回滚**:
   - **指令**: `git revert HEAD`
   - **效果**: 仅恢复 `server.ts` 至原来的单体 `new Kernel()` 启动逻辑，`packages/core/bootstrap/` 纯新增文件保留且无副作用，服务即刻恢复正常。

2. **Commit 3 / 2 / 1 (基础代码新增) 故障回滚**:
   - **指令**: `git reset --hard HEAD~1` 或 `git revert <commit_id>`
   - **效果**: 安全擦除或反向消除对应的模块新增，对现存业务逻辑零风险。
