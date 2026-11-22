# LearningSurface 教学内容 / 活动容器设计

> 状态：已实现（阶段 1–6 均已完成）
> 日期：2026-11-21
> 范围：白板、学案、作业与第三方渲染插件的统一内容/活动容器

本文定义 `LearningSurface`：一个可以承载演示文稿、HTML 课件、作业提交等内容或活动的统一宿主。它替换当前分散在 `html-applet`、学案 `interactive_courseware` 区块和作业业务组件里的多套渲染路径。

---

## 1. 目标与非目标

### 目标

- 一套数据描述（`LearningContentRef`）、一套运行时宿主（`LearningSurface`）、一套渲染插件协议（`LearningSurfaceRenderer`）。
- 白板一页可以放多个 Surface；学案每个活动最多一个 Surface。
- 统一进度、提交、评分、尝试次数的状态口径。
- 内置渲染器开箱即用，同时允许第三方插件通过 manifest 注册新的内容/活动类型。
- 复用现有课程/班级权限、沙箱、主题、字号与 LMS Bridge 能力。

### 非目标

- 本期不做课程级（`courses`）内容复用；绑定仍以课时/活动为单位。
- 不允许 Surface 嵌套 Surface。
- 不把第三方代码放进宿主 React 树；插件渲染器一律沙箱。
- 不在本文中确定作业迁移的每一张明细表，迁移清单由盘点阶段产出。

---

## 2. 命名

| 名称                        | 职责                                                          |
| --------------------------- | ------------------------------------------------------------- |
| `LearningContentRef`        | 内容/活动的数据描述：用什么渲染器、引用什么资源、少量展示配置 |
| `LearningSurface`           | 运行时宿主：一个实例的沙箱、生命周期、尺寸、事件、attempt     |
| `LearningSurfaceRenderer`   | 渲染插件：`inline` React 或 `sandbox` iframe/远程模块         |
| `learning_surface_attempts` | 学生 × Surface × 尝试的统一状态表                             |

避开 `ActivityProvider`：平台里的 `activity provider` 已指外部活动插件（`/api/activity-providers`），新概念不再复用该词。

---

## 3. 概念分层

```text
LearningContentRef        数据：这是什么内容 / 活动
        ↓
LearningSurface           运行时：一个实例，管沙箱、生命周期、尺寸、事件、attempt
        ↓
LearningSurfaceRenderer   渲染插件：inline 或 sandbox
```

放置策略由外层决定：

- **白板**：新增白板元素类型 `learning_surface`。一个元素对应一个 Surface，同一页放多个元素即为多实例；拖动、缩放、层级、协同与持久化复用现有白板能力。
- **学案**：`lesson_activities.surface_id`。一个活动最多一个 Surface，由列的唯一索引保证。

---

## 4. 数据模型

### 4.1 `learning_surfaces`

Surface 的稳定身份。容器删除后只做软删，attempt 仍可追溯。

| 字段                        | 类型             | 说明                                                                                     |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `id`                        | TEXT PK          | Surface id                                                                               |
| `lesson_id`                 | TEXT NOT NULL    | 所属课时；班级级作业为空字符串（阶段 2 已确认）                                          |
| `kind`                      | TEXT NOT NULL    | `whiteboard_element` / `lesson_activity` / `lesson_block` / `assignment` / `lesson_eval` |
| `owner_id`                  | TEXT NOT NULL    | 白板元素 id、学案活动 id、作业定义 id，或课时 id（`lesson_eval`）                        |
| `content_ref_json`          | TEXT NOT NULL    | `LearningContentRef`                                                                     |
| `deleted_at`                | INTEGER NULL     | 软删时间                                                                                 |
| `created_at` / `updated_at` | INTEGER NOT NULL | 时间戳                                                                                   |

索引与约束：

- `UNIQUE(kind, owner_id)`：一个容器最多一个 Surface。
- `INDEX(lesson_id, deleted_at)`：按课时查活跃 Surface。

