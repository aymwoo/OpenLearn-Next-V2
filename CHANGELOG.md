# Changelog

All notable changes to **OpenLearn V2** (platform package `openlearn-next`) are documented here.

> Versioning note: the platform `openlearn-next` is versioned independently of
> `@openlearn/plugin-sdk` (currently **3.6.1**) and `@openlearn/plugin-test-kit`.
> Bumping the platform does not change the SDK / test-kit versions.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Features

- **互动课堂与课程编辑器全局架构优化及第三方插件生态体系 (Interactive Classroom & Lesson Editor Optimization with Plugin Ecosystem)**:
  - **四阶课堂生命周期状态机与中控台 (Classroom Stage State Machine & Cockpit)**:
    - `server/services/classroom-runtime-service.ts`：实现高可用课堂生命周期状态机，定义 `PRE_CLASS_READY`（课前就绪）、`IN_CLASS_TEACHING`（课中授课）、`WRAP_UP_EXIT_TICKET`（结课通票）、`ARCHIVED_REPORT`（学情归档简报）四阶流转；
    - 支持前置守卫钩子（`StageGuardHook`）与流转监听拦截，允许第三方插件在切阶前进行条件阻断或后续联动（如课件同步、随堂测触发）；
    - `src/features/classroom/ClassroomInteractiveCockpit.tsx`：为教师端中控台提供一键阶梯式教学流转控制栏、节奏晴雨表、极速点名/投票/抢答快捷交互与大屏展台唤起。
  - **大屏教学展台 (Projector Stage Display View)**:
    - `src/features/classroom/StageDisplayModal.tsx`：为多媒体教室与大屏投影场景打造暗色高对比度专属展台，集成当前教学环节、大屏高精度时钟、动态投屏签到码、极速抢答夺魁光效看板、极速投票柱状图与实时节奏晴雨表。
  - **学生端极简实时响应与极速互动 (Student Interactive Overlay & Real-time SRS)**:
    - `src/features/student/StudentInteractiveOverlay.tsx`：为学生端（含独立 Tab/弹窗联动模式）打造非侵入式悬浮互动条，支持「听懂了 💡 / 有疑问 ❓ / 讲太快 🐇」瞬时步调反馈、毫秒级一键抢答按钮、极速单选答题卡及 60 秒下课通票打卡。
  - **全链路第三方插件可扩展能力架构 (Third-Party Plugin Extensibility Ecosystem)**:
    - 扩展槽位 `classroom.quick_activity`：允许第三方插件以极简声明式组件向教师端中控台注册自定义即时互动卡片/操作；
    - 扩展槽位 `stage.display.card`：允许第三方插件向多媒体大屏展台投送专属展示看板与数据可视化图元；
    - 课程编辑器步骤扩展：`src/features/teacher/lesson-editor/timelineConfig.ts` 引入 `registerCustomSegmentType` 与 `customSegmentTypes` 动态注册表，支持第三方插件扩展自定义教学环节（如分组研讨、科学探究实验、随堂辩论）；
    - 插件 SDK 与依赖注入：`packages/core/di/interfaces.ts` 与 `@openlearn/plugin-sdk` 暴露 `IInteractionRuntimeServiceToken`，允许插件调用服务端统一状态广播、抢答判定与活动生命周期。
  - **原子并发安全抢答与随堂测原子 Upsert (Atomic Concurrency Protection)**:
    - 抢答状态机采用 `UPDATE classroom_buzzers SET ... WHERE status = 'READY'` 原子 CAS 语句，杜绝并发网络包下的并列第一争议；
    - 修复随堂测关系型提交漏洞，`server/routes/lessons.ts` 的 `/api/lessons/:id/quiz-submit` 在原有 JSON 写入之外新增 `lesson_quiz_submissions` 关系行级 upsert（`ON CONFLICT(lesson_id, element_id, student_id) DO UPDATE`），避免多学生同时交卷时 read-modify-write 覆盖同伴作答；唯一键含 `lesson_id`，同一元素在多个课节复用时也不会跨课节互相覆盖。

- **学生端异常教师端实时感知、系统日志审计与端侧极简角标 (Student Exception Telemetry & Low-Visibility Diagnostics)**:
  - **端侧异常上报与系统审计日志持久化**：
    - `src/hooks/useGlobalErrorCapture.ts` 与 `src/store/errorStore.ts`：新增错误订阅机制 `registerErrorListener`。当学生端（处于 `role === 'student'` 或 `student_live` 模式）捕获到 React 崩溃、Promise 异常、JS 运行时错误或 5xx 接口故障时，自动提取学生学号/ID、学生姓名、课节及班级上下文，通过 Socket.IO 发送 `student-client-error`（并提供 `/api/diagnostics/report` 作为断网或重连期间的 HTTP Fallback）；
    - `server/presence.ts` 与 `packages/core/kernel/index.ts`：服务端接收后向控制台输出警告日志，并通过内核 `eventBus.publish({ type: 'student.client_error' })` 自动将完整错误载荷持久化记录至 SQLite `events` 审计日志表（可供 `/api/events` 追溯查询）；
  - **教师端实时多维感知**：
    - `src/hooks/useClassroomSocket.ts`：监听 `student-error-alert` 事件，在教师/管理员端触发黄色 Toast 警示气泡并记录入 `errorStore.studentErrors`；
    - `src/components/LiveClassroomView.tsx`：在在线互动课堂顶部状态栏展示「学生端异常 (N)」快速入口，并在学生头像圆环卡片与学生详情列表中对发生异常的学生渲染红色脉冲感叹号角标，支持一键点击直达该学生的排查日志；
    - `src/features/modals/SystemErrorCenterModal.tsx`：为教师端引入「本机异常」与「学生端异常」双标签页切换，支持查看学生详细报错堆栈并一键导出 Markdown 诊断报告；
  - **学生端低可见度与低干扰改造**：
    - 降低学生端异常浮窗的视觉侵入性，将以往大尺寸的文本气泡替换为**屏幕左下角极简感叹号圆形图标加红色数字角标**，保留点击查看排查报告能力的同时最大限度降低课堂上对学生专注度的干扰。

- **通用「结算页自动上报」（不主动提交的课件也能拿分）**：部分互动课件答完题后直接切到结算/结果页（如「闯关结束·…」），既不调用 `LMS.submit`，也没有匹配「提交/完成」关键词的按钮，导致旧的“按钮点击 → 抓分”逻辑无法触发。现于 `server/utils/bridge-sdk.ts` 的 `initAutoSubmit` 中新增独立的 `ResultWatcher`：
  - 用 `MutationObserver`（debounce 600ms）监听可见文案，命中强结束信号（`闯关/挑战/答题/测试/游戏/本轮/本关` + `结束/完成/成功`、`通关`、`结算`、`查看解析`、`正确率`、`最终得分`、`总得分` 等）才启动；
  - 抓分口径优先「正确题数 `X/Y` → 百分制」（如 `#correctCount = 12/15 → 80`），否则回落**可见**的分数元素；
  - 仅从可见元素取值（`getBoundingClientRect` + 祖先 `computedStyle` 判定），避开结算页未展开时隐藏的初始值 `0`；
  - 展开后短轮询（`0/120/250/400/700/1100ms`）取最后一次有效分数，**每次作答只上报一次**（`__lmsResultSubmitted` 幂等门）。
  - 验证：用 jsdom 还原该课件的结算页，答题中命中 `第 3 / 15 关` **不**触发；调用 `showResult()`（`#correctCount=12/15`）后仅上报一次 `{score:80,completion:1}`。

- **高频轮询引发的终端指令日志刷屏治理 (CommandBus Logging Noise & Polling Debounce Fix)**:
  - **问题背景**：用户处于互动课堂或白板模式时，终端持续高频输出 `[CommandBus] Executing: courseware.list (ID: 01a0becb-...) by user:usr_admin:administrator`，且因 UUIDv7 携带毫秒时间戳而导致命令 ID 不停递增变化，造成严重的终端日志刷屏。
  - **后端 CommandBus 读写分离静默与元数据扩展**：
    - `packages/core/command-bus/index.ts`: 在 `CommandMetadata` 接口中扩展 `silent?: boolean` 选项；新增默认只读静默指令集合 `DEFAULT_QUIET_COMMANDS`（包含 `courseware.list`, `courseware.get_attempt_raw_data`, `whiteboard.query`, `whiteboard.get_element`, `vfs.read_path`, `vfs.list_dir` 等高频查询）；
    - 仅在非静默指令或设置了 `DEBUG_COMMAND_BUS=true`/`DEBUG=*commandbus*` 时才输出 `[CommandBus] Executing...` 控制台日志，错误日志（`console.error`）与业务数据变更类（Mutation）指令不受影响；
    - `server/routes/courseware.ts`: 在 `GET /api/courseware` 路由中，创建 `courseware.list` 指令时标记 `{ silent: true }`。
  - **前端白板课件拉取防抖与模块级客户端缓存**：
    - `src/features/whiteboard/InteractiveWhiteboard.tsx`: 建立模块级单例缓存 `globalCoursewareCache`（30 秒 TTL + in-flight 请求 Promise 复用去重），避免组件重渲染或重新挂载时频繁发送 `/api/courseware` 请求；在上传新课件时仍可通过 `{ force: true }` 即刻穿透刷新缓存；
    - 精确选中追踪：引入 `lastSelectedCoursewareElementRef`，避免白板 `elements` 数组因心跳轮询更新而持续触发 `fetchCoursewares()`，仅在用户切换选中目标为 `html-applet` 图元时才触发选项拉取。
  - **根组件轮询状态防抖优化**：
    - `src/App.tsx`: 在 `fetchElements` 中引入 `lastElementsJsonRef` 内容浅对比，当课节白板图元数据未发生实质变更时不再调用 `setElements`，消除 2 秒一次轮询引起的全树无谓重渲染。
  - **验证**：核心单元测试与 E2E 流程（`command-routing.test.ts`、`courseware-e2e-flow.test.ts` 以及白板 75 项交互测试）全部通过；终端日志刷屏彻底消除。
- **桥接抓分正则过度转义（数字/分数从未能解析）**：`bridge-sdk.ts` 内嵌于模板字符串中的正则误写成 `\\d` / `\\s`，生成到课件的实际 JS 里是 `\\d`（匹配字面反斜杠 + `d`），导致 `findScoreInDOM` 的分数/分数值解析（`12/15` 等）全部失效。已修正为 `\\d`/`\\s`（即输出 JS 的 `\d`/`\s`），并新增正则自检。
- **AI Provider 密钥解密分叉（插件 AI 调用 401）**：`packages/core/di/ai-service.ts` 曾自带一份 `decryptKeyIfNeeded`，只读 `process.env.ENCRYPTION_KEY`，且在密钥缺失/为空时**静默返回密文**；而「AI Provider 测试」与各业务路由走 `server/utils/crypto.ts`（含 `.env` 回退）。二者实现分叉导致典型故障：**测试按钮通过，但插件 `ctx.services.ai.generateText()` 把密文当作 Bearer 发出，上游返回 `401 login fail: Please carry the API secret key`**。生产 `ecosystem.config.cjs` 将 `ENCRYPTION_KEY` 显式置为 `''`，而 `dotenv` 不会覆盖已存在的空值变量，因此该问题在 PM2 部署下必现。
  - 新增 `packages/core/di/api-key-crypto.ts` 作为唯一事实来源（`getEncryptionKey` / `encryptApiKey` / `decryptApiKey` / `looksLikeCiphertext`），密钥解析顺序：`process.env` → `.env` 文件 → 自动生成并持久化（仍不覆盖已有行）；
  - `server/utils/crypto.ts` 改为从该模块转发导出（保持既有导入路径与可用 API 不变），杜绝再次分叉；
  - `AIService.generateText` 改用共享 `decryptApiKey`，并在解密结果仍是密文时抛出可操作的错误（提示 ENCRYPTION_KEY 不一致 / 需重新保存 API Key），不再向上游发送密文换取难以定位的 401。
  - 验证：`packages/core/di/__tests__/ai-service.test.ts` 通过；`tsc --noEmit` 0 错误；在“正常 / `ENCRYPTION_KEY=''`（PM2 场景）/ 密钥被轮换”三种场景下探测 AIService，分别为成功、成功（回退 `.env`）、抛出明确解密错误。

### Features

