# Phase 13 Research: 业务模块解耦与样式沙箱化

## 1. Domain & Boundaries (领域与边界)

### In-Scope (处于范围内)
- **大单体白板与课件视图的完全抽离**：
  - 将原宿主 Shell 层的 `src/components/InteractiveWhiteboard.tsx` (4000+ 行大单体) 剪切移入子应用项目 `packages/mfe-whiteboard/src/components/` 目录下。
  - 将原宿主 Shell 层的 `src/components/InteractiveCoursewareViewer.tsx` 剪切移入子应用项目 `packages/mfe-courseware/src/components/` 目录下。
  - 清理宿主应用内的直接文件引用，确保宿主应用包体积缩减。
- **微前端依赖包配置 (package.json)**：
  - 在 `packages/mfe-whiteboard/package.json` 中配置白板应用独有的第三方依赖库（如 `react-konva`, `pptx-preview`, `reveal.js`, `socket.io-client`, `react-markdown` 等），确保独立打包的完整性。
- **样式隔离与沙箱化配置**：
  - 基于 Tailwind CSS v4 配置两个微应用的 CSS 工具类名前缀（白板使用 `wb` 前缀，课件使用 `cw` 前缀）。
  - 在两个微应用中彻底禁用全局基础重置样式（`preflight: false`），通过仅导入 `theme` 和 `utilities` 避免篡改或覆盖宿主 Shell 样式。
  - 所有微应用自定义的非 Tailwind 普通 CSS 样式强制采用 CSS Modules (`*.module.css`) 进行哈希混淆，由 Vite 构建器在编译阶段实现物理沙箱隔离。
- **宿主入口重构与降级渲染**：
  - 将宿主 `src/App.tsx` 中所有直接渲染 `InteractiveWhiteboard` 和 `InteractiveCoursewareViewer` 的位置，替换为动态异步加载的 `MfeLoader` 包装容器。
  - 传入对应微应用的动态 props 参数并配置 Error Boundary。
- **数据库种子数据自动发现与预置**：
  - 在宿主 SQLite 初始化脚本中增加 `mfe_remotes` 表的种子数据填充逻辑，预置 `mfe_whiteboard` (指向 `http://localhost:5174/remoteEntry.js`) 和 `mfe_courseware` (指向 `http://localhost:5175/remoteEntry.js`)。

### Out-of-Scope (处于范围外)
- **重构白板的核心渲染引擎**：不改变 `react-konva` 绘图层、PDF/PPTX 预览核心、Reveal.js 初始化逻辑，仅对其暴露的接口进行微前端 Context 桥接。
- **多运行时动态版本自动回滚**：当微前端版本不一致时，不作自动回退降级处理，完全依赖 `MfeErrorBoundary` 的标准异常捕获及用户手动刷新。
- **Shadow DOM 样式强沙箱隔离**：不改变 `MfeLoader` 为 Shadow DOM 渲染模式，规避弹窗层定位及 Fullscreen API 在 Shadow DOM 中的严重失效问题。

---

## 2. Technical Approach (技术方案)

### 2.1 Zustand 状态共享与本地 UI 隔离

根据 `13-CONTEXT.md` 决策：
1. **状态消费与订阅**：微应用通过注入的 `MfeContext` 共享的 Zustand Store 进行 React 级别细粒度订阅。
   - 使用 React Hook 订阅形式：
     ```typescript
     import { useStore } from 'zustand';
     const userName = useStore(infra.store, (state: any) => state.session?.name);
     ```
2. **高频同步逻辑读取**：在 Canvas/Konva 绘图高频回调或非 React 逻辑中，为规避 React 渲染周期带来的闭包旧值问题，微应用直接通过调用同步快照 API 读取最新状态：
   ```typescript
   const currentElements = infra.store.getState().elements;
   ```
3. **本地 UI 状态托管**：白板的笔刷粗细、所选颜色、本地控制状态等纯局部交互 UI 状态，保留在微应用本地组件的 `useState` 中，不进入宿主全局状态树，实现职责隔离并避免无谓的全局渲染。

### 2.2 样式隔离与 Tailwind CSS v4 沙箱化

