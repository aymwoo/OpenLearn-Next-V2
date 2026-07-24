# 开发者指南

欢迎使用 OpenLearn V2 开发者指南。

---

## 常用开发命令

| 命令 | 描述 |
|---|---|
| `pnpm dev` | 启动开发服务器（Express + Vite HMR），监听 9000 端口 |
| `pnpm build` | 执行完整构建（前端 Vite 构建 -> 插件打包 -> esbuild 服务端 bundle） |
| `pnpm start` | 启动生产环境 bundle (`dist/server.cjs`) |
| `pnpm lint` | TypeScript 类型检查 (`tsc --noEmit`) |
| `pnpm lint:eslint` | 全局 ESLint 检查 (`.ts` / `.tsx`) |
| `pnpm format` | Prettier 代码自动格式化 |
| `pnpm test` | 执行 Vitest 测试套件 |

---

## 项目代码目录结构

```
├── server.ts              # Express + Socket.IO 后端组装根
├── src/                   # React 19 前端微前端 Shell
│   ├── App.tsx            # 主应用壳
│   ├── components/        # 公共组件
│   ├── features/          # 领域功能模块 (courseware, teacher, whiteboard)
│   ├── services/          # API 客户端服务层
│   └── store/             # Zustand 状态库
├── packages/
│   ├── core/              # Platform Kernel 内核 (command-bus, event-bus, plugin-host, DI, db)
│   ├── plugin-sdk/        # 插件开发 SDK (@openlearn/plugin-sdk)
│   ├── plugin-test-kit/   # 测试工具包 (@openlearn/plugin-test-kit)
│   └── plugins/           # 系统内置插件 (vfs, management, ai-planner)
```
