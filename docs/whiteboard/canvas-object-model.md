# Canvas Object Model 画布对象模型

画布对象的概念模型与字段语义说明（运行时由 SQLite `whiteboard_elements` 表持久化，前端对应 `src/types/app.ts` 的 `WhiteboardElement`）。

> 📌 白板**子系统机制**（渲染器注册、协同同步、html-applet、防抖自动保存、公平抽问）见
> [architecture/whiteboard-subsystems.md](../architecture/whiteboard-subsystems.md)。
> 白板**运行时架构**（渲染管线、实时同步、扩展点）见 [whiteboard-runtime.md](whiteboard-runtime.md)。

---

## CanvasObject

画布中的每一个渲染元素均实现 `CanvasObject`：

```typescript
export interface CanvasObject<T = Record<string, unknown>> {
  readonly id: string;
  type: string; // 不受约束的 string：合法取值由渲染侧分支决定，见下方「type 取值」
  name: string;
  position: Point2D;
  rotation: number; // in degrees
  scale: Scale2D;
  size: Size2D;
  opacity: number; // 0.0 to 1.0
  visible: boolean;
  locked: boolean;
  zIndex: number;
  parentId?: string | null;
  groupId?: string | null;
  layerId: string; // 渲染必需：决定元素所在图层
  createdAt: number;
  updatedAt: number;
  createdBy: string; // 权限必需：元素归属者
  metadata: ObjectMetadata;
  payload: T;
}
```

> 该接口是**文档层的模型说明**：仓库中并不存在同名 TS 接口的实现文件（原
> `src/features/whiteboard/canvas-model/types.ts` 已于 Phase 0 删除，它从未被生产代码引用）。
> 运行时落库结构见 `migrations/000_initial_schema.sql` 的 `whiteboard_elements` 表；
> 前端元素类型见 `src/types/app.ts` 的 `WhiteboardElement`。
> 两个最易遗漏的字段：`layerId`（渲染必需，缺失则元素不渲染）与 `createdBy`（权限必需，缺失则无法做归属校验）。

---

## `type` 取值

`CanvasObject.type` 在类型层面**不受约束**（就是 `string`），**不存在**任何联合类型声明。合法取值只能从渲染侧的分派代码读出 —— 即 `src/features/whiteboard/InteractiveWhiteboard.tsx` 中 `renderElement` 系列的 `el.type === '...'` 判断分支。

宿主内置、当前确有渲染分支的取值（实测自上述文件的分支判断）：

| 类别     | 取值                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 绘图     | `pen`（自由画笔）、`highlighter`（荧光笔）、`rectangle`、`circle`、`shape`（`data.shape` 区分 `rect` / `circle`）、`text` |
| 教学组件 | `quiz`、`assignment`、`rollcall`、`code-sandbox`、`math-graph`、`presentation`、`learning_surface`、`hello-world`         |
| 扩展     | `plugin`（`PluginCardRenderer`）、`whiteboard.renderer`（插件自定义图元）、`page_meta`（页面配置元数据，非可见元素）      |
| 存量兼容 | `html-applet`（已废弃，见下方说明）                                                                                       |

> `html-applet` 已废弃：新建时服务端会把 `whiteboard.draw` 的 `html-applet` 统一转换成 `learning_surface` 并写入 Surface 记录。客户端保留它的渲染分支，仅用于历史课节 / 导入课程包里的存量元素，避免它们变成空白卡片。

> ⚠️ **不存在**的取值（勿凭直觉捏造）：`custom`、`geogebra-widget`。`timer` 没有宿主内置渲染分支，只能由插件通过 `whiteboard.renderer` 渲染，不要当成内置类型使用。历史上曾提及的 `path` / `image` 并非合法 `type` 取值。

新增 `type` 取值时，除 `renderElement` 的渲染分支外，还必须同步登记 `src/features/whiteboard/core/element-capabilities.ts` —— 默认尺寸、自动平铺、可见性、全屏只读交互与属性侧栏的尺寸形态都以这张表为单一真源（见 [whiteboard-runtime.md](whiteboard-runtime.md#白板组件类型)）。若该类型需要创建时默认值，还要补 `useWhiteboardDrop.buildElementData` 的对应分支。插件类型不改宿主分支，走 `whiteboard.renderer` 扩展点。
