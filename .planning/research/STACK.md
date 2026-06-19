# 微前端选型研究：Vite Module Federation (Vite 6 + React 19)

本篇文档针对 **OpenLearnV2** 的微前端架构（将庞大的 `App.tsx` 拆分为独立的微应用模块并基于前端集成 Vite Module Federation）进行技术栈选型研究，为后续的路线图制定（Roadmap Creation）提供详细、确切的决策支持。

---

## 1. 核心依赖选型与版本

经过对现代微前端生态及构建工具链的充分调研与对比，OpenLearnV2 的微前端改造**必须使用且仅使用**以下依赖项：

| 依赖包名称 | 推荐版本范围 | 安装位置 | 选型理由 |
| :--- | :--- | :--- | :--- |
| **`@module-federation/vite`** | `^1.16.8` | `devDependencies` (基座与子应用) | **Module Federation 2.0 (MF2)** 官方维护的 Vite 插件。支持跨构建工具联邦（如 Webpack/Rspack/Vite 混合使用），并具备第一方类型共享 (Type Sharing) 和基于 Manifest 的动态发现能力，深度适配 Vite 6 架构。 |
| **`@module-federation/runtime`** | `^1.16.8` | `dependencies` (动态加载器 / 宿主壳) | 官方的轻量级运行时包。在宿主壳 (Shell App) 需要进行完全动态的 Remote 加载、注册与错误处理（如 circuit breaker / 降级策略）时，由运行时 API 提供第一方底层支持。 |

### 🚫 严禁引入/弃用的插件与库

1. **`@originjs/vite-plugin-federation` (彻底弃用)**：
   * **原因**：该插件长期疏于维护，缺少对 Vite 6 的 Environment API 的原生支持。在 React 19 环境下会导致 HMR (热重载) 崩溃、虚拟模块解析错误以及 top-level await 编译失效，因此**严禁在本项目中使用**。
2. **`jskits/vite-plugin-federation` (不推荐)**：
   * **原因**：虽然该插件修复了 originjs 的部分 Vite 6 兼容性问题，但其并非 Module Federation 2.0 官方标准规范，无法享受官方 MF2 提供的统一运行时优化、热模块替换和跨构建工具（Webpack/Rspack）的互操作特性。

---

## 2. React 19 / Zustand 5 的单例共享规范

React 19 在浏览器端要求**强单例运行时**。如果基座 (Host) 和子应用 (Remote) 加载了两个不同实例的 React 核心库，会导致 Hook 上下文丢失、渲染树断裂以及致命运行时崩溃。同时，基座的状态管理 (Zustand 5) 必须穿透共享给子应用。

因此，两端的 `@module-federation/vite` 配置文件中必须严格配置如下 `shared` 字段：

```typescript
// module-federation.config.ts 或 vite.config.ts
shared: {
  react: {
    singleton: true,
    requiredVersion: '^19.0.1',
    strictVersion: true, // 强制版本匹配，若不匹配在控制台报错并中断
  },
  'react-dom': {
    singleton: true,
    requiredVersion: '^19.0.1',
    strictVersion: true,
  },
  zustand: {
    singleton: true,
    requiredVersion: '^5.0.14',
    strictVersion: false, // 允许小版本范围兼容
  }
}
```

---

## 3. Tailwind CSS v4 样式集成与编译管道

OpenLearnV2 当前的技术栈已升级至 Tailwind CSS v4 (`@tailwindcss/vite: ^4.1.14`)。Tailwind v4 取消了传统的 `tailwind.config.js`，完全采用 **CSS-First** 配置模式。

### 核心问题
由于 Host (Shell App) 和 Remote (子应用) 是独立构建的，Host 的构建过程在默认情况下**完全无法感知** Remote 中所编写的 HTML/TypeScript 类名。如果两端各自打包一份 Tailwind 样式，会导致：
1. 重复注入 Tailwind 基础样式（Reset CSS/Preflight），造成页面样式混乱和极大的带宽浪费。
2. 远程组件在 Host 中渲染时，因 Host 构建时扫描不到该组件源码，导致 Remote 独有的 Tailwind 工具类样式完全缺失。