- **课件成绩「按策略留分」归集原生化 (Native Courseware Score Policy Aggregation)**：此前「按 `LATEST` / `MAX` / `AVERAGE` / `FIRST` 策略从多次提交里算最终分」只存在于第三方插件 `interactive-courseware` 的私有表里，宿主记录的 `submission_result.score` 恒等于**最后一次**上报值 —— 学生反复作答时「最高分」策略形同虚设，且停用该插件后这层能力一并消失。现在配置与聚合都由平台自己完成：
  - **迁移 `migrations/004_courseware_score_config.sql`** 新增 `courseware_score_config` 表：`courseware_id`（主键）、`courseware_name`、`raw_full_score`（课件自身满分，默认 100）、`target_full_score`（课程目标满分，默认 100）、`weight_percentage`（权重%，默认 100）、`score_policy`（默认 `LATEST`）、`score_fields`（从提交载荷取分的字段路径，逗号/分号分隔，留空自动探测）、`lesson_id`、`updated_at`；并对 `lesson_id` 建索引；`migrations/README.md` 的迁移清单同步登记；
  - **新增纯函数模块 `packages/plugins/courseware-score.ts`**：`getNested`（点号路径）/ `toNumber`（兼容尾随 `%`）/ `parseScoreFields` / `extractScoreFromFields` / `collectScoreSamples` / `aggregateScores` / `clamp` / `round2` —— 无副作用、无 IO，供命令处理器与 HTTP 路由共用，杜绝两处口径漂移；
  - **`courseware.submit_attempt` 按策略聚合**：原始载荷先追加进 `submission_raw`（保持 append-only 流水），随后按该课件配置从**全部样本历史**取分、按策略聚合、按 `raw_full_score → target_full_score` 归一化后写入 `submission_result`；未配置的课件走内置默认（`LATEST`、不折算），行为与改动前完全一致。`POST /api/courseware/attempts/:attemptId/log` 同源同口径接入（该路径的分数抽取口径与 `/submit` 不同，必须复用同一聚合函数才不会算出两个分数）；
  - **新增四个原生命令**：`courseware.get_score_config`（`lesson:read`，回传 `source: 'courseware' | 'global' | 'builtin'` 标示配置来源）、`courseware.save_score_config`（`lesson:write`，保存后广播 `courseware.score_config_saved`）、`courseware.list_score_configs`（`lesson:read`）、`courseware.regrade_attempts`（`lesson:write`，按 attemptId 或 coursewareId 重算历史成绩，改策略后无需学生重做）；
  - **权限口径**：这四个命令刻意声明 `lesson:read` / `lesson:write` 而非 `courseware:read` / `courseware:write` —— 后者不在任何角色兜底能力集内（教师兜底为 `lesson:*` / `whiteboard:*` / `management:*` / `quiz:*` / `vfs:*` / `process:*` / `plugin:*`），用 `courseware:*` 会把教师挡在门外；跨插件调用时需透传调用者原始 `actorId`（`commandBus.createCommand(type, payload, command.actorId)`）以延续其角色身份。
  - 验证：新增 `packages/plugins/__tests__/courseware-score.test.ts`（16 例：字段抽取、样本收集、四种策略、归一化与权重、边界钳制）全部通过；`server/__tests__/courseware-e2e-flow.test.ts` 与 `courseware-attempts-filter.test.ts` 回归 8 例全绿；宿主 `tsc --noEmit` 在本轮改动文件上 0 错误。
- **分数变量监视器原生化 (Native Score Variable Monitor)**：监视器此前由第三方插件经上一版新增的「课件运行时脚本扩展点」注册 —— 方向正确，但**插件停用即失去采集能力**，且白板 `srcDoc` 路径（客户端注入 `/bridge.js`，不经服务端 `injectLmsSdk`）根本拿不到运行时脚本。现在由平台自有：
  - **新增 `packages/plugins/score-monitor-script.ts`**（与 `courseware-score.ts` 同层，避免 `packages → server` 反向依赖）：与插件版行为等价的零依赖脚本，三层采集（`window.__LMS_WATCH__` 显式声明 → window 上名字匹配 `score|point|grade|mark|correct|right` 的有限数值属性自动发现 → 14 个分数类元素的**可见**文本兜底，键名形如 `dom__score`，比例文本 `a/b` 归一化到百分制，同元素按选择器去重）；变量变化后静默 1200ms 以 `LMS.saveProgress({ score, watch })` 上报一次样本（无 `window.LMS` 时回退 `parent.postMessage`），单会话上限 60 次，`window.__LMS_WATCH__ === false` 或 `window.__LMS_WATCH_DISABLED__ === true` 可关闭；`init()` 会把 `{ stop() }` 登记进 `window.__LMS_SCORE_WATCHERS__`，便于运行期排障与测试回收；
  - **由内置插件注册**：`packages/plugins/builtin.ts` 的 `activate()` 以 owner `@openlearn/plugin-builtin`、`id score-variable-monitor`、`position body-end`、`priority 200` 注册进扩展点，`deactivate()` 时 `clear(owner)`；注册失败仅告警，不影响内核启动；
  - **覆盖白板 `srcDoc` 路径**：`GET /bridge.js` 支持 `?cw=<coursewareId|lessonId>&name=<名称>`，把命中该课件的运行时脚本追加在 Bridge SDK 之后返回（`collectCoursewareRuntimeScripts` 相应改为导出）；`src/features/whiteboard/utils/bridgeUtils.ts` 的 `wrapSrcDocWithBridge()` 改为注入 `/bridge.js?cw=<lessonId>`，使白板里手写的 HTML 课件同样获得抓分与采样能力；
  - **脚本字面量安全**：全段不含任何反斜杠转义序列（用 `[0-9]` 代替 `\d` 并改用 `+` 拼接而非模板字符串）、不含 `</script` —— 这两条正是历史上「正则双重转义导致抓分全部失效」与「模板字符串被 `</script>` 截断」两个事故的根因，现以断言测试长期守护；
  - **插件 v1.0.31 相应瘦身**：`interactive-courseware` 删除 `src/score-monitor-script.ts` 与注册/撤销代码（避免双份监视器对同一批变量重复上报样本），并把成绩配置读写改为「平台原生优先」—— `grade.set_config` 写透到 `courseware.save_score_config`、`grade.get_config` 优先读 `courseware.get_score_config` 并回写本地镜像表，保证插件面板与官方成绩口径一致。
  - 验证：新增 `packages/plugins/__tests__/score-monitor-script.test.ts`（jsdom，10 例：字面量安全 / 空闲零上报 / 变量变化一次上报 / 显式声明路径 / DOM 兜底 / 比例文本 / 两处开关 / 无 attempt 不上报 / 无 `window.LMS` 时回退 `postMessage`），并扩展 `builtin.test.ts` 断言 activate 后注册表内存在原生监视器；插件侧 `tsc --noEmit` 0 错误，ZIP 通过平台 `validateAndBundleZip` 校验。
- **课件运行时脚本扩展点（Courseware Runtime Script Extension Point）**：互动课件跑在 `<iframe credentialless sandbox="allow-scripts allow-forms allow-downloads">`（**无** `allow-same-origin`）里，是不透明源（opaque origin）——父窗口读不到它内部的任何状态，服务端拼接 HTML 是平台唯一能向课件投递代码的位置。此前该位置只硬编码了 Bridge SDK，现把这条通道抽象为**可被插件注册的公开扩展点**，宿主不再替业务决定「课件里该跑什么」：
  - **新增内核服务**：`packages/core/di/courseware-runtime-script-registry.ts` 的 `CoursewareRuntimeScriptRegistry`，接口与 Token（`CoursewareRuntimeScript` / `IRegisteredCoursewareRuntimeScript` / `ICoursewareRuntimeScriptRegistry` / `ICoursewareRuntimeScriptRegistryToken`，Token 名 `@openlearn/core:ICoursewareRuntimeScriptRegistry`）定义在 `packages/core/di/interfaces.ts`，并在内核 `constructor()` 中随其他 `IService` 一起注册；`packages/core/di/index.ts` 与 `@openlearn/plugin-sdk` 均已导出；
  - **注册语义**：`register(owner, { id, source, position?, priority?, coursewareId?, coursewareUuid? })` —— `id` 在 owner 内唯一，同一 `owner::id` 重复注册即覆盖（便于热更新）；不指定 `coursewareId`/`coursewareUuid` 则对所有课件生效，指定则精确匹配；`position` 取 `'head'`（紧跟 Bridge SDK）或 `'body-end'`（默认，`</body>` 前）；同位置按 `priority` 升序、插入序次之拼接，顺序确定。配套 `unregister(owner, id)` / `clear(owner?)` / `list(courseware?)` / `listOwners()`；
  - **注入实现**：`server/routes/shared.ts` 的 `injectLmsSdk()` 新增 `collectCoursewareRuntimeScripts(cwInfo)`，把 head 脚本拼在 Bridge SDK 之后、body-end 脚本插在 `</body>` 之前（无 `</body>` 则追加到末尾），每段脚本前带 `<!-- Courseware Runtime Script (owner/id) -->` 注释便于排查；**服务未注册、`list()` 抛错或没有任何脚本时全部静默降级**，既有课件渲染路径零影响；
  - **插件接入方式**：可直接从 `@openlearn/plugin-sdk` 导入该 Token，也可用 `ctx.resolve(new Token('@openlearn/core:ICoursewareRuntimeScriptRegistry'))` 按名字解析 —— 后者不依赖 SDK 构建产物是否已包含新 Token，部署顺序更安全；
  - **首个使用方**：「分数变量监视器」已从 `server/utils/bridge-sdk.ts` 的模板字符串中**整体迁出**，改由 `interactive-courseware` 插件 v1.0.29 通过本扩展点注册（`src/score-monitor-script.ts`，`position: 'body-end'`、`priority: 200`，`activate()` 注册、`deactivate()` 撤销）。监视器行为不变：三层采集（`window.__LMS_WATCH__` 显式声明 / window 上名字匹配 `score|point|grade|mark|correct|right` 的有限数值属性自动发现 / 分数类元素**可见**文本兜底，键名形如 `dom__score`，故完全不调用 `LMS.*`、只把分数写进 `#score` 的静态课件也能采到分）、变化后静默 `1200ms` 以 `LMS.saveProgress({ score, watch })` 上报一次样本、单会话上限 60 次、同一元素按选择器去重（避免 `#score` 与 `[id*="score" i]` 重复登记）；采样仍走 `status='inprogress'`，**不会**提前把 attempt 置为已完成，快照落到 `submission_result.extra_json.watch` 与 `submission_raw.payload_json.watch`，成为插件按 `score_policy`（MAX / AVERAGE / LATEST）聚合的样本历史。
  - 验证：宿主 `tsc --noEmit` 对相关文件 0 错误；插件 `tsc --noEmit` 0 错误；jsdom 冒烟测试（先真实执行 `BRIDGE_SDK_CODE`，再执行扩展点注入的监视器脚本）——两段脚本 `doubleBackslashSeqs=0`，空闲 1.5s 零上报，`window.userScore=55` 触发 1 次采样（`score=55`），`#score` 文本改为 `82` 再触发 1 次（`score=82`、`watch.dom__score=82`，且无重复 DOM 键）。
- **课程编辑器「作业上传」真正落地（作业中心 / Assignment Hub，P0 地基）**：白板教学对象里的「课堂作业任务」此前只有一个按钮加 `alert('系统已经成功模拟拉起本地文件选择和上传流程！…')`，零后端调用；同时学生经命令总线提交作业会恒被 `[CapabilityGuard] Access Denied` 拒绝（`assignment.submit` 要求 `lesson:write`，而学生兜底能力不含它）。
  - **数据模型收敛**：新增迁移 `migrations/005_assignment_hub.sql`（并同步写入 `packages/core/db/index.ts` 的 schema 块，保证全新库与既有库结构一致）：新建 `plugin_assignments`（作业实体，**同时挂 `lesson_id` 与 `class_id`**，白板对象只是投影片段）、`plugin_submission_versions`（每次提交一个不可变版本，支持多文件 + 文本 + 链接）、`plugin_assignment_files`（上传文件归属与归档状态）、`plugin_peer_review_tasks`（互评任务分配）；重建 `plugin_submissions` 以去掉 `UNIQUE(lesson_id, student_id)`（旧表一课时只能存一条、重交直接覆盖丢档），并为旧形态记录保留 `WHERE assignment_id IS NULL` 的部分唯一索引；`plugin_peer_reviews` / `plugin_grades` 补 `assignment_id` / `task_id` / `anonymous` / `peer_average_score` / `source` / `published_at` / `graded_by` 等列。已在真实开发库副本上验证：迁移后旧数据（`plugin_peer_reviews` 20 行、`plugin_grades` 10 行、人造旧提交记录）零丢失，重复执行幂等。
  - **权限修正（P0 阻塞缺陷）**：`packages/core/capability-system/index.ts` 的角色兜底新增 `assignment:read` / `assignment:submit` / `assignment:review`（学生与教师）与 `assignment:manage`（教师）；`packages/plugins/assignment-eval.ts` 的四个动作分别改用这四个能力（原为 `lesson:write` / `lesson:read`，学生因此完全无法提交作业）。学生**仍然没有** `lesson:write` —— 写权限收窄为命令处理器内部的所属权校验（`parseActorId` 比对 `studentId`，教师/管理员不受限），HTTP 层亦对普通学生强制覆盖 `studentId`。
  - **命令总线契约（`packages/plugins/assignment-eval.ts` 重写）**：新增 `assignment.create` / `assignment.list` / `assignment.get` / `assignment.assign_peer_reviews`；`assignment.submit` 支持 `assignmentId` + `fileIds`/`textContent`/`linkUrl`（保留仅 `lessonId` 的旧式调用，自动查找/创建该课时默认作业），重交递增 `version` 并写不可变版本行，迟交按 `due_at`/`allow_late` 拦截；`assignment.grade` 确认后除 `saveSemesterGrade` 外，当作业只挂班级时自行投影到宿主 `assignments` / `assignment_submissions`；提交与评分分别发布 `assignment.submitted` / `assignment.graded` 事件。
  - **HTTP 端点（新增 `server/routes/assignment-hub.ts`）**：`POST /api/assignments`（教师建/改）、`GET /api/assignments`、`GET /api/assignments/:id`、`POST /api/assignments/:id/files`（**原始二进制体**上传，避免 multipart/base64 膨胀；扩展名白名单 + `BLOCKED_EXTENSIONS` + magic bytes + `.zip/.docx/.pptx` 容器头校验 + 单文件大小/文件数上限；教师可代学生上传，普通学生一律写到自己名下）、`GET /api/assignments/:id/files`、`GET /api/assignments/:id/files/:fileId`（越权与不存在一律 403，`path.resolve` 限制在 `storage/assignments` 内，`res.download` + `nosniff`）、`DELETE /api/assignments/:id/files/:fileId`（已随提交归档 → 409）、`POST /api/assignments/:id/submit`、`POST /api/assignments/:id/assign-peer-reviews`。
  - **插件双激活缺陷修复（既有线上问题）**：`PluginHost.restoreActivePlugins()` 与 `Kernel.bootstrapSystemPlugins()` 会在同一内核内把 `@openlearn/plugin-assignment-eval` 激活两次，第二次激活先 `unregisterHandler('assignment.submit')`、再在 `assignment.create` 上撞「已注册」抛错中止，导致**作业插件在生产启动后同样没有注册任何命令**（`No handler registered for command: assignment.submit`）。现于 `activate` 开头按 `OWNED_COMMAND_TYPES` / `OWNED_ACTION_IDS` 做幂等撤销，重复激活安全。
  - **测试与文档**：新增 `packages/plugins/__tests__/assignment-hub.test.ts`（8 例）与 `server/__tests__/assignment-hub-routes.test.ts`（7 例，走真实 `client_sessions` Cookie 会话，证明学生提交不再被拒且无法冒充他人）；`packages/core/di/__tests__/semester-grade.test.ts` 改用规范 `user:<id>:<role>` actorId 并删除手工 `capabilityGuard.grant()`（正是这些手工授权长期掩盖了学生缺少 `assignment:*` 能力的问题）；`docs/reference/plugin-capability-matrix.md` 的 `assignment:*` 段与 `docs/tutorials/plugin-development-tutorial.md` 的权限字符串示例同步更新。
