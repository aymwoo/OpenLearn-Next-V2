# 金丝雀插件（Canary Plugin）测试实施方案

> 状态：**设计定稿，待实施**。本文汇总五个设计件：探针 manifest、activate 骨架、社区注册表 fixture、测试矩阵、打包 builder。
> 目标：以一个"金丝雀探针插件"走完第三方插件全生命周期，同时验证**文档正确性、SDK 契约（33 Token）、宿主双模式、HTTP 网关、社区市场**五条链路。
> 基准版本：v0.3.22 / SDK 3.7.0 / test-kit 3.3.3 / vitest 4.1.9。所有预期报错文案均已在源码核实（标注出处）。

---

## 0. 设计总则

- **两个载体**：`canary`（合法全功能探针）+ 一组**毒丸 ZIP**（每类非法场景一枚）
- **双模式原则**：除标明「仅 inline」外，激活/运行探针在 `inline` 与 `worker` 模式各执行一次，断言一致；差异点单独列表
- **黑盒驱动**：探针结果经插件自身 HTTP 端点（`/probes`）暴露，测试代码全部走 HTTP，不 import 插件内部
- **ok 语义**：探针的 `ok=true` 表示「实际行为符合预期」——预期失败（如 SEC 拒绝）也记 ok，避免把已知拒绝误判为故障
- **记录现状项**：清单中 6 处「记录现状」（1.1 / 1.9 / 4.7 / 5.3 / 敞口标注）断言当前实际行为而非理想行为，这些是后续修复讨论的输入

## 1. 文件布局

```
server/__tests__/canary/
├── README.md                 # 本文档
├── expectations.ts           # 全部期望表（纯数据：PROBE_MATRIX / MODE_DIFFS / TOKEN_SWEEP / REQUIRE_SWEEP / POISON_MATRIX）
├── canary.builder.ts         # 打包与 HTTP 驱动 helper（11 个导出函数）
├── canary.e2e.test.ts        # describe.each 主矩阵
├── fixtures/
│   └── registry-v1.json      # 社区市场 fixture（单测用；E2E 托管公网）
└── canary-src/               # 金丝雀"作者工程"（真实 TS 源码，tsc 类型检查覆盖）
    ├── index.ts              # activate 骨架（§3）
    ├── contracts.ts          # CanaryProbeToken
    ├── manifest.template.json# manifest 定稿（§2），测试注入覆盖项生成变体
    └── frontend.tsx          # 可选前端入口（classic JSX）
```

---

## 2. 探针 manifest（`manifest.template.json` 定稿）

```jsonc
{
  "id": "ext-canary",                          // 命令空间 canary.*、表前缀 plugin_ext_canary_ 均由它派生
  "name": "金丝雀探针插件",
  "version": "1.0.0",                          // 三档复用：0.9.0 降级 / 1.0.0 当前 / 1.0.1 升级
  "main": "index.js",                          // 显式声明，不依赖 ZIP 路径隐式默认（install-utils.ts:159）
  "engines": { "openlearn": ">=0.3.0" },       // 毒丸变体：">=99.0.0"、"^0.2.9"（零主版本互锁）
  "requires": [
    "@openlearn/core:ICommandBusService@^1.0.0",
    "@openlearn/core:IEventBusService@^1.0.0",
    "@openlearn/core:IDatabase@^1.0.0",
    "@openlearn/core:IStorageService@^1.0.0"
  ],
  "optional": ["@openlearn/core:IAIService@^1.0.0"],
  "capabilitiesProposed": [
    "lesson:read", "lesson:write", "file:write"
    // 刻意不申请 lesson:control —— 供权限反向断言（startActivity 必 PERMISSION_DENIED）
  ],
  "provides": ["ext-canary:ICanaryProbeService"],   // Token 名全等，必须含冒号
  "api": {
    "baseRoute": "/canary",
    "routes": [
      { "method": "GET",  "path": "/status",    "auth": true },
      { "method": "GET",  "path": "/items/:id", "auth": true, "roles": ["teacher", "administrator"] },
      { "method": "POST", "path": "/echo",      "auth": true },
      { "method": "GET",  "path": "/public",    "auth": false }
      // stream 刻意不声明（ctx.http.stream 命令式注册）→ 清单 5.3 记录现状项
    ]
  },
  "contributes": {
    "teacher.tab":         { "id": "canary-tab", "label": "金丝雀", "icon": "Bird", "position": 50 },
    "student.view":        { "id": "canary-student", "label": "探针面板" },
    "classroom.tool":      { "id": "canary-tool", "name": "探针互动", "icon": "Activity", "commandType": "canary.ping" },
    "anchor:*":            { "id": "anchor:toolbar-export", "placement": "before", "label": "探针锚点" },
    "help.plugin_docs":    { "id": "canary-docs", "title": "金丝雀说明", "markdownUrl": "/plugins/canary.md" },
    "student.lesson.tool": { "id": "canary-lesson-tool", "label": "课中探针" }
  },
  "classroomTools": [
    { "id": "canary-classroom", "name": "探针", "icon": "Bird", "commandType": "canary.ping", "payload": { "src": "classroom" } }
  ],
  "configuration": {
    "properties": {
      "showInDashboard":  { "type": "boolean", "default": true },
      "maxPollOptions":   { "type": "number",  "default": 10, "minimum": 1, "maximum": 20 },
      "greeting":         { "type": "string",  "default": "hello", "enum": ["hello", "hi"] },
      "enableAnonVoting": { "type": "boolean", "default": false }
    }
  },
  "updateSource": { "type": "github-release", "repo": "aymwoo/openlearn-canary" }
}
```

