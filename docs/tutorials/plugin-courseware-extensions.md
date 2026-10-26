# 课件与教学环节扩展：画板图元、环节类型与进入条件

<!-- doc-version: sdk=3.7.0 -->

> **适用范围**：`@openlearn/plugin-sdk@3.7.0` / 平台 `v0.7.4+`
>
> 本页是[插件开发完全指南](plugin-development-tutorial) §6 的配套篇，讲**怎么把教学内容塞进备课与授课流程**：
> 备课画板图元（Palette Item）、自定义教学环节（Segment Type）、以及学生能否看到某个环节的进入条件（Gate）。
> 前端 bundle 的加载机制与上下文见[前端插件指南](plugin-frontend-guide)。
>
> ⚠️ 三节里的 `ctx.ui.register*` API 都需要**与宿主同 realm** 执行（`inline` / `worker` 模式的插件）。
> 第三方 ZIP 插件的 `frontend.js` 跑在隐藏 iframe 里，只能用**声明式**写法（`manifest.contributes`）；
> 每节末尾都给出了声明式等价写法，请优先用它。

---

## 1. 备课画板组件扩展（Palette Item，v0.3.17）

想为教师课程设计（备课画板）开发专用的教学内容卡片（物理仿真模拟器、3D 分子结构、AI 生成习题卡等），可以用 `ctx.ui.registerPaletteItem()` 注册画板组件：

```tsx
// src/frontend.tsx
import React, { useState } from 'react';
import type { PaletteItemComponentProps } from '@openlearn/plugin-sdk';

// ⚠️ SDK 目前**没有**导出 FrontendPluginContext（只在宿主源码 src/plugin-host/types.ts 里）。
// 插件侧要类型安全，就按实际用到的方法自己声明一个最小接口——
// 不要写 `import type { FrontendPluginContext } from '@openlearn/plugin-sdk'`，那是编译错误。
interface PluginFrontendCtx {
  pluginId: string;
  invokeCommand<T = unknown>(type: string, payload?: unknown): Promise<T>;
  ui: {
    registerPaletteItem(item: unknown): void;
    registerExtensionPoint(slot: string, config: Record<string, unknown>): void;
  };
}

// 1. 画布渲染组件（教师与学生双端均可见）
function MoleculeViewerCanvas({ elementId, lessonId, data, userRole, onElementUpdate }: PaletteItemComponentProps) {
  const [activeTab, setActiveTab] = useState<'view' | 'info'>('view');

  return (
    <div className="w-full h-full flex flex-col bg-slate-900 text-white select-none">
      <div className="p-2 border-b border-slate-800 flex justify-between items-center text-xs">
        <span className="font-semibold text-emerald-400">{data.title || '分子探究'}</span>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab('view')}
            className={`px-2 py-0.5 rounded ${activeTab === 'view' ? 'bg-emerald-600' : 'bg-slate-800'}`}
          >
            3D 视口
          </button>
          <button
            onClick={() => setActiveTab('info')}
            className={`px-2 py-0.5 rounded ${activeTab === 'info' ? 'bg-emerald-600' : 'bg-slate-800'}`}
          >
            结构参数
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        {activeTab === 'view' ? (
          <div className="text-center">
            <div className="text-2xl font-mono text-emerald-300 mb-1">{data.smiles || 'H2O'}</div>
            <div className="text-xs text-slate-400">渲染模式: {data.renderMode || '球棍模型'}</div>
          </div>
        ) : (
          <div className="text-xs text-slate-300 space-y-1">
            <div>分子式: {data.formula || 'H₂O'}</div>
            <div>摩尔质量: 18.015 g/mol</div>
          </div>
        )}
      </div>
    </div>
  );
}

// 2. 插件生命周期入口
async function activate(ctx: PluginFrontendCtx) {
  ctx.ui.registerPaletteItem({
    type: 'ext-chem/molecule-viewer',
    labelZh: '3D 分子探究器',
    labelEn: '3D Molecule Viewer',
    descriptionZh: '支持高保真 3D 分子轨道与化学键可视化交互',
    descriptionEn: 'Interactive 3D molecule model viewer',
    color: 'emerald',
    group: 'media', // 可放入 'media'、'interaction'、'quiz'、'code' 或自定义扩展分组
    defaultData: {
      title: '水分子结构模型',
      smiles: 'O',
      formula: 'H₂O',
      renderMode: 'ball-and-stick',
    },
    // 教师在备课画板点击卡片时，弹出的初始参数配置表单
    editFields: [
      {
        key: 'title',
        labelZh: '模型名称',
        labelEn: 'Title',
        kind: 'input',
        placeholderZh: '输入模型名称...',
      },
      {
        key: 'smiles',
        labelZh: 'SMILES 结构式',
        labelEn: 'SMILES Code',
        kind: 'input',
        placeholderZh: '例如 O, CCO, c1ccccc1...',
      },
      {
        key: 'renderMode',
        labelZh: '渲染样式',
        labelEn: 'Render Mode',
        kind: 'select',
        options: [
          { value: 'ball-and-stick', label: '球棍模型 (Ball & Stick)' },
          { value: 'cpk', label: '空间比例模型 (CPK)' },
          { value: 'wireframe', label: '线框网格 (Wireframe)' },
        ],
      },
    ],
    // 挂载到白板画布的渲染组件
    component: MoleculeViewerCanvas,
  });
}

async function deactivate() {
  // 宿主会在插件停用/卸载时自动清理已注册的 palette items
}

export default { activate, deactivate };
```