### 4.2 容器侧

- 白板元素：`type = 'learning_surface'`，`data = { surfaceId }`，尺寸/位置仍由白板元素自身字段承载。
- 学案活动：`lesson_activities.surface_id`（迁移 `075`），并加部分唯一索引（一个活动最多一个 Surface）。历史活动保持未绑定，由活动保存时的 `surface` 字段按需创建。
- 学案首页块：`lesson_activity_blocks.surface_id`（迁移 `077`），Surface `kind='lesson_block'`。首页块不是活动，保留独立 `order_index` 与展示语义，不转成 `lesson_activities`。

### 4.3 `learning_surface_attempts`

| 字段                        | 类型                       | 说明                                   |
| --------------------------- | -------------------------- | -------------------------------------- |
| `id`                        | TEXT PK                    | Attempt id                             |
| `lesson_id`                 | TEXT NOT NULL              | 冗余，便于按课时查询                   |
| `surface_id`                | TEXT NOT NULL              | 关联 `learning_surfaces.id`            |
| `student_id`                | TEXT NOT NULL              | 学生                                   |
| `attempt_no`                | INTEGER NOT NULL           | 从 1 开始                              |
| `renderer_id`               | TEXT NOT NULL              | 创建时的渲染器                         |
| `status`                    | TEXT NOT NULL              | `in_progress` / `submitted` / `graded` |
| `auto_score`                | REAL NULL                  | 渲染器自动分                           |
| `score`                     | REAL NULL                  | 最终分（教师可覆盖）                   |
| `max_score`                 | REAL NULL                  | 满分                                   |
| `completion`                | REAL NULL                  | 0–1                                    |
| `state_json`                | TEXT NULL                  | 渲染器进度快照                         |
| `is_preview`                | INTEGER NOT NULL DEFAULT 0 | 教师预览                               |
| `submitted_at`              | INTEGER NULL               | 提交时间                               |
| `graded_at` / `graded_by`   | INTEGER/TEXT NULL          | 评分时间与评分人                       |
| `created_at` / `updated_at` | INTEGER NOT NULL           | 时间戳                                 |

约束与索引：

- `UNIQUE(surface_id, student_id, attempt_no)`
- `INDEX(lesson_id, student_id)`
- `INDEX(surface_id, is_preview)`

作业域全量迁移后，文件、版本、互评等明细表统一以 `attempt_id` 关联；量规仍属于活动/作业定义，不进入 attempt。

---

## 5. `LearningContentRef`

只存引用和轻配置，不存 HTML 正文。

```ts
interface LearningContentRef {
  rendererId: string;
  source: {
    kind: 'courseware' | 'resource' | 'assignment' | 'activity' | 'inline';
    id?: string;
  };
  config?: {
    title?: string;
    height?: number;
    aspectRatio?: string;
    maxAttempts?: number;
  };
}
```

约束：

- `source.kind !== 'inline'` 时必须有 `source.id`。
- `inline` 仅内置渲染器可用，并受体积上限与 sanitize 约束。
- `maxAttempts` 缺省表示不限；达到上限后宿主只读展示最近一次。

---

## 6. 渲染器协议

### 6.1 manifest 声明

```json
{
  "contributes": {
    "learning.surface": [
      {
        "id": "html_courseware",
        "label": "HTML 课件",
        "execution": "sandbox",
        "view": "surface.html",
        "capabilities": ["resizable", "progress", "submittable", "scorable"],
        "sourceKinds": ["courseware", "resource", "inline"],
        "defaultSize": { "width": 960, "height": 540 },
        "minSize": { "width": 320, "height": 240 },
        "aspectRatio": "16:9"
      }
    ]
  }
}
```

