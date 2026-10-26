# 前端插件指南：加载、上下文与扩展点

<!-- doc-version: sdk=3.7.1 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.1` / 平台 `v0.7.4+`
>
> 本页是[插件开发完全指南](plugin-development-tutorial) §6 的正文，讲**前端 bundle 怎么被加载、拿到什么上下文、能注册哪些扩展点**。
> 备课画板图元、教学环节类型、环节进入条件属于「课件内容扩展」，见配套篇：[课件与教学环节扩展](plugin-courseware-extensions)。

---

## 0. 先确认你落在哪一档

前端代码的执行环境由**插件来源**决定，不是由你的构建配置决定：

| 插件来源                                      | 前端执行环境                                              | 能给可见 UI 吗                    |
| --------------------------------------------- | --------------------------------------------------------- | --------------------------------- |
| 内置插件（`packages/plugins/*`）              | `inline`：与宿主同 realm，`import()` 直接加载             | ✅ 能（正常 React 组件）          |
| 管理员加入 `OPENLEARN_TRUSTED_INLINE_PLUGINS` | `worker_threads` / `inline`                               | ✅ 能                             |
| **第三方 ZIP 插件（绝大多数开发者）**         | `process`：不透明源隐藏 iframe（`/plugin-sandbox/frame`） | ❌ **不能**（只能声明数据型贡献） |

> 🚩 **第三方插件的硬边界**（`v0.7.0` 起）：你的 `frontend.js` 跑在 `sandbox="allow-scripts"` 的**隐藏** iframe 里 ——
> 没有 `allow-same-origin`，没有 `window.HostSharedDeps`，没有 `React`，`component` 是函数因而**无法**跨 postMessage 传递（`DataCloneError`）。
> 因此本页 §2–§5 里的 `component` / `uiService.showModal` / `socketService` 等成员对第三方插件**不存在**。
> 第三方插件的前端能做的只有五件事：`frontendApi` 调后端、`storageService` 存键值、
> `invokeCommand` 派发命令、`ui.showToast` 弹提示、`ui.registerExtensionPoint` 注册**数据型**条目。
> 完整能力边界与路线见 [前端沙箱能力边界](../plugin/frontend-sandbox-capability-boundary)，
> 档位判定见[教程 §2.2](plugin-development-tutorial#execution-modes)。

---

## 1. FrontendPluginHost

前端插件运行在浏览器中，通过动态 `import()` 加载 ESM 模块。三档执行模式在前端侧的落点：

| 前端执行模式 | 加载方式                                    | 适用                       |
| ------------ | ------------------------------------------- | -------------------------- |
| `inline`     | 父页面 Blob URL + `import()`                | 内置插件                   |
| `worker`     | 前端 Worker（`browser-worker-manager.ts`）  | 受信插件                   |
| `process`    | 隐藏 iframe + postMessage RPC（**第三方**） | ZIP 插件（默认，不可绕过） |

`legacy`（vm 时代残留）勿用。判定逻辑在 `src/plugin-host/plugin-host.ts` 的
`activatePlugin` / `activateRemotePlugin`，模式来源见 `src/plugin-host/types.ts` 的 `executionMode`。

**inline 插件的模块形状**（一个可运行的最小示例）：

```typescript
// frontend.tsx —— 仅 inline / worker 模式成立
export default {
  manifest: {
    id: '@scope/frontend-plugin',
    name: '前端插件',
    version: '1.0.0',
    author: 'Author',
    capabilitiesProposed: [],
    classroomTools: [
      {
        id: 'my-tool',
        name: '🔧 我的工具',
        icon: 'Wrench',
        commandType: 'myplugin.tool_action',
        payload: {},
      },
    ],
  },

  activate: async (ctx: FrontendPluginContext) => {
    // ctx.services.frontendApi   — HTTP API 调用
    // ctx.services.socketService — WebSocket 通信
    // ctx.services.uiService     — Toast/Modal UI
    // ctx.services.storageService — localStorage

    ctx.ui.registerExtensionPoint('teacher.tab', {
      id: 'my-tab',
      label: '我的面板',
      icon: 'Layout',
      component: () => import('./MyPanel'),
      position: 10,
      pluginId: ctx.pluginId,
    });
  },
};
```

**唯一的跨档硬契约**：`default export` 必须是**带 `activate` 函数的对象**。
沙箱加载器逐字检查 `typeof plugin.activate !== 'function'`，不满足直接抛
`missing activate function` 并把插件置为错误态 —— 第三方插件把组件当 default 导出是本仓库出现过的
真实事故（脚手架模板曾这样生成，见 [Scaffold CLI §3](../sdk/scaffold-cli)）。

---

## 2. FrontendPluginContext

```typescript
interface FrontendPluginContext {
  services: {
    frontendApi: IFrontendAPI; // HTTP API 调用
    socketService: ISocketService; // WebSocket 通信（仅 inline / worker）
    uiService: IUIService; // Toast/Modal/文件下载（仅 inline / worker）
    storageService: IStorageService; // localStorage
  };
  pluginId: string;
  manifest: FrontendPluginManifest;
  ui: {
    registerExtensionPoint(slot: ExtensionSlot, config: ExtensionPointConfig): void;
    unregisterExtensionPoint(slot: ExtensionSlot, id: string): void;
    registerPaletteItem(config: PaletteItemConfig): void; // v0.3.17: 注册备课画板组件
    unregisterPaletteItem(type: string): void;
    registerSegmentType(type: SegmentTypeMeta): void; // 注册自定义教学环节类型
    unregisterSegmentType(id: string): void;
  };
  invokeCommand<T = any>(type: string, payload?: any): Promise<T>; // V2.5: 调用后端 Command Handler
  // 页面导航与 Tab 订阅控制（仅 inline / worker）
  navigation?: {
    getTeacherTab(): string;
    setTeacherTab(tab: string): void;
    subscribeTeacherTab(callback: (tab: string) => void): () => void;
  };
  // 向后兼容 shim
  registerPanel?(config: any): void;
  registerMenu?(config: any): void;
  registerToolbarButton?(config: any): void;
}
```

> `FrontendPluginContext` 类型**没有**从 `@openlearn/plugin-sdk` 导出（只在宿主源码
> `src/plugin-host/types.ts` 里）。插件侧要类型安全就按实际用到的成员自己声明最小接口，
> 不要写 `import type { FrontendPluginContext } from '@openlearn/plugin-sdk'` —— 那是编译错误。

---

## 3. 前端服务接口

```typescript
interface IFrontendAPI {
  get<T>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
  post<T>(path: string, body?: any): Promise<{ success: boolean; result?: T; error?: string }>;
  del<T>(path: string): Promise<{ success: boolean; result?: T; error?: string }>;
}

interface ISocketService {
  emit(event: string, ...args: any[]): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
  disconnect(): void;
}

interface IUIService {
  showToast(title: string, message: string, type: 'info' | 'success' | 'warning' | 'error'): void;
  showModal(title: string, content: React.ReactNode): void;
  closeModal(): void;
  downloadFile(data: Blob | string, filename: string, mimeType?: string): void;
}

interface IStorageService {
  get(key: string): string | null; // localStorage 读取
  set(key: string, value: string): void;
  delete(key: string): void;
  clear(): void;
}
```

**第三方沙箱里这些接口的形状不一样**（经 RPC 代理，全部返回 Promise，且只有子集）。
下面用 `bridge` 代指沙箱注入的那个上下文对象 —— 它与上文的 `FrontendPluginContext` **不是同一份契约**：

```typescript
// 沙箱桥接暴露的成员（server/utils/plugin-sandbox-frame.ts 的 makeCtx）
bridge.services.frontendApi.get / post / del(path, body?) // → Promise
bridge.services.storageService.get / set / delete(key) // → Promise，键自动加 `${manifest.id}:` 前缀
bridge.ui.registerExtensionPoint(slot, config) // → Promise<boolean>
bridge.ui.showToast(message) // → Promise<boolean>
bridge.invokeCommand(type, payload) // → Promise
bridge.context.get() // → Promise<{ lessonId, classId }>
```

> 注意两处命名差异：inline 插件的 toast 是 `ctx.services.uiService.showToast(...)`，
> 沙箱里是 `bridge.ui.showToast(...)`；沙箱**没有** `socketService`、`uiService.showModal`、`navigation`。
> 插件侧按实际使用的那个形状声明自己的最小接口即可。

---

## 4. 可用的 UI 扩展槽位

| Slot                       | 用途                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `teacher.tab`              | 教师标签页                                                                         |
| `teacher.panel`            | 教师独立全宽管理面板（v3.2）                                                       |
| `teacher.dashboard.widget` | 教师仪表盘小部件                                                                   |
| `student.view`             | 学生视图                                                                           |
| `student.fullscreen`       | 学生全屏视图/考试模式（v3.2）                                                      |
| `student.lesson.tool`      | 学生学习工具                                                                       |
| `classroom.tool`           | 课堂工具                                                                           |
| `global.setting`           | 全局设置页扩展（v3.2）                                                             |
| `nav.user_menu`            | 顶部 Header 用户菜单扩展（v0.3.x）                                                 |
| `command_palette.item`     | 全局命令面板（Ctrl+K）条目（**数据型**，第三方插件可用）                           |
| `editor.palette_item`      | 备课画板组件面板（v0.3.17，Palette Item 见[配套篇](plugin-courseware-extensions)） |
| `editor.timeline_segment`  | 备课环节类型（Segment Type，见[配套篇](plugin-courseware-extensions)）             |
| `anchor:*`                 | 宿主原生按钮/元素前后插入按钮（v0.2.6，锚点目录见 `docs/plugin/anchor-slots.md`）  |

> 上表只是演示用子集 —— `ExtensionSlot` 联合类型现有 **100+ 个成员**，完整清单与各槽位 Props 见
> [`docs/reference/plugin-ui-extension-slots.md`](../reference/plugin-ui-extension-slots)。
>
> ⚠️ 常见误写：备课画板组件的槽位名是 **`editor.palette_item`**，**不是** `palette.item`（后者不是合法槽位）。

**学生端插件获取当前学生 ID**：宿主在渲染 `student.view` 扩展点时（`src/features/student/StudentDashboardPanel.tsx` 调用点），通过 `slotProps` 注入当前学生 ID。插件组件通过 props 接收：

```tsx
// 前端插件入口 frontend.tsx（仅 inline / worker）
export default function MyStudentPlugin(props: { studentId?: string }) {
  const studentId = props.studentId;
  if (!studentId) return <div>请先登录学生账号</div>;

  // 使用 studentId 获取该学生的个人数据
  return <div>当前学生 ID: {studentId}</div>;
}
```

**所有扩展点组件统一收到课堂上下文（v0.2.8+）**：宿主经 `ExtensionPointRenderer` 向每个扩展点组件注入 `{ lessonId, classId }`（当前课程/班级，`string | null`）；非渲染场景用 `ctx.context.get()` / `ctx.context.subscribe()` 读取。详见 [`docs/reference/plugin-ui-extension-slots.md`](../reference/plugin-ui-extension-slots)。

---

## 5. 插件自定义图标与左侧导航栏展示（v0.5.1+）

每个插件都可以设置专属图标，并直接展示在系统左侧边栏导航（`NavigationSidebar`）的「扩展应用」列表中。

### 5.1 配置途径与优先级

1. **动态注册传参（最高优先级）**：调用 `ctx.ui.registerExtensionPoint('teacher.tab', { icon: 'BookOpen', ... })` 时传入；
2. **Manifest 贡献点声明**：在 `manifest.json` 的 `contributes['teacher.tab'][i].icon` 中配置；
3. **Manifest 插件主图标**：在 `manifest.json` 根级声明 `"icon": "BookOpen"`；
4. **默认安全回退**：若未配置或解析失败，自动回退到系统标准的 `<Puzzle />` 图标。

### 5.2 支持的图标格式

- **Lucide 图标名称（推荐）**：`'BookOpen'`、`'Award'`、`'BarChart'`、`'GraduationCap'`、`'Calculator'`、`'FileText'`、`'HelpCircle'` 等（PascalCase 或 kebab-case 均可）。
- **Emoji 符号**：`'📚'`、`'🧪'`、`'📊'`、`'⚡'`、`'🎯'`。
- **图片 / SVG 资源路径**：以 `http://`、`https://`、`data:image/` 或 `/` 开头的 URL 字符串。
- **React 组件**：`import { Award } from 'lucide-react'` 后直接作为组件传入（**仅 inline / worker**）。

### 5.3 示例

**方式 A：前端动态注册时指定图标与展示排序：**

```typescript
export default {
  activate: async (ctx: FrontendPluginContext) => {
    ctx.ui.registerExtensionPoint('teacher.tab', {
      id: 'quiz-hub',
      label: '随堂测验中心',
      icon: 'BookOpen', // 指定 Lucide 图标名，或使用 Emoji '📚'
      position: 15, // 决定在左侧导航栏扩展应用中的排列次序（数值越小越靠前）
      component: () => import('./QuizHubView'),
    });
  },
};
```

**方式 B：在 `manifest.json` 中配置（第三方插件只能走这条）：**

```json
{
  "id": "@openlearn/plugin-quiz-hub",
  "name": "随堂测验中心",
  "version": "1.0.0",
  "main": "index.js",
  "icon": "BookOpen",
  "contributes": {
    "teacher.tab": [
      {
        "id": "quiz-hub",
        "label": "随堂测验中心",
        "icon": "BookOpen",
        "position": 15
      }
    ]
  }
}
```

> 声明式条目由宿主注册为**数据型扩展点**：Tab 按钮按其元数据渲染，面板内容需要 `component`，
> 因此第三方插件会得到「有按钮、无内容」的结果。要真正落内容，请等下文的声明式 slot DSL 落地，
> 或把可见交互收敛到 `command_palette.item` / `classroom.tool` 这类数据型槽位。

### 5.4 侧边栏交互与视觉特性

- **与系统内置导航无缝对齐**：相同的 18px 矢量比例、圆角、悬停交互与主题动态变色；
- **折叠态居中展示**：点击侧边栏收起按钮时文本隐藏，图标居中，悬浮显示带插件名称的 Tooltip；
- **按 `position` 升序排列**：多个已激活插件依 `position` 从小到大平滑排序。

---

## 6. invokeCommand（自 V2.5 起可用）

前端插件可以通过 `ctx.invokeCommand()` 调用后端已注册的 Command Handler：

```typescript
// 前端插件中调用后端命令
const result = await ctx.invokeCommand('poll.get_results', { pollId: 'xxx' });
// 命令类型会自动添加插件命名空间前缀：poll.get_results → @scope/plugin.poll.get_results
```

命名空间规则是**双向共用**的（`packages/core/plugin-host/plugin-namespace.ts`）：

- 缺省时前置 `${manifest.id}.`；
- 已经以 `${manifest.id}.` 开头则原样使用。

所以后端 `commandBus.registerHandler('poll.get_results', …)` 与前端 `invokeCommand('poll.get_results')`
能对上；而写全限定名 `invokeCommand('@scope/plugin.poll.get_results')` 同样成立 ——
**沙箱桥接的运行期注册不经过前缀化，写全限定名更稳**。

---

## 7. 宿主依赖共享网关（HostSharedDeps）与构建

> ⚠️ **先读这一条（v0.7.0 勘误）**：`window.HostSharedDeps` **只注入到宿主父页面**。
> 远程（process 沙箱）插件的前端代码跑在 `sandbox="allow-scripts"` 的不透明源 iframe 里，
> iframe 与父页面不共享 `window` → 它拿不到 `HostSharedDeps`，读到的值是 `undefined`。
> 因此**本节的 external 指引只适用于「与宿主同 realm 执行」的插件**；
> 远程沙箱插件照做会**必然激活失败**（`Cannot read properties of undefined (reading 'React')`）。
> 远程插件的正确构建方式见 §7.2，完整能力边界见
> [`docs/plugin/frontend-sandbox-capability-boundary.md`](../plugin/frontend-sandbox-capability-boundary)。

### 7.1 inline / worker：共享运行时 + 裸导入转译

全局 `window.HostSharedDeps` 暴露以下共享运行时：

| 共享对象                        | NPM 包              | 提供的内容                              |
| ------------------------------- | ------------------- | --------------------------------------- |
| `HostSharedDeps.React`          | `react`             | React 核心 API (`createElement`, Hooks) |
| `HostSharedDeps.ReactDOM`       | `react-dom`         | ReactDOM 对象及 Portal                  |
| `HostSharedDeps.ReactDOMClient` | `react-dom/client`  | 现代 DOM Root 创建 (`createRoot`)       |
| `HostSharedDeps.jsxRuntime`     | `react/jsx-runtime` | JSX 工厂函数 (`jsx`, `jsxs`)            |
| `HostSharedDeps.Recharts`       | `recharts`          | Recharts 图表库                         |
| `HostSharedDeps.LucideReact`    | `lucide-react`      | Lucide 图标库                           |

宿主在执行 Blob URL 动态导入前会经 `transformBareModuleImports` 完成解构语法转译与别名对齐
（`import React, { useState } from 'react'`、`import { createPortal } from 'react-dom'`、
`import { jsx as _jsx } from 'react/jsx-runtime'`）。因此可把这些库配置为 external：

```javascript
import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['src/frontend.tsx'],
  bundle: true,
  outfile: 'dist/frontend.js',
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'recharts', 'lucide-react'],
  format: 'esm',
});
```

> 自平台 `v0.3.15+` 起，现代 `"jsx": "react-jsx"` 与经典 `"jsx": "react"` 均可原生支持。

**推荐 esbuild 构建配置（内联执行环境）：**

```javascript
import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['src/frontend.tsx'],
  bundle: true,
  outfile: 'dist/frontend.js',
  external: ['react', 'react-dom', 'recharts', 'lucide-react'],
  format: 'esm',
  platform: 'browser',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
});
```

### 7.2 远程沙箱：不要 external React

远程（process 沙箱）插件的 iframe 是**隐藏**执行体 —— 它不渲染任何用户可见 UI，
可见界面只能来自 manifest 声明式贡献。由于 iframe 取不到 `HostSharedDeps`，
远程插件**不要**把 react 系列库设为 external：

```javascript
import esbuild from 'esbuild';

esbuild.build({
  entryPoints: ['src/frontend.tsx'],
  bundle: true,
  outfile: 'dist/frontend.js',
  // 注意：这里**不要**把 react / react-dom 列进 external —— 沙箱 iframe 取不到
  // 宿主的 window.HostSharedDeps，external 会导致激活时求值为 undefined 而失败。
  external: ['@openlearn/plugin-sdk'],
  format: 'esm',
  platform: 'browser',
});
```

> ⚠️ SDK CLI（`openlearn-plugin-sdk build`）对前端构建**强制**注入
> `external: ['react','react-dom','recharts','lucide-react']` —— 该预置只对内联执行环境成立。
> 既然第三方插件的 `frontend.tsx` 本就不该出现 React（见 §0），这条预置对它们无害；
> 但若你确实要在**受信**插件里用 React，请自建前端构建脚本而不是依赖 CLI 默认值。

### 7.3 常见错误排查

| 错误信息                                                 | 原因                                                                         | 解决方法                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `missing activate function`                              | `frontend.js` 的 default export 是 React 组件而非 `{ activate }`             | 改成 `export default { activate, deactivate }`               |
| `Failed to resolve module specifier "react/jsx-runtime"` | `tsconfig.json` 中 `jsx` 为 `"react-jsx"`                                    | 改为 `"react"`                                               |
| `React is not defined`                                   | 前端未声明 `react` 为 `peerDependency` 或 `external`                         | 内联插件：加 `external: ['react']`；远程插件：本不该用 React |
| `Cannot read properties of undefined (reading 'React')`  | 远程插件把 react 设为 external，但沙箱 iframe 读不到 `window.HostSharedDeps` | 远程插件去掉 react 的 external，或干脆不写 React             |
| `process is not defined`                                 | 构建 `platform` 未设为 `browser`                                             | 设置 `platform: 'browser'`                                   |
| `DataCloneError`                                         | 把函数（`component` / `render`）塞进 postMessage 的扩展点配置                | 沙箱插件只能注册数据型配置；组件请留给 inline 插件           |

---

## 8. 前端组件如何获取通信能力（完整示例）

**仅 inline / worker 插件适用**。组件通过**模块级变量**拿到 `invokeCommand` 和扩展点注册能力。关键点：

- `registerExtensionPoint` 的 `component` 必须用**普通函数**声明（`function MyPanel() {}`），不要用箭头函数（esbuild 打包后闭包可能出问题）；
- 组件通过模块级变量拿 `ctx`，因为扩展点组件不是由你的组件树渲染，props 不可控；
- `default export` 是 `{ activate, deactivate }` 对象，不是组件本身。

```typescript
// src/frontend.tsx

let ctx: any = null;

// ① 组件必须用普通 function 声明（不要用箭头函数）
function MyPanel() {
  const [data, setData] = React.useState([]);

  React.useEffect(() => {
    // 通过模块级变量拿到 invokeCommand
    ctx.invokeCommand('myplugin.list').then(setData);
  }, []);

  return React.createElement(
    'div',
    null,
    data.map((item: any) => React.createElement('div', { key: item.id }, item.name)),
  );
}

function MyWidget() {
  return React.createElement('div', null, '仪表盘卡片');
}

// ② activate 接收 host 传入的 FrontendPluginContext，存到模块变量
async function activate(hostCtx: any) {
  ctx = hostCtx; // ← 关键：hostCtx 自带 invokeCommand、ui.registerExtensionPoint 等

  hostCtx.ui.registerExtensionPoint('teacher.tab', {
    id: 'my-tab',
    label: '我的面板',
    icon: 'Layout',
    component: MyPanel, // ← 普通函数引用，不是 () => <MyPanel/>
    position: 10,
  });

  hostCtx.ui.registerExtensionPoint('teacher.dashboard.widget', {
    id: 'my-widget',
    label: '我的卡片',
    icon: 'BarChart3',
    component: MyWidget,
    position: 0,
  });
}

function deactivate() {}

// ③ default export 必须是 { activate, deactivate } 对象
export default { activate, deactivate };
```

**为什么 component 不能用箭头函数？**

esbuild 在打包箭头函数时可能改变其闭包作用域，导致 `React.createElement` 引用丢失。使用 `function` 声明可保证构建后的函数引用稳定。

**为什么通过模块级变量拿 ctx 而不是 props？**

扩展点组件由宿主渲染，props 由宿主控制。宿主向扩展点组件传递的 props 是宿主定义的（如 `studentId`、`lessonId` 等业务数据），不包含 `invokeCommand`。因此 API 调用能力必须通过模块级闭包变量传递。

---

## 相关文档

- [插件开发完全指南](plugin-development-tutorial) —— 主教程（manifest、命令、事件、安全、发布）
- [课件与教学环节扩展](plugin-courseware-extensions) —— 备课画板图元 / 环节类型 / 进入条件
- [前端沙箱能力边界](../plugin/frontend-sandbox-capability-boundary) —— 第三方插件真实能力与路线
- [UI 扩展槽位参考](../reference/plugin-ui-extension-slots) —— 55 个槽位与 Props
- [Scaffold CLI](../sdk/scaffold-cli) —— 脚手架模板与构建产物
