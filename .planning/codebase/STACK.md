# Technology Stack

**Analysis Date:** 2026-06-17

## Languages

**Primary:**
- TypeScript 5.8 - Entire project (frontend and backend), type-checked with `tsc --noEmit`
- Target: ES2022; module: ESNext; moduleResolution: bundler

**Markup/Style:**
- HTML - Entry point `index.html`
- CSS - TailwindCSS 4 utility classes; index.css for base styles

## Runtime

**Environment:**
- Node.js (ES modules, `"type": "module"` in `package.json`)
- Development: `tsx` runs `server.ts` directly (ESM, on-the-fly TypeScript transpilation)
- Production: `node dist/server.cjs` (CommonJS bundle produced by esbuild)

**Package Manager:**
- pnpm (primary, `pnpm-workspace.yaml` present with workspace configuration)
- npm (secondary, `package-lock.json` present)
- Lockfile: `pnpm-lock.yaml` (148KB) and `package-lock.json` (249KB)

## Frameworks

**Core:**
- Express 4.21 - HTTP server framework, drives the entire REST API in `server.ts`
- React 19.0 - Frontend UI framework, single-page app
- Vite 6.2 - Frontend dev server (HMR) and production bundler, configured via `vite.config.ts`
- TailwindCSS 4.1 - Utility-first CSS framework, used via `@tailwindcss/vite` Vite plugin

**Testing:**
- 未检测到测试框架。项目中未发现 `jest`、`vitest`、`mocha` 等测试依赖，也没有测试文件（无 `*.test.*` 或 `*.spec.*` 文件）。

**Build/Dev:**
- esbuild 0.25 - Production bundler for server code (`server.ts` to `dist/server.cjs`)
- tsx 4.21 - Development runtime for TypeScript (ESM transpilation on the fly)
- autoprefixer 10.4 - PostCSS plugin for CSS vendor prefixes (bundled with TailwindCSS)
- `@vitejs/plugin-react` 5.0 - Vite plugin for React Fast Refresh and JSX transforms

## Key Dependencies

**Critical:**
- `@google/genai` 2.8 - Google Generative AI SDK, used for Gemini model calls (`gemini-3.5-flash`, `gemini-2.5-flash`)
- `better-sqlite3` 12.10 - Synchronous SQLite3 driver for Node.js; stores all persistent data in `packages/core/db/educational_os.db`
- `socket.io` 4.8 + `socket.io-client` 4.8 - WebSocket real-time communication (server + client)
- `zustand` 5.0 - Lightweight React state management library
- `dotenv` 17.2 - Environment variable loading from `.env` files

**Visualization & Interaction:**
- `konva` 10.3 + `react-konva` 19.2 - HTML5 Canvas 2D rendering for the interactive whiteboard
- `react-konva-utils` 2.0 - Utility helpers for react-konva
- `recharts` 3.8 - Charting library for statistical visualizations (academic performance, attendance)
- `reveal.js` 6.0 + `@types/reveal.js` 5.2 - Web-based presentation framework for slideshow-style courseware
- `motion` 12.23 - Animation library (formerly Framer Motion)
- `lucide-react` 0.546 - Icon library

**Document Processing:**
- `jspdf` 4.2 + `jspdf-autotable` 5.0 - Client-side PDF generation (reports, score exports)
- `jszip` 3.10 - ZIP archive creation/reading (courseware packaging, plugin packaging)
- `pptx-preview` 1.0 - PowerPoint file preview (uploaded teaching materials)
- `react-markdown` 10.1 - Markdown rendering for AI responses and lesson content

**Utilities:**
- `uuid` 14.0 - Unique ID generation

**Type Definitions (devDependencies):**
- `@types/better-sqlite3` 7.6
- `@types/express` 4.17
- `@types/node` 22.14
- `@types/uuid` 10.0

## Configuration

**TypeScript:**
- Config: `tsconfig.json`
- Key settings: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit: true`, path alias `@/*` maps to `./*`

**Vite:**
- Config: `vite.config.ts`
- Plugins: `@vitejs/plugin-react` (React Fast Refresh), `@tailwindcss/vite` (Tailwind CSS 4 integration)
- Path alias: `@` maps to project root
- HMR disabled via `DISABLE_HMR` env var (for AI Studio compatibility)

**pnpm Workspace:**
- Config: `pnpm-workspace.yaml`
- Key setting: Allows native builds for `@google/genai`, `better-sqlite3`, `core-js`, `esbuild`, `protobufjs`

**Environment:**
- `.env.example` 文件存在 — 定义两个必需变量:
  - `GEMINI_API_KEY` — Gemini AI API 密钥（AI Studio 通过用户密钥面板自动注入）
  - `APP_URL` — 应用部署 URL（AI Studio 通过 Cloud Run 服务 URL 自动注入）
- 开发模式：根目录放置 `.env` 文件（`dotenv` 自动加载）
- 生产模式：AI Studio 运行时环境自动注入

## Platform Requirements

**Development:**
- Node.js (支持 ES2022 modules)
- pnpm 或 npm
- 有效的 GEMINI_API_KEY（或配置第三方 AI 提供商）

**Production:**
- AI Studio 平台（Google Cloud Run 部署）
- Metadata config `metadata.json` 声明 `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` 能力
- 构建流程：`vite build`（前端）+ `esbuild server.ts --bundle --platform=node --format=cjs --packages=external`（后端）
- `packages/external` 标志确保 `better-sqlite3` 等原生模块不被打包，由生产环境的 `node_modules` 提供

---

*Stack analysis: 2026-06-17*
