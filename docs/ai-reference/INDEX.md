# AI 参考文档索引（OpenLearn-Next 全项目）

> **这份文档集的目标读者是 AI 编程 Agent，不是人。**
> 它用「结论 → 源码证据 → 约束」的固定结构，回答「这个模块在哪、这个 API 怎么签名、这个错误谁抛的」。
> 不含营销段落、不含模糊措辞。凡未取证处，显式标注 `待确认` 并登记到
> [evidence/unresolved-questions.md](evidence/unresolved-questions.md)。

---

## 0. 版本与取证坐标

| 项              | 值                                                                                                                                 | 取证方式                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 平台版本        | `openlearn-next` **0.7.8**                                                                                                         | 仓库根 `package.json` → `version`       |
| Git commit      | `4f41c9b`                                                                                                                          | `git log -1 --oneline`                  |
| Plugin SDK      | **3.7.5**                                                                                                                          | `packages/plugin-sdk/package.json`      |
| plugin-test-kit | **3.3.3**                                                                                                                          | `packages/plugin-test-kit/package.json` |
| Node            | **22**（`.nvmrc`）                                                                                                                 | CI 与 Dockerfile 均钉 22                |
| 分析日期        | 2026-10-31                                                                                                                         | —                                       |
| 索引产物        | `.repomix/openlearn-next.repo.pack.md`（1,688 文件 / 4.46M tokens）+ `.repomix/plugin-subsystem.pack.md`（193 文件 / 628k tokens） | repomix 1.18.1                          |

**取证坐标制式**（全文档统一）：

```text
路径/相对仓库根 → `符号名`（L行号）
```

例：`packages/core/plugin-host/types.ts → PluginContext（L227）`。
**符号名是主键，行号只是辅助** —— 行号会随代码变动漂移，符号名稳定。

**路径约定**：无前缀 = 本仓库相对路径；`[P]` = 外部示例插件仓库 `openlearn-plugin-lab-seat`。

**证据状态标记**（逐条结论必带其一）：

| 标记     | 含义                              |
| -------- | --------------------------------- |
| `已验证` | 有实现代码 + 调用链，或有测试证据 |
| `推断`   | 由类型/调用关系推导，未运行验证   |
| `待确认` | 未找到足够证据，不得据此编码      |
| `不适用` | 经检查该机制在目标仓库不存在      |

---

## 1. 先读哪一篇

**第一次接触这个仓库**：`architecture/platform-overview.md`（约 8k tokens）建立全局心智，
再按任务查表。**不要一次加载整个 `ai-reference/`。**

### 1.1 平台开发任务

| 我要做的事                                | 先读                                                                                 | 再读                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 搞清整体分层与进程边界                    | [architecture/platform-overview.md](architecture/platform-overview.md)               | [architecture/plugin-runtime-planes.md](architecture/plugin-runtime-planes.md)             |
| 找一个模块在哪                            | [architecture/module-map.md](architecture/module-map.md)                             | —                                                                                          |
| 排查「接口为什么 403 / 500 / 点了没反应」 | [architecture/request-lifecycle.md](architecture/request-lifecycle.md)               | [plugin-system/error-handling-and-cleanup.md](plugin-system/error-handling-and-cleanup.md) |
| 改内核 / 加一个 DI 服务                   | [subsystems/kernel-and-di.md](subsystems/kernel-and-di.md)                           | [api/configuration-map.md](api/configuration-map.md)                                       |
| 改表 / 写迁移 / 查保留策略                | [subsystems/data-and-migrations.md](subsystems/data-and-migrations.md)               | —                                                                                          |
| 加一条实时推送                            | [subsystems/realtime-and-events.md](subsystems/realtime-and-events.md)               | [architecture/request-lifecycle.md](architecture/request-lifecycle.md) §4                  |
| 改 AI / 测评 / 作业评分                   | [subsystems/ai-and-assessment.md](subsystems/ai-and-assessment.md)                   | —                                                                                          |
| 改课堂 / 课节 / 白板                      | [subsystems/classroom-and-whiteboard.md](subsystems/classroom-and-whiteboard.md)     | —                                                                                          |
| 动安全策略 / 限流 / 数据范围              | [subsystems/observability-and-security.md](subsystems/observability-and-security.md) | —                                                                                          |
| 查 HTTP 端点                              | [api/http-endpoints.md](api/http-endpoints.md)                                       | —                                                                                          |
| 查命令 / 事件                             | [api/commands-and-events.md](api/commands-and-events.md)                             | —                                                                                          |
| 查环境变量                                | [api/configuration-map.md](api/configuration-map.md)                                 | —                                                                                          |
| 构建 / 测试 / 部署                        | [development/build-and-deploy.md](development/build-and-deploy.md)                   | —                                                                                          |

### 1.2 插件开发任务