- **课程编辑器「作业上传」学生端闭环（作业中心 P1）**：白板上的「课堂作业任务」不再是只弹提示的说明卡，而是真正驱动一套提交闭环。
  - `src/features/whiteboard/components/AssignmentSubmitDialog.tsx`（新增）：真实文件选择器（本地多选 / 拖拽 / 串行上传 / 实时进度 / 失败重试）、文字作答与作品链接、版本历史与成绩展示；上传中的请求在关闭弹窗时会全部 abort。
  - `src/features/whiteboard/components/AssignmentBindingField.tsx`（新增）：教师端在编辑面板中选择 / 新建 / 解除绑定作业实体，并写回白板元素 payload 的 `assignmentId`（新建后学生立即可见）。
  - `src/features/whiteboard/InteractiveWhiteboard.tsx`：学生按钮在已绑定时直接打开提交弹窗，未绑定时按课时兜底查找已发布作业，找不到则给出明确提示；教师编辑面板接入绑定控件。
  - `server/__tests__/assignment-hub-routes.test.ts`：新增 3 个读路径用例（弹窗数据源与重交版本递增、按课时列表的学生/教师差异、教师新建后可直接绑定），并抽出 `resetAssignmentState`/`uploadTracked`/`submitWork` 让用例彼此独立。
  - `src/features/whiteboard/__tests__/assignment-hub-ui.test.tsx`（新增）：4 个组件用例覆盖绑定 / 解除绑定 / 新建就地面板提示、上传队列与版本历史渲染、提交体去重、失败时保留作答。
  - 修掉自测发现的三处问题：`AssignmentBindingField` 在白板没有 toast 宿主时提示会静默丢失（改为面板内就地提示）；上传完成的附件同时出现在「待提交附件」与「上传队列」导致同一 `fileId` 被写进版本两次（按 id 去重）；`通知/删除/重试` 的边界文案与校验补齐。
- **课程编辑器「作业上传」P2 互评闭环（分配 / 双盲 / 量规 / 截止 / 异常标记）**
  - 服务端（`packages/plugins/assignment-eval.ts`）：`assignment.get` 新增 `peerReviewTasks`（双盲，只给被评作品内容与版本，不含作者身份）与教师专属 `peerProgress`（提交 / 任务 / 待完成统计、互评人清单、异常标记 `peer_review_pending` / `all_full_marks` / `score_gap`）；`assignment.assign_peer_reviews` 支持 `dueAt` 并回写 `plugin_assignments.peer_review_due_at`；`assignment.peer_review` 收紧为「只认互评任务持有人」并在截止后拒绝（此前仅在已提交过互评时拦截）。
  - 路由（`server/routes/assignment-hub.ts`）：新增 `POST /api/assignments/:assignmentId/peer-review`，`reviewerId` 一律由会话决定，请求体无法冒充他人；附件下载对互评人放行（仅限被分配到的提交）。
  - 前端：新增 `AssignmentPeerReviewPanel`（学生端：匿名同学 A/B、作品预览与附件下载、四维四档量规、手输总分、截止后锁定、作者更新后的复核提示），并在提交弹窗里与「我的提交」并列成标签页；新增 `AssignmentPeerProgressPanel`（教师端：分配按钮 + 每份份数 / 截止时间 + 进度 + 异常标记 + 互评人清单），挂在白板教师编辑面板。
  - 测试：插件层 3 例（分配式互评 / 双盲与教师进度 / 截止与反复改分）、路由层 3 例（互评端点防冒充、互评人附件下载、教师进度可见性）、组件层 5 例（量规提交、截止锁定、越界拒绝、分配与提示）。
- **互动课件成绩榜对学生可见（白板课件元素）**：学生点开白板课件元素右上角「查看成绩」即可看到全班分数榜（名次 / 姓名 / 分数 / 完成度 / 均分），自己那一行高亮并显示「我的成绩 N · 全班第 X/Y 名」；访客（guest）与教师预览的占位 attempt 不计入榜单，名次同分并列（88/88/70 → 1/1/3），榜单顺序学生与教师一致。
  - `src/features/whiteboard/components/HtmlAppletFrame.tsx`：新增 `computeAttemptRanks` / `sortAttemptsByRank` 与 `PLACEHOLDER_STUDENT_IDS`，浮层按钮与面板统一改用 `orderedAttempts`（同源计数，避免「徽标 N 条 / 列表 M 条」口径不一致），并从 `useAppStore` 读取当前会话以识别「我」。
  - 回归：`src/features/whiteboard/__tests__/html-applet-scores.test.tsx` 由 5 例扩到 10 例（学生名次与「（我）」标记、未提交提示、教师视角无「我的成绩」、占位行过滤、名次算法单测）。

### Fixes

- **互动课件学生提交归属丢失（学生提交后教师端「学生互动提交数据」为空）**：学生在互动课堂提交网页课件后，真实学生成绩完全不入库，`submission_result` 长期为空，而 `courseware_attempt` 里堆积的全是 `student_id='guest'` / `'teacher'` 的预览记录。根因是三处独立缺陷叠加：
  - **iframe 不携带会话导致归属丢失**：`src/features/whiteboard/components/HtmlAppletFrame.tsx` 的课件 iframe 使用 `credentialless` + `sandbox`（无 `allow-same-origin`），访问 `/runtime/:uuid/` 时不带 cookie，服务端 `injectLmsSdk` 只能建出一条 `student_id='guest'` 的 attempt，且**同一课件的所有匿名访问者复用同一条**；真实学生提交时又因 `attempt.student_id('guest') !== session.userId` 被 `403 Forbidden` 拒绝。现由持有会话的父窗口在转发上报前调用新增接口 `POST /api/courseware/attempts/:attemptId/adopt` 认领归属：无主 attempt 直接改归属（保留已产生的原始流水），已被其他学生占用则为本学生复用/新建自己的 attempt 并返回新 id；接口幂等，教师/管理员预览不受约束。
  - **提交失败被静默吞掉**：`src/services/lms-bridge.ts` 的三处上报（submit / saveProgress / log）均不检查 `res.ok`，401/403 只在控制台留下无痕错误，学生端看起来「提交成功」。现已对非 2xx 响应输出带响应正文的 `console.error`。
  - **终态状态值不一致导致「已完成」永不生效**：`lms-bridge.ts` 提交时传 `status: 'submitted'`，而 `packages/plugins/builtin.ts` 的 `courseware.submit_attempt` 处理器只在 `status === 'completed'` 时更新 `courseware_attempt.finished_at/status`，导致 attempt 永远停在「进行中」，`HtmlAppletFrame` 的 `submittedAttempts` 覆盖层与提交列表的「已提交/完成」筛选全部失效。现统一提交终态为 `'completed'`。
