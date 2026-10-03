# Canvas Object Model 画布对象模型

画布对象的类型定义与坐标/变换原语。实现位于 `src/features/whiteboard/canvas-model/`。

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

> 完整定义见 `src/features/whiteboard/canvas-model/types.ts` 的 `CanvasObject`。
> 两个最易遗漏的字段：`layerId`（渲染必需，缺失则元素不渲染）与 `createdBy`（权限必需，缺失则无法做归属校验）。

---

## `type` 取值

`CanvasObject.type` 在类型层面**不受约束**（就是 `string`），**不存在**任何联合类型声明。合法取值只能从渲染侧的分派代码读出 —— 即 `src/features/whiteboard/InteractiveWhiteboard.tsx` 中 `renderElement` 系列的 `el.type === '...'` 判断分支。

宿主内置、当前确有渲染分支的取值（实测自上述文件的分支判断）：

| 类别     | 取值                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 绘图     | `pen`（自由画笔）、`highlighter`（荧光笔）、`rectangle`、`circle`、`shape`（`data.shape` 区分 `rect` / `circle`）、`text` |
| 教学组件 | `quiz`、`assignment`、`rollcall`、`code-sandbox`、`math-graph`、`presentation`、`html-applet`、`hello-world`                |
| 扩展     | `plugin`（`PluginCardRenderer`）、`page_meta`（页面配置元数据，非可见元素）                                                    |

> ⚠️ **不存在**的取值（勿凭直觉捏造）：`custom`、`geogebra-widget`、`timer` 在代码中零命中。`path` / `image` 仅作为**渲染缓存分类**（`rendering-engine/cache/cache-manager.ts` 的 `CacheManager.get/set` 参数）与**工具栏图标名**（`tool-system/default-tools.ts` 的 `createDefaultTool`）出现，**不是** `CanvasObject.type` 的取值。新增 `type` 取值需同时补上 `buildElementData` 的 `switch` 分支与 `renderElement` 的渲染分支。

渲染/工具栏侧的组件能力对照见 [whiteboard-runtime.md](whiteboard-runtime.md) §白板组件类型。