#### 方案对比
- **方案 A：Shadow DOM 物理隔离**
  - *优点*：浏览器原生提供绝对的 CSS 样式隔离，子应用与宿主稳妥不冲突。
  - *缺点*：导致第三方库产生的 React Portal 弹出层（如 Dropdown 菜单、Tooltip 气泡）以及浏览器全屏（Fullscreen API）定位失效，难以在弹窗中正常工作，且子应用无法便捷共享宿主 `@font-face` 及主题变量。
- **方案 B：Tailwind 前缀隔离 + 根类包裹 + CSS Modules (已选)**
  - *优点*：通过配置子应用 Tailwind 前缀（`wb:`、`cw:`）、全局禁用子应用 Preflight、以及对非 Tailwind 样式使用 CSS Modules，实现低成本且无副作用的隔离，弹窗定位和全屏 API 完全兼容宿主环境。
  - *缺点*：编写 Tailwind 时需要添加命名空间。

#### Tailwind CSS v4 样式前缀配置与 Preflight 禁用设计
由于 OpenLearnV2 项目使用 Tailwind CSS v4（通过 `@tailwindcss/vite` 插件进行构建），其配置为 CSS-first。

1. **白板应用配置 (`packages/mfe-whiteboard/src/index.css`)**：
   ```css
   @layer theme, utilities;

   /* 仅导入主题变量与工具类，不引入 preflight 基础重置，实现 preflight: false */
   @import "tailwindcss/theme" layer(theme);
   @import "tailwindcss/utilities" prefix(wb) layer(utilities);

   /* 额外的微应用全局包裹限制（可选，用于自定义局部样式重置） */
   .mfe-whiteboard-root {
     box-sizing: border-box;
   }
   ```
2. **课件应用配置 (`packages/mfe-courseware/src/index.css`)**：
   ```css
   @layer theme, utilities;

   /* 仅导入主题变量与工具类，禁用 preflight */
   @import "tailwindcss/theme" layer(theme);
   @import "tailwindcss/utilities" prefix(cw) layer(utilities);

   .mfe-courseware-root {
     box-sizing: border-box;
   }
   ```
3. **在 React 组件中的具体用法**：
   - 因为 Tailwind v4 对 `prefix` 采用的是**变体/命名空间修饰符**机制（使用冒号 `:` 分隔，而非旧版 v3 中的连字符 `-`），所以开发代码中需要使用 `:` 书写样式：
     ```tsx
     // 白板组件内部
     <div className="wb:flex wb:flex-col wb:h-full wb:bg-white wb:border wb:border-gray-200">
       <span className="wb:text-sm wb:font-bold wb:text-indigo-600">协作白板</span>
     </div>
     ```
     ```tsx
     // 课件组件内部
     <div className="cw:relative cw:w-full cw:h-full cw:p-4">
       <iframe className="cw:w-full cw:h-full cw:border-none" ... />
     </div>
     ```

#### 自定义普通 CSS 的隔离模式 (CSS Modules)
针对写在自定义样式表中的非 Tailwind CSS：
- 统一创建 `*.module.css` 文件（例如 `InteractiveWhiteboard.module.css`）。
- 在 React 组件中引用：
  ```typescript
  import styles from './InteractiveWhiteboard.module.css';
  // ...
  return <div className={styles.canvasContainer}>...</div>
  ```
- Vite 构建器会自动进行哈希重命名（如 `_canvasContainer_1a2b3_5`），彻底消除全局污染的隐患。

### 2.3 核心依赖解耦与 package.json 配置

#### 白板应用依赖解耦
解耦后，`packages/mfe-whiteboard` 需要在 `dependencies` 中添加其绘图、PPT 预览和幻灯片组件所依赖的全部第三方库：

```json
{
  "name": "mfe-whiteboard",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "zustand": "^5.0.14",
    "konva": "^10.3.0",
    "react-konva": "^19.2.4",
    "react-konva-utils": "^2.0.0",
    "lucide-react": "^0.546.0",
    "pptx-preview": "^0.0.5",
    "reveal.js": "^6.0.1",
    "socket.io-client": "^4.8.3",
    "react-markdown": "^10.1.0"
  },
  "devDependencies": {
    "@module-federation/vite": "1.16.8",
    "@types/reveal.js": "^5.2.2",
    "typescript": "~5.8.2",
    "vite": "^6.2.3"
  }
}
```