- **互动课堂提交列表徽标与列表口径不一致（徽标显示 8 条记录、列表却为空）**：`src/components/LiveClassroomView.tsx` 的徽标使用未过滤的 `attempts.length`，而列表使用按所选班级过滤后的结果，二者数据源不同造成自相矛盾的界面。现两者共用同一份派生数据（班级 + 搜索 + 状态筛选），徽标在发生过滤时额外以 `/ 总数` 形式提示总量；状态筛选口径统一为 `completed|submitted|finished`（终态）与 `active|inprogress|started`（进行中），修正原先只认 `'started'` 导致「进行中」筛选失效的问题。
- **修复插件自建表 SQL 注入（`ensureTable` / `table` / `dropAllTables`）**：`ctx.db.ensureTable(tableName, schema)`、`ctx.db.table(tableName)` 的表名与 `CREATE TABLE` 的列定义片段都直接来自插件（ZIP 上传，属不可信输入），此前被原样拼进 DDL —— 形如 `t (x); DROP TABLE events; --` 的表名即可改写内核数据。现在 inline（`packages/core/plugin-host/context-builder.ts`）与 Worker（`packages/core/worker-runtime/worker-manager.ts`）双模式强制同等校验：表名必须匹配 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`，列定义必须为非空字符串且不含 `;`（阻断多语句注入），`dropAllTables()` 从 `sqlite_master` 读到的表名二次校验 `^plugin_[A-Za-z0-9_]+$` 后才拼进 `DROP TABLE`。校验失败直接抛错，不再静默放行。
- **消除插件更新检测的 Shell 命令注入，并为相关出站端点补鉴权**：`server/services/version-fetcher.ts` 原以 `execSync(`git ls-remote --tags "${url}"`)` 执行字符串拼接命令，而 `repo` 来自插件 manifest（安装时由上传方控制，属不可信输入），形如 `x"$(cmd)"` 的取值会触发 shell 命令替换（宿主 RCE）。现改为 `execFileSync('git', ['ls-remote', '--tags', url])` 参数数组执行（不经过 shell），并新增 `normalizeSource()` 白名单：仅接受 `owner/name` 形式的 GitHub / Gitee 仓库（长度 ≤ 140，正则为 `^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$`），非法值直接返回「无效的更新源：仅支持 owner/name 形式的 GitHub / Gitee 仓库」而**不发起任何出站请求**；缓存键与后续 URL 拼接一律改用已校验的值，避免未校验输入污染缓存。
- **`server/routes/plugins.ts` 三个端点补鉴权**：`GET /api/plugins/market` 与 `POST /api/plugins/:id(*)/check-update` 都会按插件声明的 `updateSource.repo` 触发服务端 git / HTTP 出站请求，此前无鉴权、可被未认证调用放大为出站请求放大器，现挂 `requireAuth()`（不限角色，插件中心教师亦需查看）；`POST /api/plugins/execute-command` 是插件宿主前端 → 后端的统一命令入口，此前无鉴权，现挂 `requireAuth()`，且**刻意不限制角色** —— 教师端与学生端共用同一插件宿主（`src/main.tsx` 单例），学生端学习面板与考试全屏视图也会派发命令，若限制为 teacher/administrator 会直接打断学生端功能。
- **修复学生端诊断上报回退端点的鉴权后门与身份冒充**：`POST /api/diagnostics/report` 是 WebSocket 路径（`server/presence.ts` 的 `student-client-error`）的 HTTP 回退，却既无鉴权、也丢掉了 WS 路径已有的防冒充校验，使回退路径成为绕过身份校验的后门。现在：① 挂 `requireAuth()`；② 非教师/管理员时必须 `session.userId === data.studentId`，不符返回 403 并记 `[Diagnostics Security]` 警告（与 `presence.ts` 校验强度对齐）；③ 学生上报的 `studentName` 一律取服务端会话权威值（`session.username || session.studentId`），忽略客户端传值，阻断借 `studentName` 向全体教师广播任意文本的冒充/钓鱼；④ 同一账号 1 秒内只接受一次上报（超出返回 429），计数表超过 5000 条时清理 60 秒前的记录，避免被放大为写库 + 全量广播风暴；⑤ 收敛 payload：仅保留已知字段并截断长度（`type` ≤ 64、`message` ≤ 2000、`title` ≤ 200、`studentId` ≤ 64、`studentName` ≤ 100），防止超大包写进 `events` 审计表；⑥ 无有效载荷时保持静默成功（与历史行为一致，避免触发前端重试）。
- **修复插件停用 / 卸载后的资源与能力残留**：`packages/core/plugin-host/index.ts` 中，Worker 模式插件的 `terminateWorker` 只在 `finally` 里改状态、**未调用** `this.resourceTracker.disposeAll(pluginId)`（只有 inline 路径 `deactivatePluginExclusive` 调用了），导致 worker 模式插件停用后命令、事件订阅、定时器与路由永久残留；非 ACTIVE 态（`ERROR` / `INACTIVE` / `INSTALLED`）的卸载分支既不执行停用逻辑、也不执行 `revokeAll`，使已授予能力残留在内存中（权限泄漏，典型场景：`activate` 中途失败或 reload 失败后直接卸载）。现在 Worker 终止的 `finally` 中无条件 `disposeAll`；卸载流程在「1b. 兜底资源回收」与「4b. 撤销插件能力」两处无条件执行 `resourceTracker.disposeAll(pluginId)`（幂等，对已回收过的插件为空操作）与 `capService.revokeAll('plugin:' + manifestId)`（失败仅 warn），与 inline 路径及 T-04-20 保持一致。
- `packages/core/version.ts` 的兜底版本号 `FALLBACK_VERSION` 由 `0.3.20` 同步为 `0.3.21`（仅在无法定位平台 `package.json` 时作为降级值使用），避免诊断信息与实际发布版本不一致。
- **修复互动课件成绩提交 500（actorId 未归一化 + 空 `completion` 触发载荷校验失败）**：学生提交网页课件成绩时 `POST /api/courseware/attempts/:attemptId/submit` 返回 500，服务端日志为 `[CapabilityGuard] Access Denied: Actor <uuid> missing capability student:write for courseware.submit_attempt`。根因两处：① `server/routes/courseware.ts` 用 `session.userId`（裸 UUID）作为 actorId 传入 `courseware.submit_attempt`，而 CapabilityGuard 的角色兜底依赖 `user:<id>:<role>` 的 `:role` 后缀（`packages/core/capability-system/index.ts` 的 `actorId.endsWith(':student')`），裸 UUID 匹配不到任何角色能力；② `packages/core/kernel/index.ts` 的 `validateJsonSchema` 把**显式 `null` 当作已提供值**校验（`key in data && data[key] !== undefined`），而路由把缺省为 `null` 的 `completion`/`score` 一并塞进 payload，导致不带完成度的提交以 `property "completion": Expected number, got object` 失败。现改用 `getActorId(req)` 归一化身份（仅在取不到时回退 `user:<id>:<role>`），且 payload 只下发非空字段。
  - **教师课件预览提交同样 500**：预览 attempt 的 `student_id = 'teacher_preview'`（`src/features/whiteboard/utils/bridgeUtils.ts`），会话角色为 `teacher`，而 teacher 角色兜底能力此前不含 `student:write`。现将其补入（当前仅 `courseware.submit_attempt` 一条命令要求该能力，路由层仍按 `attempt.student_id` 校验所属权，不放松跨学生写入）。
- **修复 `GET /api/courseware/attempts/:attemptId/raw` 越权读取**：该端点返回学生原始作答明细，但此前既无 `requireAuth`，又将 actorId 硬编码为 `'teacher-demo'`（种子能力含 `lesson:*`，恰好满足命令要求的 `lesson:read`），任何人只要持有 attemptId 即可读取任意学生作答（越权与未认证读取）。现要求登录会话（无会话 401）并叠加**所属权校验**：教师 / 管理员可读任意 attempt，其他角色（含学生）仅能读自己的 attempt（读他人一律 403，attempt 不存在亦返回 403 以免用状态码枚举存在性），身份取真实会话 `getActorId(req)`。这样既关闭 IDOR 与未认证读取，也不打断「学生查看自己作答详情」类调用方，与 `/submit` 的所属权口径一致；前端现有唯一调用方 `src/components/LiveClassroomView.tsx` 挂在教师视图下，不受影响。
  - 验证：新增 `server/__tests__/courseware-submit-actor.test.ts`（6 例：学生 Cookie 会话提交自己的 attempt 并落库、跨学生 403、教师预览提交 200、无会话 401、`/raw` 的 401 / 学生读自己 200 / 学生读他人 403 / 教师读任意 200、CapabilityGuard 角色后缀与裸 UUID 对比）。用例刻意不走 `capabilityGuard.grant`（此前 `courseware-e2e-flow.test.ts` 与 `quiz-answered-e2e.test.ts` 正是靠手工授权绕过了上述缺陷，因此缺陷未被发现；本次已一并移除这两处手工授权，令其回归真实鉴权路径），故修复前必然失败：`git stash` 掉修复复跑，4 例失败并逐字复现线上报错 —— `[CapabilityGuard] Access Denied: Actor stu-actor-0001 missing capability student:write for courseware.submit_attempt`、`property "completion": Expected number, got object`、`/raw` 无会话返回 200、学生读他人 attempt 返回 200。修复后 `courseware-submit-actor` / `courseware-e2e-flow` / `courseware-attempts-filter` / `security_hardening` / `quiz-answered-e2e` / `lesson_ownership` / `builtin` 共 49 例全绿，`tsc --noEmit` 在改动文件上 0 错误。
- **白板 `wrapSrcDocWithBridge` 单测断言过期（全量测试长期为红）**：`src/features/whiteboard/__tests__/whiteboard-components.test.tsx` 仍断言 `<script src="/bridge.js"></script>`，而实现早已输出带追踪参数的 `<script src="/bridge.js?cw=<lessonId>"></script>`（该参数由 `server/routes/bridge.ts` 的 `req.query.cw` 消费），断言已同步修正。另：全量测试中的 `packages/core/__tests__/lti-provider-plugin.test.ts` 因引用仓库内并不存在的 `v2_plugins/plugin-lti-provider/src/index.js` 而整文件失败（新克隆必红），属既有问题，本次未处理。
- 修复作业中心 `assignment.create` 被 `management.ts` 的旧描述符拦截：`ActionRegistry.getActionByCommandType()` 返回**最先注册**的描述符并由它决定内核 payload 校验，旧描述符 `core-assignment-create` 的 `required: ['classId','title']` 会让「只挂课时、不挂班级」的作业创建失败（`Missing required property "classId"`）。插件现在一并接管该描述符；`server/routes/assignments.ts` 的旧班级作业页直接写库、不经命令总线，不受影响。
- `plugin_assignments.created_by` / `plugin_grades.graded_by` 改为保存用户 ID，原先写入 `user:<id>:<role>` 形式的完整 actorId，与其他表的 `*_id` 列口径不一致。
- 修复白板课件元素的成绩浮层在「全班专注锁定」下不可点击的问题：`HtmlAppletFrame` 的浮层与按钮 z-index 由 `z-10` 提升到 `z-[60]`，不再被 `ReadOnlyLockCover`（`z-50`）遮挡，学生在只读锁定态仍能查看成绩榜。
- 修复 `GET /api/courseware/attempts` 无鉴权且下发原始作答的问题：改为 `requireAuth()` + 按角色裁剪字段——学生只拿榜单字段（姓名 / 分数 / 完成度 / 状态），`extra_json`（原始作答明细）与 `comment`（教师评语）仅教师 / 管理员可见，避免同班互相抄答案。
  - 回归：`server/__tests__/courseware-attempts-filter.test.ts` 新增「未登录 401」「学生被裁剪 / 教师保留 `extra_json` + `comment`」2 例（补齐真实 `client_sessions` 会话与 Cookie），`server/__tests__/courseware-e2e-flow.test.ts` 两处成绩榜请求改带教师会话 Cookie（该文件由 4 例扩到 6 例）。
- 修复学生端「作业提交与互评」面板在提交内容为纯文字 / 链接 / 多附件时整页白屏的问题：`src/components/StudentAssignmentEvalPanel.tsx` 直接 `mySubmission.file_path.split('/')`，而作业中心（P0/P1）引入的这类提交 `plugin_submissions.file_path` 恒为 NULL → `TypeError: Cannot read properties of null (reading 'split')`（线上遥测：2026-09-21 学生端 `#/courses`）。
  - 新增 `baseName()` / `describeSubmission()` / `fileHref()`：自己与同学的提交都改为按内容物描述（文件名 / N 个附件 / 文字作答 / 链接作答 / 已提交（无附件）），附件改为走带权限的 `/api/assignments/:assignmentId/files/:fileId`，并在卡片内展示文字作答与作品链接；无附件时不再渲染指向 `null` 的下载链接。
  - `server/routes/lessons.ts`：`GET /api/lessons/:lessonId/eval-submissions` 与 `GET /api/lessons/:lessonId/students/:studentId/eval-status` 新增 `LATEST_VERSION_COLUMNS`（子查询取最新 `plugin_submission_versions` 的 `files_json` / `text_content` / `link_url`）与 `withLatestVersion()`（展开为 `files` / `textContent` / `linkUrl`），旧面板因此能看到真实提交内容而不只是一个文件路径。
  - 回归：新增 `src/components/__tests__/student-assignment-eval-panel.test.tsx` 4 例（纯附件 / 纯文字互评 / 历史纯路径兼容 / 未提交）。把该组件改动 stash 掉后，其中 2 例会以**与线上完全相同的** `TypeError: Cannot read properties of null (reading 'split')` 失败，证明该回归已被锁死。
- 补齐作业互评只读接口的鉴权：`GET /api/lessons/:lessonId/eval-submissions` 与 `GET /api/lessons/:lessonId/students/:studentId/eval-status` 此前**没有任何鉴权**，任何人仅凭 `lessonId` 即可读到全班提交（含文字作答、附件名、互评记录与成绩），现分别加 `requireAuth()`。
  - 回归：新增 `server/__tests__/eval-submissions-auth.test.ts` 3 例（未登录 401；登录后 `file_path` 为 null 的提交回填 `files` 且不泄露内部字段 `latest_files_json`；`eval-status` 同样正常）。
- **互动课堂前后端字段名失配修复（学生端投票 / 节奏信号 / 结课通票）**：
  - **投票**：`StudentInteractiveOverlay` 发送 `selectedOption` 而服务端读 `option`，导致所有投票落库为字符串 `"undefined"`（投票分布与课堂简报警戒失真）。服务端改为兼容 `option` / `selectedOption`，并新增「选项必须属于本次投票的可选项」「缺失选项返回 400」校验；前端统一发送 `option`。
  - **节奏信号**：前端发送 `signalType` 而服务端读 `signal`，请求恒 400 且被前端静默吞掉（"听懂反馈晴雨表"从未生效）。服务端兼容两种字段名，前端统一发送 `signal`。
  - **结课通票**：前端发送 `feedbackNotes` 而服务端读 `feedback`，学生文字反馈被静默丢弃。服务端兼容两种字段名，前端统一发送 `feedback`。
  - 新增 `server/__tests__/classroom-routes-contract.test.ts`（11 例）锁定请求契约：两种字段名均可用、非法选项 400、缺字段 400、投票关闭后拒绝、大屏数据接口未登录 401。

### Docs

- **新增「架构文档 ↔ 代码」漂移审计流水线与本地钩子**：`audit-tools/` 新增三个互不依赖的 Python 脚本与两个入口脚本 —— `normalize.py`（把文档标题与代码目录名归一化为同一套 canonical key）、`extractors.py`（分别从 `docs/` 与 `packages/core/`、`packages/plugins/`、`src/`、`server.ts` 提取结构化事实并落成 JSON）、`aligner.py`（对齐两侧并输出 `MISSING_IN_CODE` / `MISSING_IN_DOCS` 漂移清单）、`run.sh`（一键跑完整链路：无漂移时退出码 0 并打印 `✅ No architecture drift detected.`，有漂移时以 `::error::` 注解打印并退出 1，便于 CI 与钩子消费）、`install-hook.sh`（把审计装成本地 pre-commit 钩子，仅当暂存区命中 `docs/`、`packages/core/`、`src/features/`、`packages/plugins/` 时才运行；若已存在钩子会先备份为 `*.bak` 再链式追加，不覆盖用户脚本）。
- **CI 新增 `docs-drift-audit` job**：`.github/workflows/ci.yml` 中依次 checkout ➔ setup-python 3.11 ➔ `bash audit-tools/run.sh`；失败时上传 `audit-tools/reports/drift_report.md` 作为工件，并在 PR 场景下用 `actions/github-script` 把完整报告贴回 PR 评论，让文档漂移在合并前可见。当前基线：`docs facts: 103` / `code facts: 55` / `drift items: 0`（MISSING_IN_CODE 0、MISSING_IN_DOCS 0）。
- **新增 `docs/developer-guide/docs-drift-audit.md`**：记录该审计要解决的问题（文档描述了而代码已删改，或代码新增了子系统而文档未登记）、两侧事实的提取口径、本地运行方式与装钩子方式，并登记进 `docs/index.md` 的开发者指南 toctree。
- `.gitignore` 补充忽略审计生成物：`audit-tools/reports/`（`extracts.json` / `drift_report.md` / `drift_report.json`）与 `audit-tools/__pycache__/`，仓库只提交脚本与说明，避免每次运行都产生噪声 diff。
- **README 重写为面向外部读者的平台能力总览**：补充徽章（测试 / Node / pnpm / 许可证）、「核心特性」五大项（微内核 + 事件驱动架构、双运行模式插件沙箱、零信任课件隔离与 Bridge SDK、课堂实时协同与学生端遥测、AI 伴随教学引擎）、ASCII 架构拓扑图、pnpm 命令表（补齐 `lint:eslint` / `format` / `db:backup` / `db:reset`）、环境变量表（补默认值列）、分阶段演进路线图（阶段一 v0.3.21 稳固与安全收敛，阶段二 v0.4.0 K12 课堂交互与智能伴随深化）与相关文档索引，替代原先偏「快速上手」的首页。
- **补充三个运行时架构文档**，把此前只存在于代码里的三条运行链路正式文档化：`docs/architecture/classroom-runtime.md`（Classroom Runtime，跨前端 `src/features/classroom-runtime/` 与内核 `packages/core/classroom-runtime/` 两侧）、`docs/architecture/interaction-runtime.md`（Interaction Runtime，覆盖 Keyboard / Mouse / Touch / Gesture / Drag / Clipboard / Focus / ContextMenu / Selection 九个交互域）、`docs/architecture/resource-runtime.md`（Teaching Resource Runtime，把 PDF / PPT / 视频 / Notebook / Mermaid / GeoGebra 等异构资源统一适配为 Workspace 控件）；三篇文档均登记进 `docs/index.md` 的架构 toctree，随 ReadTheDocs 发布，同时被上一提交引入的漂移审计纳入比对范围（本仓库 `docs facts: 103` / `code facts: 55` / `drift items: 0` 基线保持）。
- **修正 README 中 5 处失效链接**：3 处指向并不存在的 `docs/architecture/plugin-architecture-audit-report.md`（该文件全仓不存在、git 历史也从未提交过；改为指向既有的架构文档漂移审计），2 处指向同样不存在的仓库根 `LICENSE`（改为指向声明 `"license": "MIT"` 的 `package.json`）。**注意：仓库目前确实没有 LICENSE 文件**，若要以文件形式发布许可证，需由版权持有者补齐版权行后另行提交。

