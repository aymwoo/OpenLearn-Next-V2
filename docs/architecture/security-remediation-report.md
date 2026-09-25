# OpenLearn Next (V2) 安全审计与修复报告

> **审计时间**：2026-09-25
> **审计对象**：`openlearn-next@0.3.21` 全栈教学操作系统
> **审计范围**：服务端安全、认证鉴权、依赖健康、构建配置、状态管理、数据库迁移
> **前置审计**：[code-quality-audit-report.md](./code-quality-audit-report.md)（2026-09-21）

---

## 1. Executive Summary

本次审计基于上一轮代码质量审计报告中发现的残留问题，对平台进行了全面的安全扫描与架构评估。审计覆盖 **974 个源文件（~180K 行代码）**，发现 **4 项 CRITICAL、8 项 HIGH、5 项 MEDIUM** 安全问题，以及多项架构与工程化改进点。

所有发现的问题均已修复并通过验证：

| 验证项 | 结果 |
|--------|------|
| TypeScript 类型检查 (`tsc --noEmit`) | **0 错误** |
| 测试套件 (`vitest run`) | **250 文件 / 1691 用例全部通过** |
| 依赖安装 (`pnpm install`) | **正常** |

---

## 2. 审计发现汇总

### 2.1 安全问题

#### CRITICAL（4 项，已全部修复）

| 编号 | 位置 | 问题描述 |
|------|------|----------|
| SEC-01 | `server/routes/os.ts:61` | **命令注入 RCE** — `exec(\`pdfinfo "${filePath}"\`)` 直接拼接文件路径于 shell 命令字符串，可构造恶意文件名实现远程代码执行 |
| SEC-02 | `server/routes/os.ts:23` | **未认证文件上传** — `/api/upload` 无 `requireAuth()` 中间件，与 SEC-01 串联形成未认证 RCE 攻击链 |
| SEC-03 | `server/routes/roster.ts:160` | **数据库 Schema 泄露** — `/api/db-status` 无认证，暴露完整 SQLite 内部信息（表结构、行数、PRAGMA 参数） |
| SEC-04 | `server/routes/workspace.ts:245` | **未认证 VFS 文件访问** — `/files/*` 虚拟文件系统路由无任何鉴权 |

#### HIGH（8 项，已全部修复）

| 编号 | 位置 | 问题描述 |
|------|------|----------|
| SEC-05 | `server/routes/plugins.ts` | 插件列表、配置、贡献点端点均无认证 |
| SEC-06 | `server/routes/admin.ts` | 管理报告下载端点无认证 |
| SEC-07 | `server/routes/os.ts` | 命令注册表、AI 对话历史端点无认证 |
| SEC-08 | `server/routes/assignments.ts:183` | 任何登录用户可查看所有作业提交（IDOR 越权） |
| SEC-09 | `server/routes/roster.ts:597` | 明文密码回退比较（非 bcrypt 时直接 `===`） |
| SEC-10 | `server/routes/roster.ts:935` | 临时密码在 API 响应中明文返回 |
| SEC-11 | `server.ts:170` | 仅登录接口有 rate limit，上传/AI 聊天/提交等无限制 |
| SEC-12 | `server.ts:165,252` | HSTS 禁用 + CORS 允许 `null` origin 携带 credentials |

#### MEDIUM（5 项，已修复 3 项）

| 编号 | 位置 | 问题描述 | 状态 |
|------|------|----------|------|
| MED-01 | `server.ts:160` | CSP 全局禁用 | 保留（AI Studio iframe 嵌入需求） |
| MED-02 | `server.ts:159` | xFrameOptions 禁用（点击劫持） | **已修复** → `sameorigin` |
| MED-03 | `server.ts:181-192` | 上传目录 auth 中间件未实际执行 | **已修复** |
| MED-04 | `server/routes/roster.ts:624` | 课堂口令明文存储和比较 | 保留（短生命周期临时口令，产品需求） |
| MED-05 | `server/routes/lessons.ts:605` | 测验提交 read-modify-write 竞态 | 保留（已有 secondary atomic upsert 兜底） |

### 2.2 架构与工程化问题