- `execution: 'inline'` 仅允许宿主内置渲染器；插件声明为 `inline` 时安装期拒绝或强制降级为 `sandbox`。
- `view` 与 `entry` 二选一；`view` 为插件静态目录下的相对路径。
- 安装期通过 zod schema 校验，SDK 自动生成类型。

### 6.2 运行时事件

宿主统一事件集：

```text
ready / resize / progress / submit / finish / error / state.patch
```

| 事件          | 方向            | 负载                                  |
| ------------- | --------------- | ------------------------------------- |
| `ready`       | Renderer → Host | `{ rendererId }`                      |
| `resize`      | Renderer → Host | `{ width, height }`                   |
| `progress`    | Renderer → Host | `{ completion?, state? }`             |
| `submit`      | Renderer → Host | `{ autoScore?, maxScore?, payload? }` |
| `finish`      | Renderer → Host | `{}`                                  |
| `error`       | Renderer → Host | `{ code, message }`                   |
| `state.patch` | Host → Renderer | 恢复进度时下发                        |

- `inline` 用回调，`sandbox` 用 `postMessage`，宿主归一化。
- `progress` 防抖写入 `state_json`；`submit` / `finish` 幂等。
- 能力不足时宿主隐藏对应 UI（例如没有 `submittable` 就不显示提交按钮）。

阶段 4 的 sandbox 实现（方案 A）：

```text
iframe → host: { channel: 'ol-plugin-view', type: 'surface-event', event: 'progress', payload }
iframe → host: { channel: 'ol-plugin-view', type: 'surface-event', event: 'submit',   payload }
host → iframe: { channel: 'ol-plugin-view', type: 'state.patch', payload }
```

插件侧调用 `bridge.surface.progress(data)` / `bridge.surface.submit(data)` / `bridge.surface.onStatePatch(cb)`。
宿主校验：来源 window、事件名、payload 为对象且 ≤ 64KB、`completion` 0–1（0–100 自动归一）、
`autoScore/maxScore` 非负；不接受插件传入的学生身份，attempt 归属由宿主会话决定。
`sandbox` 渲染器不直接调用平台 API，也不接触 attempt id。

---

## 7. 宿主行为

### 7.1 生命周期与 attempt

- 首次收到 `progress` / `submit` 时才创建 attempt；不产生空记录。
- 再次进入优先续用最近一条未提交 attempt；已提交时按 `maxAttempts` 决定新建或只读。
- `submit` / `finish` 必须在线确认；断网时允许本地草稿，禁止假提交。
- 教师预览写入 `is_preview = 1`，不计入学生统计、榜单和完成率。

### 7.2 权限

复用 `server/services/class-access.ts` 口径：

- 学生：只能读写自己的 attempt。
- 教师：可看本课/本班全部 attempt，可覆盖分数。
- 管理员：全量。
- Surface 本身不新增独立授权表。

### 7.3 尺寸与布局

- Renderer 声明 `resizable` / `minSize` / `aspectRatio` / `defaultSize`。
- 白板元素自由缩放，但不得小于 `minSize`。
- 学案固定全宽，高度取 `defaultSize.height` 或 `aspectRatio`。
- Surface 不允许嵌套另一个 Surface。

### 7.4 失败回退

- Renderer 不存在、manifest 无效或加载失败：显示占位与「内容暂不可用」，记录告警。
- 教师可替换 Renderer 或重新选择资源；学生侧不暴露内部错误堆栈。

### 7.5 删除

- 删除白板元素或学案活动：`learning_surfaces.deleted_at` 打标，attempt 保留。
- 删除课时：沿用现有课时级联删除，清理 Surface 与 attempt。
- 教师历史视图仍可读取已删除 Surface 的成绩。

---

## 8. API 草案