## [0.3.21] - 2026-09-20

### Fixes

- **启动横幅品牌重命名与版本号单一来源 (Startup Banner Rebrand & Version SSOT)**:
  - **横幅品牌化**：`server.ts` 的 HTTP listen 回调内将启动横幅文本从历史遗留的 "Educational OS Kernel" 重命名为平台统一品牌 "OpenLearn Next"；横幅格式为 `OpenLearn Next vX.Y.Z ready:`；
  - **网址可点击**：本地与局域网 URL 输出套用 OSC 8 (`\x1B]8;;URL\x1B\\URL\x1B]8;;\x1B\\`) 超链接，使 iTerm2 / Windows Terminal / GNOME Terminal / VS Code 集成终端等现代终端可直接 ⌘/Ctrl+点击打开浏览器；同步套用到 `OPEN_BROWSER=true` 时的 "Auto-opening browser" 提示；
  - **TTY 守卫防日志污染**：`process.stdout.isTTY && process.env.TERM !== 'dumb'` 才启用 OSC 8 转义，管道 / PM2 / 文件重定向等非交互环境自动退化为纯文本，避免日志里残留 ANSI 转义序列；
  - **版本号单一来源 (SSOT)**：`packages/core/version.ts` 不再硬编码 `PLATFORM_VERSION = '0.3.18'`，改为运行期从最近的上级 `package.json`（匹配 `name === 'openlearn-next'`）读取 `version` 字段；找不到时回退 `'0.3.20'`。从此发布新版本时只改根 `package.json`，启动横幅与所有 `PLATFORM_VERSION` 引用自动同步；
  - **验证**：`packages/core/__tests__/version-consistency.test.ts` 6/6 通过；`npx tsx` 与模拟 `dist/server.cjs` 两条运行路径均返回 `0.3.21`；`pnpm lint` 在改动文件中未引入新 TS 错误。

## [0.3.18] - 2026-09-19

### Tests & Reliability

- **测试套件时间预算加固 (Test-suite Timing Robustness)**：
  - **背景诊断**：全量测试曾在部分运行中出现“每次失败文件都不同、单独跑又全绿”的抖动。实测定位为**环境性**问题——在 IDE / MCP server / 其他 agent 同时跑重活的机器上，`PSI io full avg300` 达 18%、16 核 loadavg 达 52–72，磁盘停顿令各测试的时间预算先后被击穿；环境回落（loadavg 1.2 / `PSI io` 1%）后全量 43s 稳定通过。因此该抖动**不是仓库代码缺陷**，但下面三处测试本身确实存在可被击穿的脆弱点；
  - **`worker-runtime/integration.test.ts`**：三处硬编码 `setTimeout(..., 5000)` 守卫（失败信息仅 `Timeout A`/`Timeout B`，且条件满足后不清理定时器）抽为具名 `WORKER_ACTIVATION_BUDGET_MS = 30_000` 的 `activateAndWait()` 辅助函数，并在 resolve/reject 时 `clearTimeout`。注意 vitest 的 `testTimeout` **不**管辖测试内部的 `setTimeout`；
  - **`AppShell.test.tsx`**：`beforeAll` 预热 `StudentView`/`TeacherView` 动态 chunk，使 `React.lazy` 命中模块缓存——实测首个用例 **939ms → 322ms（−66%）**，把 vitest 的 transform 开销移出断言窗口；
  - **`LazyCourseware.test.tsx`**：三处 `await waitFor(...)` 补齐显式预算（原为 1000ms 默认值，而实测已消耗 ~320ms，仅约 3× 余量），并同样预热 `InteractiveCoursewareViewer` chunk；
  - **验证**：修复后 6 次全量运行全绿——空闲 ×3、合成 CPU 压力（`PSI cpu` 32.7%）×1、dev server 运行中 ×2（其中一次 `PSI cpu` 44%）。

### Features

- **默认 Gemini 配置彻底移除与动态 AI Provider 架构强制 (Complete Gemini Fallback Removal & Dynamic AI Provider Enforcement)**:
  - **解耦硬编码回退**：服务端与内核全面清理 `process.env.GEMINI_API_KEY` 兜底以及 `@google/genai` 依赖，系统 AI 能力统一由数据库 `ai_providers` 中动态配置的 OpenAI 兼容提供商（如 DeepSeek、Qwen、Ollama、OpenAI 等）驱动；
  - **内核 DI 服务强化与凭据解密**：`packages/core/di/ai-service.ts` 与 `AIProviderGateway` 严格要求已配置的提供商，无有效 Provider 时统一抛出友好中文提示；集成 AES-256-GCM 密钥透明解密支持；
  - **业务路由全量收归内核服务**：`assignments.ts`（生成题目、建议测验与智能评测）、`lessons.ts`（白板 AI 助教）、`grading.ts`（学期综合评估）、`schedules.ts`（课表 OCR）与 `ai-submit-injector.ts` 全面移除 Gemini 回退分支，统一收归内核 `kernelContainer.aiService`；
  - **前端未配置状态与友好引导**：
    - `RightSidebar.tsx`: 移除写死的“系统默认（Gemini）”选项；无提供商时展示“未配置 AI 提供商”禁用选项，并在抽屉顶部展示醒目琥珀色警示卡片引导前往「系统管理 -> AI 提供商管理」，同时禁用输入框与发送按钮；
    - `TimetableOcrView.tsx`: 移除默认选项，无提供商时显示多模态模型要求引导横幅并禁用 OCR 识别按钮；
    - `App.tsx`: 修正 `agentProviderId` 初始状态机与同步逻辑，消除对 `'system'` 伪提供商的隐式依赖；
  - **环境与部署配置清理**：清理 `.env.example`, `docker-compose.yml`, `ecosystem.config.cjs`, `deploy.sh`, `cli.mjs`, `metadata.json` 中的 `GEMINI_API_KEY` 与遗留声明。

- **现代化紧凑导航边栏与分类折叠交互 (Modern Compact Navigation Sidebar & Collapsible Categories)**:
  - **紧凑排版与现代无边框视觉**：导航边栏宽度缩小为贴合项目文字宽度的紧凑尺寸，移除突兀深黑边框，升级为柔和阴影与半透明底色现代设计；
  - **分类折叠与视觉层级区隔**：导航条目分类（如教学工具、系统管理等）支持点击折叠/展开，带平滑动画与状态记忆；条目文字“帮助与支持”统一精简为“帮助支持”。

- **全平台品牌统一为 OpenLearn Next (Brand Standardization to OpenLearn Next)**:
  - 将系统内所有历史遗留的 "Edu OS"、"EduLearn OS"、"EduLearn LMS" 标识全面对齐为统一产品命名 "OpenLearn Next"。

- **全站中文字体规范化与 9pt (12px) 物理保底 (Chinese Web Typography & 9pt Minimum Floor Guarantee)**:
  - **中文排版底线标准设定**：根据现代中文网页排版规范与印刷字号换算标准（$9\text{pt} = 12\text{px}$，中文小五号字），杜绝页面中因字号过小（如 6px~11px）导致的中文字符发虚、笔画粘连与难以辨认问题；
  - **全局 CSS 强防御兜底 (`src/index.css`)**：在全局样式表中配置 `max(12px, calc(12px * var(--app-font-scale, 1))) !important` 规则，确保即使用户选择紧凑缩放模式（85%），全站各处文字依然严格受 12px（9pt）物理底线保护；
  - **全站源码扫描与字号升级**：对全平台 70+ 个页面与组件中的 748 处微像素类名（`text-[6px]` ~ `text-[11.5px]`）全面升级为标准 Tailwind `text-xs` 或 `text-sm`，将 `text-2xs` 与 `text-3xs` 平移升级，并同步将所有 Recharts/SVG 图表（学情轨迹、出勤统计、成绩趋势等）轴线刻度与提示框字体统一提升至 12px。

- **全局字体缩放无障碍辅助功能 (Global Font Size Scaling & Accessibility)**:
  - **全局字号状态管理 (`fontSizeStore`)**：基于 Zustand 构建字号缩放状态机（支持 80%、90%、100%、110%、125%、150%），状态自动持久化至 `localStorage`；
  - **全站 CSS 变量与视图穿透生效**：通过 `--font-scale` 变量联动根节点 `html` 与主要工作区样式，并向所有沙箱课件 `iframe` 广播字号缩放指令（`broadcastFontScaleToIframes`）；
  - **顶栏统一控制交互 (`FontSizeSelector`)**：在系统全局顶栏集成快捷调节器，并移除非顶部的冗余按钮（如白板与课程编辑器工具栏），保障操作界面纯净统一。

### Fixes

- **仪表盘加载 500 异常与 Worker 插件命令注册修复 (Dashboard Command & Worker Capability Fixes)**:
  - **缺陷**：进入 `/#/dashboard` 仪表盘页面时，触发两项 HTTP 500 服务端接口错误（`records is not iterable` 与 `No handler registered for command: lianyun-course.research.get_activities`）；
  - **修复**：
    - `@aymwoo/plugin-lab-seat`: 修复 `records is not iterable` 异常，为数据库 `db.prepare(...).all()` 查询结果增加空值数组兜底（`records || []`）；
    - `service-host.ts`: 修复 worker capability 检查逻辑，支持缺少 `worker:all_commands` 时安全回退，并在无 handler 注册时不发生未捕获奔溃；新增测试 `packages/core/worker-runtime/__tests__/dashboard-plugins.test.ts` 锁定回归。

- **管理后台页面风格规范化对齐 (Admin Panel Visual Harmonization)**:
  - 重构 `AdminPanel.tsx`，将旧式高对比黑边框与深色底框统一调整为与教师端其他页面一致的现代白底、轻质灰边（`border-gray-200/80`）与柔和阴影风格。

- **全班专注锁定白板内嵌组件只读与交互阻断 (Class Focus Lock Whiteboard Component Read-Only Guard)**:
  - **缺陷**：当教师开启“全班专注模式/禁言锁定”时，学生端白板画布虽有锁定提示遮罩，但白板内部渲染的各类教学组件（Reveal 演示文稿、代码沙箱、数理画板、点名器、互动课件等）仍可被学生独立点击和操作；
  - **修复**：在白板容器与所有内嵌教学小部件上联动 `isLocked` / `readOnly` 状态，对白板画布层全面注入交互阻断（`pointer-events-none`、只读参数穿透传递与操作拦截），确保专注锁定期间学生端所有内嵌组件完全处于只读观察状态；
  - **测试覆盖**：新增单元测试 `src/features/whiteboard/__tests__/whiteboard-readonly-lock.test.tsx` 严格验证只读遮罩与组件交互拦截逻辑。


- **交互网页课件任意文件名 404 与自愈恢复机制 (Arbitrary HTML Courseware Entry & Self-Healing)**:
  - **缺陷**：在属性编辑器中选择单文件 HTML 课件时，系统固定寻址 `index.html`；若课件文件名为中文或自定义命名（如 `自适应五子棋.html`、`约翰·斯诺的霍乱地图.html`），运行时报错 `File not found: index.html`；且仅存放在 `system_resources` 原生表的课件在磁盘缺少物理文件时无法直接运行；
  - **修复**：
    - `bridge.ts`: 增加智能入口扫描与回退机制，当指定 `subpath`（如 `index.html`）不存在时，智能扫描目标根目录与首层子目录下的 `.html` 文件并正常直出；自动在磁盘生成 `index.html` 镜像并自愈更新数据库 `courseware.entry`；若磁盘目录不存在，自动回溯至 `system_resources` 原生表还原物理文件；
    - `resources.ts`: 单页 HTML 动态登记时保留原始 `.html` 文件名作为 `entry` 并向磁盘双写；
    - `builtin.ts`: 课件上传与 AI 改写版本生成时保留真实文件名并双写 `index.html` 软副本；
    - `bootstrap-db.ts`: 启动时执行自愈迁移，自动将 `system_resources` 同步至 `courseware` 并纠正历史硬编码。
  - **测试覆盖**：新增 `server/__tests__/bridge.test.ts`，覆盖任意命名直出、入口自愈、系统资源还原与 404 兜底场景。

