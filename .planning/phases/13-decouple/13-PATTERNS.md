# Phase 13: 业务模块解耦与样式沙箱化 - Patterns

本文档为 Phase 13（业务模块解耦与样式沙箱化）的模式映射文件。它规划了需要新建和修改的文件列表，定义了各自的角色和数据流向，并提取了代码库中对应的相似代码和具体实现细节以供后续开发阶段复用。

---

## 1. 目标文件概述与角色分类 (Overview & Role Classification)

在解耦过程中，我们将对以下文件进行修改或新建：

| 目标文件 | 类型 | 角色分类 | 关联数据流向 |
| :--- | :--- | :--- | :--- |
| `packages/mfe-whiteboard/package.json` | 修改 | 包配置文件 (MFE Dependencies) | 声明子应用专用库依赖，保证与宿主共享单例库版本一致 |
| `packages/mfe-whiteboard/src/index.css` | 新建 | 样式沙箱配置 (Tailwind v4) | 禁用 Preflight 并声明 `wb` 前缀，将白板样式物理隔离 |
| `packages/mfe-whiteboard/src/components/InteractiveWhiteboard.tsx` | 新建 | 业务核心视图 (Whiteboard Core View) | 通过 DI 容器解析宿主 `ISocketService` 进行高频笔迹数据传输 |
| `packages/mfe-whiteboard/src/App.tsx` | 修改 | 微前端生命周期入口 (MFE Lifecycle Entry) | 暴露 `createMfeApp` 挂载函数，接收 `MfeContext` 并渲染组件 |
| `packages/mfe-courseware/package.json` | 修改 | 包配置文件 (MFE Dependencies) | 声明课件应用基础依赖，声明 Module Federation 单例 |
| `packages/mfe-courseware/src/index.css` | 新建 | 样式沙箱配置 (Tailwind v4) | 禁用 Preflight 并声明 `cw` 前缀，隔离课件查看器样式 |
| `packages/mfe-courseware/src/components/InteractiveCoursewareViewer.tsx` | 新建 | 业务核心视图 (Courseware Viewer) | 接收宿主传入的课件 ID 属性，在 iframe 内展示并控制全屏 |
| `packages/mfe-courseware/src/App.tsx` | 修改 | 微前端生命周期入口 (MFE Lifecycle Entry) | 接收宿主 `MfeContext` 传入，暴露 `mount/unmount/update` |
| `src/App.tsx` | 修改 | 宿主 Shell 入口 (Host App Container) | 移除对白板与课件的静态硬编码引入，替换为 `MfeLoader` 动态插槽 |
| `packages/core/db/index.ts` | 修改 | 数据库种子配置 (Database Seeding) | 在启动时向 `mfe_remotes` 表预置白板与课件微应用入口 URL |

---

## 2. 详细文件模式与代码摘录 (Detailed File Patterns & Excerpts)

### 2.1 packages/mfe-whiteboard/package.json
*   **角色分类**：MFE 依赖配置文件。
*   **数据流**：声明 whiteboard 绘图、PPT 预览和幻灯片组件所依赖的全部第三方库，保证微应用在独立发版和独立打包时的依赖完整性。
*   **最接近的代码相似物**：`packages/mfe-whiteboard/package.json` (原模板) / 根目录 `package.json`。
*   **应当复用的代码片段/模式**：
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

### 2.2 packages/mfe-whiteboard/src/index.css 与 packages/mfe-courseware/src/index.css
*   **角色分类**：Tailwind CSS v4 沙箱化配置层。
*   **数据流**：禁用 Preflight 并添加隔离命名空间。仅导入 `theme` 和 `utilities` 变体，将所有的 Tailwind 工具类进行物理隔离，以确保子应用的引入绝不覆盖宿主 Shell 默认样式。
*   **最接近的代码相似物**：`src/index.css`。
*   **应当复用的代码片段/模式**：
    *   **白板子应用样式 (`packages/mfe-whiteboard/src/index.css`)**：
        ```css
        @layer theme, utilities;

        /* 仅导入主题变量与工具类，禁用 preflight */
        @import "tailwindcss/theme" layer(theme);
        @import "tailwindcss/utilities" prefix(wb) layer(utilities);

        .mfe-whiteboard-root {
          box-sizing: border-box;
        }
        ```
    *   **课件子应用样式 (`packages/mfe-courseware/src/index.css`)**：
        ```css
        @layer theme, utilities;

        /* 仅导入主题变量与工具类，禁用 preflight */
        @import "tailwindcss/theme" layer(theme);
        @import "tailwindcss/utilities" prefix(cw) layer(utilities);

        .mfe-courseware-root {
          box-sizing: border-box;
        }
        ```
    *   **类名书写规范**：
        在子应用组件代码中，任何需要使用 Tailwind 样式的 class 必须带有对应前缀修饰符（如 `wb:flex`，`cw:relative` 等）：
        ```tsx
        // 白板示例
        <div className="wb:flex wb:flex-col wb:h-full wb:bg-white wb:border wb:border-gray-200">
        // 课件示例
        <div className="cw:relative cw:w-full cw:h-full cw:p-4">
        ```

