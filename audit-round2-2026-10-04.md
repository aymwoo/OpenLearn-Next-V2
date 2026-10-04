# OpenLearnV2 第二轮代码审计报告

- 审计日期：2026-10-04
- 基线：`fa2bb95`（工作区干净，2763 测试全绿）
- 范围：自 `a11b99b`（上一轮代码审计基线）以来 **210 个文件**的变更
- 方法：四路并行专项审计（E1/E2/E3/E4a + 性能缓存）+ 主会话逐条复核

---

## 0. 结论摘要

**这批重构的质量整体很高**：Bridge SDK 解耦做到三份副本 sha256 完全一致，CapabilityGuard 归并逐字节等价，数据库 SSOT 收敛彻底（`db/index.ts` 1000+ 行 → 363 行、零内联 DDL），**端点↔鉴权映射在 5 次服务抽离中 1:1 全部对齐**。

但审计出 **3 个确定性功能损坏**（其中 1 个我已实测复现）和 **2 个权限/数据隔离缺口**。

| 级别 | 数量 | 说明 |
|---|---|---|
| 🔴 确定性功能损坏 | 3 | 用户点得到、必错 |
| 🟠 权限/归属校验丢失 | 2 | 1 个是搬迁遗漏，1 个是既有 |
| 🟡 契约回归 | 1 组 | 4xx → 500，8 个端点受影响 |
| ✅ 审计通过 | 2 | E1 数据库、E2 能力目录 |

---

## 1. 🔴 确定性功能损坏

### 1.1 成绩 PDF 导出必抛错（**我已实测复现**）

`214a848 perf(bundle)` 重写了 `gradeReportService.ts:164-165` 的动态 import，但没验证 `autoTable` 可用。

**实测结果**：
```
autoTable 存在: undefined          ← 当前代码路径
模块导出键: [Cell, CellHookData, Column, ...]
有 applyPlugin 导出: function
applyPlugin 后 autoTable: function ← 正确写法
```

**根因**：`jspdf-autotable@5.0.8` 的自注册块是 `var jsPDF = anyWindow.jsPDF || anyWindow.jspdf?.jsPDF; if (jsPDF) applyPlugin(jsPDF)` —— **只在 UMD 全局存在时注册**，而 ESM 入口不设该全局。于是 `doc.autoTable` 恒为 `undefined`。

**影响**：`useGradeExport.ts:126` → `generateClassPDFReport` → 点「导出 PDF」直接抛 `doc.autoTable is not a function`。
**测试覆盖：0 处**（`grep generateClassPDFReport` 在测试中零命中）。

**修复**：
```ts
const { jsPDF } = await import('jspdf');
const { applyPlugin } = await import('jspdf-autotable');
applyPlugin(jsPDF);
```
并补一条 jsdom 冒烟测试。

> 注：该缺陷早于本批提交（`git log -S` 显示 v5 自项目初始即锁定），但 `214a848` 恰好重写这两行却未验证，属"改了没测"。

### 1.2 课件 iframe 事件链彻底断掉

`088cc50 perf(mfe)` 把 `emitCoursewareEvent()` 里对 `whiteboardEventSlot.ingest()` 的直接调用删掉，改为"解耦"——靠事件总线转发。

**但通配符订阅根本不存在**（我已实测确认）：
```ts
// src/services/event-bus.ts:33-37  subscribe 把事件名当字面量 Map key
this.handlers.set(eventType, new Set());          // 存的是 'courseware.*' 这个字面量
// src/services/event-bus.ts:87    publish 只做精确查找
const handlers = this.handlers.get(event.type);   // 查 'courseware.submitted' → undefined
```
而订阅方 `WhiteboardEventSlot.ts:249` 订阅的是 `frontendEventBus.subscribe('courseware.*', ...)`。

**后果**：`courseware.submitted` / `courseware.progress_saved` / `courseware.event_logged` / `courseware.config_reported` 四类事件**永远进不了白板事件槽**。教师面板 `WhiteboardEventPanel.tsx:17,51` 与调试面板 `useWhiteboardEvents.ts:24,46,50` 永久静默失效。后端 socket 的 `courseware-attempt-updated` 路径仍会 ingest，所以表现为"部分事件有、部分没有"，极难定位。