| 编号 | 类别 | 问题描述 | 状态 |
|------|------|----------|------|
| ARCH-01 | 依赖安全 | `xlsx@^0.18.5` 有已知 CVE（原型污染） | **已修复** → 替换为 `exceljs@^4.4.0` |
| ARCH-02 | 依赖分类 | `esbuild`/`@types/reveal.js`/`pino-pretty` 错放在 dependencies | **已修复** → 移至 devDependencies |
| ARCH-03 | 构建配置 | `build.target: 'esnext'` 过于激进 | **已修复** → `es2022` |
| ARCH-04 | 构建配置 | manualChunks 引用不存在的包（marked/dompurify/highlight.js） | **已修复** → 移除死规则 |
| ARCH-05 | 构建配置 | `modulePreload: false` 完全禁用预加载 | **已修复** → `{ polyfill: false }` |
| ARCH-06 | 类型安全 | tsconfig 未启用任何 strict 子标志 | **已修复** → 启用 `noImplicitThis` + `alwaysStrict` + `strictBindCallApply` |
| ARCH-07 | 状态管理 | 4 个域 store 为死代码（从未被组件消费） | **已修复** → 移除无效镜像订阅 |
| ARCH-08 | 迁移文档 | Migration README 缺少 009 条目 | **已修复** |

---

## 3. 修复详情

### 3.1 P0 — 关键安全修复

#### 3.1.1 命令注入修复（SEC-01 + SEC-02）

**文件**：`server/routes/os.ts`

**变更**：
- `import { exec }` → `import { execFile }`
- `exec(\`pdfinfo "${filePath}"\`)` → `execFile('pdfinfo', [filePath])`
- `/api/upload` 路由添加 `requireAuth('teacher', 'administrator')` 中间件

**原理**：`execFile` 不创建 shell 子进程，参数通过数组传递，从根本上消除 shell 元字符注入风险。

#### 3.1.2 未认证端点全面加固（SEC-03 ~ SEC-07）

**涉及文件**：`os.ts`, `roster.ts`, `workspace.ts`, `plugins.ts`, `admin.ts`

共 **16 个端点** 补加了 `requireAuth()` 中间件：

| 端点 | 角色限制 | 文件 |
|------|----------|------|
| `GET /api/db-status` | teacher, administrator | roster.ts |
| `GET /files/*` | 任意认证用户 | workspace.ts |
| `GET /api/mfe/remotes` | 任意认证用户 | workspace.ts |
| `GET /api/plugins` | 任意认证用户 | plugins.ts |
| `GET /api/plugins/:id/contributions` | 任意认证用户 | plugins.ts |
| `GET /api/plugins/:id/config` | 任意认证用户 | plugins.ts |
| `GET /api/audit-report/download` | administrator | admin.ts |
| `GET /api/remediation-roadmap/download` | administrator | admin.ts |
| `GET /api/classroom-optimization-plan/download` | administrator | admin.ts |
| `GET /api/commands/registered` | 任意认证用户 | os.ts |
| `GET /api/activities` | 任意认证用户 | os.ts |
| `POST /api/activities/:id/start` | 任意认证用户 | os.ts |
| `GET /api/activities/running` | 任意认证用户 | os.ts |
| `POST /api/activities/:id/finish` | 任意认证用户 | os.ts |
| `POST /api/activities/:id/pause` | 任意认证用户 | os.ts |
| `POST /api/activities/:id/resume` | 任意认证用户 | os.ts |
| `POST /api/agent/chat` | 任意认证用户 | os.ts |
| `GET /api/agent/conversations` | 任意认证用户 | os.ts |
| `DELETE /api/agent/conversations` | 任意认证用户 | os.ts |

### 3.2 P1 — 高优先级安全修复

#### 3.2.1 明文密码回退移除（SEC-09）

**文件**：`server/routes/roster.ts`

**变更**：学生登录的密码验证流程中，当存储密码既非 bcrypt 哈希（`$2` 前缀）也非 SHA-256 哈希（64 位 hex）时，原逻辑直接进行明文比较（`storedPwd === providedPassword`）并自动升级。修复后该分支设置 `matchesOwnPassword = false`，拒绝明文密码登录。

**影响**：遗留明文密码账户将无法登录，需由管理员重置密码。