### 2.3 packages/mfe-whiteboard/src/components/InteractiveWhiteboard.tsx
*   **角色分类**：协同白板业务核心视图。
*   **数据流**：
    *   纯本地 UI 状态（笔刷粗细、所选颜色、本地控制状态等）保留在组件自身的 `useState` 中。
    *   业务状态（elements 列表等）通过 React Props 从宿主中获取。
    *   **WebSocket 直连高频绘图轨迹**：通过 DI 容器解析宿主传递的 `@openlearn/frontend:ISocketService`，不走 EventBus 也不直接调用 `io()`，以保护消息网格通畅。
*   **最接近的代码相似物**：`src/components/InteractiveWhiteboard.tsx` (Host Shell 侧的同名大单体组件)。
*   **应当复用的代码片段/模式**：
    *   **移除直接 io 依赖，声明 Context Props**：
        ```typescript
        import type { MfeContext } from '../../../../src/mfe/types';
        import type { ISocketService } from '../../../../src/plugin-host/types';

        interface InteractiveWhiteboardProps {
          lessonId: string;
          elements: any[];
          mfeContext?: MfeContext;
          userRole?: 'teacher' | 'student';
          activeSegmentId?: string | null;
          onSegmentSync?: (segId: string) => void;
          onElementAdd?: (type: string, data: any) => Promise<void>;
          onElementUpdate?: (id: string, data: any) => Promise<void>;
          onElementDelete?: (id: string) => Promise<void>;
          onClearBoard?: () => Promise<void>;
          onRefresh?: () => void;
        }
        ```
    *   **基于 DI 获取 ISocketService 实例**：
        ```typescript
        const socketRef = useRef<ISocketService | null>(null);

        useEffect(() => {
          // 通过 MfeContext 的 serviceRegistry 安全解析宿主 SocketService
          const socketService = mfeContext?.serviceRegistry?.get<ISocketService>('@openlearn/frontend:ISocketService');
          if (socketService) {
            socketRef.current = socketService;
            socketService.emit('join-room', lessonId);

            const handleWhiteboardSync = (data: any) => {
              if (data.type === 'temp-draw') {
                 setRemoteDrawings(prev => ({ ...prev, [data.userId]: data.payload }));
              } else if (data.type === 'temp-end') {
                 setRemoteDrawings(prev => {
                    const next = { ...prev };
                    delete next[data.userId];
                    return next;
                 });
              } else if (data.type === 'refresh') {
                 if (onRefresh) onRefresh();
              } else if (data.type === 'segment-change') {
                 if (onSegmentSync && data.payload?.segmentId) {
                    onSegmentSync(data.payload.segmentId);
                 }
              }
            };

            socketService.on('whiteboard-sync', handleWhiteboardSync);

            return () => {
              socketService.off('whiteboard-sync', handleWhiteboardSync);
              // 注意：由于 SocketService 是宿主单例，在此处不调用全局 socketService.disconnect()
            };
          }
        }, [mfeContext, lessonId, onRefresh, onSegmentSync]);
        ```
    *   **高频笔迹消息广播**：
        在 PointerMove 事件中，利用 socket 进行临时绘图轨迹的高频广播（非持久化，仅内存转发）：
        ```typescript
        if (socketRef.current) {
          socketRef.current.emit('whiteboard-update', {
            roomId: lessonId,
            type: 'temp-draw',
            userId: (socketRef.current as any).id || 'student', // 宿主 socket 的 id
            payload: { ...currentDrawing, page: currentPage, segmentId: activeSegmentId }
          });
        }
        ```
    *   **本地普通 CSS 哈希隔离 (CSS Modules)**：
        为规避 Konva 重绘所需的局部精细排版受全局 CSS 污染，任何非 Tailwind 的自定义 CSS 需使用 CSS Modules 声明。
        ```typescript
        import styles from './InteractiveWhiteboard.module.css';

        // 渲染时
        return <div className={styles.canvasContainer}>...</div>
        ```

### 2.4 packages/mfe-whiteboard/src/App.tsx 与 packages/mfe-courseware/src/App.tsx
*   **角色分类**：子应用远程生命周期管理入口。
*   **数据流**：实现并导出 `createMfeApp` 工厂函数，在挂载时将 `MfeContext` 绑定给 React 组件，在卸载时调用 `root.unmount()` 回收内存和销毁容器。
*   **最接近的代码相似物**：`packages/mfe-whiteboard/src/App.tsx` (原模板)。
*   **应当复用的代码片段/模式**：
    *   **白板挂载入口 (`packages/mfe-whiteboard/src/App.tsx`)**：
        ```typescript
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import type { MfeContext } from '../../../src/mfe/types';
        import { InteractiveWhiteboard } from './components/InteractiveWhiteboard';

        export default function App(props: any & { mfeContext?: MfeContext }) {
          return (
            <div className="mfe-whiteboard-root">
              <InteractiveWhiteboard {...props} />
            </div>
          );
        }

        export function createMfeApp(ctx: MfeContext) {
          let instance: { unmount: () => Promise<void>; update: (props: any) => Promise<void> } | null = null;

          const mount = async (container: HTMLElement, props?: Record<string, any>) => {
            const root = createRoot(container);
            root.render(<App {...props} mfeContext={ctx} />);
            instance = {
              unmount: async () => { root.unmount(); },
              update: async (newProps: Record<string, any>) => {
                root.render(<App {...newProps} mfeContext={ctx} />);
              },
            };
            return instance;
          };

          return {
            mount,
            unmount: async () => {
              if (instance) {
                await instance.unmount();
                instance = null;
              }
            },
            update: async (props: Record<string, any>) => {
              await instance?.update(props);
            },
            styles: ['/src/index.css'], // 打包后指向微应用的样式入口
          };
        }
        ```

