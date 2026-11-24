# 打字竞技场：学生建房、教师观战与现代化 UI

## 摘要

在现有“打字竞技场”插件上完成学生创建双人 PK / 多人竞速房间、学生房主开始与结束比赛、教师端实时发现学生房间并只读观战。同一课节允许教师房与多个学生房并存，沿用现有打字、实时排名、积分、成绩单和学期成绩同步流程。

同时使用 **Tailwind CSS CDN + daisyUI 4.12.10 + Lucide 0.468.0** 统一美化学生完整页、教师看板和随堂面板；不引入 React，不增加远程前端裸模块依赖，并保留本地 CSS 作为 CDN 不可用时的兜底。

## 当前状态分析

- `/home/wuxf/Develop/openlearn-plugins/typing-arena/src/index.ts` 已实现本轮服务端主体：
  - `rooms` 新装结构及旧表补列包含 `creator_role/creator_name`。
  - `isRoomOwner()`、`canControlRoom()`、`requireRoomController()` 已实现学生房主与教师只读权限边界。
  - `POST /rooms` 已允许服务端逻辑处理学生建房、自动加入及返回 `room + me`。
  - `findActiveRooms()`、`GET /active` 的 `rooms[]`、`GET /live` 的 `rooms[] + 可选 code` 已实现；旧 `room` 兼容字段保留。
  - 学生真实姓名继续由服务端查询平台 `students.name`，不回退到客户端传名。
- `/home/wuxf/Develop/openlearn-plugins/typing-arena/storage/game.html` 已加入现代 UI 库、建房表单、房间列表容器和房主按钮，但旧 JavaScript 尚未同步：
  - `showRoomCard()` 仍引用已删除的 `room-desc/btn-join`。
  - `bind()` 仍绑定不存在的 `btn-join`，会在初始化时阻断页面。
  - 多房间渲染、学生建房、房主开始/结束和动态图标刷新尚未接通。
- `/home/wuxf/Develop/openlearn-plugins/typing-arena/storage/teacher.html` 仍是单房间状态与旧视觉，尚无学生房列表、选中房间号和只读观战状态。
- `/home/wuxf/Develop/openlearn-plugins/typing-arena/storage/panel.html` 可继续使用兼容的 `/active.room`，功能无需扩展为多房管理，但需要统一视觉，并把“等待老师开始”调整为“等待房主开始”。
- `/home/wuxf/Develop/openlearn-plugins/typing-arena/manifest.json` 的 `/rooms`、`/room/start`、`/room/end` 仍仅声明 `teacher`，若不修改，宿主会在进入插件业务逻辑前拦截学生请求。
- `/home/wuxf/Develop/openlearnv2/server/utils/plugin-view-bridge.ts` 的 CSP 明确允许 `https:` 脚本与样式，因此上述固定版本 CDN 方案可用于沙箱视图；业务请求仍只走 `OpenLearnPluginBridge.api`。

## 实施修改

### 1. 服务端复核，不重复重构

文件：`/home/wuxf/Develop/openlearn-plugins/typing-arena/src/index.ts`

保留当前实现，仅按最终测试暴露的问题做必要修正，重点核对：

- 学生只能创建双人 PK / 多人竞速房，创建者身份来自 `req.actor.userId`，姓名为服务端权威查询结果；忽略学生提交的预置名册。
- 学生房创建者自动加入；学生只能控制自己的学生房，不能控制教师房或其他学生的房间。
- 教师/管理员可控制教师房，但对学生房即使重复调用开始、结束或幂等路径也不能改变状态。
- 新建房只结束同一 `creatorRole + createdBy` 的旧活动房，不收尾其他教师或学生的房间。
- `/active` 同时返回完整 `rooms[]` 和兼容 `room`；`/live?code=` 校验课节/班级范围，未传 `code` 时优先教师自己的教师房，不因学生新建房而自动切换教师看板。
- `liveRoomToJson(room, req)` 与房间摘要持续输出 `creatorRole/creatorName/isOwner/canControl`，前端只据此控制可见性，服务端继续做最终权限校验。

### 2. 学生完整页：多房间、建房与房主控制

文件：`/home/wuxf/Develop/openlearn-plugins/typing-arena/storage/game.html`