#### 课件应用依赖配置
`packages/mfe-courseware` 只需添加基础 UI 图标支持：

```json
{
  "name": "mfe-courseware",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "zustand": "^5.0.14",
    "lucide-react": "^0.546.0"
  },
  "devDependencies": {
    "@module-federation/vite": "1.16.8",
    "typescript": "~5.8.2",
    "vite": "^6.2.3"
  }
}
```

---

## 3. Validation Architecture

为确保解耦后的子应用与宿主壳应用集成无缝、样式沙箱彻底生效、且在子应用挂起或网络故障时具备降级容灾能力，设计如下两层验证体系。

### 3.1 单元与集成测试 (Automated Testing)
使用 `Vitest` 和 `React Testing Library` 编写自动化集成测试：

1. **`MfeLoader` 对解耦子应用的生命周期加载测试**：
   - 编写 `packages/core/__tests__/mfe-lifecycle-integration.test.tsx`。
   - 模拟动态加载过程，验证当 `MfeLoader` 装载 `mfe_whiteboard` 时，能成功获取其导出的 `createMfeApp` 并触发 `mount`；卸载时，验证调用 `unmount` 并最终执行 React 根节点的 `root.unmount()` 清理。
2. **样式隔离与编译后 CSS 类名前缀检测测试**：
   - 在集成打包步骤后，通过脚本读取子应用打包生成的 CSS 文件，断言其中不包含未加前缀的 Tailwind 基础重置规则（如全局 `*`, `body`, `html` 的重置定义），且存在 `wb:` 或 `cw:` 前缀样式选择器。
3. **Zustand Context 共享订阅机制测试**：
   - 验证传递给子应用的 `MfeContext` 中 `store` 是一个单例对象。
   - 断言子应用内通过 `useStore(ctx.store)` 订阅的数据能够在宿主状态改变时自动响应，且在子应用被销毁后清除相关订阅。

### 3.2 手动集成与 UAT 校验 (Manual UAT)
1. **多端协同白板与 WebSocket 链路校验**：
   - 启动宿主 Shell (`npm run dev`) 和白板子应用 (`pnpm --filter mfe-whiteboard dev`)。
   - 分别以“教师”和“学生”身份登录，进入白板页面进行实时书写绘图，确认笔迹能够高频双向同步。
   - 检查网络通信，确认高频轨迹数据通过 SQLite 桥接的 DI `ISocketService` 底层通道进行 WebSocket 直连，而普通控制命令（如清屏、添加文字元件）通过 EventBus 转发。
2. **样式沙箱防泄露 UAT 检查**：
   - 打开 Chrome 开发者工具审查元素，确认宿主面板样式（如 Header、侧边栏导航）没有受到白板子应用中 CSS 样式的影响。
   - 检查是否所有自定义的特殊绘图交互均采用了哈希样式名（形如 `._canvas_xxx`），验证 Host 全局样式不影响微应用内部排版。
3. **MFE 下线与容灾降级验证 (Fail-safe)**：
   - 在 SQLite 的 `mfe_remotes` 表中将 `mfe_whiteboard` 记录删除（或将其 entry 地址改写为无效 IP）。
   - 重新进入白板展示页，确认系统没有发生致命崩溃白屏，而是优雅显示“应用未安装或已停用”的友好占位符，控制台无循环发包错误，完全符合安全防守决策 D-12。

---

## 4. Codebase Patterns & Reusable Assets (代码库模式与复用资产)

### 4.1 可复用资产 (Reusable Assets)
- **`MfeLoader` Container (`src/mfe/MfeLoader.tsx`)**：这是在宿主端挂载所有微应用的通用入口，自动处理了 MFE 加载期动画、超时挂起、以及渲染异常边界。
- **`MfeContextProvider` (`src/mfe/MfeContextProvider.tsx`)**：负责构建并向下级子应用传递 Zustand Store、ISocketService 及 EventBus 实例，这是子应用解耦后能够维持核心协同逻辑正常运转的“数字基底”。
- **`appStore` (`src/store/appStore.ts`)**：全局单例 vanilla store 实例，承载了整个应用的大字典数据，解耦后的微应用将完全依赖该 store 数据项实现 UI 细粒度同步。