**ZIP 结构**：`manifest.json` + `index.js`（esbuild 产物）+ 可选 `frontend.js` + 可选 `package.json`。

**字段 ↔ 断言映射**：`id`→2.1/4.1/4.6/5.1/3.1；`main`→0.4/1.1-1.3；`engines`→8.7/8.8；`requires`→2.4/2.5；`capabilitiesProposed`→3.4；`provides`→6.1-6.4；`api.routes`→5.1-5.8；`contributes`→7.1-7.5/7.8；`configuration`→5.11/7.8；`updateSource`→8.1-8.6。

---

## 3. activate 骨架（`canary-src/index.ts`）

核心机制：**自报告探针**——统一执行器 `probe(id, expected, fn)` 捕获一切结果（含预期失败）写入内存 Map + 自建表持久化，经 `GET /probes` 暴露。

```typescript
// 模式探测：worker 的 db 是异步 RPC 代理（exec 返回 Promise），inline 同步
function detectMode(ctx: PluginContext): 'inline' | 'worker' {
  try { return (ctx.db as any).exec('SELECT 1') instanceof Promise ? 'worker' : 'inline'; }
  catch { return 'worker'; }
}

// activate 结构（按断言清单编号分段）：
// ├─ ensureTable('probe_results') / ('probe_kv')        → 顺带完成 4.1
// ├─ probe('2.1-pluginId') / ('2.2-services')           → services 恰 9 键 + worker 下 points*=null
// ├─ ctx 暴露 tokenSweep/requireSweep（闭包函数，经 POST /probes/run 触发）→ 2.5 / 6.5-6.6
// ├─ registerHandler('canary.ping')                     → 3.1（worker 前缀语义记录）
// ├─ subscribe('lesson.created') 计数                    → 3.5 / 9.2
// ├─ db.migrate(1, fn)                                   → 4.10 幂等重放
// ├─ http.get: /status /probes /items/:id /echo /public /ticks
// ├─ http.stream('/events')                              → 5.3 / 5.9（命令式未声明路径）
// ├─ provide(CanaryProbeToken, …)                        → 6.1 由 noprovides 毒丸变体触发
// ├─ processManager.registerInterval('canary-heartbeat', 1000) → 9.3 停用后停摆
// └─ deactivate: 仅显式 unsubscribe；其余回收依赖宿主（断言宿主完整性）
```

**关键实现规则**：

1. `detectMode` 用 `exec` 返回值判型，不依赖宿主模式字段
2. 探针结果双写（内存 + SQLite）——worker 下内存经 RPC 序列化异常时，落表路径独立可验
3. `detail` 截断 2000 字符落表；精确文案断言在内存层做
4. 毒丸变体共用同一 index.js，只改 manifest（见 §6 变体表）

---

## 4. 社区注册表 fixture

**关键前提**：`resolveCommunityRegistryUrl()` 对注册表地址本身做 SSRF 校验（community-registry.ts:246），`127.0.0.1` 被判非法 → 服务端返回「未配置」。因此：

- **L1/L2**：URL 写 `https://registry.example.com/v1.json`（过格式校验），mock `global.fetch` 返回 fixture——归一化矩阵零网络
- **L3 E2E**：fixture 托管公网（raw.githubusercontent），env 指向
- **install-from-url happy path**：本地 ZIP 回环必拦 → 真实安装走 `fallbackToClient` 浏览器直传；`install-from-url` 只测 400/安全拦截分支