- 将旧 `showRoomCard()/joinActiveRoom()` 改为基于 `S.activeRooms` 的列表渲染与按房间号加入：
  - `/active` 优先读取 `res.rooms`，旧响应仅含 `res.room` 时降级为单元素数组。
  - 每张房卡显示房间号、模式、题库、状态、人数、创建者姓名，以及“教师房间 / 我的房间 / 同学房间”标签。
  - 已加入或已结束房间不显示可加入按钮；其他房间通过事件委托调用统一的 `joinRoom(code)`。
  - 保留 6 位房间号加入入口，并复用同一个加入函数。
- 新增 `createStudentRoom()`：读取 `create-mode/create-pack/create-duration/create-target`，提交当前 `lessonId/classId` 与房间配置；成功后调用 `enterRoom(res.room, res.me)`，期间防止重复提交。
- `loadPacks()` 同时填充 `solo-pack` 和 `create-pack`，无题库时两个入口均给出明确空态。
- 新增 `updateOwnerControls()`、`startRoom()`、`endRoom()`：
  - 仅房间模式且 `S.room.canControl === true` 显示房主操作区。
  - 等待状态可开始，未结束状态可结束；每次 `/room` 轮询后刷新按钮，避免只依赖创建响应。
  - 开始/结束后更新房间详情并继续复用 `pollRoom()` 的状态切换、自动提交和排名逻辑。
- `setStagePhase()` 将等待提示区分为“你是房主，可开始比赛”和“等待房主开始”；单人练习时隐藏房主操作区。
- `enterRoom()` 隐藏房间大厅并显示舞台；`leaveRoom()` 恢复大厅、清理本场状态并立即刷新活动房列表，不再用 `showRoomCard(null)` 清空列表。
- `bind()` 移除旧 `btn-join` 绑定，接上榜内加入事件、创建房间、房主开始和结束事件。
- 初始化及动态房卡、排名等内容更新后调用 `refreshIcons()`；所有动态文本继续使用 `esc()`，避免姓名、题库名注入 HTML。

### 3. 教师看板：学生房实时列表与只读观战

文件：`/home/wuxf/Develop/openlearn-plugins/typing-arena/storage/teacher.html`

- 状态增加 `rooms` 与 `selectedCode`；创建教师房后将 `selectedCode` 设为新房号，课节/班级切换时清空选中房间、房间列表和详情。
- 新增“学生房间”实时卡片列表，显示房主、房间号、模式、状态、人数及“观战”按钮；空态不显示误导性比赛信息。
- `refreshLive()` 继续使用唯一的 1.5 秒轮询：
  - 每次更新 `S.rooms = res.rooms || []` 并渲染学生房列表。
  - `selectedCode` 非空时请求 `live?lessonId=...&code=...`；点击观战只修改 `selectedCode` 并立即调用该函数。
  - 即使响应 `room=null` 也清理旧详情，避免切课后显示上一场房间。
- 点击“返回教师房间”清空 `selectedCode`，由服务端默认选择规则恢复当前教师自己的教师房；观战学生房时显示“学生房间 · 只读观战”和房主姓名。
- `updateRoomButtons()` 同时依据房间状态和 `S.room.canControl`：学生房的开始/结束按钮禁用并隐藏或明确置为只读；教师自己房间控制流程不变。
- 观战详情复用 `renderLive()` 的实时进度、速度、正确率、得分和完成状态；房间结束后仍复用 `loadScoreboard()`、`loadHistory()` 与现有成绩同步，不新增第二套数据链路。
- 房卡使用事件委托绑定观战，动态渲染后刷新 Lucide 图标。

### 4. 三视图统一现代化视觉

文件：

- `/home/wuxf/Develop/openlearn-plugins/typing-arena/storage/game.html`
- `/home/wuxf/Develop/openlearn-plugins/typing-arena/storage/teacher.html`
- `/home/wuxf/Develop/openlearn-plugins/typing-arena/storage/panel.html`

统一采用：