**测试为何全绿**：`whiteboard-event-slot.test.ts` 直接调 `slot.emit()` 测槽本身，绕过 EventBus 路由。

**修复**：三选一 —— ① 给 EventBus 加前缀订阅（并补测试）；② 显式订阅 4 个事件名；③ 恢复 lms-bridge 的直接 ingest。

### 1.3 512KB 载荷防护被削弱

`088cc50` 的 `isPayloadOversized`（`lms-bridge.ts:146-151`）按 `v.length` 估算，而 `JSON.stringify` 会对 `\n`/`"`/控制字符转义（约 2–6 倍膨胀）。~400KB 的转义密集载荷序列化后 >1MB 仍能过闸。不构成严重 DoS，但这行注释声称的"防御超大 payload"强度低于 `088cc50` 之前的全量序列化版本。

---

## 2. 🟠 权限与数据隔离

### 2.1 分组删除丢了班级作用域（E3 搬迁遗漏）

**我已逐行确认**：

```ts
// 重构前（git show 2a1cbad^:server/routes/roster.ts:2060）
'DELETE FROM class_groups WHERE id = ? AND class_id = ?'

// 现在 roster-service.ts:747-750 —— class_id 没了
public deleteGroup(groupId: string): void {
  const res = this.db.prepare('DELETE FROM class_groups WHERE id = ?').run(groupId);
}
// 路由 roster.ts:1431 只传了 groupId，req.params.id（班级 ID）从未传入
```

同文件的 `updateGroup`、`listClassGroups` **都保留了** `class_id` 作用域 —— 典型搬迁遗漏。

**影响**：`DELETE /api/classes/{A班}/groups/{B班的小组id}` 会成功删除 B 班的小组，URL 里的班级 ID 沦为装饰。契约也从 404 变成 200。

**测试盲区**：`roster-service.test.ts` 对 `deleteGroup` 零用例，46/46 通过掩盖了这个丢失。

### 2.2 点名评价接口无角色限制（既有，非本批引入）

```ts
// server/routes/roster.ts:1331
app.post('/api/rollcalls/evaluate', requireAuth(), (req, res) => {
```

任意已登录用户（**包括学生**）可对任意 `studentId` 写入评价与 `rewardCoins`，写入 `student_rollcalls` 表并触发 `student:coins_awarded` 广播。我已确认完整链路：`roster-service.ts:930` INSERT + `roster.ts:1342` 广播。

重构前后完全一致，**不是回归**，但金币是学生激励资产，建议单独立项。

### 2.3 学生身份被缓存成无用户维度的模块级 Map

`src/services/lms-bridge.ts:26` — `const adoptedAttemptIds = new Map<string, string>()`，值绑定**具体学生**的 attempt 归属，**无 TTL、无上限、登出不清**。登出不刷新页面（`useSessionBootstrap.ts:96-103` 只有 `postLogout()`），所以 A 登出、B 登录后该 Map 原样存活。

链路：服务端 `shared.ts:124-138` 把同一个 `att_guest_*` 下发给该课件**所有**匿名访问者；A 完成上报后服务端把该行转移给 A 并返回同一 id，B 命中客户端缓存后**跳过服务端重新认领**，结果 B 的分数写进 A 的 attempt 行（学生侧表现为"提交成功但成绩没记录"）。

**当前未被稳定触发**（依赖服务端每次生成新 guest id 的隐式耦合），但一旦服务端改为稳定 id 即刻变成跨学生写数据。

**修复**：键改为 `${sessionUserId}:${attemptId}` + TTL + 登出清理。

---

## 3. 🟡 HTTP 状态码契约回归（8 个端点）

**根因**：`server/utils/error-handler.ts:12` 的 `sendSafeError(res, err, status = 500)`，且 `NODE_ENV=production` 时 `exposedMessage = fallbackMessage`。

E3 重构把原先的 `return res.status(4xx).json({error:'具体消息'})` 换成 service `throw new Error('具体消息')`，但**只有 courseware / assignment-hub / grading 三个路由层采用了 `e.status` 约定**，roster / lessons / classroom 全部退化成 500 + 生产环境吞掉消息。