### `registry-v1.json`（v1 信封，归一化预期：kept=6 / skipped=7 / registryVersion=3）

| 条目 | 内容要点 | 断言 |
|---|---|---|
| E1 ext-canary **1.0.1**（featured/verified，排前） | 全字段 | 本机装 1.0.0 时 `hasUpdate=true`；keep-first 保留它 |
| P1 ext-canary 1.0.0（重复 id，排后） | — | 丢弃，skipped+1（:194-195） |
| E2 ext-popular（downloads=9999 非 featured） | 排序基准 | featured > downloads 优先级（:209-210） |
| E3 ext-nightly（version:"nightly"） | 非 semver | 原样保留；hasUpdate=false；请求整体 200（:226-231 双向校验） |
| E4 ext-minimal（仅 id+downloadUrl） | 最小条目 | name=id、author='Community'、version=''、homepage=null 等全默认值 |
| E5 ext-alias（download_url/repo/min_platform_version/published_at + homepage `javascript:`） | snake 别名 | 别名映射生效；homepage 不安全置 null 但条目保留 |
| E6 ext-multitag（9 个 tags） | 超上限 | tags 裁剪为 8（asStringArray） |
| P2 缺 id / P3 id "Bad Id!" / P4 缺 downloadUrl / P5 `file:` / P6 `169.254.169.254` / P7 `192.168.x` | 毒丸 | 逐条 skipped+1（id 模式 / isSafeExternalUrl 三类拦截） |

**信封变体**（5 组）：`{version, plugins}` 主形态 / `{version, items}` 别名 / 裸数组 / 空注册表（前端空态）/ 无容器 → `{plugins:[], skipped:0}`。另有畸形 JSON（fetch 成功解析失败 → **失败不写缓存**）与运行时生成 501 条（`slice(0,500)` 截断，:192，代码生成不提交静态文件）。

---

## 5. 测试矩阵（`describe.each` 组织）

### 期望表（expectations.ts，纯数据）

- `PROBE_MATRIX`：两模式行为一致的探针（id → detail 精确串/正则），含 SEC 报错全文比对：
  - `4.2` → `\[SEC\] Invalid SQL identifier for ensureTable\(tableName\): "canary-items"`
  - `4.4` → `\[SEC\] createTable schema must be a non-empty string \(max 4000 chars\)`
  - `6.5` → `cannot require "xlsx"\. Allowed modules: recharts, react-markdown, jspdf, jspdf-autotable, exceljs, lucide-react, uuid`（context-builder.ts:744-747）
- `MODE_DIFFS`：双模式差异（优先级高于主矩阵）——`3.1` 命令前缀、`4.3` 分号文案（inline `must not contain ";"` vs worker `contain no semicolon`）、`4.7` exec 同步 vs Promise、`4.8` transaction、`2.2-points`（inline=set / worker=null）
- `TOKEN_SWEEP`：33 Token 全表，唯独 `IClassroomCountdownServiceToken` 期望失败
- `REQUIRE_SWEEP`：白名单 7 个必须成功 + `xlsx`/`fs`/`lodash` 必须失败
- `POISON_MATRIX`：变体 → (期望状态码, 期望错误正则)

### 主矩阵结构（canary.e2e.test.ts）

```typescript
describe('金丝雀插件全链路', () => {
  beforeAll(安装);
  describe.each(MODES)('【%s 模式】', (mode) => {
    beforeAll(先 deactivate → activate(mode) → runSweep(tokens/require) → getProbes);
    it.each(主矩阵 ∪ MODE_DIFFS[mode])('探针 %s', …);   // ok=true + detail 比对
    it.each(TOKEN_SWEEP)(…)                              // 33 条；失败者必须匹配 /countdown/
    it.each(REQUIRE_SWEEP)(…);                           // 10 条
    it(HTTP 网关 4 条 + provide 毒丸 1 条);
  });
  describe('停用与卸载回收', …);                          // 9.1-9.6 顺序敏感
  describe('毒丸安装矩阵', () => it.each(POISON_MATRIX)(…));
  describe('社区市场归一化', () => it.each(信封 5 组)(…));
});
```

约 **85 个 it 用例**由 5 张表驱动。顺序即语义：三块有意串行，`fileParallelism: true` 只影响文件间。失败信息带上下文：`expect(probe.ok, \`${id}@${mode} 失败：${detail}\`)`。