### 1.1 声明式等价写法（第三方插件用这条）

在 `manifest.contributes['editor.palette_item']` 中声明**数据型**图元（`type` / `labelZh` / `labelEn` 等），
宿主会桥接到同一 `paletteItemRegistry`，进入备课组件网格（搜索、收藏、分组）：

```json
{
  "contributes": {
    "editor.palette_item": [
      {
        "type": "ext-chem/molecule-viewer",
        "labelZh": "3D 分子探究器",
        "labelEn": "3D Molecule Viewer",
        "descriptionZh": "支持高保真 3D 分子轨道与化学键可视化交互",
        "color": "emerald",
        "group": "media",
        "defaultData": { "title": "水分子结构模型", "smiles": "O" }
      }
    ]
  }
}
```

需要自定义画布 `component` 时，只能走 `ctx.ui.registerPaletteItem`（即 `inline` / `worker` 插件）。

---

## 2. 备课环节类型扩展（Segment Type）

向备课时间线贡献自定义教学形态（如「科学探究实验」「随堂辩论」）：

```tsx
import { FlaskConical } from 'lucide-react';

// SDK 未导出 FrontendPluginContext（见 §1 说明），插件侧自行声明最小接口
interface PluginFrontendCtx {
  pluginId: string;
  ui: { registerSegmentType(type: Record<string, unknown>): void };
}

async function activate(ctx: PluginFrontendCtx) {
  ctx.ui.registerSegmentType({
    id: 'scientific_experiment',
    labelZh: '科学探究实验',
    labelEn: 'Scientific Experiment',
    icon: FlaskConical,
  });
}
```

注册后会出现在 `SegmentEditorCard` 的「教学形态」下拉中；插件停用时宿主按 `pluginId` 自动回收。

### 2.1 声明式等价写法

需同时提供 `labelZh` 与 `labelEn`，否则不会桥接为环节类型：

```json
{
  "contributes": {
    "editor.timeline_segment": [
      {
        "id": "scientific_experiment",
        "labelZh": "科学探究实验",
        "labelEn": "Scientific Experiment",
        "icon": "FlaskConical"
      }
    ]
  }
}
```

> `editor.timeline_segment` 作为 **UI 附加面板** 槽位时，在 `activate` 里 `registerExtensionPoint` 挂载 React 组件即可；
> 仅当 contributes 条目含双语 label 时才会桥接为环节类型。

---

## 3. 教学环节进入条件（Gate）

自定义环节**类型**只影响备课下拉和附加面板。学生能不能看到教师推进到的环节，由环节对象上的 `gates` 决定。
插件用声明式贡献加只读命令参与判定，这样在进程内和子进程隔离下都能工作：

```json
{
  "contributes": {
    "segment.gate_type": [
      {
        "id": "lab_report_ready",
        "labelZh": "实验报告已交",
        "labelEn": "Lab report submitted",
        "commandType": "judge"
      }
    ]
  }
}
```

`activate` 里 `actionRegistry.register`（`capabilityRequired: 'segment:gate_eval'`，`exposeToAgent: false`）
并 `commandBus.registerHandler`。处理函数**只读**，返回 `{ allowed, reason?, progress? }`。

宿主判定超时 **1500ms**，超时或异常一律**拒绝进入**（fail-closed）。不要调用 `registerGuard` 来拦直播环节 ——
guard 是另一条通道，与环节 gate 不通用。

---

## 相关文档

- [插件开发完全指南](plugin-development-tutorial) —— 主教程（manifest、命令、事件、安全、发布）
- [前端插件指南](plugin-frontend-guide) —— 前端 bundle 加载、上下文、扩展点、构建配置
- [UI 扩展槽位参考](../reference/plugin-ui-extension-slots) —— 各槽位与 Props
- [前端沙箱能力边界](../plugin/frontend-sandbox-capability-boundary) —— 第三方插件为什么不能带组件