- **Iframe credentialless 属性 React 渲染警告修复**:
  - `HtmlAppletFrame.tsx`: 将 `credentialless` 属性从布尔值 `true` 调整为字符串 `"true"`，彻底消除 React 19 控制台关于 `Received true for a non-boolean attribute credentialless` 的警告。

- **白板组件最大化学生端实时同步 (Whiteboard Fullscreen Component Student Sync)**:
  - 教师在课堂白板中最大化展示特定教学组件（如互动课件、代码沙箱）时，状态经由 `ClassroomSyncChannel` 与 Socket.IO 即时广播，学生端（包括独立标签页）实时同步全屏展示，并支持取消还原；
  - 补齐回归测试用例 `whiteboard-fullscreen-sync.test.tsx`。

- **CI 与发布流水线假绿修复 (CI & Publish Pipeline Integrity)**:
  - **`ci.yml` 从未真正运行过检查**：`cache: 'npm'` + `npm ci` 用在 pnpm workspace 上（仓库只有 `pnpm-lock.yaml`，无 `package-lock.json`），每次都在第一步以 `ENOLOCK` 失败，`tsc` / `vitest` 根本没跑。现改为 `pnpm/action-setup@v4` + `cache: 'pnpm'` + `pnpm install --frozen-lockfile`，并改用 `pnpm lint` / `pnpm test`；
  - **PR 评论步骤必然 403**：`issues.createComment` 需要 `issues: write`，而默认 token 只读。现为该 job 显式声明 `permissions: { contents: read, issues: write }`；
  - **移除重复跑整套测试的步骤**：原实现用 `execSync` 再跑一次 `vitest run --reporter=json`，其输出超过 `execSync` 默认 1MB buffer，现直接报告上方步骤的结果；
  - **`security-audit` job 无法运行**：`npm audit` 同样因缺 lockfile 报 `ENOLOCK`，改为 `pnpm audit --audit-level high`；因仓库现有 7 项传递性 devDependency high 告警，暂设 `continue-on-error: true` 并注明待归档后收紧；
  - **`publish.yml` 幂等化**：三个 `npm publish` 步骤均无“版本已存在则跳过”守卫，任何重跑（`workflow_dispatch`）或未逐包抬版本的重复 push 都会以 `EPUBLISHCONFLICT` 中断整个 job。现每步先探测 `npm view <pkg>@<ver>`，已发布则 `::notice` 跳过；两处 `workspace:*` 改写后的 `git checkout` 回滚改用 `trap ... EXIT`，即使 publish 失败也会还原工作树。

- **Vitest 配置写死本机绝对路径 (vitest.config.ts Portability)**:
  - 三个 alias 硬编码为 `/home/wuxf/Develop/openlearnv2/...`，导致 `pnpm test` 在 CI 与其他机器上无法解析。现改为基于 `import.meta.url` 的 `fileURLToPath(new URL(rel, import.meta.url))`，解析结果与原先在本机完全一致（已验证字符串一致，不改变模块标识）。

- **系统错误中心未读角标虚高 (Error Center `unreadCount` Invariant)**:
  - **缺陷**：`unreadCount` 应恒满足 `0 <= unreadCount <= errors.length`，但有两处会破坏它 —— `removeError` 删除错误后不递减计数；`addError` 达到 30 条存储上限后 `slice` 截断最旧一条却仍无条件 `+1`（后者可让角标显示 40 而面板里只有 30 条错误）；
  - **修复**：抽出 `reconcileUnreadCount()` 统一收敛该不变量，在上述两处应用；
  - **回归测试**：补齐 `removeError` 原先只断言 `errors` 长度、从不断言 `unreadCount` 的覆盖漏洞，并新增两条用例分别锁定“删除后计数同步”与“截断后不越界”（均已在修复前验证为红）。

- **白板最大化：父组件重渲染导致学生端视图被反复取消 (`InteractiveWhiteboard onFullscreenSync`)**：
  - **缺陷**：`onFullscreenSync` 常以内联箭头函数传入，每次渲染都是新引用；它原先位于 cleanup effect 的依赖数组中，导致父组件每次重渲染都拆解重跑 effect，向学生反复广播 `elementId: null`，把刚建立的最大化视图取消掉（实测：一次无关重渲染即产生 1 次 `null` 广播）；
  - **修复**：将回调存入 ref 供 cleanup 读取，effect 依赖数组仅保留稳定基础值；新增回归测试锁定“父组件重渲染不得触发 `null` 广播”。

### Docs

- **技术文档全景更新与 OpenAI 兼容架构对齐 (Documentation Decoupling & Alignment)**:
  - 全面更新 `docs/getting-started/installation-guide.md`、`docs/getting-started/quickstart.md`、`docs/ai/ai-runtime.md`、`docs/api/di-tokens.md`、`docs/architecture/configuration.md`、`docs/architecture/composition-root.md`、`docs/index.md`、`docs/sdk/plugin-sdk.md` 以及 `AGENTS.md`、`README.md`、`CLAUDE.md`；
  - 阐明 AI 运行时已完全解耦为数据库驱动的 OpenAI 兼容多 Provider 网关机制，全面移除环境变量 `GEMINI_API_KEY` 兜底说明。

## [0.3.17] - 2026-09-19

### Features & Plugin Ecosystem

- **课程设计备课画板组件插件扩展插槽 (Palette Item Extension Slot for Lesson Design)**:
  - **画板组件注册表 (`paletteItemRegistry`)**：基于 Zustand Vanilla Store 构建响应式注册单例，开放 `register`、`unregister`、`unregisterPlugin(pluginId)` 与 `usePluginPaletteItems` 响应式 Hook；
  - **插件上下文契约扩展 (`FrontendPluginContext.ui`)**：在前端插件上下文中新增 `ctx.ui.registerPaletteItem(config)` 与 `ctx.ui.unregisterPaletteItem(type)`，支持第三方插件向备课画板贡献专属教学组件（如学科仿真实验、3D 分子模型、乐谱、编程评测沙箱等）；
  - **备课组件库无缝聚合 (`LessonPalette.tsx`)**：左侧画板面板动态聚合并实时响应插件组件，新增“插件扩展”专属分组，自动享受中英文检索、拼音首字母匹配、分类折叠、收藏置顶与最近使用机制；
  - **初始参数声明式配置弹窗 (`PaletteCardEditModal`)**：支持插件声明 `editFields`（`input`、`textarea`、`select`、`options` 等），教师点击卡片时自动唤起配置表单并支持动态/异步加载选项；
  - **白板画布标准教学卡片容器 (`InteractiveWhiteboard.tsx`)**：白板自动为插件组件提供统一的标准教学卡片外壳，集成标题栏拖拽手柄、平滑缩放 handles、最小化折叠、全屏放大以及删除控制，并无缝挂载插件自定义 React 视图组件；
  - **属性侧边栏自动映射与回退**：选中插件组件时，若未注册专属 `propertyEditor`，右侧属性检查器自动基于 `editFields` 生成即时响应的通用配置表单；
  - **生命周期自动回收**：插件宿主 `unregisterPluginResources(pluginId)` 与插件停用/卸载联动，自动清理插件注册的画板组件，防止内存泄漏或残留脏配置；
  - **文档与 SDK 声明同步**：更新 [`docs/reference/plugin-ui-extension-slots.md`](docs/reference/plugin-ui-extension-slots.md)、[`docs/tutorials/plugin-development-tutorial.md`](docs/tutorials/plugin-development-tutorial.md) 以及 `@openlearn/plugin-sdk` 类型定义。

- **互动课堂独立标签页学生端与多端实时同步 (Independent Tab Student Preview & Realtime Sync)**:
  - **独立浏览器标签页学生端 (`/student/live?lessonId=...`)**：互动课堂的学生视角从页面内弹窗/抽屉改造为弹出独立的浏览器标签页，便于教师在多屏或分屏环境下双端实时对照教学效果；
  - **双向广播联动通道 (`ClassroomSyncChannel`)**：基于 `BroadcastChannel` 与 Socket.IO 构建低延迟双向联动通信通道，教师端的页面切换、白板标注涂写、组件缩放移动与课件交互实时毫秒级同步至独立学生端 tab；
  - **多端状态感知与生命周期管理**：支持主动心跳检测、掉线重连感知与独立窗口关闭状态同步。

- **全局系统错误诊断中心与一键复制 (Global System Error Diagnostic Center & One-Click Copy)**:
  - **全局未捕获异常监听 (`useGlobalErrorCapture`)**：统一捕获 `window.onerror`、`unhandledrejection` 以及 React 渲染 ErrorBoundary 异常；
  - **系统级错误诊断模态框 (`SystemErrorCenterModal`)**：当系统发生错误时通过全局 Toast 提供快速入口，打开“系统错误诊断中心”，智能提取错误分类、发生时间、课程/班级上下文以及格式化调用堆栈；
  - **智能排查建议与一键复制**：针对常见网络中断、插件执行异常、CSP 拦截提供分类排查建议，并提供带 Markdown 格式诊断报告的一键复制功能，极大简化运维排错与技术支持沟通成本。

### Refactor & Architecture

- **白板与备课互动课件属性模型统一 (Courseware Property Unification)**:
  - 备课画板与互动上课白板中，“互动网络课件”属性面板重构，统一使用 `coursewareUuid` 资产标识，移除冗余的 `resourceId` 字段；
  - 统一关联课件列表选择器与本地课件压缩包文件上传流程，规避参数歧义。

### Fixes & Security

- **CSP 内容安全策略内联脚本告警修复 (CSP script-src-attr Directive Hardening)**:
  - 规范内联事件处理器编写，消除浏览器控制台中关于 `script-src-attr 'none'` 的 Content Security Policy 告警。

### Fixes

- **课程编辑器无限重渲染导致崩溃 (Lesson Editor Infinite Render Loop / `Maximum update depth exceeded`)**:
  - **缺陷机理**：`usePluginPaletteItems` 的选择器体 `Array.from(state.items.values()).map(...)` 每次 `getSnapshot()` 都会分配一个新数组，而 `useStore` 底层是 `useSyncExternalStore`（用 `Object.is` 比较连续快照），于是 React 永远判定快照已变化、每次提交都强制重渲染，直到抛 `Maximum update depth exceeded`；只要渲染到备课组件库（`LessonPalette`）就会触发，教师端「课程编辑器」完全不可用；
  - **修复**：用 `useShallow`（`zustand/react/shallow`）包裹选择器，把不稳定数组收敛为引用稳定的结果；空列表与未安装插件场景下也不再重渲染；
  - **全仓扫描**：审查了 42 处 store 选择器，其余均返回单一字段（引用天然稳定），并确认仓库内无手写 `useSyncExternalStore`，此类缺陷仅此一处；
  - **范围说明**：该缺陷由本次未发布的「插件备课画板组件扩展插槽」一并引入（文件尚未提交），未影响任何已发布版本；
  - **回归测试**：新增 `palette-item-registry.test.tsx`，以“单组件 + 单 Hook + 空 Store、零写入”的最小场景锁定重渲染次数，直接复现并防住该缺陷。

- **全班专注锁定只读跟随模式 (Class Focus Lock — Read-only Follow Mode)**:
  - **视图切换唯一收口 (`setStudentViewStatus`)**：锁定期间学生端只放行 `lesson` 视图，其余跳转（Dashboard、作业工作区、通知直达等）统一拦截并弹出提示，修复此前“只禁用了返回学习面板按钮”导致学生仍可自由切换页面的问题；
  - **顶部导航与品牌区拦截 (`AppHeader`)**：`isStudentLocked` 下系统总览按钮与站点 Logo 不再跳转，改显锁图标与提示文案；
  - **标签页与教学环节锁定 (`StudentLessonInteractionPanel` / `StudentLessonContentPanel`)**：白板/互动课件/作业标签页与时间线环节切换在锁定期间禁用并提示，仅允许跟随教师端广播；
  - **白板只读模式 (`InteractiveWhiteboard readOnly`)**：隐藏顶部工具栏与页面栏，画布 `pointer-events: none` 禁止绘制，禁用右键菜单、浮动删除胶囊与元素删除，同时保留测验、随机点名、演示文稿等插件组件本体的交互能力；
  - **底层写入兜底**：`handleElementDelete` / `handleClearBoard` / `handleResetBoard` 与 `onElementDelete` / `onClearBoard` 在只读模式下直接拒绝，防止绕过 UI 触发白板清空；
  - **强制跟随教师步调**：锁定期间自动开启并禁用“跟随教师步调”开关，同时确保学生落在课节视图，不会被困在其他页面。

