# 变更摘要 · PR !46 白板渲染回归防护

> 合并提交：`5ac9f8d5` · 基线：`04c18815` · 日期：2026-11-28

## 基本信息

| 项目       | 内容                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| PR         | [!46 refactor(whiteboard): 收口元素能力表与宿主契约，补齐渲染回归防护](https://gitee.com/aymwoo/openlearn-next/pulls/46) |
| 合并提交   | `5ac9f8d5`（merge commit）                                                                                               |
| 合并前基线 | `04c18815`                                                                                                               |
| 规模       | 34 个文件，+3208 / -329                                                                                                  |
| 源分支     | `feat/whiteboard-render-safety`（已删除）                                                                                |
| 数据库迁移 | 无                                                                                                                       |

## 背景

互动白板的元素元数据原本分散在五处：默认尺寸、全屏只读白名单、属性侧栏、全屏标题、`page_meta` 特判。此前 `html-applet` / `learning_surface` 的渲染分支被整体删除，元素仍在数据库里、画布上却只剩空白卡片，而逻辑测试全部通过。

本次改动把这些元数据收敛到一处，并补上能直接发现「渲染分支被删」的测试。

## 主要变更

### 1. 新增单一事实源

| 新增文件                                                   | 职责                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/features/whiteboard/core/element-capabilities.ts`     | 内置元素元数据：默认尺寸、自动平铺、可见性、全屏只读交互、属性侧栏形态、创建默认值 |
| `src/features/whiteboard/core/view-model.ts`               | 分页 / 全屏 / 只读优先级的纯函数决策层                                             |
| `src/features/whiteboard/host/whiteboard-host-contract.ts` | 教师课堂 / 学生课堂 / 备课编辑器的白板 props 契约与组装                            |

已接入的消费方：

- `useAutoTilingState` 默认尺寸
- `view-model` 全屏只读白名单
- `auto-tiling` 平铺黑名单
- `pagination-utils` / `InteractiveWhiteboard` 的 `page_meta` 可见性
- `WhiteboardPropertiesSidebar` 组件卡片与尺寸输入形态
- `WhiteboardFullscreenOverlay` 全屏标题
- `useWhiteboardDrop` 创建默认值

### 2. 恢复并加固渲染分支

- `html-applet`：存量兼容，使用 `CoursewareHost` 渲染；新建时仍由服务端转换为 `learning_surface`
- `learning_surface`：恢复 `LearningSurfaceHost` 渲染，未绑定 `surfaceId` 时给可读占位
- `title` / `question` / `description` 等 `data` 文本字段增加类型保护，非字符串回落到兜底文案，避免对象值导致整块画布崩溃

### 3. 宿主接线统一

`LazyWhiteboard`、`LiveClassroomView`、`LiveClassroomMiddleWorkspace`、`StudentLessonView`、`StudentLessonInteractionPanel`、`LessonEditorView`、`whiteboardHostBridge` 统一改用契约构造函数组装白板 props。

### 4. 文档

- `docs/whiteboard/canvas-object-model.md`
- `docs/whiteboard/whiteboard-runtime.md`

补充 `learning_surface`、标注 `html-applet` 仅存量兼容、声明能力表为单一真源，并替换文档中的 `HtmlAppletFrame` 为 `CoursewareHost`。

## 测试覆盖

| 测试                                          | 数量                | 覆盖点                                                               |
| --------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| `view-model.test.ts`                          | 46                  | 初始页、环节跟随、全屏优先级、只读策略矩阵                           |
| `element-capabilities.test.ts`                | 52                  | 类型唯一、默认尺寸、兜底、平铺/全屏一致性、创建默认值、文本/标题保护 |
| `whiteboard-host-contract.test.ts`            | 19                  | 三类宿主必需 props 与语义校验                                        |
| `whiteboard-element-capabilities-ui.test.tsx` | 28                  | 能力表 → 属性侧栏尺寸/卡片形态                                       |
| `whiteboard-courseware-render.test.tsx`       | 12                  | html-applet / learning_surface 内容源映射与占位                      |
| `whiteboard-render-smoke.test.tsx`            | 42                  | 全类型渲染 + readOnly / 同页共存 / 脏数据 / 缺省尺寸 / 最小化        |
| 服务端 `whiteboard-service.test.ts`           | 新增 5（文件共 21） | html-applet → learning_surface 转换链路                              |

## 行为与兼容性说明

- `html-applet` 新建入口不变：客户端仍提交 `html-applet`，服务端统一转成 `learning_surface`；客户端分支只服务历史数据。
- `timer` / `whiteboard.renderer` 没有宿主内置渲染分支，仅由插件经 `whiteboard.renderer` 扩展点渲染。
- 文本/标题类型保护只影响非字符串值，正常字符串数据行为不变。
- 无 API 破坏性变更，无数据库迁移。

## 验证结果

- `pnpm lint`（tsc）通过
- 合并后 `main` 上白板全量：**41 个文件 / 533 条测试通过**
- 服务端 `whiteboard-service`：21 条测试通过
- Prettier 通过
- ESLint 预算 5827 / 5839，0 error

## 回滚方式

```bash
git revert -m 1 5ac9f8d5
```