- Tailwind CSS CDN、daisyUI 4.12.10、Lucide 0.468.0；版本固定，不加载 `latest`。
- 现有明暗主题变量、靛蓝品牌色、柔和径向背景、圆角卡片、轻量阴影、清晰状态徽章、按钮悬浮反馈和响应式网格。
- 教师看板补齐与学生页一致的品牌页头、图标、卡片和表单样式；随堂面板保持紧凑，不增加额外导航或大块页面结构。
- 本地 CSS 保留完整布局、颜色和控件样式，CDN 失败时功能与可读性不受影响；不引入 React、Vue、打包型组件库或新的 npm 前端依赖。
- 中文正文、标签和按钮字号保持不低于 13px；动态内容仍使用现有转义规则，不依赖 CDN 才能执行业务逻辑。

### 5. 路由权限与兼容边界

文件：`/home/wuxf/Develop/openlearn-plugins/typing-arena/manifest.json`

- 仅将 `POST /rooms`、`POST /room/start`、`POST /room/end` 的 `roles` 改为 `["teacher", "student"]`。
- `GET /live` 继续仅允许教师；其他题库、积分、成绩和记录路由不变。
- 不新增 `capabilitiesProposed`，现有 `student-data:write/api:write/api:admin` 保持不变。
- `src/frontend.tsx` 继续读取兼容的 `res.active`，无需修改。
- `panel.html` 继续读取兼容的 `res.room`，完整多房选择与建房只在学生完整页提供。

### 6. 自动化测试与打包

文件：`/home/wuxf/Develop/openlearn-plugins/typing-arena/test-harness/smoke.test.ts`

复用 `createMockContext()` 与 `ctx.http.handle()`，增加带 `actor.userId` 的教师/学生请求辅助函数及以下业务用例：

- 学生 A 建房后自动加入，返回 `creatorRole=student/isOwner=true/canControl=true`。
- 学生 A 可开始、结束自己的房；学生 B 可加入但不能控制，非房主越权返回 403。
- 学生不能控制教师房；教师可读取 `/live?code=学生房` 但不能开始或结束学生房。
- 教师房与学生房可同时存在，`/active.rooms[]` 完整返回，旧 `/active.room` 仍存在且指向首个摘要。
- 同一创建者新建房只结束自己的旧房，不影响其他创建者；`/live.rooms[]` 与选中详情同时正确返回。
- manifest 的三条写路由对教师和学生开放，而 `/live` 仍不开放学生。
- 保留现有生命周期、路由、视图烟测；修复 `game.html` 后由视图测试覆盖初始化不存在 DOM 引用错误。

## 假设与决策

- 采用已确认的“学生房主管理”：学生创建者自动加入并负责开始/结束；教师对学生房只读观战，不接管。
- 同一教师或学生最多保留一个自己的活动房，但不同创建者之间互不影响。
- 教师未主动观战时仍优先看自己的教师房；学生建房不会抢切教师当前看板。
- 学生完整页支持多房选择和建房；随堂面板保持轻量，只展示兼容的最新活动房。
- 不修改 OpenLearnV2 平台源码，不改变既有积分和学期成绩数据模型，不提交 git commit。

## 验证步骤

1. 检查三个 HTML 的内联 JavaScript 语法，并确认不再引用已删除的 `room-desc/btn-join` 等元素。
2. 在插件目录依次运行：
   - `npx tsc --noEmit`
   - `npm run test:contract`
   - `npm test`
   - `npm run build`
3. 检查构建产物 `dist/openlearn-plugin-typing-arena.zip`：根目录包含 `manifest.json/index.js/frontend.js`，并包含 `storage/game.html`、`storage/teacher.html`、`storage/panel.html`。
4. 使用一教师、两学生在真实宿主验收：
   - 学生 A 建房并自动加入，学生 B 可通过列表或房间号加入。
   - A 可开始/结束；B 不能控制；教师列表实时出现该学生房。
   - 教师进入后持续看到进度、速度、正确率和得分，无法操作学生房，可返回自己的教师房。
   - 教师房与学生房并存且互不收尾；越权请求返回 403。
   - 结束后学习积分、教师成绩单、历史比赛及学期成绩同步正常，学生姓名显示真实姓名。
5. 检查明暗主题、窄屏布局及 CDN 不可用时的本地样式兜底；重新上传 ZIP 并停用/激活，确认旧房间数据按教师房迁移且无报错。若真实宿主或测试账号不可用，明确标注该项未执行，不以构建通过替代真机验收。