- **教师端组件最大化视图同步至学生端 (Teacher Fullscreen Component Sync)**:
  - **白板视图广播 (`broadcastFullscreen`)**：互动课堂中教师最大化/退出最大化白板组件时，通过 `teacher-broadcast-fullscreen` 将组件 id 与课节连同广播给授课班级；仅实时授课中控台启用，备课编辑器不打扰学生；
  - **班级房间投递 (`class-<classId>`)**：`register-student` 时服务端按 `class_students` 将学生 socket 加入其所属班级房间，教师端同时投递到课节房间与班级房间；因此学生无论处于课节白板、互动课件、作业标签页、**作业工作区**（此前会 `leave-lesson`）还是**从学习面板直接打开作业**，都能收到同步（先前仅靠课节房间会让这些学生漏收）；
  - **远程视图状态中心 (`whiteboardViewStore`)**：最大化状态提升至独立 Zustand Store，避免学生切到「互动课件/作业」标签页导致白板卸载后同步视图丢失；
  - **强制切回白板并全屏 (`useClassroomSocket`)**：学生收到广播后强制切换到交互式白板标签页并进入全屏遮罩，确保教师展示的组件可见；学生在自学其他课节或停留在学习面板时不会被打断；
  - **原路返回 (`interruptedViewRef`)**：中断前记录学生的视图状态、标签页、课节与被打开的作业，教师退出最大化后恢复原位（同一次中断只捕获一次，反复 maximize 不会覆盖最初位置）；作业答题状态位于 App 层因此原样保留；被拉出作业工作区期间会暂存并清空作业上下文，避免 `useAppPolling` 同时拉取两个房间的 `elements` 互相覆盖；
  - **不可本地退出 (`FullscreenOverlay dismissible`)**：教师同步视图隐藏关闭按钮、ESC 不生效，且插件自定义全屏渲染器拿到的 `onClose` 亦为空操作；
  - **防卡死收敛**：教师端离开白板（切中控台 Tab / 换课节 / 卸载）或被最大化元素被删除时广播 `elementId: null`，学生端重连时同样恢复被中断的视图，避免学生被永久困在不可退出的全屏中。

### Docs

- **Sphinx 文档零告警编译修复 (Zero-Warning Docs Build)**：
  - 将 `docs/reference/plugin-ui-extension-slots.md` 与 `docs/tutorials/plugin-development-tutorial.md` 中含 JSX 的代码块语言标记由 `typescript` 修正为 `tsx`，消除 `misc.highlighting_failure` 告警（TypeScript 词法器无法处理 JSX 语法，Pygments 回退到纯文本模式）；
  - 新增 `docs/release-notes/v0.3.17.md` 并挂载到 `docs/index.md` 发布日志 toctree 顶部。

## [0.3.16] - 2026-09-18

### Fixes & Frontend Plugin Host

- **修复前端插件加载器（`FrontendPluginHost`）裸模块导入解析缺失导致扩展点（如 `teacher.tab`）未注册缺陷**:
  - **裸模块导入转换器 (`transformBareModuleImports`)**：重构 `src/plugin-host/plugin-host.ts` 中针对动态 Blob URL 的 ESM 裸模块导入替换逻辑，由原本单一简单正则升级为全形态 ESM 导入解析转换器；
  - **覆盖复合导入与别名语法**：完整支持复合默认+具名导入（如 `import React, { useState, useEffect } from "react"`）、别名转换（如 `import { useState as useState2 }` 转为对象解构 `{ useState: useState2 }`，避免 `SyntaxError`）、命名空间导入（`* as React`）及多行/带注释语句；
  - **补全共享宿主依赖映射表 (`SHARED_MODULE_MAP`)**：将 `react-dom`、`react-dom/client`、`react/jsx-runtime` 纳入宿主共享依赖，并在 `src/main.tsx` 中向 `window.HostSharedDeps` 完整导出，彻底消除浏览器端 `TypeError: Failed to resolve module specifier "react"` 报错；
  - **解决插件左侧导航与控制台挂载异常**：修复如恋云课程 (`lianyun-course` / `019fa0e6-5f59-7718-b86e-b35c93ba39aa`) 等插件在启用后前端未能正常执行 `activate(ctx)` 的问题，使得 `teacher.tab`（恋云课程管理）在左侧导航栏的“扩展应用”列表和 `teacher.dashboard.widget` 正常生效。

### Fixes & Worker Runtime

- **修复 Worker 激活期异常导致 60 秒假超时挂起 (`WorkerTimeoutError`) 与 Watchdog 误熔断缺陷**:
  - **激活期快速失败机制 (Fail-Fast)**：在 `WorkerManager.createWorker()` 中对底层 `worker` 绑定激活期单次 `exit` 与 `error` 监听；当插件在初始化/激活初期发生未捕获异常、语法错误或进程退出时，主线程由原先盲等 60 秒改为在 5ms 内立即拒绝并抛出精准的 `WorkerActivateError`，彻底消除假超时误报；
  - **WorkerInstance 生命周期细化 (`status: activating`)**：将 `WorkerInstance.status` 扩展为包含 `'activating'` 状态，仅在收到 `'activated'` 消息后提升为 `'running'`；当 Worker 在激活期意外退出时，`WorkerRegistry` 仅清理资源并标记 `crashed`，严禁触发 Watchdog 自动重启风暴，避免并发争用与误触熔断器 (Circuit Breaker)；
  - **Worker 沙箱异步异常陷阱 (`unhandledRejection` / `uncaughtException`)**：在 `generateBootstrapCode` 中为 Worker 进程注入全局未捕获异常监听，格式化错误堆栈并通过 `parentPort` 发送结构化 `error` 消息后再优雅退出，避免由于插件未 `await` 异步 RPC 调用导致 Worker 进程无声暴毙；
  - **插件上下文心跳 API (`ctx.reportProgress`)**：在 `PluginContext` 中暴露 `reportProgress(stage?, message?)`，支持耗时全栈插件在执行数据迁移或大模型加载时向宿主上报进度并滑动续期激活超时窗口；
  - **数据库迁移 DDL 命名空间放行与异步时序保护 (`service-host.ts` & `worker-manager.ts`)**：
    - 在 `ServiceHost.assertDatabaseAccessAllowed` DDL 白名单中放行 `plugin_migrations` 表，解决 Worker 插件执行 `ctx.db.migrate` 自动初始化迁移记录表时因命名空间拦截报错的问题；
    - 在 Worker 沙箱 `dbApi.migrate` 的 `dbWrapper` 中加入 `pendingPromises` 队列并统一 `Promise.all`，保证即使插件开发者未显式 `await` 内部 SQL 也能安全按序完成迁移后再更新版本号；
    - 修复机房插件 `@aymwoo/plugin-lab-seat` 在 `activate()` 中异步 DDL 操作未捕获 Promise Rejection 导致的崩溃问题。

### Docs & Engineering

- **Sphinx 技术文档严苛零告警编译与全量同步**:
  - 修复 `docs/conf.py` 静态目录配置缺失引发的 `_static` 警告，补全 `docs/_static/.gitkeep`；
  - 修复 `docs/plugin/anchor-slots.md` 中未包裹 TSX 语法导致的 Pygments 词法分析器异常；
  - 清理 `docs/index.md` 目录树中重复引用的 `api/di-tokens`；
  - 全面同步前端共享依赖白名单、Worker 迁移 DDL 规则、心跳 API 及 `IAuthSessionBridgeToken` 字典规范。

## [0.3.15] - 2026-09-17

### Features & Security

- **LTI 1.3 协议支持与安全会话桥接体系 (LTI 1.3 Advantage & Safe SSO Integration)**:
  - **Iframe 嵌入安全管控 (`server.ts`)**: 新增 `LTI_ALLOWED_LMS_ORIGINS` 环境变量支持，配置后动态放行 CSP `frame-ancestors` 并自动关闭 `X-Frame-Options: SAMEORIGIN`，使平台可在受信任的 Canvas/Moodle 等 LMS 平台的 iframe 中无缝内嵌运行，未配置时保持原有严格同源防点击劫持策略；
  - **平台统一会话桥接服务 (`IAuthSessionBridgeService`)**: 在 DI 容器中注册统一会话创建服务，供特权认证插件安全同步用户并生成 `client_sessions`；
  - **网关跨域会话 Cookie 安全注入与特权守卫 (`PluginApiGateway`)**: 扩展 `PluginApiResponse` 支持 `sessionToken` 字段，且通过特权守卫限制仅声明依赖 `IAuthSessionBridgeService` 的认证插件可触发下发；网关在主线程自动写入符合第三方 Iframe 规范的 `SameSite=None; Secure; HttpOnly` 会话 Cookie，同时保持对非授权普通响应头 `Set-Cookie` 的严格黑名单剥离；
  - **官方参考插件研发 (`@openlearn/plugin-lti-provider`)**: 提供完整的 LTI 1.3 Tool Provider 独立插件参考实现，内聚 OIDC 3-Legged 登录状态机、RS256 JWT 验签与公钥托管（`/jwks`），支持 LTI Advantage 成绩回传 (`assignment.graded` 监听与 AGS 同步)。

## [0.3.14] - 2026-09-09

### Fixes & Packaging

- **修复 `npx openlearn-next` 运行时无法解析可选依赖 `xlsx` 的告警 (Cannot find package 'xlsx')**:
  - **根因分析**：`xlsx` 被误声明为 devDependency，但服务端 bundle 以 `--packages=external` 构建，`import('xlsx')` 被保留为运行时动态导入；devDependency 不会随发布包安装到消费者环境（含 npx 缓存目录），导致动态导入失败并打印 `[PluginHost] xlsx not available (optional)` 告警；
  - **修复**：将 `xlsx` 从 devDependencies 移至 dependencies，确保运行时动态导入可正常解析，插件共享模块正确注册 Excel 导入导出能力。

### Fixes & UI

- **修复教师端模拟学生（Student View）后无法返回教师端的交互缺失缺陷**:
  - 在 `App.tsx` 页面最顶部新增常驻醒目的全局模拟学生横幅（Top Impersonation Banner），提示当前模拟学生并提供常驻【退出模拟并返回教师端】操作；
  - 在 `AppHeader.tsx` 顶部导航栏的 `View as: [选择学生]` 下拉框旁接入 `setActiveRole` 并增加【返回教师端】快捷操作按钮；
  - 完善 `AppHeader.test.tsx` 单元测试，覆盖模拟状态退出按钮的渲染与触发回调。

## [0.3.13] - 2026-09-06

### Fixes & Packaging

- **修复 NPM 发布包中 `workspace:*` 协议未展开导致的 npx 无法运行异常 (EUNSUPPORTEDPROTOCOL)**:
  - **根因分析**：由于发包流程使用了原生 `npm publish`，原生 npm 不支持 pnpm monorepo 的 `workspace:*` 依赖协议，导致打入 tarball 的 `package.json` 中 `@openlearn/plugin-sdk` 依赖未展开为真实版本号；终端执行 `npx openlearn-next` 时报错 `npm error Unsupported URL Type "workspace:": workspace:*` 并退出；
  - **发布修复**：切换发布脚本为 `pnpm publish --no-git-checks`，打包阶段由 pnpm 自动将 `workspace:*` 解析并转译替换为真实版本号（`3.6.0`）；
  - **SOP 规范修正**：更新 `.agents/skills/openlearn-release-workflow/SKILL.md`，将平台主包发布命令标准化为 `pnpm publish --no-git-checks`。

## [0.3.12] - 2026-09-06

### Features & Security

- **插件 HTTP SSE 流式长连接通信体系 (`Plugin HTTP SSE Streaming & Safety Defense`)**:
  - **极简流式 API 契约 (`ctx.http.stream`)**:
    - 在 `IPluginHttpRouter` 中新增 `stream(path, handler)`（支持缺省动词匹配 GET/POST）与 `stream(method, path, handler)`（显式动词匹配）；
    - 向插件注入 `PluginStreamResponse` 写入器，支持 `stream.write(data, event?, id?)`、`stream.end()`、`stream.error(err)`、`stream.isClosed` 及 `stream.onClose(callback)`；
    - 自动格式化符合 W3C 标准的 SSE 事件流（支持多行文本 `data: line1\ndata: line2\n\n` 及 JSON 结构自动序列化）。
  - **Worker 隔离模式跨线程流式 RPC 通道**:
    - 新增跨线程流式协议族：`httpStreamStart`、`httpStreamChunk`、`httpStreamEnd`、`httpStreamError`、`httpStreamAbort`、`routesRegistered`；
    - Worker 内部通过轻量代理透明接收流式请求，实现毫秒级逐 chunk 双向 IPC 通信；
    - Worker 插件激活时自动将注册的路由元数据（包含 `isStream` 标识）上报至宿主，宿主毫秒级精准识别流式路由。
  - **反向中止与大模型算力熔断保护 (T-STR-04)**:
    - 客户端断开连接（如用户点击“停止生成”、刷新或关闭页面）时，主线程通过 `res.on('close')` 毫秒级向 Worker 派发 `httpStreamAbort`；
    - Worker 内部立即将 `stream.isClosed` 标记为 `true` 并触发 `stream.onClose(cb)` 监听器，强制打断 Worker 内正在进行的大模型 API 调用与循环任务，杜绝 Token 浪费与僵尸进程。
  - **纵深流式安全防御机制 (Threat Mitigations)**:
    - **T-STR-01 并发长连接硬上限**：单 IP 最多 5 个并发流，单插件最多 50 个并发流，超限返回 429 Too Many Requests，防御慢速长连接 Slowloris 攻击耗尽套接字与文件描述符；
    - **T-STR-02 超时看门狗阶梯防护**：首包超时（10s）+ 最大空闲超时（60s）+ 最大生存期（300s）看门狗守护，超时强制切断悬挂流；
    - **T-STR-03 单 Chunk 体积硬限制**：单个 SSE Chunk 大小硬限制 64KB，超限直接报错熔断，防内存洪峰 OOM；
    - **T-STR-05 标头强制固化**：安全网关强制注入标准 SSE 标头（`text/event-stream; charset=utf-8`、`no-cache`、`no-transform`、`keep-alive`、`X-Accel-Buffering: no`），禁止插件篡改高危 Header；
    - **T-STR-06 生命周期统一回收**：插件停用或热重载时，强制销毁所有未关闭的流并向 Worker 发送 abort，无任何悬挂遗留。
  - **开发者测试工具包赋能 (`@openlearn/plugin-test-kit`)**:
    - 导出 `createMockStreamResponse()` 工具函数与 `MockStreamResult` 接口，方便插件开发者在单测中无需启动 HTTP 服务器即可离线验证流式生成与中断逻辑。