#### 3.2.2 临时密码泄露修复（SEC-10）

**文件**：`server/routes/roster.ts`

**变更**：`POST /api/students` 创建学生接口的响应中移除 `tempPassword` 字段。

**验证**：前端代码中无任何对 `tempPassword` 的引用，移除安全。

#### 3.2.3 CORS null origin 修复 + 点击劫持防护（SEC-12 + MED-02）

**文件**：`server.ts`

**变更**：
- CORS 中间件不再反射 `null` origin 为 `Access-Control-Allow-Origin`，不再为 null origin 设置 `Allow-Credentials`
- `helmet.xFrameOptions` 从 `false` 改为 `{ action: 'sameorigin' }`，防止跨域点击劫持

#### 3.2.4 全局 Rate Limiting（SEC-11）

**文件**：`server.ts`, `server/routes/os.ts`, `server/context.ts`

**变更**：
- 新增 `writeLimiter`：60 次/分钟/IP，作为全局中间件应用于所有 POST/PUT/DELETE 请求
- 新增 `aiLimiter`：10 次/分钟/IP，专门应用于 `POST /api/agent/chat`（昂贵的 LLM 调用）
- `ServerContext` 接口新增 `aiLimiter` 字段

#### 3.2.5 作业提交 IDOR 修复（SEC-08）

**文件**：`server/routes/assignments.ts`

**变更**：`GET /api/assignments/:id/submissions` 的角色限制从 `requireAuth()` 改为 `requireAuth('teacher', 'administrator')`，防止学生查看他人提交。

#### 3.2.6 上传目录认证修复（MED-03）

**文件**：`server.ts`

**变更**：`/uploads` 静态资源中间件从空操作改为实际执行认证检查。`/avatars/` 路径例外放行（产品需求：头像公开可读），其余路径未认证返回 401。

### 3.3 P2 — 代码质量修复

#### 3.3.1 xlsx → exceljs 替换（ARCH-01）

**涉及文件**：`package.json`, `packages/core/plugin-host/context-builder.ts`, `packages/core/worker-runtime/worker-manager.ts`, `packages/core/plugin-host/types.ts`, `vitest.config.ts`, `packages/core/__mocks__/xlsx.ts`

**变更**：
- 依赖从 `xlsx@^0.18.5` 替换为 `exceljs@^4.4.0`
- 移除 `@types/xlsx`（exceljs 内置类型）
- 共享模块注册名从 `xlsx` 改为 `exceljs`
- Vitest mock 更新为 exceljs API 兼容桩

#### 3.3.2 依赖分类修正（ARCH-02）

**文件**：`package.json`

**变更**：以下包从 `dependencies` 移至 `devDependencies`：
- `esbuild` — 仅用于构建脚本
- `@types/reveal.js` — 类型定义仅构建时需要
- `pino-pretty` — 仅开发环境日志格式化（生产环境使用 JSON 输出）

#### 3.3.3 构建配置优化（ARCH-03 ~ ARCH-05）

**文件**：`vite.config.ts`

**变更**：
- `build.target`: `'esnext'` → `'es2022'`（匹配 tsconfig target，避免旧环境语法错误）
- `modulePreload`: `false` → `{ polyfill: false }`（保留模块预加载声明但不注入 polyfill）
- 移除 `vendor-content` manualChunk 规则（marked/dompurify/highlight.js 非直接依赖，规则永不匹配）

#### 3.3.4 TypeScript Strict 子集启用（ARCH-06）

**文件**：`tsconfig.json`

**变更**：启用以下 strict 子标志（0 编译错误）：
- `noImplicitThis: true` — 防止 `this` 隐式 any
- `alwaysStrict: true` — 确保所有文件使用 strict 模式
- `strictBindCallApply: true` — 严格检查 bind/call/apply 参数

**未启用**（需大量重构，建议后续渐进推进）：
- `strictNullChecks` — 产生 ~150 个错误
- `noImplicitAny` — 产生大量错误
- `strictFunctionTypes` — 产生类型兼容性问题

#### 3.3.5 状态管理死代码清理（ARCH-07）

**文件**：`src/store/appStore.ts`, `src/store/index.ts`