### 2.5 src/App.tsx (宿主端)
*   **角色分类**：宿主 Shell orchestrator 核心应用层。
*   **数据流**：下线白板与课件的直接静态引入，通过 MfeLoader 异步加载子应用包。将交互回调（如 `onElementAdd`, `onElementUpdate` 等）以 props 形式传入 `MfeLoader`。
*   **最接近的代码相似物**：`src/App.tsx` (自身)。
*   **应当复用的代码片段/模式**：
    *   **替换硬编码的静态组件导入**：
        ```diff
        -import { InteractiveWhiteboard } from './components/InteractiveWhiteboard';
        -import { InteractiveCoursewareViewer } from './components/InteractiveCoursewareViewer';
        +import { MfeLoader } from './mfe/MfeLoader';
        ```
    *   **白板卡槽的渲染替换**（在所有原硬编码 InteractiveWhiteboard 渲染处进行修改）：
        ```tsx
        <MfeLoader
          name="mfe_whiteboard"
          props={{
            lessonId: selectedLesson,
            elements: elements,
            userRole: activeRole,
            activeSegmentId: activeSegmentId,
            onSegmentSync: (segId) => setActiveSegmentId(segId),
            onElementAdd: async (type, data) => {
              await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, data })
              });
              fetchElements(selectedLesson);
            },
            onElementUpdate: async (elementId, data) => {
              await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data })
              });
              fetchElements(selectedLesson);
            },
            onElementDelete: async (elementId) => {
              await fetch(`/api/lessons/${selectedLesson}/whiteboard/${elementId}`, {
                method: 'DELETE'
              });
              fetchElements(selectedLesson);
            },
            onClearBoard: async () => {
              await fetch(`/api/lessons/${selectedLesson}/whiteboard`, {
                method: 'DELETE'
              });
              fetchElements(selectedLesson);
            },
            onRefresh: () => fetchElements(selectedLesson)
          }}
        />
        ```
    *   **课件卡槽的渲染替换**：
        ```tsx
        <MfeLoader
          name="mfe_courseware"
          props={{
            coursewareId: previewSelectedCourseware,
            onClose: () => setPreviewSelectedCourseware(null)
          }}
        />
        ```

### 2.6 packages/core/db/index.ts
*   **角色分类**：数据库初始化与种子预置服务。
*   **数据流**：向数据库 `mfe_remotes` 表初始化填充数据，使得宿主在启动阶段自动获取远程 remote 模块 URL。
*   **最接近的代码相似物**：`packages/core/db/index.ts` (自身) 的 `users` and `ai_providers` 种子填充逻辑。
*   **应当复用的代码片段/模式**：
    ```typescript
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

---

## 3. 防守性设计与容灾机制 (Fail-Safe & Defensiveness)

按照 **D-12** 的容灾决策设计，在加载微前端子应用包时，宿主需确保在子应用因物理环境掉线（如端口冲突、构建崩溃、资源地址离线）时不会发生全局白屏崩溃：
1. **Error Boundary 物理隔离**：所有的 `MfeLoader` 外层均默认由 `MfeErrorBoundary` 包裹。当子应用装载阶段崩溃或运行时报错，异常将被捕获并局部降级显示“应用未安装或已停用”的友好占位符（由 `MfeErrorFallback.tsx` 控制）。
2. **阻断二次轮询请求**：在停用或拉取超时后，`MfeLoaderCore` 的 Effect 挂载周期需要及时清除 timeout 时钟，防止由于内存溢出或轮询发包导致的控制台网络请求泛滥。

---

## 4. 样式沙箱验证规程 (Style Sandbox Verification)

为确保白板与课件子应用在宿主端加载时，不发生样式相互污染，必须进行如下校验：
1. **无污染断言**：编译打包生成的 CSS 资源中，不得包含任何未包含前缀的全局通用重置选择器（如全局的 `*`, `body`, `html` 等默认覆盖规则，因为这些规则已在 `preflight: false` 中被剔除）。
2. **前缀约束校验**：在 Chrome DevTools 下，验证所有渲染出的白板/课件节点 ClassList 是否正确包含了命名空间修饰前缀 (`wb:` / `cw:`)，并确认第三方弹层 (Portal Tooltip) 依然定位正常。
