# 扩展点与槽位参考

**结论先行**：槽位有**四套互不相同**的编号体系，混用是最常见的错误来源。
组件拿到的 props 只有三个来源（`route`、注册时的 `slotProps`、宿主调用点传的 `slotProps`），
**没有** `userId` / `role` / `socket` 的自动注入；身份靠 `dispatcher` + `services` 自取。

---

## 1. 四套编号体系（先分清再动手）

| 组    | 含义                          | 数量                                  | 定义处                                                | 与 UI 的关系                       |
| ----- | ----------------------------- | ------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| **C** | 前端 `ExtensionSlot` 联合类型 | **120**                               | `src/plugin-host/types.ts → ExtensionSlot`（L95-252） | 命令式注册组件的**唯一合法槽位名** |
| **D** | `anchor:*` 开放命名空间       | 类型上无限；**真有渲染调用点的 8 个** | `types.ts → AnchorSlot`（L265）                       | 插到宿主原生按钮前后               |
| **A** | `contributes` 严格键          | **71**                                | `manifest-schema.ts → contributesSchema`（L594-720）  | 声明式数据；多数有对应 C 组槽位    |
| **B** | `contributes` 宽松键          | **38**                                | `manifest-schema.ts → frontendSlotsShape`（L542-585） | 同上，只校验 `id` 必填             |

关系：

- `A ∩ B = ∅`；
- A 组里 **4 个**不在 C 组：`locales`、`palette.items`、`teacher.cockpit.widget`、`timeline.segments`（纯数据键）；
- B 组里 **1 个**不在 C 组：`workspace.view`；
- 机器可读真源：`docs/agent/contracts/slots.json`（120 条全集 + 8 个 anchor）。

**取证**：`docs/agent/contracts/contributes-groups.json → a_total / b_total`。**不要凭记忆报数字**，读该文件。

### 1.1 8 个真有渲染点的 anchor

```text
anchor:classroom-attribution:awards
anchor:whiteboard-toolbar:ai-tutor
anchor:whiteboard-toolbar:code-sandbox
anchor:whiteboard-toolbar:courseware
anchor:whiteboard-toolbar:grid
anchor:whiteboard-toolbar:math-graph
anchor:whiteboard-toolbar:presentation
anchor:whiteboard-toolbar:rollcall
```

往其它 `anchor:xxx` 写**不会报错**（类型上 `anchor:${string}` 全放行），只是永远不渲染。

---

## 2. 两套注册机制

### 2.1 声明式（`manifest.contributes`）

```json
{
  "contributes": {
    "classroom.seating.toolbar": [{ "id": "remote-power", "label": "远程开机", "commandType": "lab_seat.power_on" }],
    "teacher.tab": [{ "id": "seat-panel", "label": "机房座位", "view": "storage/seat.html" }]
  }
}
```

- 组件固定为 `NullExtensionComponent`（`plugin-host.ts` L203/L246），**纯数据**；
- `commandType` 被自动前缀化为 `<manifest.id>.<短名>`；
- 条目内**未在 zod 声明的字段会被 strip**。`view` 只在 `teacher.tab` / `teacher.panel` /
  `teacher.dashboard.widget` / `student.view` / `student.lesson.tool` 五个 schema 里显式声明
  （`manifest-schema.ts` L501 / L607 / L619 / L631 / L641）。

### 2.2 命令式（`ctx.ui.registerExtensionPoint`）

```ts
ctx.ui.registerExtensionPoint('teacher.tab', {
  id: 'seat-panel',
  label: '机房座位',
  icon: 'Armchair',
  component: SeatPanel, // 或 () => import(...) 且带 __isLazyFactory
  pluginId: ctx.pluginId, // 宿主会覆盖为真实 pluginId
  position: 100,
  rolesAllowed: ['teacher'],
  slotProps: { commandType: `${ctx.manifest.id}.lab_seat.list_rooms` }, // 必须全限定
});
```