## [0.3.11] - 2026-09-06

### Features & Security

- **插件安全 RESTful API 体系 (`Plugin RESTful API & Security Gateway`)**:
  - **声明与注册双轨模型**：
    - 在 `manifest.json` 中支持 `api.routes` 静态规则声明（支持 `method`, `path`, `auth`, `roles`, `rateLimit`），便于平台前置进行静态安全合规审计与网关路由规则初始化；
    - 插件在 `activate(ctx)` 生命周期中直接通过 `ctx.http`（`IPluginHttpRouter`）注册路由处理函数（支持 `get`, `post`, `put`, `delete`, `patch`, `all`），支持动态路径参数提取（`:param`）与自动包装 200 OK；
    - 统一路由端点挂载规范：`/api/plugins/:pluginId/*`。
  - **纵深安全网关防御中间件 (`PluginApiGateway`)**:
    - **系统保留路由避让**：核心动作（如 `config`, `toggle`, `contributions`）无缝避让放行至既有控制器；
    - **路径遍历防护 (Path Traversal Protection)**：对原始子路径及规范化路径执行双重 `..` 检测，识别并阻断路径遍历攻击（返回 400）；
    - **请求体硬限制 (DoS/OOM 防护)**：Payload 体积硬限制 1MB，超限直接返回 413，大文件上传强制引导至平台统一 `IStorageService` 通道；
    - **滑动窗口内存限流器 (Rate Limiter)**：基于客户端 IP + 插件 ID 滑动窗口统计，默认单端点 120 req/min 防刷，超限返回 429 与 `Retry-After`；
    - **前置认证与细粒度 RBAC 守卫**：支持 Session Cookie (`edu_os_token`) 与 `Authorization: Bearer` 凭证，校验用户角色权限，未登录返回 401，权限不符返回 403（`auth: false` 显式声明的公开路由直接放行）；
    - **响应安全清洗 (Response Sanitization)**：安全网关强制剔除插件试图向客户端注入的高危响应头（包括 `Set-Cookie`, `Access-Control-Allow-Origin`, `Content-Security-Policy` 等），从根本上消除会话劫持与策略篡改风险。
  - **Worker 沙箱隔离模式跨线程 RPC 通信**:
    - 在 Worker 运行时与宿主之间扩展 `httpRequest` / `httpResponse` 跨线程 RPC 消息协议；
    - Worker 线程通过纯只读不可变的 `PluginApiRequest` DTO 处理请求，完全杜绝沙箱插件直接持有或污染 Node.js 原生 Express Request/Response 对象的可能；
    - 内置 5000ms 超时熔断保护，防止 Worker 挂起耗尽宿主连接。
  - **Plugin Test Kit 与生命周期联动**:
    - `@openlearn/plugin-test-kit` 的 `createMockContext` 默认内置 `PluginHttpRouter`，让插件开发者开箱即用编写单元测试；
    - `ResourceTracker` 与插件生命周期深度绑定，插件卸载或热重载时自动清理路由器，彻底防止路由泄漏。

## [0.3.10] - 2026-09-06

### Features & CLI Utilities

- **`doctor` 增加 SDK 套件与插件版本全方位兼容性检测**：
  - **SDK Suite 综合检测**：同步校验 `@openlearn/plugin-sdk` 与 `@openlearn/plugin-test-kit` 的解析版本与安装形态；
  - **内置核心插件平台兼容性 (`Core Plugins`)**：零外部依赖校验全部 7 个核心内置插件的 `engines.openlearn` 约束是否被当前平台版本满足，防范版本互锁；
  - **已安装扩展插件引擎约束检测 (`Installed Plugins`)**：自研轻量级 SemVer 范围判定引擎，扫描 SQLite 数据库与本地插件清单，校验各扩展插件与平台版本（`engines.openlearn`）的兼容性，精准识别不兼容插件并提出预警。

### Fixes

- **SDK 依赖版本漂移治理**：根 `package.json` 的 `@openlearn/plugin-sdk` 从 `^3.5.2` 改为 `workspace:*` 并刷新锁文件（此前锁文件冻结在 npm 3.5.2 快照、`.pnpm` 残留 3.4.3，与 workspace 3.6.0 三版本并存，宿主实际解析版本随安装历史漂移）；移除 `pnpm-workspace.yaml` 中过期的 `minimumReleaseAgeExclude`（SDK 3.5.2）与不存在的 `packages/mfe-courseware` workspace 条目。
- **发布流程防漂移（npx 确定性依赖）**：`scripts/publish.sh` 与 CI `publish.yml` 在发布 `openlearn-next` 前将 `workspace:*` 重写为精确 SDK 版本并发布后还原——`server.cjs` 以 `--packages=external` 构建、运行时从消费者 `node_modules` 解析 SDK，精确 pin 保证 npx/npm 用户装到的 SDK 与构建时版本强一致。
- **`build-plugins.mjs` 与 SDK CLI / token-enforcer 策略对齐**：插件 ZIP 构建改为 `external: ['@openlearn/plugin-sdk']`，不再把构建时刻的 SDK 代码打进产物（否则运行时与宿主解析的 SDK 脱节，且可能被 token-enforcer 拒绝）。
- **插件更新检测补全**：`POST /api/plugins/:id/check-update` 在插件未声明市场更新源（`updateSource`）时回退扫描本地 `v2_plugins/*/manifest.json` 按 semver 对比，避免已安装插件停留在安装时刻的快照版本；移除 `one-click-update` 中指向已下架 research-workflow 插件的硬编码死路径分支，无 `downloadUrl` 时明确返回 400 并引导客户端 ZIP 直传；Plugin Center 更新弹窗对本地源更新显示"重新构建 ZIP 上传"提示而非热更新按钮。
- **`npx openlearn-next` CLI 参数解析与命令调度重构**：
  - 引入健壮的零外部依赖 token 解析器，支持位置无关的子命令调度（如 `openlearn-next --port 9001 doctor` 不再跳过子命令错误拉起服务端）；
  - 支持 `--key=value` 赋值语法（如 `--port=9000`、`--host=127.0.0.1`、`--cors=*`）；
  - 严格校验必需参数缺失（如单独输入 `-p` 或 `-p -H 127.0.0.1` 时明确报错退出，不再静默吞并后序参数）；
  - 增加未知/拼写错误命令拦截（如 `docotr` 给出友好报错提示，避免误启动服务）；
  - 增加停机信号超时保护至 35s，确保内核 30s 优雅关机流程完整执行。
- **`clean` 模式 SQLite WAL 预写日志安全落盘保护**：在默认清理模式下，清理 WAL/SHM 前先调用 SQLite `PRAGMA wal_checkpoint(TRUNCATE)` 将预写日志落盘至主库，消除直接 `unlinkSync` 导致未 checkpoint 事务静默丢失的高危隐患；同时兼容 Windows 下 `%LOCALAPPDATA%` NPX 缓存目录发现。
- **`doctor` 防版本漂移体系升级与一键自愈 (`--fix`)**：
  - **SDK Version 解析鲁棒化**：通过 Node 模块解析器与向上递归解析，兼容 npm/npx 依赖提升（hoisting）结构；
  - **平台内核核心版本防漂移**：自动校验 `package.json` 与 `packages/core/version.ts` 的版本一致性；
  - **NPX 缓存历史包防漂移**：扫描发现滞留的旧版本 NPX 缓存包并发出预警；
  - **一键自愈 (`--fix`)**：支持 `npx openlearn-next doctor --fix` 一键自动清理旧版 NPX 缓存、自动同步版本元数据、自动创建数据目录。
- **`backup` 目标目录自动递归创建**：在线冷备时若目标路径包含多级未创建目录，自动执行 `mkdirSync(recursive)` 防止 ENOENT 异常。
- **`openlearn-next doctor` 新增 SDK Version 一致性检查**：对比 `package.json` 声明与 `node_modules` 实际解析版本（支持 workspace 链接 / 精确 pin / caret 三种形态，零依赖实现），不一致时报错并给出修复指引。

### Docs

- `docs/index.md` 去除硬编码的 `@openlearn/plugin-sdk@3.5.2` 版本号，改为跟随平台 release。

## [0.3.9] - 2026-09-06

### Fixes

- **Worker 插件 DB 代理补齐 `exec` 转发**：`ctx.resolve(IDatabaseToken)` 的 worker 侧 stub 只暴露 `prepare/{run,get,all}`，worker 插件调用 `exec` 报 `rawDb.exec is not a function`。主侧 exec RPC 本就经过 `assertDatabaseAccessAllowed` 守卫（DDL 命名空间 + 核心表黑名单），此处补齐转发；返回 Promise（异步 RPC），与 `prepare*` 语义一致。
- **脚手架 CLI 不再把 SDK 自身打进插件 bundle**（随 `@openlearn/plugin-sdk` **3.6.0** 发布，详见其 CHANGELOG）：SDK dist 引用宿主侧 pino/express/uuid/semver，此前被整体打进插件产物导致脚手架项目构建失败、产物在宿主被 token-enforcer 拒绝；现保持 external，与平台官方 `build-plugins.mjs` 一致，独立脚手架无需手动补装依赖。
- 同步发布 `@openlearn/plugin-test-kit` **3.3.2**。

## [0.3.8] - 2026-09-06

### Features & CLI Utilities (CLI 运维诊断与便捷体验全景增强)

- **多网卡局域网 IP 自动侦测与终端直显 (`-H, --host`)**：
  - 启动服务时自动扫描全量本地网卡 IPv4 地址，终端同时以明亮高亮及可点击超链接形式输出 `Local` (http://localhost:PORT) 与 `Network` (http://192.168.x.x:PORT) 访问地址，极大简化教师多设备与局域网移动端机房联调流程；
  - 支持 `-H, --host <host>` 参数自定义监听网卡。
- **服务就绪后自动唤起浏览器 (`-o, --open`)**：
  - 跨平台零外部依赖实现（macOS `open` / Windows `cmd start` / Linux `xdg-open`），在 HTTP 服务器真正绑定就绪时精准静默自动弹出默认浏览器。
- **环境健康自检与就绪诊断工具 (`npx openlearn-next doctor`)**：
  - 新增独立子模块 [`cli-doctor.mjs`](file:///home/wuxf/Develop/openlearnv2/cli-doctor.mjs)，支持五维综合体检：
    1. Node.js 运行时版本校验（>= 20.0.0 严格检查）；
    2. 硬件架构、CPU 核心数与剩余空闲物理内存容量评估；
    3. 目标数据存储目录递归创建与原子写入/删除权限检测；
    4. 目标端口（默认 9000 或 `-p` 指定）占用状态与自动避让检测；
    5. 本机局域网网络接口连通性与 IPv4 地址检测。
- **一键在线冷备快照与安全回滚恢复 (`backup` / `restore`)**：
  - 新增独立数据运维子模块 [`cli-data.mjs`](file:///home/wuxf/Develop/openlearnv2/cli-data.mjs)；
  - `backup [file]`：基于 SQLite WAL 在线一致性快照技术，毫秒级导出当前平台完整快照；
  - `restore <file>`：还原前强制校验 SQLite Magic Header (`SQLite format 3\0`) 防坏文件注入，并自动为被覆盖主库生成 `.bak_<timestamp>` 安全回滚镜像副本。
- **终端免界面重置管理员密码 (`reset-admin`)**：
  - `reset-admin [--password <pwd>]`：在无需启动 Web 界面的情况下，直接对主库 `admin` 账号进行 bcrypt 加密重置，并在账号缺失时自动补全。
- **命令行轻量级插件状态速查 (`plugins [list]`)**：
  - 终端直接输出已安装插件的 ASCII 美化表格（包含插件 ID、版本、状态、加载模式），支持各类环境 schema 兼容。
- **一次性纯净临时沙盒演示模式 (`--demo` / `--temp`)**：
  - 在操作系统临时目录动态生成隔离沙盒环境运行，并在终端收到 `SIGINT` / `SIGTERM` 退出信号时，经由优雅关闭管道自动销毁沙盒数据，实现“零残留、用完即走”。
- **CORS 跨域白名单命令行透传 (`--cors <origins>`)**：
  - 命令行直接透传配置到 Express 与 Socket.IO 运行时跨域拦截器。
- **自动化测试保障**：
  - 新增专用自动化测试套件 [`packages/core/__tests__/cli-enhanced.test.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/cli-enhanced.test.ts)，全量 7 项测试保障。

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