| 我要做的事               | 先读                                                                                     | 再读                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 从零建一个插件           | [development/getting-started.md](development/getting-started.md)                         | [examples/minimal-plugin.md](examples/minimal-plugin.md)                                   |
| 写 `manifest.json`       | [development/manifest-reference.md](development/manifest-reference.md)                   | [plugin-system/registration-and-loading.md](plugin-system/registration-and-loading.md)     |
| 查某个 API 的签名        | [development/api-reference.md](development/api-reference.md)                             | [plugin-system/context-and-services.md](plugin-system/context-and-services.md)             |
| 往界面上塞 UI            | [development/ui-extension-guide.md](development/ui-extension-guide.md)                   | [plugin-system/extension-points-and-slots.md](plugin-system/extension-points-and-slots.md) |
| 搞清插件何时激活/停用    | [plugin-system/lifecycle.md](plugin-system/lifecycle.md)                                 | [architecture/execution-flows.md](architecture/execution-flows.md)                         |
| 激活报 capability denied | [plugin-system/capabilities-and-security.md](plugin-system/capabilities-and-security.md) | [development/troubleshooting.md](development/troubleshooting.md)                           |
| 写插件测试               | [development/testing-guide.md](development/testing-guide.md)                             | —                                                                                          |
| 抄一个真实插件           | [examples/lab-seat-walkthrough.md](examples/lab-seat-walkthrough.md)                     | —                                                                                          |
| 核实一条结论             | [evidence/source-index.md](evidence/source-index.md)                                     | [evidence/unresolved-questions.md](evidence/unresolved-questions.md)                       |

---

## 2. 文档地图

```text
docs/ai-reference/
├── INDEX.md                              ← 你在这里
├── architecture/
│   ├── platform-overview.md               五层结构 / 三条数据通路 / 进程边界 / 启动顺序
│   ├── module-map.md                      目录 → 职责 → 关键符号（server / src / 29 个子系统）
│   ├── request-lifecycle.md               中间件链 → 命令四道闸门 → 事件 → Socket → 错误出口
│   ├── plugin-runtime-planes.md           插件四层运行面（内核 / 传输 / 前端 / 沙箱）
│   └── execution-flows.md                 5 条端到端链路（安装 / 激活 / 派发 / 渲染 / 停用）
├── subsystems/
│   ├── kernel-and-di.md                   EducationalOS / ServiceRegistry / Token / 四条总线
│   ├── data-and-migrations.md             86 张表 / 45 个迁移 / 读池 / 保留策略 / 备份
│   ├── realtime-and-events.md             5 类房间 / SOCKET_ROUTES / presence / 课堂互动
│   ├── ai-and-assessment.md               AI 三层 / 7 个能力模块 / 测评 / 作业评分 / 活动生态
│   ├── classroom-and-whiteboard.md        课节引擎 / 课堂运行时 / 白板（前端主导）
│   └── observability-and-security.md      日志指标 / 四层防线 / 6 档数据范围 / 签名治理
├── api/
│   ├── http-endpoints.md                  313 端点分布 / 鉴权写法 / 插件 REST 网关
│   ├── commands-and-events.md             84 命令 / 84 描述符 / 事件目录
│   └── configuration-map.md               配置查表入口 / 易错点 / 部署检查清单
├── plugin-system/
│   ├── lifecycle.md                       7 态状态机 + 超时 + 清理顺序
│   ├── registration-and-loading.md        发现 → 解压 → 校验 → 载入 → 模式求值
│   ├── extension-points-and-slots.md      120 槽位 + 4 类容器 + 合并规则
│   ├── context-and-services.md            ctx 全字段 + 9 服务 + Token 三口径
│   ├── capabilities-and-security.md       3 套能力登记 + 3 道 Barrier + SQL 守卫
│   └── error-handling-and-cleanup.md      17 个错误类 / 错误码 / 熔断 / 资源回收
├── development/
│   ├── getting-started.md                 环境 → 脚手架 → 构建 → 安装
│   ├── manifest-reference.md              manifest 逐字段 + zod 规则
│   ├── api-reference.md                   插件公开 API 全签名
│   ├── ui-extension-guide.md              4 条 UI 通道与选型判据
│   ├── testing-guide.md                   L0–L3 测试阶梯
│   ├── troubleshooting.md                 现象 → 归因 → 修法
│   └── build-and-deploy.md                构建 6 步 / 测试四档 / PM2 & Docker 部署
├── examples/
│   ├── minimal-plugin.md                  最小可运行插件（server-only）
│   └── lab-seat-walkthrough.md            真实插件解剖（27 命令 / 4 槽位）
└── evidence/
    ├── source-index.md                    结论 → 源码符号 反查表
    └── unresolved-questions.md            待确认清单（U-01…）+ 主观取舍（A-01…）
```

---

## 3. 与仓库内其它文档的关系

本仓库 `docs/` 下已有一套**面向人**的 Sphinx 文档（发布到 readthedocs），
本目录是**面向 AI** 的平行层，两者不是替代关系。

| 场景                                     | 用哪个                                            |
| ---------------------------------------- | ------------------------------------------------- |
| 给新同事讲架构、写方案                   | `docs/architecture/*.md`（Sphinx，有图有叙事）    |
| AI Agent 定位代码、核对签名、查错误码    | **本目录**（有坐标、有真值表、有排错树）          |
| 查机器可读真值（槽位数、能力数、禁写表） | `docs/agent/contracts/*.json`（本文档的共同上游） |