### 已知坑（写入测试注释）

- **vitest 4.1.9 在测试运行存在失败用例时静默跳过覆盖报告**（本机实测复现）；CI coverage job 若要出报告，运行必须全绿（或排除失败文件）
- worker 激活超时默认 60s：测试内 `process.env.OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS = '20000'` 须在 worker-manager 模块加载前设置

---

## 6. 打包 builder（canary.builder.ts）

### 职责边界（关键事实）

宿主 `validateAndBundleZip()` 安装时对 `index.js` 再做 esbuild（token-enforcer 扫描 + 打包）。**ZIP 里的 index.js = 作者侧 esbuild 产物**（bundle 完成、SDK external）——宿主只应看到相对导入与 `@openlearn/*` 两类导入。

### esbuild 参数

| 产物 | 关键选项 |
|---|---|
| `index.js` | `format:'esm'`（对齐 esm-loader）、`platform:'node'`、`target:'node20'`、`external:['@openlearn/plugin-sdk']`、`sourcemap:'inline'` |
| `frontend.js`（可选） | `jsx:'transform'`（classic，不产生 react/jsx-runtime 导入）、`external:['react','react-dom','recharts','lucide-react']`（HostSharedDeps 提供） |

manifest 以独立文件写入 ZIP 根（宿主 `zip.file('manifest.json')` 读取），模板 + `manifestOverrides` 深合并生成变体。

### 毒丸组装差异

| 变体 | 组装 |
|---|---|
| nested-zip | `zip.folder('canary').file(…)` 嵌套布局 |
| all-method / engine99 / engine02 / missing-entry | manifestOverrides 注入，正常组装 |
| traversal | `zip.file('../evil.js', …)`——**JSZip 可能规范化 `../`**，实测；被吞则降级为 install-utils 宿主单测直测（已有覆盖） |
| bomb | `zip.file('padding.bin', Buffer.alloc(301*1024*1024, 0))`——全零经 DEFLATE 极小但 uncompressedSize 命中 300MB 检查（level 1 加速） |

### HTTP 驱动 helper（11 个导出）

`buildCanaryZip / buildPoisonZip / installZip / activate / deactivate / uninstall / getProbes / runSweep / getTicks`。走 supertest + 管理员会话（与既有 server 测试同构）。**实现时先验证**宿主是否有带 `mode` 的激活 HTTP 端点；若无，`activate` 白盒直调 `pluginHost.activatePlugin(pluginId, { mode })` 并注释说明。

### 缓存

进程内模块级缓存 `index.js` 产物（同文件多 describe 复用）；不跨文件。

---

## 7. 实施顺序

| 步 | 内容 | 验证点 |
|---|---|---|
| 1 | ✅ builder 骨架 + 最小合法 ZIP 打通安装闭环（R2 已排除） | 上传 → 激活 inline → `/status` 200（`canary.step1.test.ts` 4/4） |
| 2 | activate 骨架完整化（探针结果落表 + /probes） | GET /probes 返回首批结果 |
| 3 | 主矩阵（expectations.ts + canary.e2e.test.ts 双模式） | 85 用例全绿 |
| 4 | 毒丸矩阵（8 变体） | 逐条拒绝文案比对 |
| 5 | 回收断言（9.1-9.6） | worker 轮次后无残留 |
| 6 | 社区市场（单测 5 组 + 公网 fixture E2E） | 归一化 + hasUpdate + UI |
| 7 | Playwright 旅程（阶段 7 前端，顺带填 playwright 空转） | Tab 渲染 / studentId 注入 / 锚点 |

## 8. 风险登记

| # | 风险 | 处置 |
|---|---|---|
| R1 | JSZip 对 `../` 条目名的规范化 | 实测；被吞则该毒丸降级为宿主直测 |
| R2 | 宿主二次 esbuild 对 ESM external 的处理 | 步骤 1 先行打通 |
| R3 | worker fork 内 SDK 实例一致性 | 依赖 Token phantom type 跨实例兼容；断言禁用 `instanceof` |
| R4 | bomb 变体 301MB 内存峰值 | 单独跑；coverage job 与其并行需注意 |
| R5 | classic JSX 前端加载接受度 | 阶段 7 验证；失败则前端降级为纯声明式 contributes |

## 附录 A：阶段 7 前端断言明细（2026-09-25 随 2320687 提交复核更新）