### 4.2 需遵循的模式 (Established Patterns)
- **Vite Module Federation 插件强单例配置模式**：在子应用的 `vite.config.ts` 中，必须遵循 `packages/mfe-whiteboard/vite.config.ts` 中已配置的模式，定义 `react`, `react-dom`, `zustand` 强共享，requiredVersion 读取自本地 package.json 以免引发版本冲突。
- **React Portal 与 Root 卸载安全模式**：微应用挂载和卸载的容器，一定要使用 `createRoot` 创建实例并在 unmount 时确保 `root.unmount()` 被完全执行，防止页面切换时累积内存泄漏。

---

## 5. Integration Points (集成点)

### 5.1 数据库自动种子注册
在 `packages/core/db/index.ts` 文件的末尾（数据库初始化阶段），加入 `mfe_remotes` 种子数据写入动作：

```typescript
// packages/core/db/index.ts - 数据库种子预置点
try {
  const countObj = db.prepare('SELECT COUNT(*) as cnt FROM mfe_remotes').get() as { cnt: number };
  if (countObj && countObj.cnt === 0) {
    console.log('Seeding default MFE Remotes...');
    const insertStmt = db.prepare('INSERT INTO mfe_remotes (name, entry) VALUES (?, ?)');
    insertStmt.run('mfe_whiteboard', 'http://localhost:5174/remoteEntry.js');
    insertStmt.run('mfe_courseware', 'http://localhost:5175/remoteEntry.js');
  }
} catch (e) {
  console.error('Failed to seed default MFE Remotes:', e);
}
```

### 5.2 宿主端 App.tsx 瘦身与 Loader 替换
在 `src/App.tsx` 中：
- 删除直接引用的白板与课件组件：
  ```diff
  -import { InteractiveWhiteboard } from './components/InteractiveWhiteboard';
  -import { InteractiveCoursewareViewer } from './components/InteractiveCoursewareViewer';
  +import { MfeLoader } from './mfe/MfeLoader';
  ```
- 替换多处 `InteractiveWhiteboard` 渲染逻辑：
  ```tsx
  // 教师端或学生端白板卡槽
  <MfeLoader
    name="mfe_whiteboard"
    props={{
      lessonId: selectedLesson,
      userRole: activeRole,
      elements: elements,
      activeSegmentId: activeSegmentId,
      onSegmentSync: (segId) => setActiveSegmentId(segId)
    }}
  />
  ```
- 替换多处 `InteractiveCoursewareViewer` 渲染逻辑：
  ```tsx
  // 课件查看器卡槽
  <MfeLoader
    name="mfe_courseware"
    props={{
      coursewareId: studentSelectedCourseware,
      onClose: () => setStudentSelectedCourseware(null)
    }}
  />
  ```

### 5.3 子应用挂载入口实现
1. **`packages/mfe-whiteboard/src/App.tsx`**：
   - 导入剪切过来的 `InteractiveWhiteboard` 组件。
   - 使用 `createMfeApp` 接收并利用 `ctx` 提供 store、eventBus 和 socket，挂载到容器中：
     ```tsx
     export function createMfeApp(ctx: MfeContext) {
       let instance: any = null;
       const mount = async (container: HTMLElement, props?: Record<string, any>) => {
         const root = createRoot(container);
         root.render(
           <InteractiveWhiteboard
             {...props}
             mfeContext={ctx}
           />
         );
         instance = {
           unmount: async () => { root.unmount(); },
           update: async (newProps: any) => { root.render(<InteractiveWhiteboard {...newProps} mfeContext={ctx} />); }
         };
         return instance;
       };
       return { mount, unmount: async () => { instance?.unmount(); }, update: async (props: any) => { instance?.update(props); } };
     }
     ```
2. **`packages/mfe-courseware/src/App.tsx`**：
   - 同样模式导出 `createMfeApp`，用以动态挂载 `InteractiveCoursewareViewer`。