| 约束                    | 说明                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `pluginId` 不可伪造     | `ui.register` 分支强制写入 `ctx.pluginId` 与 `origin:'runtime'`（`plugin-host.ts` L635-639） |
| 跨插件注销被拒          | `unregisterExtensionPoint` 由宿主注入调用方 pluginId（`types.ts` L537-538 注释）             |
| `component` 传函数      | `process` 插件**不可**这样做（`postMessage` 无法克隆函数 ⇒ `DataCloneError`）                |
| `slotProps.commandType` | 宿主在此处**不补前缀**，必须写全限定名                                                       |

### 2.3 同名冲突

主键是 `(slot, id)`。后注册的覆盖先注册的。声明式先于运行时注册（`activateRemotePlugin` L683-685），
因此**运行时注册赢**。跨插件同 id 也互相覆盖 —— 用 `<pluginId>-<name>` 做前缀可避免。

---

## 3. 四类容器语义（`layoutVariant`）

> ⚠️ `layoutVariant` 是**平台文档的语义分类**，不是运行时字段：`grep -r layoutVariant src/plugin-host/` 无命中。
> 它决定你写 CSS 的方式，别当 API 用。

| 类型                             | 宿主环境                       | 典型槽位                                                                                 | 规范                                                           | 禁止                                                |
| -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| **Panel**                        | 独占 Tab 视口，宿主给滚动容器  | `teacher.tab`、`teacher.panel`、`admin.tab`、`class.tab`、`timetable.tab`                | `w-full h-full` + `flex flex-col min-h-0`                      | —                                                   |
| **WhiteboardWidget**             | 白板画布内的图元卡片           | `teacher.dashboard.widget`、`student.view`、`whiteboard.canvas.widget`                   | 适配缩放与拖拽尺寸                                             | 当成页面级满屏面板                                  |
| **FloatingOverlay**              | 与主工作区**并列**的 Flex Item | `student.classroom.overlay`、`stage.display.overlay`、`student.quick_actions.fab`        | **必须** `position: fixed`（如 `fixed right-4 bottom-4 z-50`） | `w-full` / `h-full` / `flex-1`（会把白板挤成 0 宽） |
| **ActionItem / Badge / Toolbar** | 行内工具条 Flex 容器           | `classroom.topbar.action`、`header.action`、`course.card.badge`、`editor.segment.action` | 紧凑内联（`h-8 px-2 flex items-center`）                       | 撑高工具栏、换行                                    |

证据：`openlearn-next docs/reference/plugin-ui-extension-slots.md` §1.1.1（表格四行）。
该文档是**平台口径**，与 `src/plugin-host/extension-point-renderer.tsx` 的实际渲染分支一致（`student.classroom.overlay` 走独立容器）。

### 3.1 浮层高度契约（`view` 页面必做）

```js
// storage/xxx.html 内
window.OpenLearnPluginBridge.ui.resize(420); // 单位 px，非 op，是独立 resize 消息
```

宿主 `PluginSandboxIframeView` 监听 `ol-plugin-view` 通道的 `resize` 消息并同步 iframe 高度（保底 180px）。
折叠态建议 `resize(40)`，展开态 `resize(420)`。

---

## 4. 组件实际收到的 Props

渲染调用（`extension-point-renderer.tsx` L536）：

```tsx
React.createElement(resolveExtensionComponent(activeExt), mergedProps);
// mergedProps = { ...activeExt.slotProps, ...slotProps,
//                 router-route, dispatcher: getExtensionDispatcher(...) }
```

合并优先级（后者覆盖前者）：

```text
route（ext.route ?? 渲染器 route）
  → ...ext.slotProps（注册时声明）
    → ...slotProps（宿主调用点传入）
      → dispatcher（宿主注入的受控动作总线）
```

| 槽位类别                     | 宿主**确实**注入的额外 props                                                       | 不注入                                |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| 多数行内/徽章类              | `dispatcher`、`lang`                                                               | `userId`、`role`、`session`、`socket` |
| `student.view`               | `studentId`、`dispatcher`                                                          | `classId`（除非调用点显式传）         |
| 白板卡片（`view` 形态）      | `classId`、`studentId`、`studentName`（`plugin-host.ts` L551-553 的 iframe props） | —                                     |
| `teacher.tab`（panel 形态）  | `renderType: 'panel'`                                                              | 页面级上下文                          |
| `teacher.tab`（button 形态） | **组件不被渲染**，宿主自绘导航按钮                                                 | —                                     |
| `ai_sidebar.tab`             | `renderType`、`activeTab`、`setActiveTab`                                          | —                                     |

