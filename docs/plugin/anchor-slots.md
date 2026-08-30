# 锚点扩展槽目录 (Anchor Extension Slots)

> **版本**：v0.2.6+
>
> 锚点槽位（`anchor:*`）用于在宿主某个**原生按钮/元素的前后**插入插件按钮。与固定槽位（`teacher.tab`、`classroom.tool` 等）不同，锚点槽位由宿主在目标元素两侧各渲染一次，插件通过 `placement` 声明插在哪一侧。

## 1. 命名约定

```
anchor:{页面或区域}:{锚点 id}
```

- `{页面或区域}`：区分锚点所属界面，如 `whiteboard-toolbar`（白板工具栏）。
- `{锚点 id}`：宿主为某个原生按钮/元素起的唯一 id，由宿主定义并在此目录公布。
- 锚点 id 是**受治理的公开契约**：插件只能引用宿主已公布的锚点，不能凭空指定任意 DOM 位置。

## 2. 锚点清单

### 白板工具栏 (`whiteboard-toolbar`)

白板顶部工具栏（`src/features/whiteboard/components/WhiteboardToolbar.tsx`）已埋设以下锚点：

| 锚点槽位 | 锚点目标（原生按钮） | 说明 |
| :--- | :--- | :--- |
| `anchor:whiteboard-toolbar:presentation` | 「插入演示幻灯片」按钮 (`Presentation` 图标) | 前后各可插入一个插件按钮 |
| `anchor:whiteboard-toolbar:code-sandbox` | 「插入代码沙箱」按钮 (`Terminal` 图标) | 前后各可插入一个插件按钮 |
| `anchor:whiteboard-toolbar:math-graph` | 「插入数学函数图表」按钮 (`Activity` 图标) | 前后各可插入一个插件按钮 |
| `anchor:whiteboard-toolbar:courseware` | 「插入交互网页课件」按钮 (`Globe` 图标) | 前后各可插入一个插件按钮 |
| `anchor:whiteboard-toolbar:rollcall` | 「随机点名」按钮 (`UserCheck` 图标) | 前后各可插入一个插件按钮 |
| `anchor:whiteboard-toolbar:ai-tutor` | 「请求 AI 助教建议」按钮 (`Wand2` 图标) | 前后各可插入一个插件按钮 |
| `anchor:whiteboard-toolbar:grid` | 「开启/关闭网格背景」按钮 (`Grid` 图标) | 前后各可插入一个插件按钮 |

## 3. 插件使用方式

### 3.1 命令式注册（前端实际渲染走这条）

在插件前端 `activate(ctx)` 中调用：

```ts
ctx.ui.registerExtensionPoint('anchor:whiteboard-toolbar:rollcall', {
  id: 'my-button',
  label: '我的按钮',
  placement: 'before',            // 'before' | 'after'，缺省 'after'
  position: 50,                   // 同侧多插件按钮的排序权重（缺省 100，升序）
  component: () => import('./MyButton'),
});
```

### 3.2 同锚点多插件排序（`position`）

同一个锚点、同一侧（`before` 或 `after`）可能被多个插件注册按钮。宿主按 `position` **升序**渲染（缺省 `100`）：

```ts
ctx.ui.registerExtensionPoint('anchor:whiteboard-toolbar:rollcall', {
  id: 'btn-a', placement: 'before', position: 10,  // 排在前面
  component: () => import('./A'),
});
ctx.ui.registerExtensionPoint('anchor:whiteboard-toolbar:rollcall', {
  id: 'btn-b', placement: 'before', position: 90,  // 排在后面
  component: () => import('./B'),
});
```

> `position` 的排序范围是「同一 slot + 同一侧」内的**跨插件**排序，插件无法用 `position` 插到宿主原生按钮的「更前面/更后面」——与原生按钮的相对位置由 `placement` 决定。

### 3.3 声明式贡献（管理后台预览/枚举走这条）

在 `manifest.json` 的 `contributes` 中声明：

```json
{
  "contributes": {
    "anchor:whiteboard-toolbar:rollcall": [
      { "id": "my-button", "label": "我的按钮", "icon": "Sparkles", "placement": "before" }
    ]
  }
}
```

> 声明式贡献由后端 `ContributionRegistry` 存储，用于管理后台展示「该插件新增了 N 个按钮」；**实际渲染仍依赖命令式注册**。

## 4. 宿主如何新增锚点

在目标按钮前后各渲染一次 `ExtensionPointRenderer`，并指定 `placement`：

```tsx
<ExtensionPointRenderer slot="anchor:whiteboard-toolbar:xxx" placement="before" />
<button …原生按钮… />
<ExtensionPointRenderer slot="anchor:whiteboard-toolbar:xxx" placement="after" />
```

- `placement="before"` 一侧只渲染声明 `placement: 'before'` 的扩展。
- `placement="after"` 一侧只渲染声明 `placement: 'after'` 或未声明（默认）的扩展。
- 无扩展注册时渲染 `null`，不影响原有布局。

新增锚点后，请同步更新本文档第 2 节的清单。

## 5. 相关文档

- 声明式贡献点规范：[`plugin-manifest-spec.md`](./plugin-manifest-spec.md)
- 统一扩展点注册表：[`extension-registry.md`](./extension-registry.md)