| 方法   | 路径                                               | 说明                                                    |
| ------ | -------------------------------------------------- | ------------------------------------------------------- |
| GET    | `/api/learning-surface-renderers`                  | 渲染器目录（内置 + 已激活插件）                         |
| GET    | `/api/learning-surfaces/:id`                       | 宿主读取 Surface 的内容引用                             |
| POST   | `/api/learning-surfaces`                           | 按容器创建 / 更新 Surface（`kind` + `ownerId`）         |
| PATCH  | `/api/learning-surfaces/:id`                       | 更新 Surface 的内容引用                                 |
| DELETE | `/api/learning-surfaces/:id`                       | 软删 Surface，attempt 保留                              |
| POST   | `/api/learning-surface-attempts`                   | 创建/续用 attempt，body 含 `surfaceId` / `assignmentId` |
| GET    | `/api/learning-surface-attempts/mine?lessonId=`    | 当前学生的 attempts（也支持 `assignmentId`）            |
| PATCH  | `/api/learning-surface-attempts/:id`               | 更新进度 / `state_json` / 教师评分                      |
| POST   | `/api/learning-surface-attempts/:id/submit`        | 提交，写 `auto_score`                                   |
| POST   | `/api/learning-surface-attempts/:id/attempts`      | 新建一次尝试（达到上限时拒绝）                          |
| GET    | `/api/lessons/:lessonId/learning-surface-attempts` | 教师查看全班                                            |

阶段 2 追加的作业写通道（旧 `/api/assignments/*` 写端点已 410）：

| 方法   | 路径                                                                   | 说明                     |
| ------ | ---------------------------------------------------------------------- | ------------------------ |
| POST   | `/api/learning-surface-assignments`                                    | 创建 / 更新作业定义      |
| POST   | `/api/learning-surface-assignments/generate`                           | AI 生成作业              |
| POST   | `/api/learning-surface-assignments/suggest`                            | AI 建议题目（不落库）    |
| POST   | `/api/learning-surface-assignments/create-suggested-quiz`              | 落库 AI 建议             |
| POST   | `/api/learning-surface-assignments/:id/files`                          | 上传附件                 |
| DELETE | `/api/learning-surface-assignments/:id/files/:fileId`                  | 删除未归档附件           |
| POST   | `/api/learning-surface-assignments/:id/submit`                         | 提交不可变版本           |
| POST   | `/api/learning-surface-assignments/:id/peer-review`                    | 提交互评                 |
| POST   | `/api/learning-surface-assignments/:id/assign-peer-reviews`            | 分配互评                 |
| POST   | `/api/learning-surface-assignments/:id/submissions`                    | 传统班级作业提交         |
| POST   | `/api/learning-surface-assignments/:id/submissions/:studentId/grade`   | 传统班级作业评分         |
| GET    | `/api/learning-surface-assignments/:id/attempts`                       | 教师查看作业全班 attempt |
| POST   | `/api/learning-surface-lessons/:lessonId/eval-submissions`             | 课时级随堂提交           |
| POST   | `/api/learning-surface-lessons/:lessonId/eval-submissions/:id/reviews` | 课时级互评               |

新 API 逐步替换旧作业接口；迁移完成前旧读接口保持不变。

---

## 9. 迁移与实施顺序

### 阶段 0：盘点

- 盘点 `assignments`、`assignment_submissions`、`plugin_submissions`、版本、文件、成绩、互评、量规的读写入口。
- 产出「旧表 → 新表 → 读写入口 → 回滚点」清单。

### 阶段 1：状态底座

- 迁移 `learning_surfaces`、`learning_surface_attempts`。
- 新 API 与权限校验；旧 API 暂不变。

### 阶段 2：作业域全量迁移

- 迁移 `073`：明细表补 `attempt_id`，存量提交、版本、文件、互评、评分与成绩历史在单事务内回填。
- 迁移 `074`：课时级随堂提交（`assignment_id IS NULL`）回填为 `kind='lesson_eval'` 的 Surface 与 attempt。
- 作业定义映射为 `kind='assignment'` 的 Surface；班级级作业 `lesson_id` 为空字符串。
- 旧写 API 统一 410，新写通道 `/api/learning-surface-assignments/*` 与 `/api/learning-surface-lessons/*` 接管；旧读 API 保持不变。
- 新写完成后由桥接服务同步 attempt 并回填 `attempt_id`，读侧口径一致。

