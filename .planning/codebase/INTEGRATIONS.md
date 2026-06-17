# External Integrations

**Analysis Date:** 2026-06-17

## APIs & External Services

**AI 大语言模型:**
- Google Gemini — 系统默认 AI 服务，用于 Agent 聊天、课件自动提交注入、OCR 识别
  - SDK: `@google/genai` 2.8
  - Auth: `GEMINI_API_KEY`（环境变量）
  - 模型: `gemini-3.5-flash`（默认 Agent 聊天和大多数场景）, `gemini-2.5-flash`（课件提交 SDK 注入）
  - 调用入口:
    - `server.ts:195` — `runGeminiAgentChat()` 中创建 `new GoogleGenAI({ apiKey })`
    - `server.ts:2251` — 课件自动提交注入中使用
    - `server.ts:3325` — OCR 识别请求
    - `server.ts:3472` — 成绩/评估生成

- OpenAI 兼容 API — 第三方 AI 提供商（用户可在管理面板配置）
  - SDK: 无（直接使用 `fetch` + REST API，`server.ts:275` `runOpenAIAgentChat()`）
  - Auth: 通过 `ai_providers` 表中存储的 `api_key`（Bearer Token）
  - 端点: 用户配置的 `api_url`，通过 `buildOpenAIChatUrl()` 构建 `/chat/completions` 路径
  - 配置管理: `server.ts:715` 从 `ai_providers` 表查询，`POST /api/admin/ai-providers` 端点管理 CRUD

**PPT 预览:**
- `pptx-preview` 1.0 — 客户端 PPT 文件渲染预览
  - 无需外部 API，完全客户端处理

## Data Storage

**数据库:**
- SQLite（本地文件）via `better-sqlite3` 12.10
  - 数据库文件: `packages/core/db/educational_os.db`（300KB，30+ 张表）
  - 客户端: 直接使用 `better-sqlite3` Driver，无 ORM
  - 连接: 同步 API，`new Database(dbPath)` 在 `packages/core/db/index.ts:25`
  - 核心表: `events`（事件审计日志）, `lessons`, `whiteboard_elements`, `plugins`, `plugin_storage`, `pending_commands`, `processes`, `vfs_nodes`, `classes`, `students`, `class_students`, `student_lesson_progress`, `assignments`, `assignment_submissions`, `schedules`, `attendance`, `system_resources`, `computer_labs`, `student_seats`, `courseware`, `courseware_attempt`, `submission_raw`, `submission_result`, `users`, `client_sessions`, `ai_providers`, `exams`, `exam_scores`, `student_semester_reports`

**文件存储:**
- 本地文件系统 — 无外部对象存储服务
  - `storage/courseware/<uuid>/` — 课件文件（HTML + ZIP + 运行时代码）
  - `uploads/` — 上传的 PDF/PPTX 文件
  - `assets/` — 静态资源（插件 ZIP 包等）

**缓存:**
- 无外部缓存服务
- 服务器内存中维护少量运行时状态:
  - `onlineStudents` Map — 在线学生映射（`server.ts:4879`）
  - `activeStudentLessons` Map — 学生当前课程（`server.ts:4880`）
  - `lessonActiveSegments` Map — 课程活跃环节（`server.ts:4881`）

## Authentication & Identity

**Auth Provider:**
- 自定义 Cookie/Session 认证 — 无第三方身份提供商
  - 实现: Cookie `edu_os_token` 存储会话令牌，`server.ts` 中 `POST /api/auth/login`、`checkAuth()` 中间件
  - 用户表: `users`（存储在 SQLite 中）
  - 默认账户: `admin/admin`（administrator 角色）、`teacher/teacher`（teacher 角色）
  - 角色系统: `student`, `teacher`, `administrator`
  - 权限控制: `CapabilityGuard` 子系统基于字符串能力（如 `lesson:write`, `management:read`），`checkIsTeacherOrAdmin()` 保护管理端点

## Monitoring & Observability

**错误追踪:**
- 无外部错误追踪服务（如 Sentry、Datadog）
- 控制台日志 + `console.error` 错误处理

**日志:**
- `console.log` / `console.error` 标准输出
- 关键事件写入 SQLite `events` 表（审计日志，`packages/core/event-bus/index.ts` 自动记录所有事件）
- 进程日志: 每个后台进程的 `logs` 字段存储在 `processes` 表中

## CI/CD & Deployment

**托管平台:**
- Google AI Studio — 应用托管和运行环境
  - 配置文件: `metadata.json` 声明应用元数据和所需能力
  - 运行时注入: `GEMINI_API_KEY` 和 `APP_URL` 由 AI Studio 自动注入
  - HMR 兼容: `DISABLE_HMR` 环境变量控制开发模式下文件监听（AI Studio Agent 编辑文件时防止闪屏）

**CI Pipeline:**
- 未检测到 CI/CD 配置文件（无 `.github/workflows`、`.gitlab-ci.yml` 等）
- 构建命令: `npm run build` → `vite build`（前端）+ `esbuild server.ts`（后端）

## Environment Configuration

**必需环境变量:**
- `GEMINI_API_KEY` — Google Gemini API 密钥（默认 AI 服务的核心凭据）
- `APP_URL` — 应用部署 URL（用于自引用链接和回调）

**可选环境变量:**
- `NODE_ENV` — 自动检测：打包输出（`.cjs` 或在 `/dist` 路径下）时自动设为 `production`
- `DISABLE_HMR` — 设为 `true` 时禁用 Vite HMR 和文件监听（AI Studio 编辑模式）

**密钥位置:**
- 开发: `.env` 文件（项目根目录，不提交到 git）
- 生产: AI Studio 运行时环境自动注入
- 第三方 AI 提供商密钥: 存储在 SQLite `ai_providers.api_key` 字段中

## Webhooks & Callbacks

**WebSocket 实时通信（替代 HTTP Webhook 模式）:**
- 使用 Socket.IO 进行双向实时推送，事件包括:
  - `courseware-attempt-updated` — 课件提交更新（`server.ts:1199,1240`）
  - `student-progress-updated` — 学生进度更新（`server.ts:1390,3142`）
  - `lesson-progress-mode-changed` — 课程进度模式变更（`server.ts:1968`）
  - `assignment-graded-toast` — 作业批改通知（`server.ts:4801`）
  - `student-picked` — 随机点名结果（`server.ts:4842`）
  - `presence-update` — 在线学生状态（`server.ts:4884`）
  - `whiteboard-sync` — 白板实时同步（`server.ts:4932`）
  - `student-active-segment-changed` — 课堂环节切换（`server.ts:4909,4939`）
  - `student-acknowledged` — 学生确认（`server.ts:2878`）
  - `class-lock-status-changed` — 班级锁定状态（`server.ts:2897,2913`）

**HTTP 回调:**
- `POST /api/commands` — 执行内核命令（`server.ts:662`）
- `POST /api/agent/chat` — AI Agent 对话（`server.ts:689`）
- `POST /api/courseware/upload` + `POST /api/courseware/confirm` — 课件上传和确认
- `POST /api/courseware/attempts/:attemptId/submit` — 课件成绩提交
- 课件运行时代理端点: `GET /runtime/:uuid/` 和 `GET /runtime/:uuid/*` — 提供课件文件

---

*Integration audit: 2026-06-17*