新提交为座位图落地了渲染器，并新增 2 个 autosave 槽位（**槽位总数 53 → 55**）：

| # | 断言 | 预期 |
|---|---|---|
| 7.1 | manifest 声明 `teacher.tab` + `ctx.ui.registerExtensionPoint` | 教师端主导航出现「金丝雀」Tab，点击渲染插件组件 |
| 7.2 | `student.view` | 组件收到 `slotProps.studentId` |
| 7.3 | 任意槽位组件 | 统一收到 `{ lessonId, classId }`（extension-point-renderer 未被新提交改动） |
| 7.4 | `anchor:toolbar-export:before` | 按钮出现在锚点前侧、`position` 升序 |
| 7.5 | 声明 `classroom.seating.toolbar` / `legend` / `summary` / `seat_badge` | **在机房座位页真实渲染**（`ComputerLabSeatingMap.tsx:192/267/302/363`）。前置：先经 `GET /api/classes/:classId/seats` 准备 `computer_labs` + `student_seats` 数据。slotProps：toolbar=`{classId,lab,stats}`、legend/summary=`{classId,stats}`、seat_badge=`{seat,student,isOnline,classId}`（座位级，每个有座学生渲染一次） |
| 7.5b | 声明 `classroom.seating.seat_actions` | 注册成功但**暂不渲染**（右键菜单挂载未实现，记录现状项） |
| 7.6 | 组件内 `invokeCommand('canary.ping')` | 经后端 handler 返回 |
| 7.7 | 组件 import `@/` 内部单例 | 构建期被拒 |
| 7.8 | `showInDashboard: false` | 插件卡片总览开关隐藏 widget |
| 7.9（新增） | 声明 `whiteboard.autosave.status` / `action` | 在课程编辑器渲染（`LessonEditorView.tsx:261/270`）；slotProps：status=`{lessonId,status,pendingCount,lastSavedTime}`、action=`{lessonId,flush,pendingCount}`；伴随事件 `whiteboard.autosave.pending/saving/saved` |

**文档同步影响**：`docs/reference/plugin-ui-extension-slots.md` 已随本次复核更新（55 槽位、渲染器表 6 行、seat_actions 未挂载标注）；`docs/tutorials/plugin-development-tutorial.md` §6.4 注脚的"53 个槽位"需同步为 55。

## 9. 「记录现状」清单（后续修复讨论输入）

1. **1.1** 缺 `main` 时 ZIP 路径静默注入 `'index.js'`（install-utils.ts:159）——与 schema 必填语义不一致
2. **1.9** 重复安装同 id 的现有语义（更新 or 拒绝，实施时记录）
3. **4.7** inline 模式 `ctx.db.exec` 可执行任意 DDL/DML（权限敞口）
4. **5.3** 命令式注册但 manifest 未声明的端点的网关语义
5. **5.x** SEC 报错文案 inline/worker 两套不一致（4.3）
6. **2.5** `IClassroomCountdownServiceToken` 无实现无注册（已在 di-tokens.md 标注勿用）
7. **步骤 1 实测**：`NODE_ENV=test` 时激活退化为 data: URL 加载，无法解析 external 的 `@openlearn/*` 导入（plugin-host/index.ts:1235 分支）——测试必须显式切 `NODE_ENV='production'` 复现生产行为；测试环境与生产行为存在此分叉
8. **步骤 1 实测**：ZIP 安装插件的 `ctx.pluginId` 是 **DB UUID**（非 manifest.id），与 `plugin-sdk.md` 的"唯一实例标识"表述存在口径冲突；表前缀相应为 `plugin_<uuid 整理后>_`
9. **步骤 1 实测**：vitest module runner 对仓库外路径（/tmp）的 `import(file://…)` 抛 ERR_MODULE_NOT_FOUND——测试的 pluginsDir 必须位于仓库内（已固定为 `server/__tests__/canary/.tmp-plugins-*`，gitignore 覆盖）
10. **步骤 1 实测**：宿主符号链接指向的是 **node_modules 中已发布的 @openlearn/plugin-sdk@3.6.1**（根 package.json 依赖 ^3.6.1），而非 workspace 源码 3.7.0——Token 按 name 解析不受影响，但"插件运行时 SDK 与宿主同源"的表述需留意

## 附录 B：机房座位图种子数据（启用 7.5 渲染断言）