### 推荐解决手段 (CSS 编译指令)
为了将整个微前端生态的样式打通，Host (壳应用) 必须在其全局样式文件（如 `src/index.css`）中，使用 v4 引入的 `@source` 指令显式包含所有子应用的源文件目录。

```css
/* packages/shell/src/index.css (或主入口 css) */
@import "tailwindcss";

/* 1. 包含当前 Host 的扫描路径 */
@source "./src";

/* 2. 包含本地开发的远程插件/微前端模块源码路径，使 Host 的 Tailwind 编译器能提取所有类名 */
@source "../../packages/plugins/*/src";
@source "../../src/plugins/*/src";
```

而在 Remote 子应用打包时，**不应该**在子应用的 CSS 产物中包含完整的 Tailwind 基础规则，仅打包其自定义样式，从而确保样式是由 Host 统一管理、扫描并最终合并输出，消除样式膨胀。

---

## 4. Vite 6 编译目标与宿主环境集成配置

为了支持 Module Federation 运行时动态加载 ESM 模块，Host 与 Remote 在 Vite 6 下的编译目标必须支持 Top-level await。

### Host (基座 / Shell App) 配置示例
```typescript
// vite.config.ts (Host App)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';
import path from 'path';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      federation({
        name: 'shell_app',
        remotes: {
          // 静态注册的 Remote (此处可为空，以便后续动态注册)
        },
        shared: {
          react: { singleton: true, requiredVersion: '^19.0.1' },
          'react-dom': { singleton: true, requiredVersion: '^19.0.1' },
          zustand: { singleton: true, requiredVersion: '^5.0.14' },
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      target: 'esnext', // 必须设为 esnext，以允许构建产物使用原生 top-level await 异步动态导入
      minify: 'esbuild',
      cssCodeSplit: true,
    },
  };
});
```

### Remote (子应用 / 插件) 配置示例
```typescript
// packages/plugins/my-plugin/vite.config.ts (Remote App)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    federation({
      name: 'remote_my_plugin',
      filename: 'remoteEntry.js',
      exposes: {
        // 暴露子应用的挂载入口或生命周期方法
        './PluginEntry': './src/PluginEntry.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.1' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.1' },
        zustand: { singleton: true, requiredVersion: '^5.0.14' },
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'esnext',
  },
});
```

---

## 5. 微前端运行时与动态加载器设计建议 (MFE-02)

为了对接 Phase 2.0 中定义的 **MFE-02 (Shell App 与动态微应用加载器)**，推荐使用 `@module-federation/runtime` 的原生 API。在运行时，Shell App 可以根据数据库（SQLite `plugins` 表）中的插件注册地址，动态加载 Remote 应用：

```typescript
import { init, loadRemote } from '@module-federation/runtime';

// 1. 初始化 Module Federation 运行时，动态发现注册的服务
init({
  name: 'shell_app',
  remotes: [
    {
      name: 'remote_my_plugin',
      entry: 'http://localhost:5001/remoteEntry.js', // 可从 API 动态获取
    },
  ],
});

// 2. 在路由或插件生命周期节点动态导入
async function mountRemotePlugin(pluginName: string) {
  try {
    const module = await loadRemote(`${pluginName}/PluginEntry`);
    // 执行微应用标准挂载生命周期 (bootstrap, mount)
    return module;
  } catch (error) {
    console.error(`Failed to load remote plugin: ${pluginName}`, error);
    // 回退到安全降级 UI
  }
}
```

该方案完美兼容现有的 `PluginHost` 类型安全和 SemVer 版本控制机制，为后续宿主状态共享（MFE-04）以及路由解耦抽离（MFE-05）打下了可靠的底层架构基础。