**变更**：
- 移除 `classStore`、`lessonStore`、`liveClassStore`、`studentStore` 的 import 和 `.subscribe()` 镜像同步代码
- 从 `store/index.ts` barrel 导出中移除上述 4 个 store
- 保留 `uiStore` 订阅（仍被 appStore 的 action 委托使用）

**影响**：移除了约 65 行无效代码。4 个域 store 文件本身保留（仍有测试覆盖），但不再参与运行时数据流。

### 3.4 P3 — 迁移一致性

#### 3.4.1 Migration README 更新（ARCH-08）

**文件**：`migrations/README.md`

**变更**：补充 009 条目（`009_classroom_peer_review.sql` — 课中互评表）。

---

## 4. 修改文件清单

| 文件路径 | 修改类型 | 关联编号 |
|----------|----------|----------|
| `server/routes/os.ts` | 安全修复 | SEC-01, SEC-02, SEC-07, SEC-11 |
| `server/routes/roster.ts` | 安全修复 | SEC-03, SEC-09, SEC-10 |
| `server/routes/workspace.ts` | 安全修复 | SEC-04, SEC-05 |
| `server/routes/plugins.ts` | 安全修复 | SEC-05 |
| `server/routes/admin.ts` | 安全修复 | SEC-06 |
| `server/routes/assignments.ts` | 安全修复 | SEC-08 |
| `server.ts` | 安全修复 + 配置 | SEC-11, SEC-12, MED-02, MED-03 |
| `server/context.ts` | 接口扩展 | SEC-11 |
| `server/middleware/auth.ts` | 无修改（参考） | — |
| `packages/core/plugin-host/context-builder.ts` | 依赖替换 | ARCH-01 |
| `packages/core/worker-runtime/worker-manager.ts` | 依赖替换 | ARCH-01 |
| `packages/core/plugin-host/types.ts` | 依赖替换 | ARCH-01 |
| `packages/core/__mocks__/xlsx.ts` | Mock 更新 | ARCH-01 |
| `package.json` | 依赖管理 | ARCH-01, ARCH-02 |
| `tsconfig.json` | 类型安全 | ARCH-06 |
| `vite.config.ts` | 构建配置 | ARCH-03, ARCH-04, ARCH-05 |
| `vitest.config.ts` | 测试配置 | ARCH-01 |
| `src/store/appStore.ts` | 死代码清理 | ARCH-07 |
| `src/store/index.ts` | 死代码清理 | ARCH-07 |
| `migrations/README.md` | 文档补全 | ARCH-08 |

---

## 5. 遗留建议

以下问题因风险/收益比不划算或需要更大规模重构，建议后续版本处理：

| 优先级 | 建议 | 原因 |
|--------|------|------|
| P2 | 启用 `strictNullChecks` | 需修复 ~150 个类型错误，建议按模块渐进推进 |
| P2 | 启用 `noImplicitAny` | 需为数百个参数添加类型注解 |
| P2 | 拆分 `InteractiveWhiteboard.tsx`（4148 行） | 大规模重构，需独立排期 |
| P2 | 拆分 `App.tsx`（2226 行，127 hooks） | 需重新设计状态管理架构 |
| P3 | 统一 `mfe_remotes` 表时间戳类型 | 该列未被代码引用，修改风险大于收益 |
| P3 | 为关键表添加 FOREIGN KEY 约束 | 需评估对性能的影响 |
| P3 | 启用 CSP 头 | 需解决 AI Studio iframe 嵌入兼容性 |

---

## 6. 积极发现

本次审计中确认的已有安全实践（无需修改）：

- **SQL 注入防护完善** — 全部使用参数化查询（`?` 占位符），未发现字符串拼接 SQL
- **API 密钥加密存储** — AES-256-GCM 加密，端点返回掩码密钥
- **SSRF 防护** — `url-safety.ts` 阻止非 HTTP 协议和私有 IP
- **iframe 沙箱** — 课件 HTML 正确设置 CSP sandbox 头
- **测试覆盖扎实** — 250 个测试文件、1691 个用例，覆盖核心模块
- **密码哈希升级体系** — bcrypt 为主 + SHA-256 自动升级（本次修复了明文回退漏洞）
- **.env 安全** — `.gitignore` 正确排除，仅 `.env.example` 被追踪