### 阶段 3：宿主与放置

- 新增 `LearningSurfaceHost`（`src/features/learning-surface/`）：按 `surfaceId` 读取内容引用，按渲染器分发，并把渲染器的 `progress` / `submit` 事件懒创建 / 续用 attempt。
- 阶段 3 只接通内置 `html_courseware`，复用 `CoursewareHost` 的沙箱、访问 token、主题/字号与 Bridge 能力；其余渲染器显示占位，阶段 4 接入。
- 白板新增 `learning_surface` 元素：`data` 只存 `surfaceId`，尺寸 / 层级 / 协同沿用现有白板能力；属性栏可按渲染器与资源绑定内容（`kind='whiteboard_element'`，`owner_id` = 元素 id）。
- 迁移 `075` 增加 `lesson_activities.surface_id`；活动保存时按 `surface` 字段创建 / 更新 Surface，`surface: null` 或删除活动只软删 Surface，attempt 保留。
- 学案学生端与教师活动编辑器已接入宿主与绑定入口；学案包导入导出携带 `surface_content_ref_json`。

### 阶段 4：内置渲染器

- 前端新增渲染器注册表（`src/features/learning-surface/renderers/`）：内置 `html_courseware` / `presentation` / `assignment_submission` 提供 React 组件，插件渲染器按目录项（`pluginId + view`）走严格沙箱。
- `presentation` 复用 `RevealPresentationWrapper`：支持资源库 `.md/.pdf/.pptx` 与内联 Markdown（`config.markdown`，纯文本上限 64KB），翻页只通过 `onSlideChange` 上报，不写回元素。
- `assignment_submission` 覆盖 `source.kind='assignment'`（作业定义）与 `'activity'`（课时级随堂提交），学生侧复用作业提交弹窗与随堂提交面板，教师侧显示统计概览；attempt 由作业域桥接维护（`attemptMode='bridge'`），不重复创建。
- attempt 生命周期抽成 `useLearningSurfaceAttempt`：进入时恢复最近 attempt，`progress` 1 秒防抖，`submit` 幂等；只读态由宿主统一注入。
- 插件事件通道（方案 A）：沙箱脚本新增 `bridge.surface.progress / submit / onStatePatch`，宿主只接受来源匹配、事件名合法、payload ≤ 64KB 的消息；`init` 携带 `surfaceId / rendererId / state`，并通过 `state.patch` 回灌恢复进度。
- 安装期校验（`manifest-schema.ts`）：`contributes['learning.surface']` 使用 strict schema 校验 `id/label/sourceKinds/capabilities/defaultSize/minSize/aspectRatio`，`view` 必须是插件目录下的相对路径（拒绝穿越、协议与绝对路径），`view` 与 `entry` 至少声明一个。

### 阶段 5：存量内容迁移

- 迁移 `076`：白板 `html-applet` 元素原地改为 `learning_surface`，`data` 只保留 `surfaceId` 与几何 / 分页字段；元素 id 不变，快照行同步迁移，分页、层级、协同与 `resetWhiteboard` 不受影响。
- 来源映射：`coursewareUuid` → `courseware`；`resourceId` → `resource`；手写 `code` → 幂等落到 `system_resources`（`inline-mig-*`）后按 `courseware` 引用。无来源的空元素保持原样。
- 迁移 `077`：学案首页 `interactive_courseware` 块建 `kind='lesson_block'` 的 Surface，并写 `surface_id`；`content_json` 保持原样便于回退。
- 导入路径直接落新模型：课程包里的 `html-applet` 与学案包里的 `interactive_courseware` 在导入时即创建 Surface，避免产生新的存量。
- 导出路径：包格式 `version: 2` 起原生导出 `learning_surface`（携带 `contentRef`，不导出本机 `surfaceId`）；导入端在新环境重建 Surface。v1 的 `html-applet` 包仍按内容引用转换导入。
- 回滚：DOWN 从 Surface 的 `content_ref_json` 反序列化回旧结构；迁移前按项目流程执行 `pnpm db:backup` 整体备份。