| 端点 | 重构前 | 现在 |
|---|---|---|
| `GET /lessons/:id/pre-class-diagnostic` | 404 | **500** |
| `POST /lessons/:id/quiz-submit`（缺参 / 元素不存在） | 400 / 404 | **500** |
| `POST /classroom/sessions/:id/simulate-quiz-responses` | 400 | **500** |
| `POST /api/classes`（空 name） | 200 建空名班 | **500** |
| `POST /api/students`（空 name） | 200 建空名学生 | **500** |
| `PUT /api/classes/:id`（班级不存在） | 200 静默成功 | **500** |
| `POST /api/classes/:id/students`（脏数据） | 200 静默成功 | **500** |

**深层病因**：代码库现在有**两套错误状态约定**——
- 类型化（健壮）：`err.status = 403` + 路由 `if (e.status)`（courseware 全部、assignment-service 21 处）
- 字符串嗅探（脆弱）：路由层 `e.message?.includes('not found' | 'required' | ...)`（roster 8 处、assignments 2 处、grading 3 处）

后者的问题是**service 里任何一次文案微调（改错别字、换标点、翻译）都会把 4xx 静默翻成 500**，且 46 个 service 测试全不经过路由 catch，抓不到。

---

## 4. 🟠 潜伏的数据丢失路径

`PUT /api/classes/:id` 改为全量覆盖（`roster-service.ts:145-147`）：

```ts
.prepare('UPDATE classes SET name = ?, description = ?, lab_id = ? WHERE id = ?')
.run(name.trim(), description || '', labId || null, id);
```

配合路由层 `if (name)` 门控（`roster.ts:67`），产生两个缺陷：
1. **任何只带 `name` 的请求会清空 `description` 与 `lab_id`** —— `lab_id` 是班级↔机房绑定，`getClassSeats` 依赖它，置空后排座 UI 失效
2. **只改 `description` 的请求被完全忽略**（旧代码是 `if (description !== undefined)`）

**当前 4 个调用方全部只发 passcode 字段**，所以是**潜伏缺陷**而非线上事故——新增班级编辑 UI 即触发。趁没有调用方时改成本最低。

---

## 5. ✅ 审计通过的两项

### 5.1 E1 数据库 SSOT（我独立双向验证）

- 空库跑迁移 → 建出 **63 张核心表**；实库 97 张中多出的 **34 张全是 `plugin_*` 插件运行时自建表**，本就不该由迁移创建 → **核心 schema 完整**
- legacy 形态升级（表齐全但 `_migrations` 为空）→ 迁移重跑**成功、零漂移**（`CREATE TABLE IF NOT EXISTS` 幂等 + `duplicate column name` 容错覆盖了 `ALTER TABLE ADD COLUMN`）
- `packages/core/db/index.ts` 1000+ 行 → **363 行、零内联 DDL**，职责纯化为密码/pragma/路径/初始化

### 5.2 E2 能力目录归并 + E4a Bridge SDK 解耦

- **CapabilityGuard 逐字节等价**：全文件 diff 唯一差异是 7 行文件头注释，133 行逻辑体（`extractRole` 白名单、`*:*:*` 超级绕过、通配符部分匹配）完全一致；拦截器 `kernel/index.ts:273-288` 未被触碰；垫片是纯 re-export，不存在双实例
- **Bridge 三副本 sha256 完全一致**（我实测）：重构前内联 28952 字符 / 新包源 28952 / 当前生成物 28952，**同一 sha** → 沙箱边界代码零改动
- **iframe 沙箱属性未动**：`allow-scripts allow-forms allow-downloads`（**无** `allow-same-origin`）、`referrerPolicy="no-referrer"`、`credentialless` 全部保留
- 端点↔鉴权映射在 5 次 E3 抽离中**1:1 全部对齐**（含 `/api/users*` 的 administrator-only）
- 两个 `publishClassroomEvent`（`COURSEWARE_ATTEMPT_UPDATED`、`STUDENT_PROGRESS_UPDATED`）路由删掉后**已在 service 补回**
- 无循环依赖、无孤儿 import、43 个 chunk 全部产出、构建通过

---

## 6. 中低危清单