**冲突裁决优先级**：

```text
源码 > docs/agent/contracts/*.json + docs/agent/facts-ledger.md > docs/reference/*.md > docs/ai-reference/**
```

本目录已与 `docs/agent/contracts/` 全部 7 个文件对齐（槽位 120、能力 19/8/7、Token 32/31、
禁写表 40、contributes 71/38、bridge 10/8、版本 0.7.8/3.7.5/3.3.3）。

> 本目录**不在** Sphinx toctree 中（`docs/conf.py` 的 `exclude_patterns` 已排除），
> `make html` 不会因它产生「文档未包含在 toctree」警告。

---

## 4. 平台侧硬约束（先记住，能省 80% 返工）

1. **命令必须配 ActionDescriptor**：只有 handler 没有描述符 ⇒ 403 `COMMAND_NOT_REGISTERED`（default-deny）。
   全平台现已 84/84 配对；自查用 `node scripts/plugin-command-audit.mjs`（细则见 [api/commands-and-events.md](api/commands-and-events.md) §1）。
2. **`inputSchema` 只认全大写类型名**：`'OBJECT'` 才校验，小写 `'object'` 静默跳过，`required` 完全失效。
3. **`ctx.config` 必须 `.get(key)`**：`ctx.config[key]` 恒 `undefined`；且 `process`/`worker` 下 `ctx.config` 整个不存在。
4. **前端没有路由表**：新增页面靠注册扩展槽位，不靠加路由。
5. **事件推前端必须在 `SOCKET_ROUTES` 登记**：否则后端日志正常、前端不刷新。
6. **房间名只能用 `server/presence.ts` 的 4 个构造函数 + 课节 id**：手拼字符串会在改前缀时漏改。
7. **`ctx.pluginId` 是 `plugins` 表行 UUID，不是 `manifest.id`**；表前缀、命令前缀、存储隔离各用各的。
8. **SQL 守卫只作用于 `process`/`worker`**：`inline` 下不拦，但「没被拦」不等于「被允许」。
9. **`server/utils/bridge-sdk.ts` 是生成物**：源在 `packages/bridge-sdk/src/bridge.js`。
10. **单实例部署**：SQLite 单写者 + 进程内单例内核，PM2/Docker 都不能多副本。

## 5. 插件侧硬约束

1. **`manifest.main` 必填**，缺失则安装失败（`main: z.string().min(1)`，`manifest-schema.ts` L798）。
2. **`manifest.id` 不能含 `:`** —— zod refine 拦的是 actor 伪造（L795）。
3. **第三方 ZIP 插件被强制 `process` 子进程**；信任只来自「文件在 `packages/plugins/`」或
   id 命中 `OPENLEARN_TRUSTED_INLINE_PLUGINS`。**`@openlearn/` 前缀不构成信任。**
4. **`process` 下 `capabilitiesProposed` 为空 ⇒ 激活期非 `get*` RPC 全被拒**，激活失败。
5. **`ctx.services.*` 九个成员类型均为 `T | null`**，用前判空。
6. **`view` 路径必须以 `storage/` 开头**，且官方 CLI 不打包 `storage/`，必须自写打包脚本。
7. **`ctx.db.table()` 同步、`migrate`/`ensureTable` 异步**，后者必须 `await`。
8. **前端 `frame` 通道只有 10 个 op**，越界即 `Unsupported sandbox bridge op "xxx"`。
9. **前端产物禁止裸模块说明符**：`import React from 'react'` 会被 SDK CLI 拦下，必须 `import type` + 运行期注入。
10. **`ctx.provide` 只在 `inline` 可用**；`process`/`worker` 下该方法不存在，必须 `typeof` 守卫。

---

## 6. 一页速查

| 问题           | 答案                                                                               | 出处                                                               |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 规模           | 约 228k 行 TS/TSX；86 张表；313 HTTP 端点；84 命令（84 描述符）；19 条 socket 路由 | [platform-overview.md](architecture/platform-overview.md) §1       |
| 内核在哪个文件 | `packages/core/kernel/index.ts`（749 行）                                          | [kernel-and-di.md](subsystems/kernel-and-di.md) §1                 |
| 命令入口       | `POST /api/commands`（`server/routes/os.ts` L112）                                 | [request-lifecycle.md](architecture/request-lifecycle.md) §3       |
| 命令超时       | 路由层 10s；插件激活/停用 5s                                                       | 同上 / [plugin-system/lifecycle.md](plugin-system/lifecycle.md)    |
| 前端入口       | `src/App.tsx`（157 行）+ `src/components/AppShell.tsx`（35 行）                    | [platform-overview.md](architecture/platform-overview.md) §6       |
| 开发端口       | 9000                                                                               | [development/build-and-deploy.md](development/build-and-deploy.md) |
| 数据库文件     | `packages/core/db/educational_os.db`                                               | [data-and-migrations.md](subsystems/data-and-migrations.md) §1     |
| 真值来源       | `docs/agent/contracts/*.json`（7 个）                                              | [module-map.md](architecture/module-map.md) §5                     |