### 阶段 6：验收与清理

- 删除旧渲染与编辑路径：`HtmlAppletFrame`、`CoursewarePropertiesModal`、`CoursewareEntrySelectorModal`、白板 `html-applet` 渲染 / 属性分支、调色板项、拖放默认数据、全屏旧分支与学案旧回退。
- 课件成绩浮层迁出为 `CoursewareScoresOverlay`，由 `html_courseware` 渲染器叠加，功能不随旧组件删除而丢失。
- `whiteboard.draw` 收到 `html-applet` 时由服务端自动转成 `learning_surface`（手写 HTML 幂等落到 `system_resources`），对 AI / 旧插件透明；无来源时返回 400。
- 保留：`CoursewareHost`（Surface 渲染器依赖）、课程包 v1 导入兼容（`html-applet` 自动转换）、迁移 DOWN（回滚）。课程包 v2 原生导出 Surface。
- 作品展示改为从 Surface 读取课件引用，并保留旧 `html-applet` 兼容分支。
- 验收：白板一页多 Surface、学案活动与首页块、作业提交 / 评分 / 互评、断网草稿、教师预览、快照恢复、课程包往返；全量门禁、docs 构建与 audit 通过。

---

## 10. 并行 P0：课堂运行时统一 `mode_pack_id`

`LearningSurface` 的工作区放置依赖模式包决议。当前课堂运行时仍有多处读取 `delivery_mode`：

- `LiveClassroomView` 顶栏/中栏 compact
- `TimelineRail` 新建环节默认类型
- `CourseManagement` 筛选与徽标
- `ModePackPrepShell` 的备课面

需要统一为：

```text
lesson.mode_pack_id → lesson.delivery_mode → whiteboard
```

并让上述消费点读取解析后的包能力（工作区、环节类型、备课面、adapter/channel），而不是只读两值枚举。

---

## 11. 已确认决策

| 维度            | 结论                                       |
| --------------- | ------------------------------------------ |
| 第一职责        | 统一宿主 + Provider                        |
| Provider 开放度 | 内置 + 插件注册                            |
| 数据形态        | 引用优先 + 轻配置                          |
| 学案粒度        | 每个 `lesson_activities` 活动最多一个      |
| 状态归属        | 新建统一状态表                             |
| 状态粒度        | 学生 × Surface × 尝试                      |
| 作业接入        | 先迁作业域，再上作业渲染器                 |
| 迁移范围        | 提交、文件、版本、互评、量规全部迁移       |
| API 策略        | 新 API 逐步替换旧 API                      |
| 白板落点        | 新元素 `learning_surface`，一页多个        |
| 学案落点        | `lesson_activities.surface_id`             |
| 执行形态        | `inline` + `sandbox`                       |
| 事件协议        | 标准事件集                                 |
| 插件声明        | manifest `contributes['learning.surface']` |
| 存量数据        | 一次性迁移                                 |
| 迁移方式        | 备份 + 单事务                              |
| 删除策略        | 软删 Surface、保留 attempt                 |
| 尝试次数        | 默认不限，可配置                           |
| 教师预览        | `is_preview=1`，不入统计                   |
| 评分            | 自动分 + 教师覆盖                          |

---

## 12. 待定事项

- 作业明细表清单与逐表迁移顺序（阶段 0 产出）。
- 匿名互评、小组作业与 Surface attempt 的映射方式。
- 无障碍与全屏、快捷键的统一约定。
- 课程级（`courses`）内容复用的优先级与时机。