> 表 DDL：`computer_labs(id, room_number, rows, cols, created_at)`、`student_seats(class_id, student_id, lab_id, row_idx, col_idx, PK(class_id, student_id))`（packages/core/db/index.ts:235-250）。
> 关键约束：`classes.lab_id` 与 `student_seats.lab_id` 必须一致——`GET /api/classes/:classId/seats` 分别从两处读取（roster.ts:869-886），前端用返回的 `lab_id` 在 labs 列表中 `find` 命中机房信息。

### B.1 API 驱动种子（L3 E2E / Playwright，全黑盒，teacher 会话）

```text
1. POST /api/labs           { room_number: "机房A-101", rows: 4, cols: 6 }
   → { id: "lab_xxxx" }                                   // id 形如 lab_<random8>（roster.ts:834）
2. POST /api/classes        { name: "金丝雀测试班", description: "canary seating" }
   → { id: "cls_xxxx" }
3. POST /api/students × 8   { name: "学生01" .. "学生08" }
   → 每次返回 { id }（学号自动生成；默认密码 123456）
4. POST /api/classes/:classId/seats
   { lab_id: "<labId>", seats: [                          // 8 人中 6 人落座前两排
     { student_id: s01, row_idx: 0, col_idx: 0 },         // ← 在线
     { student_id: s02, row_idx: 0, col_idx: 1 },         // ← 在线
     { student_id: s03, row_idx: 0, col_idx: 2 },         // ← 离线
     { student_id: s04, row_idx: 1, col_idx: 0 },         // ← 离线
     { student_id: s05, row_idx: 1, col_idx: 1 },         // ← 在线
     { student_id: s06, row_idx: 1, col_idx: 2 }          // ← 离线
   ] }                                                    // s07 / s08 故意不落座 → "未分配"分支
   → { success: true }                                    // 接口自动双写 classes.lab_id + student_seats（先清后插，roster.ts:891-908）
5. GET /api/classes/:classId/seats（读回校验）
   → { lab_id, seats: [6 条，含 LEFT JOIN students 得到的 student_name / student_number] }
```

在线态来源：`isOnline = onlineStudentIds.includes(student_id)`（presence 在线名单，ComputerLabSeatingMap.tsx:223）。E2E 中让学生 s01/s02/s05 各开一个已登录浏览器会话即可点亮 3 个在线徽章；纯集成测试可跳过（全部离线也是合法断言面）。

### B.2 SQL 直灌种子（L2 集成测试，白盒）

```sql
INSERT INTO computer_labs (id, room_number, rows, cols, created_at)
VALUES ('lab_canary', '机房A-101', 4, 6, 1737800000000);
-- 班级若走 API 创建则跳过 classes 插入（id 由服务端生成）；
-- 直灌时必须同步 classes.lab_id（GET 端点从 classes 表读 lab_id，roster.ts:871-873）：
UPDATE classes SET lab_id = 'lab_canary' WHERE id = '<classId>';

INSERT INTO student_seats (class_id, student_id, lab_id, row_idx, col_idx) VALUES
  ('<classId>', '<s01>', 'lab_canary', 0, 0),
  ('<classId>', '<s02>', 'lab_canary', 0, 1),
  ('<classId>', '<s03>', 'lab_canary', 0, 2),
  ('<classId>', '<s04>', 'lab_canary', 1, 0),
  ('<classId>', '<s05>', 'lab_canary', 1, 1),
  ('<classId>', '<s06>', 'lab_canary', 1, 2);
-- ⚠️ 直灌必须保证 students 表已有 s01-s06 记录（GET 端点 LEFT JOIN students 取姓名/学号）
```

### B.3 种子数据 ↔ 渲染断言映射

| 种子要素 | 驱动的断言 |
| --- | --- |
| 6 人落座 + 2 人未落座 | 座位卡 `hasSeat` 两分支；未落座渲染「未分配」且**不挂 seat_badge 扩展点** |
| 3 在线 / 3 离线 | `seat_badge` 的 `slotProps.isOnline` 两态；状态点样式两分支 |
| students 表真实记录 | `student_name` / `student_number` 经 LEFT JOIN 返回非空 |
| （可选毒样）seat 指向不存在的学生 | LEFT JOIN 产生 null 姓名分支的容错渲染 |
| `classes.lab_id` 与 `student_seats.lab_id` 一致 | 前端 `labs.find(l => l.id === lab_id)` 命中，机房信息面板渲染 |
| rows=4 × cols=6 网格 | 座位矩阵按 row_idx / col_idx 排布正确性 |
