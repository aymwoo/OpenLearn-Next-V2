# Changelog

All notable changes to **OpenLearn V2** (platform package `openlearn-next`) are documented here.

> Versioning note: the platform `openlearn-next` is versioned independently of
> `@openlearn/plugin-sdk` (currently **3.5.2**) and `@openlearn/plugin-test-kit`.
> Bumping the platform does not change the SDK / test-kit versions.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.3.7] - 2026-09-06

### Features & CLI Utilities
- **NPX 缓存与运行数据安全清理命令 (CLI Cache Cleaner Command)**：
  - 在 [`cli.mjs`](file:///home/wuxf/Develop/openlearnv2/cli.mjs) 及 [`cli-cleaner.mjs`](file:///home/wuxf/Develop/openlearnv2/cli-cleaner.mjs) 中新增 `clean` / `clean-cache`（以及 `--clean` / `--clean-cache`）命令行工具；
  - **精准清理 NPX 历史旧包**：自动扫描 `~/.npm/_npx/` 下的所有散列子目录，精准清理历史残留的旧版本 `openlearn-next` 临时目录，彻底杜绝 NPX 因缓存命中旧版本的问题；
  - **优化运行数据与日志**：默认清理 SQLite WAL 预写日志 (`data.db-wal`)、共享内存文件 (`data.db-shm`) 与临时目录，并在默认模式下严格保护用户核心业务数据 `data.db` 不被误删；
  - **丰富选项支持**：支持 `--npx`（仅清包缓存）、`--db`（重置本地数据库）与 `--all`（全量彻底清理重置）；
  - 新增 `-v` / `--version` 快速版本查询与完善的 `-h` / `--help` 命令帮助指引；
  - 新增自动化单元测试套件 [`packages/core/__tests__/cli-cleaner.test.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/cli-cleaner.test.ts)。

## [0.3.6] - 2026-09-06

### Quality & Governance (防版本漂移质量加固)
- **内核导出版本定义强收敛 (Kernel Definition Convergence)**：
  - 将 [`packages/core/bootstrap/types/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/bootstrap/types/index.ts) 中的 `PLATFORM_VERSION` 改为直接从单一真理源 [`packages/core/version.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/version.ts) 导入，彻底消除内核内部出现双重硬编码字面量的隐患。
- **全自动防版本漂移质量门禁测试 (Anti-Drift Test Gate)**：
  - 新增专用自动化质量门禁测试套件 [`packages/core/__tests__/version-consistency.test.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/version-consistency.test.ts)，设立 6 重自动化强断言：
    1. 根目录 `package.json.version` 强等于 `PLATFORM_VERSION`；
    2. `OPENLEARN_VERSION` 强等于 `PLATFORM_VERSION`；
    3. `bootstrap/types` 导出的平台版本强等于核心版本；
    4. `PlatformBuilder` 构建元数据与环境版本强等于核心版本；
    5. 全量 7 个核心内置插件（`builtin`、`vfs`、`process`、`management`、`ai-planner`、`ai-submit-injector`、`assignment-eval`）的 `engines.openlearn` 约束能被平台当前版本 100% 满足；
    6. `docs/conf.py` 动态或静态严格与 `package.json` 对齐。
  - 后续任何发版若漏改任一处或引发插件互锁，`pnpm test` 会在 1 秒内阻断发布并给出清晰指引。
- **文档系统版本动态绑定 (Dynamic Docs Versioning)**：
  - 改造 [`docs/conf.py`](file:///home/wuxf/Develop/openlearnv2/docs/conf.py)，改用 Python 原生动态读取根目录 `package.json` 的版本号，保证 Sphinx 文档系统与主应用平台版本永不脱节。
- **SDK 依赖版本对齐与发版脚本加固 (Dependency & Publish Hardening)**：
  - 升级根目录 `package.json` 对 `@openlearn/plugin-sdk` 的依赖为 `^3.5.2`；
  - 加固 [`scripts/publish.sh`](file:///home/wuxf/Develop/openlearnv2/scripts/publish.sh)，前置注入 `pnpm lint` 与防漂移测试强制门禁；
  - 完善发版指南 [`.agents/skills/openlearn-release-workflow/SKILL.md`](file:///home/wuxf/Develop/openlearnv2/.agents/skills/openlearn-release-workflow/SKILL.md) 标准操作规程。
- **生态与插件开发规范文档纠偏 (Ecosystem Doc Fixes)**：
  - 修正 [`docs/plugin/plugin-manifest-spec.md`](file:///home/wuxf/Develop/openlearnv2/docs/plugin/plugin-manifest-spec.md) 与插件开发教程中的 SemVer 示范，全面替换为 `">=0.2.5"` 并详细阐述 SemVer 0.x 规则。

## [0.3.5] - 2026-09-06

### Fixes & Architecture Alignment
- **平台版本单一真理源 (Single Source of Truth) 与漂移消除**：
  - 新建 [`packages/core/version.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/version.ts)，统一导出 `PLATFORM_VERSION` 与 `OPENLEARN_VERSION`；
  - 消除 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) 中历史滞留的 `OPENLEARN_VERSION = '0.2.5'` 硬编码；
  - 消除 [`packages/core/bootstrap/types/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/bootstrap/types/index.ts) 与各适配器（`UnifiedExtensionRegistry`、`PluginRuntimeAdapter`、`PluginCapabilityGateway`、`PluginRuntimeComposition`、`PluginLifecycleManager`、`PluginDistributionManager` 等）中写死的 `'0.2.5'`；
  - 修正 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 的 `/health` 接口版本获取逻辑，直接使用 `PLATFORM_VERSION`，彻底避免跨目录/CLI 运行环境下 `process.cwd()` 缺失 `package.json` 导致的读取回退。
- **内置核心插件与模版兼容性放宽 (Relaxed Engine Constraints)**：
  - 将 7 大内置插件（`builtin`、`vfs`、`process`、`management`、`ai-planner`、`ai-submit-injector`、`assignment-eval`）及插件 SDK 脚手架模板中的 `engines.openlearn` 由过紧的 `^0.2.5`（SemVer 规范下仅匹配 `<0.3.0`）调整为向上兼容的 `>=0.2.5`，杜绝 0.x 阶段版本升级引发的插件互锁拒载异常。
- **SPA 路由与健康检查端点层级调整 (Route Order Correction)**：
  - 将 `/health`、`/health/ready`、`/metrics` 端点移至静态 SPA 回退路由（`app.get('*', ...)`）之前，修复生产环境下对系统探针请求错误返回 `index.html` 的问题。
- **历史数据库插件恢复安全容错 (Worker Directory Existence Guard)**：
  - 在 [`packages/core/worker-runtime/worker-manager.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/worker-manager.ts) 创建 Worker 时，检查 `pluginDir/index.js` 是否在物理磁盘真实存在。若物理文件因迁移或版本迭代已清理，自动安全回退至内嵌数据 URL 启动，消除启动恢复时的 `ERR_MODULE_NOT_FOUND` 堆栈报警。

## [0.3.3] - 2026-09-06

### Fixes & Network Hardening
- **Socket.IO & Express Same-Origin CORS 智能放行 (Same-Origin Auto-Allowance & CORS Fix)**：
  - 在 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 引入统一的 `isOriginAllowed(origin, hostHeader)` 判定算法；
  - 修复生产环境（未显式配 `ALLOWED_ORIGINS` 时）CORS 回调对同源浏览器请求（如 `http://localhost:9000`）抛出 `new Error('CORS not allowed')` 导致底层 Engine.IO 响应 `HTTP 400 Bad Request {"code": 3, "message": "Bad request"}` 的问题；
  - 自动放行同源请求（`new URL(origin).host === hostHeader`）与本地回环来源（`localhost`、`127.0.0.1`、`[::1]`、`0.0.0.0`），对于未受信任跨域请求安全剔除 `Access-Control-Allow-Origin` 头而不再向底层抛出未捕获异常；
  - 解决客户端重连由于 CORS 阻断陷入反复 400 的异常状态。

## [0.3.2] - 2026-09-06

### Fixes & Runtime Hardening
- **Vite 依赖动态按需解耦 (Vite Decoupling & Module Loader Fix)**：
  - 移除 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 顶层静态 `import { createServer as createViteServer } from 'vite'`，消除 esbuild 打包 CJS 时在 `dist/server.cjs` 顶层生成的 `require("vite")` 提升语句；
  - 将开发期 Vite 中间件初始化改为在 `if (process.env.NODE_ENV !== 'production')` 分支内执行异步 `await import('vite')`，彻底解决在纯生产环境（零 `devDependencies` 安装）及 `npx openlearn-next@latest` 启动时由于缺失 vite 引发的 `Cannot find module 'vite'` 崩溃异常。
- **esbuild 核心解耦与生产依赖补齐 (esbuild Dynamic Import & Dependency Governance)**：
  - 移除 [`packages/core/esm-loader/install-utils.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/esm-loader/install-utils.ts) 顶层静态 `import * as esbuild from 'esbuild'`，在 `bundlePlugin` 函数内部改为按需动态 `await import('esbuild')`，避免服务启动模块加载期对 esbuild 的同步求值；
  - 将 `esbuild` 正式移入 [`package.json`](file:///home/wuxf/Develop/openlearnv2/package.json) 的生产 `dependencies`，保障在独立部署与分发场景下管理后台上传安装插件 ZIP 时的内存打包与编译功能完好可用；
  - 经扫描校验，`dist/server.cjs` 外部依赖缺失项完全归零（`Missing from dependencies: []`）。
- **CLI 生产环境模式显式守卫 (CLI Production Safeguard)**：
  - 在 [`cli.mjs`](file:///home/wuxf/Develop/openlearnv2/cli.mjs) 启动子进程前显式注入 `process.env.NODE_ENV = process.env.NODE_ENV || 'production'`，保障从 CLI/npx 唤起时稳定运行于生产静态托管模式。

## [0.3.1] - 2026-09-06

### Features
- **插件导航 API 扩展**：`FrontendPluginContext.navigation` 新增 `setSelectedLesson(lessonId: string | null)` 方法，转发到 `appStore.setSelectedLesson`，供第三方插件在 `activate(ctx)` 中切换当前课节。

### Security & Multi-Teacher Authorization (Round 4)
- **IDOR 课程水平越权防护与教师专属所有权 (Lesson Ownership & IDOR Protection)**：
  - **数据层升级**：在 [`packages/core/db/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/db/index.ts) 与 [`migrations/000_initial_schema.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/000_initial_schema.sql) 中的 `lessons` 表增加 `creator_id TEXT` 字段，并在系统启动时平滑执行 `ALTER TABLE lessons ADD COLUMN creator_id TEXT`，全面兼容历史老版本未标记创建人的课程；
  - **内核指令绑定**：在 [`packages/plugins/builtin.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/builtin.ts) 的 `lesson.create` 命令执行时，优先解析 `payload.creatorId` 或提取 `command.actorId`（自动解析 `user:usr_id:teacher` 前缀），并在发出的 `lesson.created` 领域事件中携带创建人 ID；
  - **路由所有权守卫与白板写访问权限中间件**：在 [`server/routes/lessons.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/lessons.ts) 抽象出通用鉴权函数 `checkLessonOwnership(req, lessonId)` 与声明式白板写权限中间件 `requireWhiteboardWriteAccess()`：
    - 针对课堂主白板（`!assignment-`），强制教师/管理员登录并验证课程所有权，严禁学生和未授权教师修改/清空白板；
    - 针对随堂作业学生白板（`assignment-${id}-student-${studentId}`），强制身份认证并校验当前学生是否为该作业的拥有者（防止跨学生篡改与匿名恶意刷白板），教师与管理员放行以支持在线批注与作业点评；
    - 统一挂载至 `POST /api/lessons/:id/whiteboard/reset`、`POST /api/lessons/:id/whiteboard`、`PUT /api/lessons/:id/whiteboard/:elementId`、`DELETE /api/lessons/:id/whiteboard`、`DELETE /api/lessons/:id/whiteboard/:elementId`；
    - 为 `POST /api/lessons/:id/quiz-submit`、`GET /api/lessons/:id/quiz-submissions` 以及 `POST /api/lessons/:id/ai-tutor` 补齐明确的 `requireAuth` 角色中间件，拦截匿名恶意调用与大模型 Token 额度消耗。
  - **教研协同流转与一键克隆**：重构 `POST /api/lessons/:id/clone` 接口，强制挂载 `requireAuth('teacher', 'administrator')` 中间件，在复制课程模板与白板结构时自动将新课程属主更新为当前操作教师，实现“跨教师只读浏览 + 一键克隆转为本人教案”的顺畅备课流转；
  - **前端交互与安全视觉**：
    - 在 [`CourseManagement.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/teacher/CourseManagement.tsx) 课程卡片中显著标注创建教师身份（本人课程展示皇冠徽章，他人课程展示只读图标），对于非本人创建课程禁用删除按钮并提示权限不足；新增「我的备课」快速筛选开关，支持教师在海量共享课程中一键聚焦个人教案；
    - 在 [`LessonEditorView.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/teacher/LessonEditorView.tsx) 中增加只读横幅提示，并在他人课程模式下引导一键克隆，拦截非所有者修改操作；
  - **自动化测试套件**：编写 [`server/__tests__/lesson_ownership.test.ts`](file:///home/wuxf/Develop/openlearnv2/server/__tests__/lesson_ownership.test.ts)，全方位覆盖未登录拦截 (401)、学生越权阻断 (403)、跨学生作业白板篡改拦截 (403)、跨教师越权拦截 (403)、管理员放行、老旧课程兼容以及克隆后属主流转等核心用例，全平台 177 个测试套件（1011 个测试用例）持续 100% 绿灯。

### Security & Engineering Governance (Round 3)
- **SEC-01 传输安全与 Cookie 策略加固 (Cookie Secure & Nginx TLS Best Practice)**：
  - 在 [`server/routes/roster.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/roster.ts) 中对身份凭据 Cookie `edu_os_token` 进行安全改造，根据请求来源及环境协议动态注入 `; Secure` 标识，并将超长有效期缩短并精准对齐服务端会话有效期（7 天 / 604,800 秒）。
  - 在 [`nginx.conf`](file:///home/wuxf/Develop/openlearnv2/nginx.conf) 与 [`nginx.generated.conf`](file:///home/wuxf/Develop/openlearnv2/nginx.generated.conf) 增补全链路 HTTPS 443 SSL 规范配置（TLS 1.2/1.3、强加密套件、HSTS），并提供 80 端口强跳 443 的最佳实践指导。
- **SEC-02 敏感端点鉴权防护与统一脱敏错误处理中间件 (Endpoint Protection & Info Leakage Defense)**：
  - 对监控与关键配置端点挂载严格权限门禁：[`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 中的 `/metrics` 挂载 `requireAuth('administrator')`；[`server/routes/plugins.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/plugins.ts) 中的 `GET /api/ai-providers` 挂载 `requireAuth('teacher', 'administrator')`，`/api/admin/logs` 挂载 `requireAuth('administrator')`。
  - 创建 [`server/utils/error-handler.ts`](file:///home/wuxf/Develop/openlearnv2/server/utils/error-handler.ts) 实现统一的 `sendSafeError` 错误响应中间件，在生产环境下统一屏蔽底层 SQL 语句、文件系统绝对路径与系统异常堆栈，全面替换各路由模块中的裸 `e.message` 返回，杜绝敏感系统信息探测与泄漏。
- **SEC-03 依赖治理、锁定文件与工程规范校准 (Dependency Governance & Clean Repository)**：
  - 彻底清理仓库跟踪的冗余锁定文件 `package-lock.json` 与历史遗留临时文件 `temp_check.mjs`、`test-results/`，同步在 [`.gitignore`](file:///home/wuxf/Develop/openlearnv2/.gitignore) 增补忽略规则。
  - 在 [`package.json`](file:///home/wuxf/Develop/openlearnv2/package.json) 补齐 `"engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }`；清理失效废弃脚本 `migrate-passwords`；
  - 编写 [`scripts/backup-db.ts`](file:///home/wuxf/Develop/openlearnv2/scripts/backup-db.ts) 重构 `db:backup` 脚本，修复此前因 ESM/CJS 混用导致的模块加载失败。
- **SEC-04 代码清洁度与路由层解耦治理 (Lint Warnings & Architecture Hygiene)**：
  - 全面清理由旧版 `server.ts` 拆分至 14 个路由文件时机械复制的无用头文件导入与上下文全量解构代码（如 `GoogleGenAI`、`xss`、`crypto`、`bcrypt`、`ai-submit-injector` 等），ESLint warnings 大幅缩减近 600 个，TypeScript 类型检查零错误通过。
- **SEC-05 自动化测试与内核文档同步 (Docs & Test Parallelism Alignment)**：
  - 校准 [`AGENTS.md`](file:///home/wuxf/Develop/openlearnv2/AGENTS.md) 描述，阐明 Vitest 启用 `fileParallelism: true` 的真实原理（通过环境变量 `VITEST_POOL_ID` 隔离于独立 SQLite 库文件），修复文档失真；全量 176 个测试套件、993 个用例持续 100% 绿灯通过。

### Security
- **VULN-06 白板协同投毒阻断 (RCE & XSS Defense)**：
  - 彻底移除 [`MathGraphWrapper.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/widgets/MathGraphWrapper.tsx) 中的原生 `eval`，自研实现算术 AST 递归下降求值器 `safeEvaluateMath`，严格限定白名单数学运算与常用函数，彻底阻断 JS 语法、属性与原型链穿透。
  - 重构 [`CodeSandboxWrapper.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/widgets/CodeSandboxWrapper.tsx)，将代码执行迁移至独立 Web Worker Blob 沙箱环境，隔离 DOM、Cookie、`localStorage` 访问，并配置 3 秒看门狗超时中断。
- **VULN-03 审批端点鉴权与篡改拦截**：
  - 在 [`server/routes/processes.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/processes.ts) 中对 `/api/approvals/*` 与 `/api/processes/*` 强制挂载 `requireAuth('administrator')`，并彻底移除 `payloadOverride` 字段，杜绝参数篡改风险。
- **VULN-07 课件上传路径穿越与同源 XSS 隔离**：
  - 在 [`packages/plugins/builtin.ts`](file:///home/wuxf/Develop/openlearnv2/packages/plugins/builtin.ts) 中对课件单 HTML 上传增加路径净化 `path.basename(filename.replace(/\\/g, '/'))` 与 `!destPath.startsWith(storageDir)` 沙箱边界强校验，彻底拦截 `../` 路径穿越写文件。
  - 在 [`server/routes/resources.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/resources.ts) 直出 HTML 资源响应头注入 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-downloads`，将其降级为 opaque origin，消除同源 XSS 攻击向量。
- **VULN-01 核心业务路由鉴权全覆盖**：
  - 在 [`server/routes/roster.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/roster.ts)、[`server/routes/grading.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/grading.ts)、[`server/routes/assignments.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/assignments.ts)、[`server/routes/schedules.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/schedules.ts)、[`server/routes/lessons.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/lessons.ts)、[`server/routes/workspace.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/workspace.ts) 中为所有增删改接口全面补齐 `requireAuth('teacher', 'administrator')`。
  - 在 `/api/vfs` 针对 `virtual-submissions` 增加数据脱敏，普通学生仅可拉取本人提交物，杜绝全校学生姓名、提交内容与成绩泄露。
- **VULN-02 课件成绩伪造与冒名提交拦截**：
  - 在 [`server/routes/courseware.ts`](file:///home/wuxf/Develop/openlearnv2/server/routes/courseware.ts) 课件管理接口挂载教师/管理员鉴权，在 `/attempts/:attemptId/log` 与 `/submit` 增加学生所属权强校验，拦截跨账号冒名刷分改分。
- **VULN-04 插件安装命令注入防护与默认凭证预警**：
  - 在 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) 中为依赖安装统一添加 `--ignore-scripts` 阻断 postinstall 钩子执行，对 `manifest.deploy.script` 增加 `ALLOW_UNSAFE_PLUGIN_SCRIPTS=true` 环境变量门禁。
  - 在 [`packages/core/db/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/db/index.ts) 针对默认内置管理员与教师账号增加显著安全日志预警。
- **VULN-05 插件 Worker 资源配额限制**：
  - 在 [`packages/core/worker-runtime/worker-manager.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/worker-manager.ts) 实例化 Worker 时配置 `resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 }`，有效抵御插件内存耗尽型拒绝服务（DoS）。
- **VULN-08 Socket.IO 握手鉴权与 CORS 严格白名单化**：
  - 在 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 为 Socket.IO 引入 `io.use()` 握手鉴权中间件，校验 `edu_os_token` Cookie/Auth 并注入 Session；严格限制 CORS Origin 回调，生产环境下禁止未配置时退化为 `origin: '*'`。
  - 在 [`server/presence.ts`](file:///home/wuxf/Develop/openlearnv2/server/presence.ts) 增加角色与身份强校验，阻断学生客户端伪造他人 `studentId` 发起进入/离开课堂事件，并对 `teacher-broadcast-segment` 与 `teacher-ping-student` 严格限定仅教师或管理员可用。
- **VULN-09 插件 ZIP 条目与脚本 Zip Slip 绝对防御**：
  - 在 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) 中对 `storage/` 静态条目解压与 `manifest.deploy.script` 路径进行全面规范化，严格拒绝任何包含 `..` 的路径，并强校验 `path.resolve` 结果必须以插件安装目录为绝对前缀，阻断路径穿越写盘。
- **VULN-10 Helmet Content-Security-Policy (CSP) 策略深度收紧**：
  - 在 [`server.ts`](file:///home/wuxf/Develop/openlearnv2/server.ts) 的 Helmet CSP 中移除 `scriptSrc` 通配 `https:` 与 `data:`，仅允许 `'self'`, `'unsafe-inline'`, `'unsafe-eval'`, `blob:`；移除 `frameSrc` 全局通配 `http:` 与 `https:`，仅允许 `'self'`, `blob:`, `data:` 及环境变量可配置的合法课件域；精确化 `styleSrc` 与 `fontSrc` 仅允许受信 Google Fonts 域名。
- **VULN-11 数据库 RPC 核心安全表与底层高危 SQL 指令拦截**：
  - 在 [`packages/core/worker-runtime/service-host.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/service-host.ts) 中增加 `FORBIDDEN_OPERATIONS` 正则，全面封杀 `ATTACH DATABASE`、`DETACH DATABASE`、`PRAGMA`、`VACUUM`、`CREATE/DROP TRIGGER` 与 `CREATE/DROP VIEW`；
  - 扩展核心安全保护表白名单与 DDL 作用域校验，杜绝插件通过裸 SQL 绕过业务层或破坏数据库内部结构。
- **VULN-12 生产环境依赖漏洞治理与子依赖版本覆盖**：
  - 将仅用于开发和打包的 `xlsx` 迁移至 `devDependencies`，将 `vite` 迁移至 `devDependencies`；
  - 在 `pnpm-workspace.yaml` 中配置安全版本覆盖（`overrides`），将 `ws` (>=8.21.0), `socket.io-parser` (>=4.2.7), `nanoid` (>=3.3.18), `postcss` (>=8.5.23), `ip-address` (>=10.3.1), `dompurify` (>=3.4.13), `qs` (>=6.16.0), `body-parser` (>=1.20.6), `protobufjs` (>=7.6.5) 全面升级到安全版本。
  - `pnpm audit --prod` 达成 **0 vulnerabilities (无已知漏洞)**。
- **VULN-13 课件 LMS Bridge 消息响应定向化与通配广播收紧**：
  - 在 [`src/services/lms-bridge.ts`](file:///home/wuxf/Develop/openlearnv2/src/services/lms-bridge.ts) 回复 `LMS_PROGRESS_RESPONSE` 时严格校验接收方窗口属于 DOM 中受管辖的有效 iframe；针对具有非 null 真实域名的 iframe 定向回传 `event.origin`，并在 `sendCommandToCourseware` 中根据 iframe URL 解析真实 Origin，消除向非受信窗口通配泄露数据的隐患。
- **VULN-14 前端插件静态解析与静态路由沙箱隔离**：
  - 彻底重构 [`src/utils/pluginParsers.ts`](file:///home/wuxf/Develop/openlearnv2/src/utils/pluginParsers.ts)，完全删除主线程中的 `new Function` 动态求值，改用纯静态正则与作用域提取，杜绝浏览器主线程解析恶意插件时遭受同源脚本执行攻击；
  - 在 [`packages/core/plugin-host/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/index.ts) 的插件静态资源路由挂载中间件，强制注入 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-downloads` 与 `X-Content-Type-Options: nosniff` 响应头，确保插件静态前端页面降级至沙箱隔离环境，无法越权窃取宿主 Cookie 及本地存储。
- **自动化安全回归验证**：
  - 扩充 [`server/__tests__/security_hardening.test.ts`](file:///home/wuxf/Develop/openlearnv2/server/__tests__/security_hardening.test.ts) 与 [`src/utils/__tests__/pluginParsers.test.ts`](file:///home/wuxf/Develop/openlearnv2/src/utils/__tests__/pluginParsers.test.ts)，全量 176 个测试套件、993 个用例持续保持 100% 绿灯通过。


## [0.3.0] - 2026-09-06

### Features
- **现代教育 OS 主题系统 (Theming System Engine - Phase 3)**：
  - **主题可视化设计器 (`ThemeDesignerModal.tsx`)**：开发沉浸式调色板设计器，内置 4 套创意预设（高雅墨蓝、暮樱柔粉、复古秋叶、深海极客），提供核心主色/背景/卡片/边框/文字等色值微调、实时拟真沙箱视口微缩预览、配置 JSON 导入/导出与复制，支持本地自定义主题管理与一键激活。
  - **微前端沙箱与互动课件主题同步 (MFE & Courseware Theme Bridge)**：升级 [`src/services/lms-bridge.ts`](file:///home/wuxf/Develop/openlearnv2/src/services/lms-bridge.ts) 与 [`server/utils/bridge-sdk.ts`](file:///home/wuxf/Develop/openlearnv2/server/utils/bridge-sdk.ts)，宿主向所有课件沙箱 `iframe` 跨域广播 `theme:changed` 与 `LMS_THEME_CHANGED` 消息；沙箱内部自动响应式写入 `data-theme` 属性与 CSS 变量，并为第三方课件提供 `window.LMS.getTheme()` 查询 API。
  - **课件加载主动握手**：在 [`InteractiveCoursewareViewer.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/courseware/InteractiveCoursewareViewer.tsx) 与 [`HtmlAppletFrame.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/components/HtmlAppletFrame.tsx) 的 iframe `onLoad` 时主动下发当前主题，保障各类多文件互动课件与动态 HTML 小应用首屏样式无缝匹配。
- **现代教育 OS 主题系统 (Theming System Engine - Phase 2)**：
  - **白板渲染引擎主题联动**：升级 [`theme-manager.ts`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/rendering-engine/theme/theme-manager.ts)，原生支持 `eyecareTokens` 与 `chalkboardTokens`，实现交互白板底色（黑板墨绿 `#0e1713`）、极坐标微网格点（淡绿微光 `#2d5242`）与笔刷/文字对比度智能自适应反转（Dark/Chalkboard 模式下黑色笔迹自动转为粉笔白 `#f8fafc`），并支持外部主题订阅与动态注册。
  - **白板悬浮控件 Token 化**：白板悬浮工具栏 [`WhiteboardToolbar.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/components/WhiteboardToolbar.tsx) 与底部分页导航胶囊 [`WhiteboardPageBar.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/components/WhiteboardPageBar.tsx) 全面语义化，支持选取、画笔、几何图形、荧光笔色盘与大纲抽屉无缝随全局换肤。
  - **核心教学主视图容器适配**：课堂控制中心 [`LiveClassroomView.tsx`](file:///home/wuxf/Develop/openlearnv2/src/components/LiveClassroomView.tsx)、备课工作台 [`LessonEditorView.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/teacher/LessonEditorView.tsx)（及画板组件库 [`LessonPalette.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/teacher/lesson-editor/LessonPalette.tsx)）与学生端工作台 [`StudentView.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/student/StudentView.tsx) 全面接入设计 Token。
  - **单测护航**：新增 [`theme-manager.test.ts`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/__tests__/theme-manager.test.ts)，全量 174 个测试套件、976 个用例持续保持 100% 绿灯。
- **现代教育 OS 主题系统 (Theming System Engine - Phase 1)**：
  - 基于 Tailwind CSS v4 原生变量机制构建设计 Token 层，在 [`src/index.css`](file:///home/wuxf/Develop/openlearnv2/src/index.css) 中规范 `--bg-app`、`--bg-surface`、`--border-theme`、`--text-main`、`--color-primary` 等语义化设计变量与实用类。
  - 内置 4 套教育场景专属预设：**浅色日间 (Light)**、**暗夜极客 (Dark)**、**教学护眼防眩光 (EyeCare)**、**经典墨绿黑板 (Chalkboard)**。
  - 新增中心化主题状态管理器 [`src/store/themeStore.ts`](file:///home/wuxf/Develop/openlearnv2/src/store/themeStore.ts)，支持 DOM 响应式同步、本地偏好记忆（`localStorage`）以及动态注册自定义主题样式；
  - 研发顶栏主题切换器组件 [`ThemeSelector.tsx`](file:///home/wuxf/Develop/openlearnv2/src/components/ThemeSelector.tsx)，完成应用主外壳与导航侧边栏的语义化换肤适配。
- **数据库版本化迁移体系 (Phase 20 - DB-MIG-01)**：
  - 新增 [`server/utils/migrate.ts`](file:///home/wuxf/Develop/openlearnv2/server/utils/migrate.ts) 迁移加载与执行引擎，支持从 `migrations/` 自动读取 `.sql` 文件，按文件名自然排序并解析 `-- UP` 与 `-- DOWN` 分隔符。
  - 服务启动时自动执行迁移并记录状态至 `_migrations` 表（包含 `applied_at` 与 `checksum`），具备天然幂等性与 duplicate column 容错保护，并支持单项迁移回滚。
  - 落地首批标准迁移：[`000_initial_schema.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/000_initial_schema.sql)（30+ 核心数据表与索引）、[`001_add_execution_mode.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/001_add_execution_mode.sql)、[`002_add_client_session_expiry.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/002_add_client_session_expiry.sql)、[`003_classroom_runtime.sql`](file:///home/wuxf/Develop/openlearnv2/migrations/003_classroom_runtime.sql)。

### Fixes
- **Worker 插件自建表 DDL 安全白名单修复**：
  - [`ServiceHost`](file:///home/wuxf/Develop/openlearnv2/packages/core/worker-runtime/service-host.ts) 构造函数与方法支持同时校验 `dbPluginId`（DB UUID）与 `pluginId`（manifest.id）双重合法命名空间前缀，转义特殊字符为下划线，彻底修复 `@ext/class-manager` 等插件在 worker 内部建表时触发 `not permitted to perform DDL` 导致的 Watchdog 重启崩溃循环。
- **自定义 AI 提供商首屏列表加载修复**：
  - 修复 [`usePluginManagement`](file:///home/wuxf/Develop/openlearnv2/src/hooks/usePluginManagement.ts) 与 [`AdminPanel`](file:///home/wuxf/Develop/openlearnv2/src/components/AdminPanel.tsx) 初始化挂载时未主动调用 `fetchAIProviders()` 的问题，确保系统初次运行时默认自带的 DeepSeek 与 MiniMax 模型即时呈现，无需在添加新 provider 之后才被动刷新。
- **React 19 Rules of Hooks 违规清零**：
  - 修复 [`PluginCardRenderer.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/whiteboard/widgets/PluginCardRenderer.tsx)（`useRef`/`useEffect` 条件调用）与 [`ActivityWorkspaceWidget.tsx`](file:///home/wuxf/Develop/openlearnv2/src/features/activity-ecosystem/ActivityWorkspaceWidget.tsx)（`useMemo` 条件调用）中的 3 处致命 Hook 违规，消除了组件卸载/挂载时 Fiber 链条错乱的运行时风险。

### Refactor / Performance
- **测试套件多 Worker 数据库隔离与 Vitest 并发提速**：
  - [`packages/core/db/index.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/db/index.ts) 在 `process.env.VITEST` 下按 Worker Pool ID / PID 分配隔离的临时 SQLite 实例，彻底消除跨测试文件数据库死锁竞争。
  - [`vitest.config.ts`](file:///home/wuxf/Develop/openlearnv2/vitest.config.ts) 开启 `fileParallelism: true`，全量 172 个测试文件、965 个测试用例运行时间从 **204 秒极限压缩至 37.45 秒**（提速 **5.4 倍**）。
- **ESLint 工具链基线修复与清理**：
  - 修正 [`eslint.config.js`](file:///home/wuxf/Develop/openlearnv2/eslint.config.js) 全局 ignores，排除 `.venv`、构建产物与 Sphinx 文档静态脚本，调整非关键警告级别，`pnpm lint:eslint` 达成 0 Error 绿灯基线。

### Features (v0.2.9)
- **html-applet 组件增强**：
  - 抽取统一 `<HtmlAppletFrame>` 组件（画布内嵌/全屏/兜底三处复用），按优先级解析四种内容源：`coursewareUuid` → `resourceId` → 插件自定义内容源 → `code`（`srcDoc`）。
  - `HtmlAppletPayload` 补齐 `resourceId` / `sourceType` / `sourceId`，并修复 `buildElementData` 字段丢失与 `title` 渲染。
  - 新增 `src/types/lms-bridge.ts`，声明 `window.LMS` / `__LMS_STUDENT__` / `__LMS_COURSEWARE__` 类型契约。
- **插件内容源扩展**：新增 `coursewareSourceRegistry` 与 `ctx.ui.registerCoursewareSource` / `unregisterCoursewareSource`（所有权感知 + 停用自动清理），SDK 导出 `CoursewareSourceLoader` 类型。
- **LMS Bridge 双向通信**：`window.LMS` 新增 `on` / `off` / `setConfig` / `getProgress`；宿主新增 `sendCommandToCourseware(iframe, event, payload)`；后端新增 `GET /api/courseware/attempts/:attemptId/progress`。
- **课件事件化**：课件 `submitted` / `progress_saved` / `event_logged` / `config_reported` 发布到前端 EventBus（`courseware.` 前缀经 Socket 转发到后端 EventBus），后端 log 路由发布 `courseware.event_logged`。
- **备课画板组件配置增强**：`EditFieldKind` 新增 `select`（静态 `options` + 动态 `loadOptions`），`PaletteCardEditModal` 支持下拉选择；html-applet 的 `coursewareUuid` / `resourceId` 可在备课画板直接选择。

### Security (v0.2.9)
- html-applet iframe 新增 `credentialless` 与 `referrerPolicy="no-referrer"`；`injectLmsSdk` 防御性移除 `<base>` 与 `<meta http-equiv=refresh>` 导航逃逸向量。

### Fixes (v0.2.9)
- Worker 插件自建表前缀改用 `manifestId`（与命令命名空间及 ServiceHost 的 DDL 守卫一致），避免 Worker 插件在自己命名空间建表被误判为越权 DDL。

### Refactor / Performance (v0.2.9)
- html-applet iframe 懒挂载（IntersectionObserver，200px 预加载边距）+ 同时挂载上限 4 个（`courseware-frame-limiter.ts`）。

### Docs (v0.2.9)
- `docs/reference/plugin-ui-extension-slots.md` 新增 §7 课件内容源、§8 LMS Bridge 双向通信；`docs/architecture/whiteboard-runtime.md` 同步 html-applet 渲染管线说明。

## [0.2.8] - 2026-09-04

### Features
- **第三方插件白板扩展能力（v3.5）**：
  - `ctx.ui.registerFullscreenRenderer(type, renderer)` / `ctx.ui.registerPropertyEditor(type, editor)` 允许插件为自定义白板元素类型注册全屏渲染器与属性编辑器；`fullscreenRendererRegistry` / `propertyEditorRegistry` 增加所有权感知的 `unregister` / `unregisterPlugin`，插件停用/卸载/激活失败时宿主自动清理其注册。
  - SDK `@openlearn/plugin-sdk` 新增 `FullscreenRendererProps` / `FullscreenRenderer` / `PropertyEditorProps` / `PropertyEditorComponent` 四个 type-only 导出。
- **扩展点组件统一注入课堂上下文**：
  - `ExtensionPointRenderer` 向所有扩展点组件 props 注入 `{ lessonId, classId }`（当前课程/班级，源 `appStore.selectedLesson` / `liveClassSelectedClassId`），`teacher.tab` 面板形态同步注入。
  - `FrontendPluginContext` 新增 `ctx.context.get()` / `ctx.context.subscribe()` 只读快照与订阅，供非渲染场景读取当前课程/班级。

### Security
- **Worker 插件数据库安全屏障**：`ServiceHost` 拦截 IDatabase RPC，禁止 Worker 插件访问核心安全表（`users` / `client_sessions` / `plugins` / `ai_providers` 等），并将 DDL 操作限制在插件自身命名空间（`plugin_<id>_` 前缀）内。

### Docs
- 更新 [`docs/reference/plugin-ui-extension-slots.md`](docs/reference/plugin-ui-extension-slots.md)：明确各槽位注入的 `slotProps` 字段契约与 `ctx.context` 用法，纠正 `@/` 宿主内部导入对第三方插件不可达的误区，并将 `fullscreenRendererRegistry` / `propertyEditorRegistry` 用法改为 `ctx.ui.register*`。
- 新增 [`docs/release-notes/v0.2.8.md`](docs/release-notes/v0.2.8.md) 发布说明。

## [0.2.7] - 2026-08-31

### Security
- **严格无同源沙箱隔离（Strict Sandboxing）**：
  - 彻底移除 `src/features/whiteboard/InteractiveWhiteboard.tsx`、`src/features/courseware/InteractiveCoursewareViewer.tsx` 与 `src/features/whiteboard/fullscreen/FullscreenRendererRegistry.tsx` 中所有 iframe 的 `allow-same-origin` 声明。
  - 统一确立 `sandbox="allow-scripts allow-forms allow-downloads"` 严格沙箱隔离，完全依托 LMS Bridge Proxy 代理跨域消息，对齐平台架构最高安全标准。

### Refactor / Performance
- **数据库外键强制开启（Database Integrity）**：
  - 在 `packages/core/db/index.ts` 初始化连接配置中显式启用 `db.pragma('foreign_keys = ON');`，在 SQLite 引擎层强制激活外键级联检查，杜绝孤儿数据。

### Tooling
- **ESLint TypeScript 规则优化**：
  - 在 `eslint.config.js` 的 `**/*.{ts,tsx}` 配置段加入 `'no-undef': 'off'`，避免 ESLint 重复校验 TypeScript 编译器类型定义导致的假报错。

### Docs
- 新增 [`docs/release-notes/v0.2.7.md`](docs/release-notes/v0.2.7.md) 发布说明，更新 Sphinx toctree 并完成 HTML 文档生成。
- 全量自动化测试回归 169 / 169 套件（941 个用例）100% 通过。

## [0.2.6] - 2026-08-30

### Features
- **插件锚点扩展槽（Anchor Slots）—— 支持在宿主原生按钮前后插入插件按钮**：
  - 新增 `anchor:*` 开放槽位：宿主在原生按钮/元素前后各渲染一次 `<ExtensionPointRenderer slot="anchor:..." placement="before|after" />`，插件通过 `placement` 声明插入侧。
  - `ExtensionPointConfig` 新增 `placement?: 'before' | 'after'`（缺省 `'after'`）；`ExtensionPointRenderer` 新增同名 prop 用于按侧过滤渲染。
  - 前端槽位类型放宽为 `AnyExtensionSlot`（`ExtensionSlot | AnchorSlot | string`），`FrontendPluginContext.ui.registerExtensionPoint` 支持任意锚点槽位。
  - manifest `contributes` 通过 `.passthrough()` 允许任意 `anchor:*` 键；后端 `ContributionRegistry` 新增 `AnchorToolConfig` 类型并纳入 `ContributionConfig` 联合。
  - SDK（`@openlearn/plugin-sdk`）导出 `AnchorToolConfig`；`openlearn.d.ts` 同步补充类型。
  - 白板工具栏已埋七个锚点：`presentation`、`code-sandbox`、`math-graph`、`courseware`、`rollcall`、`ai-tutor`、`grid`（槽位前缀 `anchor:whiteboard-toolbar:`）。

### Security
- **权限边界与最小特权原则加固**：
  - 在 `packages/core/capability-system/index.ts` 中移除 `'user-frontend': ['*:*:*']` 全局通配符特权，改为按用户角色（`:teacher` / `:student`）授予最小能力，未登录用户回退为 `anonymous: []` 零特权。
  - `server/middleware/auth.ts` 中 `getActorId(req)` 未登录回退修正为 `'anonymous'`。
  - 加固 `packages/core/kernel/index.ts` 中的 `isAdmin` 校验，消除子串模糊匹配隐患。
- **Worker 沙箱原生模块安全黑名单**：
  - 在 `packages/core/worker-runtime/worker-manager.ts` 的 `ctx.require` 中拦截 `child_process`, `fs`, `net`, `http`, `os`, `vm`, `cluster`, `worker_threads` 等危险模块，彻底防范插件逃逸沙箱执行主机指令。
- **LMS Bridge 跨窗口消息源校验**：
  - `src/services/lms-bridge.ts` 中校验 `event.source` 是否属于当前 DOM 中的合法 `iframe.contentWindow`，阻断跨窗口消息仿冒。
- **AI Provider 连通性测试 SSRF 拦截**：
  - `server/routes/plugins.ts` 中新增 `isSafeExternalUrl` 校验，封禁指向本地回环及内网私有网段的恶意探测。
- **操作系统指令通道鉴权**：
  - `server/routes/os.ts` 中对 `POST /api/commands` 挂载 `requireAuth()` 中间件。

### Fixes
- **TypeScript 全量类型编译错误清零 (72 Errors -> 0)**：
  - **前端主壳 TDZ 修复**：重构 `src/App.tsx` 中的 Hook 拓扑声明顺序，引入 `chatLogUpdaterRef` 解决 `useCourseWizard`、`usePluginManagement`、`useAgentChat` 的循环与延迟依赖，彻底清除 8 处变量在使用前引用错误。
  - **组件与服务契约对齐**：
    - `src/features/teacher/Dashboard.tsx`：适配 `scoreOverrides` 状态更新器与 `QuickActionsMenu` 异步回调。
    - `src/features/teacher/PluginView.tsx`：引入严格 `Language` 与 Tab 联合类型。
    - `src/features/teacher/classes/ClassStudentsPanel.tsx`：支持函数式更新器 `(prev => ...)`。
    - `src/hooks/useGradeExport.ts`：修复 `exportAllClassesCombinedCSV` 参数传递结构。
    - `src/components/PluginSettingsModal.tsx`：严格声明 `ConfigProperty` 类型断言。
    - `src/features/ai-classroom-context/` & `classroom-runtime/`：修复多态值类型、只读数组解构以及 `EventBus.publish` 的 `metadata: {}` 字段。
  - **核心包与服务端契约修复**：
    - `packages/core/esm-loader/manifest-schema.ts`：适配 Zod v4 双参 `z.record(z.string(), z.unknown())`。
    - `packages/plugins/__tests__/*.test.ts`：将抽象类 `new EsmLoader()` 替换为实体类 `new NodeEsmLoader()`。
    - `server/routes/grading.ts`：将 `kernelContainer.registry` 修复为 `kernelContainer.serviceRegistry`。
    - `packages/core/configuration/PlatformConfiguration.ts`：修复 `ConfigurationContext` 模块导入并放开动态扩展属性的可变性。
- **前端扩展点排序生效**：
  - `plugin-host-store.getExtensions` 按 `position` 升序（缺省 `100`）稳定排序。

### Refactor / Performance
- **数据库 9 处核心高频业务索引**：
  - 在 `packages/core/db/index.ts` 中新增 9 个针对性复合与二级索引（`idx_whiteboard_lesson`、`idx_class_students_class`、`idx_class_students_student`、`idx_schedules_class_date`、`idx_courseware_attempt_cw_st`、`idx_submission_result_attempt`、`idx_events_type_time`、`idx_assignments_class`、`idx_attendance_schedule`），消除面授课堂、排课及成绩导出时的全表扫描。

### Docs
- 新增锚点目录 [`docs/plugin/anchor-slots.md`](docs/plugin/anchor-slots.md) 并更新相关扩展点规范。
- 新增 [`docs/release-notes/v0.2.6.md`](docs/release-notes/v0.2.6.md) 发布说明。
- 全量自动化测试回归 169 / 169 套件（941 个用例）全绿通过。

### Security
- **从仓库跟踪中移除 `scratch/` 目录（17 个文件）**：该目录包含本地开发脚本、playwright 验证脚本、49KB dashboard 截图等。最严重的是 `scratch/test_logs_api.ts` —— 一个会在 SQLite 中插入伪造 admin session token 的脚本。如果随 main 分支泄露，会成为种子式攻击向量。现已 `.gitignore` 排除并 `git rm --cached` 取消跟踪。
- **`server/utils/crypto.ts` 禁止原地覆盖现有 ENCRYPTION_KEY**：旧逻辑检测到 .env 中存在 `ENCRYPTION_KEY=` 空值时会生成新密钥**原地替换**——这会让已用旧密钥加密的全部 AI Provider Key 不可解密（数据级不可回滚故障）。现改为：检测到现有 ENCRYPTION_KEY 行（含空值）时绝不动它，转用 ephemeral in-memory key + 警告日志，强制运维显式备份、轮换密钥。

### Fixes
- **TypeScript 编译错误修复（12 个，全部在未提交修改中）**：
  - `src/components/plugin-center/types.ts`：将 `export type { Language } from '../../i18n'`（re-export 不创建本地绑定）改为 `import type + export type`，修复 `TS2304 Cannot find name 'Language'`。
  - `packages/core/capability-runtime/CapabilityProvider.ts`：`CapabilityContext` 从 `./types.js` 导入但 types 未 re-export；改为从 `./CapabilityContext.js` 直接导入。
  - `packages/core/esm-loader/manifest-schema.ts`：zod v4 要求 `z.record(keySchema, valueSchema)`，将两处 `z.record(z.unknown())` 改为 `z.record(z.string(), z.unknown())`。
  - `packages/core/plugin-host/hot-reload.ts`：`HotReloadCallback` 要求 `Promise<void>` 返回，但 callback 返回 void；callback 改为 async。
  - `packages/core/configuration/ConfigurationError.ts` + `ConfigurationRegistry.ts`：`ConfigurationErrorCode` 联合类型添加 `'NOT_FOUND'`，匹配 `ConfigurationRegistry.get()` 的实际语义。
  - `packages/core/di/container/PlatformContainer.ts`：`ServiceDescriptor` 所有字段 readonly，不能事后赋值；改用三元表达式在对象字面量中一次性构造。
  - **`packages/core/bootstrap/` 三个文件**：消除 `IBootstrapStage` 在 `types/index.ts` 和 `pipeline/bootstrap-stage.ts` 的双重定义歧义（TS2308 + TS2416）。统一为单一权威定义：types 中的版本包含完整字段（`id`、`timeoutMs`、`rollback`），`bootstrap-stage.ts` 改为 `export type` re-export，`pipeline/index.ts` 桶导出移除重复项。
- **回归测试失败修复（2 个）**：
  - `src/components/__tests__/AppShell.test.tsx`：`React.lazy` 加载 `StudentView` 的异步链超过 `findByText` 默认 1s 超时（Suspense fallback 一直显示）。`findByText` 显式传 `timeout: 10_000` 并加注释说明 jsdom lazy import 的特性。
  - `packages/core/worker-runtime/__tests__/service-host.test.ts`：测试期望的错误消息 `'Access to table "users" is restricted'` 与实际产出的 `'Worker plugin "ext-test-db" is forbidden from accessing core security table "users"'` 不一致；同步测试断言到当前实现（代码演进后消息更详细）。
  - `packages/core/__tests__/{bootstrap-pipeline,platform-builder,plugin-platform-integration}.test.ts`：依赖 bootstrap 类型重构 + 为 `PluginCapability` 构造传入真实依赖（`AIRuntimeKernel` + `CapabilityLogger`）。
  - **全量回归 951 passed / 1 skipped**（170/170 测试文件），`pnpm lint` 通过。

### Refactor / Performance
- **`server.ts` health 端点版本号硬编码清理**：原代码返回 `version: '4.0.0'`，与 `package.json` 0.2.5 严重漂移。改为启动时从 `package.json` 读取 `version` 字段，**单一版本来源**，避免版本发布时手工同步遗漏。
- **`vite.config.ts` 移除 `framer-motion` 死代码 chunk 规则**：项目已迁移到 `motion`（`framer-motion` 仅作为其间接依赖存在）；删除针对 `/framer-motion/` 的 chunk 分桶规则，保留对 `/motion-dom/` 的归类（`vendor-motion`）。

## [0.2.5] - 2026-08-29

### Refactor / Performance
- **Vite Fine-grained Bundle Chunking & 90.1% Entry Bundle Reduction**:
  - Entry bundle `index.js` shrank from **2,181.47 kB (2.18 MB)** down to **216.43 kB (gzip: 66.69 kB)** — a **90.1% reduction** in initial download size.
  - Implemented modular `manualChunks` in `vite.config.ts` separating third-party dependencies into categorized vendor chunks: `vendor-react`, `vendor-charts` (Recharts & D3), `vendor-pdf` (jsPDF & html2canvas), `vendor-konva`, `vendor-reveal`, `vendor-pptx`, `vendor-icons` (Lucide), `vendor-motion` (Framer Motion), `vendor-content` (Marked & DOMPurify), and `vendor-utils`.
- **System-wide Asynchronous Component Lazy Loading (`React.lazy` & `Suspense`)**:
  - **`AppModals`**: Converted all 13+ modal dialogs (`CourseWizardModal`, `QuizGeneratorModal`, `ImportLessonsModal`, `BatchPickerModal`, `ExportWeightModal`, `CloudDriveModal`, `SystemResourceLibraryModal`, `StudentPreviewModal`, `ProcessLogsModal`, `HelpTour`, etc.) to asynchronous on-demand loading.
  - **`AppShell`**: Decoupled `TeacherView` and `StudentView` via `React.lazy`, eliminating cross-role code loading for student sessions.
  - **`TeacherView`**: Implemented lazy loading for non-dashboard sub-views (`ClassesView`, `TimetableView`, `ComputerLabView`, `AdminDirectoryView`, `HelpView`, `PluginView`, `LiveClassroomView`).
  - **`StudentView`**: Implemented lazy loading for `StudentLessonView` and `StudentAssignmentView`.

### Fixes
- **Asynchronous Unit Test Compatibility**:
  - Updated `TeacherView`, `StudentView`, and `AppShell` unit tests to support async DOM querying (`await screen.findByText`) with `Suspense` hydration.
  - Added jsDOM `ResizeObserver` mock and mock socket instance in test harnesses.

## [0.2.4] - 2026-08-29

### Refactor / Performance
- **Frontend Architecture & `App.tsx` Decoupling**:
  - Slimmed `src/App.tsx` down from **3,974 lines** to **1,722 lines** (a total reduction of **-2,252 lines, -56.7%**), transforming the monolithic root into a clean routing and context coordinator.
  - **`useLabAndSchedule`**: Encapsulated computer lab management, classroom seating layouts, timetable scheduling, and rollcall attendance tracking.
  - **`useGradeExport`**: Encapsulated grade weighting calculations, real-time CSV preview, single/multi-class CSV grade exports, whole-school PDF generation, and 30-day academic risk warning algorithms.
  - **`useLessonTimeline`**: Encapsulated lesson segment timeline state, drag-and-drop ordering, remote persistence, and SQLite auto-save state machine.
  - **`useStudentNotifications`**: Encapsulated student assignment notices, grading feedback alerts, random rollcall notifications, and read receipt tracking.
  - **`useLessonFiltering`**: Encapsulated lesson searching, sorting, and multi-criteria filters.
  - **`usePluginManagement`**: Encapsulated plugin installations, raw binary ZIP uploads, approval workflows, and AI Provider CRUD / connectivity testing.
  - **`useCourseWizard`**: Encapsulated multi-step course creation wizard workflow and timeline generation.
  - **`useQuizGenerator`**: Encapsulated AI MCQ objective quiz generation and answer tracking.
  - **`useClassBatchOperations`**: Encapsulated batch class/student selection, batch deletion, batch scheduling, batch password resets, and batch transfers.
  - **`bulkImportService`**: Separated CSV/JSON import parsers and template downloads into pure service modules.
  - **`AppModals` Adapter Pattern**: Refactored modal props into structured hook bundle adapters, eliminating dozens of top-level prop drilling lines.

### Features
- **Enhanced Hook & Service Layer**:
  - Pure modular services for grade reporting (`gradeReportService.ts`) and bulk imports (`bulkImportService.ts`).
  - Unified adapter support in `AppModals` allowing direct composition of domain hook bundles.

### Fixes
- **Redundant State & Shadowing Fixes**:
  - Cleaned up shadowed state declarations and duplicate fetcher calls across `App.tsx`.
  - Fixed PDF report generation state conflict between single-class and multi-class tracking.

### Docs
- Generated comprehensive architecture audit reports and stage-by-stage refactoring blueprints (`p0~p4` reports in artifact history).

## [0.2.3] - 2026-07-30

### Features
- **Course Management Enhancement (`CourseManagement.tsx`)**:
  - Add **icon toolbar** on each course card: View/Edit, Copy, Delete, replacing the single "View Interactive" button.
  - Add **filter chips**: filter by enrollment (>0 students), content (non-empty), and creation date (this month).
  - Add **course copy** with optimistic UI: click Copy → immediate placeholder card with loading state → API clone completes → list refreshes.
  - Add **course deletion** with stats confirmation dialog showing affected whiteboard elements, schedules, enrollments, and assignments before irreversibly deleting.
  - Course title is now clickable to navigate to the editor.
- **Backend Course APIs (`server/routes/lessons.ts`)**:
  - `DELETE /api/lessons/:id` — hard-delete a lesson with cascade deletion of whiteboard elements, student progress, schedules, and assignments.
  - `GET /api/lessons/:id/stats` — return counts of whiteboard elements, schedules, enrollments, and assignments for the delete confirmation dialog.
  - `POST /api/lessons/:id/clone` — full clone (title prefixed "副本-", content, timeline, whiteboard elements; enrollment reset to 0).
- **Fullscreen Renderer Registry (`src/features/whiteboard/fullscreen/`)**:
  - New `FullscreenRendererRegistry` with `register(type, component)` / `get(type)` API for third-party plugins to provide custom fullscreen views.
  - Smart default renderer that auto-detects data fields (`code`, `markdown`, `question`, `text`, `url`, `src`, `coursewareUuid`, `equation`) and renders appropriate HTML without hardcoded type switches.
  - `FullscreenOverlay` component using `createPortal` to render at `document.body` with `fixed` positioning covering the entire browser viewport (not just the whiteboard container).
  - Built-in type registrations: `quiz`, `timer`, `assignment`, `rollcall` (preserved from legacy), plus `html-applet` with iframe + Bridge SDK.
  - ESC key and close button always available in overlay.
- **Property Editor Registry (`src/features/whiteboard/properties/`)**:
  - New `PropertyEditorRegistry` with `register(type, component)` / `get(type)` API enabling third-party plugins to inject custom property editors into the whiteboard's right-side properties panel.
  - Plugin editors receive `{ elementId, elementType, data, updateData, lessonId, onClose }` (data-driven `useState`-style API).
  - Generic properties (x/y/width/height) and delete button remain platform-managed.
  - Plugins import via `@/features/whiteboard/properties`.

### Fixes
- **Course navigation always redirects to the same course**: Fix stale closure in `fetchLessons()` polling interval where `selectedLesson` was read from the React closure instead of the Zustand store, causing the 2-second poll to reset `selectedLesson` to `data[0].id`. Changed to `appStore.getState().selectedLesson`.
- **Drag-and-drop from palette to whiteboard fails when existing components are present**: Add `pointer-events: none` to the Konva Stage container during `isDragOverBoard` state, allowing native HTML5 `drop` events to pass through to the outer container div.

### Refactor / Performance
- **Fullscreen system refactored from hardcoded type switch** (90+ lines of if/else) to `FullscreenRendererRegistry` lookup with extensible registration.
- **View/Edit icon** changed from `Eye` to `Edit3` for better "enter editor" affordance.
- **Delete lesson route** now uses direct REST `DELETE /api/lessons/:id` instead of the command bus for simplicity.

### Docs
- Update `docs/reference/plugin-ui-extension-slots.md` with `whiteboard.fullscreen` and `whiteboard.property-editor` registry APIs.
- Expand `docs/whiteboard/whiteboard-runtime.md` with fullscreen renderer architecture and property editor extensibility documentation.

## [0.2.1] - 2026-07-29

### Features
- **Whiteboard Interactive Courseware Entry & Plugin Palette Integration**:
  - Add direct **Interactive Web Courseware / HTML Applet (Globe)** button immediately following **Math Function (Math Graph)** in `WhiteboardToolbar.tsx`.
  - Reorder `html-applet` in `paletteConfig.ts` to appear right after `math-graph` under the `present` group as "交互网页课件 (Interactive Courseware)".
  - Dynamically expose third-party plugins registering `classroom.tool` extension points inside `LessonPalette.tsx`, enabling teachers to click and insert third-party plugin components directly onto the whiteboard canvas.
- **Plugin Setup Wizard Enhancements (`PluginInstallWizard.tsx`)**:
  - Add a **⚡ Express Install / Update (`一键极速安装 / 一键极速更新`)** button in the wizard footer to automatically approve all requested permissions, accept downgrade/hot-update warnings, and complete installation in one click.
  - Apply risk-severity container and text color coding (`rose` for high risk, `amber` for medium risk, `emerald` for low risk) across requested capability rows in the permission audit step.

### Fixes
- **Fix Duplicate Toast Notifications (`appStore.ts`)**: Resolve duplicate toast card popups (e.g., plugin installation, course deployment) in `ToastContainer` by removing redundant `set(...)` array mutations in `appStore.ts`'s `addToast`/`removeToast` and delegating to `uiStore.subscribe` state synchronization. Locked by unit test suite `src/store/__tests__/appStoreToast.test.ts`.
- **Universal `postMessage` TargetOrigin `'null'` Fault Tolerance**: Implement three-layer protection (`server/utils/bridge-sdk.ts`, `src/features/whiteboard/utils/bridgeUtils.ts`, and `src/App.tsx`) that catches and normalizes invalid `targetOrigin: 'null'` calls from sandboxed third-party iframe applets into `'*'` with `[LMS Bridge Notice]` warnings, utilizing the `Object.defineProperty + Proxy` technique for shadowing `window.parent`/`window.top` on cross-origin WindowProxy. Covered by unit tests in `whiteboard-components.test.tsx`.
- **Helmet CSP `frame-src` Configuration (`server.ts`)**: Configure Content Security Policy `frame-src` directive to allow `'self'`, `blob:`, `data:`, `http://localhost`, `http://127.0.0.1`, `http:`, and `https:` origins for iframe courseware embedding.

### Docs
- **Plugin Developer Documentation (`/docs`)**: Update `docs/reference/plugin-ui-extension-slots.md` and `docs/tutorials/plugin-development-tutorial.md` detailing `classroom.tool` slot rendering targets across both `WhiteboardToolbar` and `LessonPalette`.

- **Decompose Remaining "God Components" (`TimetableManager.tsx`, `HelpView.tsx`, `PluginCenter.tsx`)**:
  - `TimetableManager.tsx`: Extracted shared types into `src/components/timetable/types.ts` and date helpers into `src/components/timetable/utils/timetableUtils.ts`. Split into 4 domain sub-views in `src/components/timetable/sub-views/`: `TimetableCalendarView.tsx` (week/cycle/list grid), `TimetableAdjustView.tsx` (batch holiday adjustment form), `TimetableImportExportView.tsx` (CSV/JSON export & importer), and `TimetableOcrView.tsx` (AI vision OCR recognition & review table). Reduced line count from **2,629 down to 1,670 lines** (-959 lines). Verified with unit tests in `src/components/__tests__/TimetableManager.test.tsx` (7/7 passing).
  - `HelpView.tsx`: Extracted helpers into `src/features/teacher/help/helpUtils.ts` & `helpUtils2.ts`. Split into 4 sub-view viewers in `src/features/teacher/help/`: `CommandBusPlayground.tsx` (interactive command playground & API debugger), `SdkGuideViewer.tsx` (plugin SDK tutorial & code examples), `UserGuideViewer.tsx` (system user guide & applet specs), and `PluginDocsViewer.tsx` (extension docs renderer). Reduced line count from **1,926 down to 324 lines** (-1,602 lines). Verified with unit tests in `src/features/teacher/help/__tests__/HelpView.test.tsx` (4/4 passing).
  - `PluginCenter.tsx`: Extracted types into `src/components/plugin-center/types.ts` and parser/sample helpers into `src/components/plugin-center/utils/pluginCenterUtils.ts`. Split into sub-views in `src/components/plugin-center/sub-views/`: `PluginStorePanel.tsx` (App Store discovery marketplace), `PluginDevPanel.tsx` (developer sideloading editor & manifest validator), and `PluginLogsPanel.tsx` (real-time system log terminal). Reduced line count from **1,784 down to 458 lines** (-1,326 lines). Verified with unit tests in `src/components/__tests__/PluginCenter.test.tsx` (2/2 passing).
- **Decompose `InteractiveWhiteboard.tsx` God Component (Phase 1 & 2)**: Extract 6 inline widget wrappers (`PluginCardRenderer`, `RollCallWrapper`, `CodeSandboxWrapper`, `MathGraphWrapper`, `HelloWorldWrapper`, `RevealPresentationWrapper`) and `wrapSrcDocWithBridge` into `src/features/whiteboard/widgets/` and `src/features/whiteboard/utils/bridgeUtils.ts`. Extract top floating toolbar into `src/features/whiteboard/components/WhiteboardToolbar.tsx`, bottom pagination & thumbnail drawer into `src/features/whiteboard/components/WhiteboardPageBar.tsx`, and modal dialogs into `src/features/whiteboard/components/WhiteboardDialog.tsx` & `CoursewareEntrySelectorModal.tsx`. `InteractiveWhiteboard.tsx` line count drops from **5,428 lines down to 3,466 lines** (shedding 1,962 lines of code!). All extracted components and widgets pass TypeScript type checks with 0 errors and are verified by unit tests in `src/features/whiteboard/__tests__/whiteboard-components.test.tsx` (4/4 tests passing).
- **Domain Store Decomposition & State Descent (Phase 1–5)**: Extract state from `appStore.ts` into 5 high-cohesion, low-coupling domain Zustand stores under `src/store/`: `uiStore.ts` (UI navigation, modals, toasts, site branding), `classStore.ts` (classes, student rosters, schedules, grades), `lessonStore.ts` (lessons, selected lesson, whiteboard elements, VFS nodes), `liveClassStore.ts` (live classroom feed, presence, time remaining), and `studentStore.ts` (student dashboard & notifications). Barrel export created at `src/store/index.ts`. All 5 domain stores include backward-compatibility bidirectional synchronization with `appStore.ts` and individual characterization unit test suites (`src/store/__tests__/uiStore.test.ts`, `classStore.test.ts`, `lessonStore.test.ts`, `liveClassStore.test.ts`, `studentStore.test.ts`) with 11/11 tests passing. Added `src/store/__tests__` pattern to `vitest.config.ts`.
- **Frontend monolith decomposition — Phase 1 (lesson_editor view)**: Extract the teacher `lesson_editor` tab view (the course timeline editor shell: palette, timeline rail, segment editor, lazy whiteboard, save-status badges, and the student-view preview trigger) from `src/App.tsx` into `src/features/teacher/LessonEditorView.tsx` behind a `LessonEditorViewProps` interface. All App-level state/setters/handlers are passed as props; the JSX is moved verbatim. Behavior is preserved and locked by `src/features/teacher/__tests__/LessonEditorView.test.tsx` (3 cases). `src/App.tsx` is reduced by ~194 lines. No new `tsc` errors beyond the type-debt baseline (116). This begins the incremental, characterization-test-guarded decomposition of `src/App.tsx` (~8.5k lines remaining) targeted for `0.3.0`.
- **Frontend monolith decomposition — Phase 2 (`classes` / School Management module)**: Decompose the entire `teacherTab === 'classes'` branch out of `src/App.tsx` into `src/features/teacher/classes/`. The module is split **by sub-feature into 9 components**, each with its own verbatim-move characterization test, then collapsed behind a single `ClassesView` wrapper: `CreateClassButton`, `ManualImportButton`, `ClassPasscodeController`, `ClassRowHeader`, `ClassTabs`, `ClassStudentsPanel`, `ClassAssignmentsPanel`, `ClassSchedulesCharts`, `ClassScheduleAttendance`, and `ClassesView` (the School Management header + batch-mode toolbar + export dropdown + `.map` body that forwards state to the 9 sub-components; the grades tab still delegates to the pre-existing `SemesterGradeManager`). `src/App.tsx` drops by ~1,925 lines (8,938 → 7,013). All 10 test files / 26 cases pass; `tsc` stays at the 116-error type-debt baseline. This completes the second feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 3 (`student` view)**: Decompose the entire `activeRole === 'student'` branch out of `src/App.tsx` into `src/features/student/`. Following the same verbatim-move + characterization-test pattern, the branch is split by sub-area into leaf components (`StudentDashboardHeader`, `StudentRollCallAlarms`, `StudentCourseProgressList`, `StudentQuickStats`, `StudentPerformanceCharts`, `StudentSchedulePanel`, `StudentAssignmentsPanel`, `StudentLessonHeader`, `StudentLessonContentPanel`, `StudentLessonInteractionPanel`, `StudentAssignmentHeader`, `StudentAssignmentQuestionPanel`, `StudentAssignmentWorkPanel`), collapsed behind three sub-wrappers (`StudentDashboardPanel`, `StudentLessonView`, `StudentAssignmentView`), and finally behind a single top-level `StudentView` wrapper that holds the outer container, the two guards (No-Student / Loading), and the `studentViewStatus` switch. `src/App.tsx` now renders a single `<StudentView .../>` for the student role; the `) : (` teacher branch join is preserved verbatim. All student-area test files pass (39 cases across 20 files); `tsc` stays at the 116-error type-debt baseline. This completes the third feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 4 (`teacher` branch wrapper)**: Collapse the entire `activeRole === 'teacher'` branch of `src/App.tsx` (the `<div className="flex-1 overflow-hidden flex bg-gray-50">` containing `NavigationSidebar`, the inner content div, the `PluginTabPanel` catch-all, and the full `teacherTab` ternary over `dashboard` / `lesson_editor` / `live_class` / `plugins` / `courses` / `classes` / `timetable` / `admin_directory` / `computer_labs` / `help`) into a single `src/features/teacher/TeacherView.tsx` behind a `TeacherViewProps` interface. `TeacherViewProps` is a flat composition of every child component's prop bag (shared props typed to the greatest-lower-bound across children that declare them), plus the few identifiers referenced only by App's inline expressions (`socketRef`, `setShowCoursewareHub`, `fetchStudents`, `fetchClassStudents`, `classStudentsMap`, `liveClassSelectedClassId`, `t`). The `live_class` inline expressions (the `students` computation, the `fetchStudents` arrow, `onPingStudent`, `onOpenCoursewareHub`) are moved verbatim so behavior is byte-for-byte preserved. `src/App.tsx` now renders a single `<TeacherView .../>` for the teacher role; the `{activeRole === 'student' ? (…) : (…)}` join is preserved verbatim. `TeacherView` ships with a characterization test (`src/features/teacher/__tests__/TeacherView.test.tsx`) covering the `teacherTab` switch. `tsc` stays at the 116-error type-debt baseline; the 8 failures in the broader suite (`packages/core/worker-rpc`, `packages/plugins/raffle-vote`, `packages/plugins/builtin`, `packages/core/di/ai-service`, `classroom-runtime/classroom-event-bus`, `ai-teacher-workspace`) are pre-existing environment/DI/API-key failures in untouched modules. This completes the fourth feature area of the `0.3.0` frontend decomposition.
- **Frontend monolith decomposition — Phase 5 (inline modals)**: Begin extracting the cluster of large **inline modals** still rendered with raw `<div className="fixed inset-0 …">` blocks in `src/App.tsx`. The first, the Course Creation Wizard (`isCourseWizardOpen`), is moved verbatim (steps 1–4, header, footer, `motion.div`, the `react-markdown` live preview, the preset buttons, and the editable timeline grid) into `src/features/modals/CourseWizardModal.tsx` behind a `CourseWizardModalProps` interface. `wizardCourseTimeline` is typed as `WizardSegment[]` (matching App's `any[]` for the `.color/.title/.type/.duration` accesses), and `setWizardStep` / `setWizardCourseTimeline` use `Dispatch<SetStateAction<…>>` to accept both value and updater calls; `generateTemplateContent` is re-imported from `src/features/teacher/HelpView`. The `isCourseWizardOpen &&` guard moves inside the component so `App.tsx` renders `<CourseWizardModal .../>` unconditionally. `src/App.tsx` sheds ~535 lines of inline modal JSX. Locked by `src/features/modals/__tests__/CourseWizardModal.test.tsx` (3 cases: renders for `lang` zh/en, hidden when closed).
- **Frontend monolith decomposition — Phase 5 (cont.: Import Lessons modal)**: Extract the second inline modal, Bulk-Import Courses (`isImportLessonsOpen`), verbatim (IDLE dropzone, PARSING preview table, IMPORTING progress, SUCCESS, ERROR states, footer controls) into `src/features/modals/ImportLessonsModal.tsx` behind an `ImportLessonsModalProps` interface; `previewImportData` is typed as `ImportRow[]` (`{ title; content }`), and `setPreviewImportData` / `setImportStatus` / `setImportErrorMsg` use `Dispatch<SetStateAction<…>>` to match App's `useState` setters. `import`/`motion`/lucide conventions mirror `CourseWizardModal`. Self-gating (`isImportLessonsOpen &&`) so `App.tsx` renders it unconditionally; `src/App.tsx` sheds ~305 lines. Locked by `src/features/modals/__tests__/ImportLessonsModal.test.tsx` (3 cases: renders for `lang` zh/en, hidden when closed). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: AI Quiz Generator modal)**: Extract the third inline modal, the AI Quiz Generator (`isQuizGeneratorOpen`), verbatim (objective/suggestion scan UI, time-limit selector, and the create-assessment `fetch` flow) into `src/features/modals/QuizGeneratorModal.tsx` behind a `QuizGeneratorModalProps` interface. Props typed to match App exactly (`lessons: Lesson[]`, `suggestedQuestions: any[]`, `quizGeneratorClassId: string | null`, `fetchClassDashboard: (classId: string) => void`; setters as `Dispatch<SetStateAction<…>>`). Self-gating so `App.tsx` renders it unconditionally; `src/App.tsx` sheds ~290 lines. Locked by `src/features/modals/__tests__/QuizGeneratorModal.test.tsx` (2 cases). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: Student Perspective Preview modal)**: Extract the fourth inline modal, the Immersive Student Perspective Preview (`isLessonPreviewVisible`), verbatim (split workspace: left Lesson-Markdown column + right `LazyWhiteboard`/`LazyCourseware` switcher with fullscreen toggles) into `src/features/modals/StudentPreviewModal.tsx` behind a `StudentPreviewModalProps` interface. Props typed precisely from `../../types/app` (`Lesson`, `WhiteboardElement`, `VFSNode`) and App's `useState` setters (`previewFullscreenPanel: 'none'|'left'|'right'`, `previewLessonTab: 'whiteboard'|'courseware'`, `activeRole`, `selectedLesson`, `elements`, `vfsNodes`, `previewSelectedCourseware`, `currentVfsParent`, `activeSegmentId`, `fetchElements`); `lang` is NOT a prop — the header is hardcoded zh. Mirrors the other modal conventions (`motion/react`, lucide `Eye/X/BookOpen/Minimize2/Maximize2/ChevronRight/Folder/Globe`, self-gating). `src/App.tsx` sheds ~217 lines. Locked by `src/features/modals/__tests__/StudentPreviewModal.test.tsx` (2 cases: renders header when visible, absent when closed). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: System Resource Library modal)**: Extract the fifth inline modal, the System Resource Library / App Store (`isSystemResourceLibraryOpen`), verbatim (tab switch between interactive-courseware/system-resources and the Cloud Drive panel, left upload+list pane, right sandbox `<iframe>` preview) into `src/features/modals/SystemResourceLibraryModal.tsx` behind a `SystemResourceLibraryModalProps` interface. Props typed to match App's `useState` declarations (`systemResourceTab`, `selectedLibraryResourceId`, `vfsNodes`, `currentVfsParent`, `cloudDrivePreviewNode`, `loadingLibraryResources`, `libraryResources`, `fetchLibraryResources`; setters as `Dispatch<SetStateAction<…>>`); reuses `CloudDrivePanel` from `CloudDriveModal`. Self-gating (`isSystemResourceLibraryOpen &&`) so `App.tsx` renders `<SystemResourceLibraryModal .../>` unconditionally; `src/App.tsx` sheds ~291 inline lines. Locked by `src/features/modals/__tests__/SystemResourceLibraryModal.test.tsx` (3 cases: renders header for `lang` zh/en, absent when closed). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: Batch Operation Picker modal)**: Extract the sixth inline modal, the Batch Operation Picker (`batchPicker &&`: 排课 / Batch Lock Lesson / Batch Transfer) verbatim into `src/features/modals/BatchPickerModal.tsx` behind a `BatchPickerModalProps` interface. Props typed to match App's `useState` declarations (`batchPicker` mode, `batchPickerLesson`/`batchPickerDate`/`batchPickerTargetClass` + setters as `Dispatch<SetStateAction<…>>`, `lessons`/`classes` as `any[]`, `expandedClassId`, `confirmBatchPicker`, `lang`); self-gating (`if (!batchPicker) return null`) so `App.tsx` renders `<BatchPickerModal .../>` unconditionally. Locked by `src/features/modals/__tests__/BatchPickerModal.test.tsx` (3 cases: renders `lang` zh/en heading when `batchPicker='schedule'`, absent when `null`). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 5 (cont.: Grade Export & Weighting Settings modal)**: Extract the seventh (final) inline modal, the Grade Export & Weighting Settings dialog (`isExportWeightModalOpen`), verbatim (weighting sliders + 50/50 & 40/60 presets, per-item quiz/assignment categorization overrides, live CSV grade preview table, footer export) into `src/features/modals/ExportWeightModal.tsx` behind an `ExportWeightModalProps` interface. Props typed to match App (`quizzesWeight`/`assignmentsWeight` + setters, `handleQuizzesWeightChange`/`handleAssignmentsWeightChange`, `customCategoryOverrides` + setter, `classDashboardMap`, `exportClassId`/`exportClassName`, `csvPreviewData` as a local `CsvPreviewData` shape, `handleExportGrades`, `lang`); uses `motion/react` and lucide `Settings2/Percent/ListFilter/Terminal/Download`. Self-gating (`if (!isExportWeightModalOpen) return null`) so `App.tsx` renders `<ExportWeightModal .../>` unconditionally. Locked by `src/features/modals/__tests__/ExportWeightModal.test.tsx` (3 cases: renders `lang` zh/en heading when open, absent when closed). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 6 (top app shell): extract `AppHeader`**: Extract the top navigation `<header>` (site brand/dashboard nav, student "View as" selector, notifications bell + dropdown, System Resource Library button, language toggle, SQLite DB-status badge, `UserMenu`) out of `src/App.tsx` (lines ~3602–3828) into `src/components/AppHeader.tsx` behind an `AppHeaderProps` interface. Prop types mirror App's `useState` declarations (`activeRole`, `teacherTab`/`studentViewStatus` + setters, `siteInfo` from the app store, `session`, `activeStudentId`/`students` + setters, `studentDashboardData`, `isNotificationsOpen` + setter, `studentNotifications`/`unreadNotifications`/`readNotifications` + setters, `setSelectedNotificationForModal`, `setIsSystemResourceLibraryOpen`, `lang`, `toggleLanguage`, `dbStatus`/`dbConnected`, `handleLogout`, `setProfileOpen`); reuses `UserMenu` from `./components/UserMenu` and the vite global `__APP_VERSION__`. `src/App.tsx` now renders `<AppHeader .../>` unconditionally. Locked by `src/components/__tests__/AppHeader.test.tsx` (3 cases: en renders `System Resource Library` + `Dashboard`, zh renders `系统资源库`, basic render). `tsc` stays at the 116-error type-debt baseline.
- **Frontend monolith decomposition — Phase 6 (cont.: `AppShell` role-switch wrapper)**: Extract the `{activeRole === 'student' ? <StudentView/> : <TeacherView/>}` switch (App.tsx lines ~3646–3886) into `src/components/AppShell.tsx` behind `AppShellProps = StudentViewProps & TeacherViewProps` (both existing interfaces are reused; the 5 shared identifiers with differing function signatures — `setActiveSegmentId`, `addToast`, `setSelectedAssignment`, `setStudentViewStatus`, `fetchElements` — resolve via intersection assignability, and `tsc` stays at 116). `AppShell` branches on `activeRole` and spreads all props to the chosen view, so `src/App.tsx` now renders a single `<AppShell .../>` (the merged union of all StudentView + TeacherView props) instead of the ternary. Swapped the now-dead `StudentView`/`TeacherView` imports for `AppShell`. Locked by `src/components/__tests__/AppShell.test.tsx` (2 cases: `activeRole:'student'` renders StudentView's "No Student Selected", `activeRole:'teacher'` renders TeacherView's nav "Live Class", each absent in the other). `tsc` stays at the 116-error type-debt baseline.

### Fixes
- **Type cleanup — `addToast` now accepts `'error'`**: Broaden the `addToast` / `showToast` type union from `'info' | 'success' | 'warning'` to `'info' | 'success' | 'warning' | 'error'` across the whole contract — `src/App.tsx` (the `addToast` definition, which rejected the `'error'` passed at lines 3359/3419), `src/services/ui-service.ts` (`UIService` wrapper), `src/components/TeacherAssignmentGradePanel.tsx`, `src/components/StudentAssignmentEvalPanel.tsx`, `src/components/LiveClassroomView.tsx`, `src/features/modals/CourseWizardModal.tsx`, `src/features/teacher/TeacherView.tsx`, `src/plugin-host/types.ts`, and the `IUIService.showToast` doc in `docs/tutorials/plugin-development-tutorial.md`. This resolves the two `TS2345` type errors that were part of the 116-`tsc` baseline (now **114**); `src/types/app.ts` already allowed `'error'` on the `Toast` type, so only the `addToast` signature was the blocker. Pure type-widening — no runtime behavior change. Affected component/modal/teacher tests (15 cases) still pass.

- **Type cleanup — `setLessons` accepts an updater function**: The `setLessons` store action in `src/store/appStore.ts` was typed `(lessons: Lesson[]) => void` and only took a plain value, so the two `setLessons(prev => prev.map(...))` updater calls in `src/App.tsx` (lines 2485, 2880) failed with `TS2345`. Widened the signature to `Lesson[] | ((prev: Lesson[]) => Lesson[])` and updated the implementation to branch on `typeof lessons === 'function'` (delegating to zustand `set((state) => …)`), mirroring React's `SetStateAction` convention. The value form at `src/App.tsx:1656` is unaffected. Resolves the 2 `TS2345` errors (tsc baseline **114 → 112**). No runtime behavior change; 58 component/feature tests pass.

### Next-round backlog
- **Frontend monolith (`src/App.tsx`)** is the active decomposition target for `0.3.0` — extracted incrementally by feature area with characterization tests. Phases 1–5 are done: `lesson_editor`, `classes`, `student`, and the entire `teacher` branch are decomposed behind `LessonEditorView` / `ClassesView` / `StudentView` / `TeacherView`, and seven inline modals (`CourseWizard`, `ImportLessons`, `QuizGenerator`, `StudentPreview`, `SystemResourceLibrary`, `BatchPicker`, `ExportWeight`) behind `CourseWizardModal` / `ImportLessonsModal` / `QuizGeneratorModal` / `StudentPreviewModal` / `SystemResourceLibraryModal` / `BatchPickerModal` / `ExportWeightModal`. **All raw `<div className="fixed inset-0 …">` inline modal blocks are now extracted**, the top navigation `<header>` is extracted into `src/components/AppHeader.tsx`, and the student/teacher role-switch is extracted into `src/components/AppShell.tsx` (Phase 6). The remaining inline regions in `src/App.tsx` are only: the outer app-shell wrapper `<div className="flex h-screen …">` plus component prop-forwarding calls that are already their own components (`RightSidebar`, `CoursewareHubPanel` via `showCoursewareHub`, `ProfileModal`, `ImportModal`, `ProcessLogsModal`, `CloudDriveModal`, `NotificationDetailModal`, `ToastContainer`, `HelpTour`), and the large prop list forwarded to `<AppShell/>` (unavoidable — `App.tsx` owns all the shared state). `src/App.tsx` is now ~4080 lines (down from ~8938); the net shrink from the shell extractions is modest because the merged prop-forwarding list stays in `App.tsx`, while the inline JSX/logic (header markup, notifications dropdown, role-switch ternary) is now isolated in `AppHeader` / `AppShell`. The decomposition is at a natural close: `App.tsx` is the central state store + prop-forwarding hub wiring `AppHeader` / `AppShell` (→ `StudentView`/`TeacherView`) / `RightSidebar` / the 7 modal components / the misc panels, each behind its own characterization test, with the 116-`tsc` baseline preserved throughout.
- **Type/lint debt**: ~116 `tsc` + ~1471 `eslint` errors carried as backlog from the `tsc` root-cause fix; not blocking.

## [0.1.16] - 2026-07-28

### Fixes
- **npm Compatibility**: Replace `workspace:*` protocol with `^3.4.3` for `@openlearn/plugin-sdk` dependency to fix `npx openlearn-next` installation failure (`EUNSUPPORTEDPROTOCOL`).

## [0.2.0] - 2026-07-28

### Fixes
- **Hidden type errors surfaced & systematic roots fixed**: `tsc` was aborting early on an invalid `tsconfig` `exclude`, masking **389 real type errors**. Fixed: added `tsconfig` `exclude` for fixtures/templates; corrected 17 wrong relative-import depths (incl. a missing `student-workspace-registry`); added the missing `@testing-library/react` dev dependency; fixed two missing name imports. Made `PluginContext.resolve<T>` infer token types across the core↔SDK boundary (public phantom on `Token`). Tightened `@openlearn/plugin-sdk` to **3.5.0**: service tokens typed concretely (was `Token<unknown>`) and service interfaces accept sync-or-async (`void | Promise<void>`). Remaining ~116 genuine per-file type errors tracked as a type-debt backlog.

### Refactor / Performance
- **Server monolith decomposition — Phase 1 (realtime bridge)**: Extract the EventBus→Socket.IO forwarding block (`server.ts` lines 652–803: `assignment.graded` toast, `handleRollcallElement` rollcall persistence, and `whiteboard.*` / `spotlight.*` sync relays) into a standalone `server/realtime-bridge.ts` module behind `setupRealtimeBridge({ eventBus, io, db })`. Behavior preserved verbatim and locked by a new characterization test (`server/__tests__/realtime-bridge.test.ts`, 7 cases). Introduces a structural `BridgeDb` port and reuses the existing `EventBusPort`, keeping the server's `kernelContainer` as the composition root. No new `tsc` errors beyond the type-debt baseline.
- **Server monolith decomposition — Phase 2 (AI agent + shared cache)**: Extract the AI chat orchestration (`buildAgentSystemInstruction`, `buildAgentFinalMessage`, `normalizeToolSchema`, `buildOpenAITools`, `executeAgentToolCall`, `buildOpenAIChatUrl`, `runGeminiAgentChat`, `runOpenAIAgentChat`) into `server/ai-agent.ts`, and the two shared module-level state Maps (`MF_REMOTE_CACHE`, `lessonActiveSegments`) into `server/shared-state.ts`. Both are consumed by `server/routes/*.ts` through `ServerContext`. Pure helpers (`buildAgentSystemInstruction`, `buildAgentFinalMessage`, `normalizeToolSchema`, `buildOpenAITools`) are covered by `server/__tests__/ai-agent.test.ts`; network-dependent handlers are skipped with a documented reason.
- **Server monolith decomposition — Phase 2 (presence / socket handlers)**: Extract the Socket.IO connection lifecycle (`io.on('connection', …)` — `register-student`, `enter-lesson`, `leave-lesson`, `join-room`, `whiteboard-update`, `whiteboard-event`, `teacher-broadcast-segment`, `teacher-ping-student`, `disconnect`, and presence broadcasting) into `server/presence.ts` behind `setupPresence({ io, eventBus })`. The shared `lessonActiveSegments` singleton is reused from `server/shared-state.ts`. Behavior (incl. the `whiteboard-event` detail that emits to the raw `lessonId`, not `lesson-<id>`) is locked by `server/__tests__/presence.test.ts` (7 cases).
- **Server monolith decomposition — Phase 2 (startup DB migrations)**: Extract the boot-time DB seed/upgrade and SEC-AUTH-03 session cleanup from `startServer()` into `server/bootstrap-db.ts` behind `runStartupMigrations(db: MigrationDb)`. Covers old default-plugin upgrade (Quiz / Random Student Picker), `CREATE TABLE IF NOT EXISTS` for `student_rollcalls` / `site_settings` / `agent_conversations`, the idempotent `client_sessions.expires_at` column add, and the expired-session cleanup. Locked by `server/__tests__/bootstrap-db.test.ts` (7 cases).
- **Composition root shrinks**: `server.ts` drops from ~1000 to ~322 lines. It now acts purely as the composition root — wiring `kernelContainer`, `ServerBootstrapAdapter`, HTTP/Socket.IO, and delegating all domain behavior to the `server/*` modules above. Each extracted slice has a verbatim-move characterization test; `tsc` remains at the 116-error type-debt baseline.

## [0.1.15] - 2026-07-27

### Features
- **Remote Plugin Update Detection**: Replace hardcoded market data with dynamic version checking via `git ls-remote` (fallback to GitHub/Gitee Releases API) and semver comparison; add `updateSource` field to plugin manifest (`@openlearn/plugin-sdk@3.4.3`); add per-plugin "检查更新" button with server-first download and client-side fallback; support pre-release version badges.
- **Dashboard Quick Access**: Make the brand logo/name area clickable to return to the dashboard; add an explicit "系统总览" / "Dashboard" nav button in the top header bar with active-state highlighting.
- **Whiteboard Toolbar Docked**: Move the interactive whiteboard drawing toolbar from a centered floating overlay into the top white area as a docked, left-aligned bar with a bottom border separator.
- **Admin Panel Monitoring Consolidation**: Move "SQLite 数据库健康体检" and "分布式操作系统硬件状况" cards from the "学校教职及系统配置" tab into the "系统监控" tab (renamed from "SQLite 数据库监控"), consolidating all system health metrics under one monitoring view; expand directory tab's staff list to full width.
- **Plugin Center ZIP Install Relocated**: Move the ZIP drag-and-drop install area from the plugin store grid into the "发现" tab header bar, placed inline to the right of the "显示系统核心插件" toggle with matching compact styling and a teal/emerald color palette.

### Fixes
- **Agent Intro Crash**: Fix `Cannot read properties of undefined (reading 'agentIntro')` crash by adding a safe fallback (`?? translations['zh']`) when the language key is unrecognized; fix `toggleLanguage` to pass the current `lang` value directly instead of a function reference causing store corruption.
- **Repository URL**: Fix incorrect repository URL in package.json from `github.com/openlearn/openlearnv2` to `github.com/aymwoo/OpenLearn-Next-V2`.

## [0.1.14] - 2026-07-26

### Features
- **Nav & Header Cleanup**: Remove obsolete "系统总览" (Dashboard) from sidebar navigation and header; set default teacher homepage tab to `courses` (Course Library); simplify language switcher to a single compact `Globe` icon button.
- **SQLite Status Badge Refactoring**: Refactor database status indicator to a compact 32x32px icon badge with dynamic status colors (🟢 Green for normal connection, 🟠 Orange for latency/warning, 🔴 Red for error/disconnect) and interactive tooltips.
- **Contextual Role Switcher**: Remove global `Teacher Mode / Student Mode` toggle buttons from top header; embed contextual `[ 👨‍🏫 教师模式 | 🎓 学生模式 ]` segmented role switchers directly inside Lesson Editor (`lesson_editor`) toolbar and Live Classroom (`live_class`) control center.
- **Integrated Cloud Resource Sub-Category**: Integrate Cloud Course Resource (`CloudDrive`) into System Resource Library modal as a sub-category tab (`[ 📚 互动课件与系统资源库 | ☁️ 云端课程资源 (Cloud Drive) ]`), removing redundant header button.

## [0.1.13] - 2026-07-26

### Features
- **In-Place Plugin Update**: Add `plugin.update_zip` command and `updatePluginFromZip` API that preserve the plugin UUID, configuration and business data on upgrade (`42f8759`); add server endpoints `POST /api/plugins/:id/update-zip-raw` and `GET /api/plugins/by-manifest/:manifestId`, plus `x-install-mode: update` on install (`c10b123`); the Plugin Install Wizard gains update mode with SemVer compare, downgrade/in-use guards and a locked target plugin (`53a8658`).

### Fixes
- **Resilient Worker Activation Timeout**: Default activation timeout raised to 60s with a sliding `activate-progress` heartbeat; tunable via `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` / `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_PROGRESS_SLIDE_MS` (`c6a9730`).
- **Plugin SDK Sync**: Make facade re-exports type-only and sync the published `dist/index.d.ts` token exports; published `@openlearn/plugin-sdk@3.4.2` (`9d0d793`).

### Docs
- **Plugin-Dev Reference**: Add authoritative DI token & Service API dictionary, capabilities/permission matrix, UI extension-slot Props, database API & migration spec, host shared-deps whitelist, and the in-place update & distribution guide (`37b1474`, `4d9ef54`).

## [0.1.12] - 2026-07-26

### Features
- **Plugin Update Detection & One-Click Hot Update**: Add online market update feed (`/api/plugins/market`), automatic SemVer comparison (`⚡ 发现新版本`), Git repository links (GitHub/Gitee) on plugin cards, release notes preview modal (`📋 新特性`), and one-click atomic hot update with state preservation & rollback (`🚀 一键热更新`).
- **Plugin Card UI Refactoring**: Redesign plugin dashboard toggle button into a standard-sized, modern iOS/Tailwind Switch toggle (`w-7 h-3.5`).
- **Plugin Namespace Migration**: Migrate third-party research workflow plugin from core namespace `@openlearn/` to third-party author namespace `@aymwoo/plugin-research-workflow`.
- **Research Workflow Plugin v1.2.0**:
  - **Class Rosters & SQLite Integration**: Wire real platform SQLite tables (`classes`, `students`, `class_students`) for real class selection.
  - **Group Management & Drag-and-Drop**: Multi-strategy auto-grouping (by size/group count) and HTML5 drag-and-drop group member movement (`⋮⋮` handle on the far left, `设为组长` button on the far right).
  - **Role View Isolation & Material Restrictions**: Separate Teacher Control Console and Student Submission Board; configurable allowed file extensions (`.pdf`, `.docx`, `.zip`, `.mp4`, `.xlsx`) and file size limits.
  - **Light Theme Alignment**: Refactor plugin UI to OpenLearn Next Light Theme palette (`slate-50`, `#ffffff` cards, `#2563eb` accents).

### Fixes
- **Worker Timeout Fix**: Optimize plugin `activate(ctx)` function to be non-blocking (< 10ms) with async 500ms race timeout, completely resolving `[WorkerRuntime] Worker operation timed out after 10000ms` during plugin installation/activation.
- **Workflow State Machine Guards**: Fix same-phase click transition error (`无法直接从 DRAFT 切换至 DRAFT`) and support teacher manual phase override flag.

## [0.1.11] - 2026-07-25

### Features
- **Plugin system (P7-A2)**: complete the unified plugin runtime refactor — wire real
  capabilities into `PluginCapabilityGateway`, integrate plugin lifecycle via unified
  facades, surface unified plugin facades (`IPluginLifecycleManager`,
  `IPluginDistributionManager`, `IUnifiedExtensionRegistry`, …) into
  `PlatformServiceRegistry`, and expose them through `@openlearn/plugin-sdk`. (#e435bba, #475e9e1, #163b1fe, #6b8153e, #1b13eba)
- **User menu & profile**: collapse the top-right username / secure-logout area into a
  circular avatar button with a dropdown (Profile / Logout); profile modal supports
  editing the display name; password-change flow added (teacher + student). (#f818550, #86e7e25, #4fd9e91)
- **Class list summary**: class management list now shows per-class summary chips —
  student count, course count (schedules), assignment count — without expanding the row. (#4451d5b)
- **Dashboard Activity Center**: live in-progress status, pause/resume and
  enter-classroom controls, light theme. (#bfecccc, #e1d9ecb)
- **Class roster**: add list view mode and grid layout. (#05ea25e)
- **Navigation**: optimize platform navigation with grouped categories, badge support,
  and a registry adapter. (#2242613)
- **Routing**: reflect the active page in the browser address bar via hash routing. (#506f617)
- **Docs**: official documentation architecture upgrade to a 25-folder taxonomy; refactor
  the plugin-development AI Skill guide to the latest V2 architecture. (#7e62138, #cd31c3a)

### Fixes
- **Dashboard Activity Center**: resolve perpetual loading of the widget. (#cca16b9)
- **plugin-sdk build**: externalize npm dependencies in the SDK bundle so it no longer
  throws `Dynamic require of "path"` at runtime. (#b50392e)

### Chores / Docs
- Purge non-system plugin artifacts and clean up the plugin build manifest
  (remove quiz-pro and other purged plugin entries). (#1b71c21, #690c704, #1ff7f59)
- Bump `@openlearn/plugin-sdk` references to **3.4.1** and document the P7-A2 unified
  plugin services; publish `@openlearn/plugin-sdk@3.4.0`. (#5070506, #7d04c73)
- Add platform foundation audit report, navigation (PF-02) audit report, and a
  documentation quality review report. (#2e9b494, #c4ee1c8, #c272d6f)
- Purge obsolete historical sprint reports / RFC drafts and synchronize docs with the
  implementation. (#1b5662c, #543bd17)
- Add Plugin System Refactor Proposal (P7-A2). (#c53bd3d)

## [0.1.10] - 2025

Baseline release. System-wide version numbers harmonized to 0.1.10 and
`@openlearn/plugin-sdk` to 3.3.1. (#4d1069a)