**身份与上下文的正确取法**（按优先级）：

1. `props.dispatcher.dispatch({ type:'host:refresh', payload:{ target:'students' } })` —— 触发宿主刷新；
2. `ctx.context.get()` → `{ lessonId, classId }`（`FrontendPluginContext.context`，`types.ts` L583-586）；
3. `ctx.services.frontendApi.get('/api/...')` —— 需要真实身份时走后端（`req.actor` 由服务端注入）；
4. `props.studentId`（仅 `student.view`）。

---

## 5. 显示与安全门控

| 门控                                                         | 求值时机   | 语义                         |
| ------------------------------------------------------------ | ---------- | ---------------------------- |
| `rolesAllowed: ('admin'\|'teacher'\|'student')[]`            | **注册时** | 不匹配的角色看不到该扩展点   |
| `position?: number`                                          | 渲染排序   | 升序                         |
| `group?: 'teaching'\|'management'\|'analytics'\|'extension'` | 导航分组   | 仅 `teacher.tab` 类          |
| `badge?: number \| string`                                   | 渲染       | 角标                         |
| 熔断                                                         | 渲染抛错时 | 3 次 / 5 分钟 → 摘除该扩展点 |

`rolesAllowed` **不是**权限系统：它只过滤可见性，真正的鉴权在服务端每个端点。

---

## 6. 空状态与失败态

| 情况                                 | 行为                                          | 证据                            |
| ------------------------------------ | --------------------------------------------- | ------------------------------- |
| 槽位无任何注册                       | 渲染 `null`，宿主布局不塌陷                   | `extension-point-renderer.tsx`  |
| `component` 抛错                     | ErrorBoundary 捕获，显示重试 UI；达阈值后熔断 | 同文件 + `extension-breaker.ts` |
| `view` 文件 404                      | iframe 空白，无错误日志                       | 安装期只解压 `storage/**`       |
| `origin:'manifest'` 条目在前端崩溃后 | **保留**（不摘除）                            | `types.ts` L303-315             |
| 同一 slot 多个 `view` 插件           | 按 `position` 排序，各自独立 iframe           | 推断                            |

---

## 7. 最小可用示例（两个通道各一）

### 7.1 声明式：座位图工具栏按钮

```json
{
  "id": "@aymwoo/plugin-lab-seat",
  "contributes": {
    "classroom.seating.toolbar": [
      { "id": "assign", "label": "一键排座", "icon": "Armchair", "commandType": "lab_seat.assign_seats" }
    ]
  }
}
```

宿主渲染按钮 → 点击派发 `<manifest.id>.lab_seat.assign_seats` → 命中你注册的 handler。

### 7.2 运行时：带 `view` 的教师页签

```ts
await ctx.ui.registerExtensionPoint('teacher.tab', {
  id: 'seat-panel',
  label: '机房座位',
  view: 'storage/seat.html', // 必须是 storage/ 前缀
  pluginId: ctx.pluginId,
  rolesAllowed: ['teacher'],
  position: 60,
});
```

`storage/seat.html` 内必须引 `/plugin-sandbox/view-bridge.js` 并调用 `ui.resize()`。

---

## 8. 反例清单（每条都对应真实故障）

| 反例                                                                          | 后果                                 |
| ----------------------------------------------------------------------------- | ------------------------------------ |
| `registerExtensionPoint('classroom.tool', { component: fn })`（process 插件） | `DataCloneError`，激活失败           |
| `slotProps: { commandType: 'lab_seat.list_rooms' }`（运行期注册写短名）       | 前端按字面派发 → 404 / 403           |
| 浮层 `view` 写 `w-full h-full`                                                | 白板被挤成 0 宽                      |
| `manifest.contributes['teacher.tab'][0].view` 写 `views/seat.html`            | 文件不进包且不匹配 `storage/` → 空白 |
| 依赖宿主自动注入 `userId`                                                     | `undefined`，逻辑静默失效            |
| 在 `classroom.tool` 里塞整块面板                                              | 工具栏高度错乱                       |