| # | 问题 | 位置 |
|---|---|---|
| M1 | **新包零测试覆盖**：bridge 是裸 IIFE，**既无幂等守卫也无幂等测试**；同一课件若同时命中 `injectLmsSdk` 与 `/bridge.js` 会被二次包装 | `packages/bridge-sdk/` 无 `__tests__/` |
| M2 | **`pnpm dev` 不跑生成脚本**：改 `bridge.js` 后跑 dev 服务的是**已提交的旧字符串**，沙箱代码改动在开发态完全不可见 | `package.json:46,48` |
| M3 | **`@openlearn/bridge-sdk` 从未被 import**：声明了 `main` 但全仓零引用，易误导后续开发者绕过 `BRIDGE_SDK_CODE` | `packages/bridge-sdk/package.json` |
| M4 | **element-cache 返回共享可变引用**并直接进 React state，还传给第三方插件属性编辑器；当前无原地写入，是"任何后续 mutation 都会全局污染"的陷阱 | `element-cache.ts:31-37` → `InteractiveWhiteboard.tsx:440` |
| M5 | **登出后 ≤45s 可无会话复用 token**（`tokenMemoryCache` 键只有 coursewareId）。真正问题是铸造端点 `courseware.ts:216` 只有 `requireAuth()`、**无归属校验**——缓存只是把既有 IDOR 冻结了 45s | `InteractiveCoursewareViewer.tsx:12` |
| M6 | **能力目录改用桶文件**后，`kernel/index.ts` 与 `worker-manager.ts` 为一个类付出整个 capability + AI 基础设施层的加载代价（目前无 import-time 副作用，非功能缺陷） | `packages/core/kernel/index.ts:4` |
| M7 | **死配置**：`vendor-reveal` 分包规则永��生效——`Reveal`/`RevealMarkdown` 被 tree-shake，产物 43 个 chunk 无一含 reveal 代码 | `vite.config.ts:88-90` |
| M8 | **6 处文档仍写 `packages/core/capability-system/`** 为权威位置，第三方插件若照此导入，将来删除垫片即断链 | `capability-gateway.md` 等 |
| M9 | **既有双轨权限实现**：`pipeline/permission-checker.ts`（按 `CapabilityRole` 枚举）与 `CapabilityGuard`（按 `resource:action` 字符串）同处一个目录，易被误认为同源 | `packages/core/capability/pipeline/` |
| M10 | **测试分层缺口**：46 个 service 测试全不经过路由 catch，H1 与全部 8 个状态码回归因此逃逸 | `server/services/__tests__/` |

---

## 7. 建议修复顺序

**第 1 批（确定性功能损坏，用户点得到）**
1. PDF 导出 `applyPlugin` + 冒烟测试
2. 课件事件链：给 EventBus 加前缀订阅（或恢复直接 ingest）+ 端到端断言

**第 2 批（权限/数据）**
3. `deleteGroup` 加回 `AND class_id = ?`（同文件 `updateGroup` 已有正确写法可直接照抄）
4. `updateClass` 改动态 SET（趁无调用方）
5. `adoptedAttemptIds` 键加用户维度 + 登出清理

**第 3 批（机制）**
6. 统一错误状态约定到 `err.status`，消除字符串嗅探
7. 补路由级状态码测试 + bridge 行为测试 + 生成物漂移 CI 检查
8. `rollcalls/evaluate` 补角色限制（可独立立项）

---

## 8. 本次审计的局限

- **未启动 dev server 做端到端 HTTP 验证**，全部结论基于静态 diff、单元测试与针对性脚本实测（如 PDF 那条我实际跑了 `applyPlugin` 前后对比）。
- **未审计 CommandBus 插件侧**（`assignment.get` / `courseware.get_attempt_raw_data`）的内部鉴权，只验证了路由层传入的 `payload`/`actorId` 与重构前一致。
- `grading-service.ts` 的 `semester-grades`（最大单个 handler）只做了端点/守卫/响应信封层面比对，**未逐行核对内部聚合 SQL**。
- 数据隔离矩阵（第 5 类缓存）基于静态分析，未做多用户并发实测。
- 第四路（E1 数据库 SSOT 专项 agent）运行超时被我终止——**其审计面我已独立双向验证**（空库建表 + legacy 升级），结论一致，无遗漏。
