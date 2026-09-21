# OpenLearnV2 — Educational OS

> 插件驱动的下一代在线教育操作系统（LMS），集成微内核架构、双运行模式插件沙箱、零信任课件隔离与 AI 伴随教学。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](package.json)
[![Node: >=20](https://img.shields.io/badge/Node-%3E%3D20.0.0-green.svg)](package.json)
[![pnpm: >=9](https://img.shields.io/badge/pnpm-%3E%3D9.0.0-orange.svg)](package.json)
[![Tests](https://img.shields.io/badge/Tests-1282%20passed-brightgreen.svg)]()

📚 **完整文档**：[openlearn-next-v2.readthedocs.io](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/) · [快速开始](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/getting-started/quickstart.html) · [安装指南](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/getting-started/installation-guide.html) · [插件开发教程](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/tutorials/plugin-development-tutorial.html) · [版本迁移](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/migration/version-migration.html)

---

## 🌟 核心特性

- 🧩 **微内核与事件驱动架构 (Educational OS Kernel)**
  - 核心子系统基于 CQRS `CommandBus`、强类型 DI 依赖注入容器与 SQLite 关系型存储。
  - `EventBus` 支持内核级事件发布/订阅，关键审计事件（如学生端异常、权限变更、课件提交）持久化落盘至 `events` 表。
- 🛡️ **双运行模式插件沙箱 (Plugin Host & Sandboxing)**
  - 支持 **Inline 原生模式** 与 **Worker 独立进程沙箱**。Worker 模式具备独立的 Node.js 进程、RPC 代理、看门狗自动拉起（Watchdog）与 5 分钟崩溃 4 次熔断保护（Circuit Breaker）。
  - 严谨的 7 态插件生命周期管理（`INSTALLED` ➔ `ACTIVATING` ➔ `ACTIVE` ➔ `DEACTIVATING` ➔ `INACTIVE` ➔ `ERROR` ➔ `UNINSTALLED`），卸载与停用自动触发资源与权限彻底回收。
  - 插件专属 REST API 安全网关：命名空间路由隔离、滑动窗口限流、SSE 并发连接配额与响应头清洗。
- 📦 **零信任课件沙箱与透明 Bridge SDK**
  - HTML5 课件与小程序在严格 `iframe`（`sandbox="allow-scripts allow-forms allow-downloads"`，严格禁止 `allow-same-origin`）中运行。
  - 独创 **Bridge SDK** 透明代理跨域通讯，内置 `ResultWatcher` 强信号监听器，实现无需题目作者适配即可自动识别「结算页/通关页」并抓取分数自动回写。
- 📡 **课堂实时协同与学生端多维遥测**
  - 在线感知（Presence Engine）：实时捕获学生专注度（Focused/Unfocused）、离屏状态与班级专注率。
  - 多人协同（Collaboration Engine）：支持分组协作、共享对象锁（ObjectLock）与白板事件插槽（WhiteboardEventSlot）。
  - **学生端极简低干扰异常遥测**：端侧左下角极简感叹号图标+红色角标，降低课堂认知负荷；异常秒级上报至教师端大屏并落盘审计日志。
- 🤖 **原生 AI 伴随教学引擎**
  - 兼容 OpenAI 协议（DeepSeek、Qwen、Ollama、OpenAI 等任意兼容提供商），密钥多重加密存储。
  - 赋能教师工作台：一键智能生成结构化教案、自动出题与随堂小测、学情诊断与个性化学习规划。

---

## 🏗️ 架构拓扑 (Architecture Topology)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Frontend UI Shell (React 19)                    │
│   Teacher Workspace  │  Live Classroom  │  Whiteboard  │  Student Live │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ WebSocket / REST API
┌────────────────────────────────────▼───────────────────────────────────┐
│                   Realtime Gateway & Security Barrier                   │
│   Socket.IO (Presence / Telemetry) │ Helmet CSP │ Session Auth Guard   │
│   Plugin REST API Gateway (Rate Limit / SSE Quota / Header Sanitizer)  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
┌────────────────────────────────────▼───────────────────────────────────┐
│                     Platform Kernel (packages/core)                    │
│  ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────────┐  │
│  │   Command Bus   │   │    Event Bus    │   │ DI Container (Tokens)│  │
│  └────────┬────────┘   └────────┬────────┘   └──────────┬───────────┘  │
│           │                     │                       │              │
│  ┌────────▼─────────────────────▼───────────────────────▼───────────┐  │
│  │     SQLite Database (WAL Mode / Migration / Audit Log Events)    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
┌────────────────────────────────────▼───────────────────────────────────┐
│                     Plugin Runtime & Sandbox Subsystem                 │
│  ┌───────────────────────────────┐   ┌──────────────────────────────┐  │
│  │ Inline Mode Runtime           │   │ Worker Process Sandbox       │  │
│  │ (Direct In-Memory Execution)  │   │ (RPC / Watchdog / Breaker)   │  │
│  └───────────────────────────────┘   └──────────────────────────────┘  │
│  ┌───────────────────────────────┐   ┌──────────────────────────────┐  │
│  │ Dynamic ESM ZIP Loader        │   │ Capability Guard (RBAC/ABAC) │  │
│  └───────────────────────────────┘   └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---


## 快速开始

### 一键运行（无需 clone 项目）

```bash
# 推荐使用 @latest 强制校验最新发布版本，规避本地历史缓存版本漂移：
npx openlearn-next@latest

# 自定义端口 / 启动后自动唤起浏览器 (-o) / 临时沙盒演示模式 (--demo)
npx openlearn-next@latest -p 3000 -o
npx openlearn-next@latest --demo -o

# 运维诊断与一键自愈 / 在线冷备
npx openlearn-next@latest doctor --fix
npx openlearn-next@latest backup
```

### 全局安装

```bash
npm install -g openlearn-next   # 安装
openlearn-next                  # 启动
npm update -g openlearn-next    # 更新
```

默认账号：`admin` / `admin`（管理员）、`teacher` / `teacher`（教师）。

### 本地开发

```bash
# 推荐使用 pnpm
pnpm install

# 启动开发服务器（端口 9000，支持 Vite HMR）
pnpm dev

# 浏览器访问
open http://localhost:9000
```
> 首次启动后，可在管理后台「AI Provider 管理」中配置您的大模型 API 密钥（DeepSeek、OpenAI、Ollama 等）。

---

## 生产部署

```bash
chmod +x deploy.sh
./deploy.sh
```

脚本自动完成：依赖校验 ➔ 生产构建 ➔ 生成 Nginx 配置 ➔ PM2 进程守护 ➔ 生成 API Key 加密密钥。
详细部署方案可参阅 [生产部署指南](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/deployment/production-guide.html)。

---

## 常用开发命令 (CLI Scripts)

| 命令 | 说明 |
| :--- | :--- |
| `pnpm dev` | 启动全栈开发服务（Express + Vite HMR，端口 9000） |
| `pnpm build` | 生产级全量构建（Vite 前端构建 ➔ 插件打包 ➔ esbuild 服务端打包） |
| `pnpm start` | 运行生产打包服务（从 `dist/server.cjs` 启动） |
| `pnpm test` | 执行 Vitest 自动化测试套件（支持并行 worker 隔离 SQLite 测试库） |
| `pnpm lint` | TypeScript 静态类型检查（`tsc --noEmit`） |
| `pnpm lint:eslint` | ESLint 代码规范检查 |
| `pnpm format` | Prettier 代码自动化格式化 |
| `pnpm db:backup` | 数据库安全在线冷备 |
| `pnpm db:reset` | 重置本地测试数据库环境 |

---

## ⚙️ 环境变量

| 变量 | 必需 | 默认值 | 说明 |
| :--- | :---: | :---: | :--- |
| `ENCRYPTION_KEY` | ✅ | — | 64 位 Hex 字符串，用于 AI Provider API Key 加密（`deploy.sh` 会自动生成） |
| `PORT` | — | `9000` | HTTP 服务监听端口 |
| `OPENLEARN_DB_PATH` | — | `./packages/core/db/educational_os.db` | SQLite 数据库文件路径（npx 运行时默认为 `~/openlearn-next/data.db`） |
| `ALLOWED_ORIGINS` | — | `*` | CORS 跨域白名单（逗号分隔） |
| `LOG_LEVEL` | — | `info` | 系统日志输出级别（`debug` / `info` / `warn` / `error`） |

---

## 🗺️ 项目演进路线图 (Roadmap)

根据平台近期代码与架构深度审计结果（相关一致性由 [架构文档漂移审计](docs/developer-guide/docs-drift-audit.md) 在 CI 中持续看守），OpenLearn 制定了分阶段的演进路线：

### 🎯 阶段一：稳固与安全收敛 (v0.3.21 - 当前阶段)
- [x] **P0 严重安全缺陷彻底闭环**：
  - [x] 为 `/api/plugins/execute-command` 挂载全局有效会话鉴权（`requireAuth()`），消除未授权命令执行面
  - [x] 插件更新检查器（`version-fetcher.ts`）消除 Shell 命令注入，采用安全参数化执行（`execFileSync`）与仓库白名单正则校验
  - [x] 插件数据库建表（`ensureTable`）在 Inline 与 Worker 双模式下全面引入 SQL 标识符与 DDL 结构校验，防御 SQL 注入
  - [x] 规范插件停用与卸载生命周期，非 ACTIVE 状态下无条件回收宿主资源（`resourceTracker.disposeAll`）与能力注销（`capService.revokeAll`）
- [x] **端侧异常健康遥测与审计体系**：
  - [x] 实现学生端 React 运行时、未捕获 Promise、网络请求故障的自动捕获与多通道秒级上报（WebSocket 优先 + HTTP 兜底）
  - [x] 教师端互动课堂大屏与学生卡片集成红色脉冲告警、异常堆栈诊断与 Markdown 报告一键导出
  - [x] 服务端事件总线统一写入 SQLite `events` 审计日志，内置学生 ID 防冒用验证与上报频率限制
  - [x] 学生端 UI 实施低干扰改造（左下角微型图标+数字角标），保障课堂学习专注度
- [ ] **SDK 契约一致性治理**：重新构建打包 `@openlearn/plugin-sdk`，补齐 `STORAGE_TOKEN` 等缺失导出的 Token 与类型定义
- [ ] **自动化测试体系清理**：解耦对未提交外部目录的物理路径硬依赖，使 215 个套件的全量测试达到 100% 绿灯

### 🚀 阶段二：K12 课堂交互与智能伴随深化 (v0.4.0 - 中期演进)
- [ ] **课件状态双向镜像与远程协助**：
  - 教师端可按需拉取单个学生的课件作答实时快照（DOM/Canvas 镜像）
  - 支持教师端一键向指定学生或全班推送课件交互指令（如强制锁屏、重置题目、跳转指定页）
- [ ] **弱网自适应与离线断点续传**：
  - 学生端在网络波动或断网状态下自动切换至离线缓存模式，答题数据暂存 IndexedDB
  - 网络恢复后触发幂等对账上报，保障农村/边远地区学校课堂的无缝教学体验
- [ ] **多学生白板分组协同微内核完善**：
  - 生产化 `CollaborationEngineKernel` 中的区域对象锁（ObjectLock），避免多人同时绘制冲突
  - 支持多白板画板并行动态分发与学生分组讨论室一键合并展示
- [ ] **AI 伴随助教深度赋能**：
  - 聚合全班随堂测验实时答题热力图与学生端异常/离屏遥测，自动向教师推送「教学干预建议」
  - 针对薄弱学生自动生成分层递进练习题并直接推送到学生互动端
- [ ] **插件 Worker 沙箱默认化**：全面推广独立 Worker 进程沙箱，实现插件与宿主主线程的硬隔离

---

## 📖 相关文档

- 📚 [官方完整文档](https://openlearn-next-v2.readthedocs.io/zh-cn/latest/)

- 🔍 [架构文档漂移审计](docs/developer-guide/docs-drift-audit.md)
- 🤝 [贡献指南与开发规范](AGENTS.md)
- 📝 [版本更新日志](CHANGELOG.md)

---

## 📄 开源许可证

本项目基于 MIT License 开源发布（声明见 [package.json](package.json) 的 `license` 字段）。

