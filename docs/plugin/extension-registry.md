# 统一扩展点与 UI 贡献点注册表 (Extension & Contribution Registry)

OpenLearn V2 提供了双层扩展点架构：
1. **`ContributionRegistry` (静态声明式)**：在插件未激活时解析 `manifest.json` 中的 `contributes` 配置，用于管理后台和主界面静态呈现图标与菜单。
2. **`UnifiedExtensionRegistry` (内核统一索引)**：对所有类型的扩展点（UI 插件组件、Activity 活动提供者、AI Actions、命令与 Capability）进行统一分类聚合索引。

---

## 1. `ContributionRegistry` 声明式贡献点

实现位置：[`packages/core/plugin-host/contribution-registry.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/contribution-registry.ts#L54)

### 槽位分类 (Slots)

| 槽位 Identifier | UI 挂载位置 | 配置字段说明 |
| :--- | :--- | :--- |
| `classroom.tool` | 课堂交互工具箱 | `id`, `name`, `icon`, `commandType`, `payload` |
| `teacher.tab` | 教师端主导航 Tab 标签 | `id`, `label`, `icon`, `position` |
| `teacher.dashboard.widget` | 教师端工作区仪表盘小组件 | `id`, `label`, `icon`, `position` |
| `student.view` | 学生端主导航视图路线 | `id`, `label`, `icon`, `route` |
| `student.lesson.tool` | 学生端课中互动小工具 | `id`, `label`, `icon` |

### API 使用示例
```typescript
const contributions = pluginHost.getContributionRegistry();

// 检索指定插件的所有贡献点
const pluginContribs = contributions.summary(pluginId);

// 检索指定槽位下的所有已注册贡献点（跨插件）
const allTeacherTabs = contributions.getTeacherTabs();
```

---

## 2. `UnifiedExtensionRegistry` 统一扩展索引

实现位置：[`packages/core/plugin-host/unified-extension-registry.ts`](file:///home/wuxf/Develop/openlearnv2/packages/core/plugin-host/unified-extension-registry.ts#L37)

### 核心 API 契约

```typescript
export interface IUnifiedExtensionRegistry {
  registerExtension(category: string, id: string, impl: unknown, meta?: Partial<ExtensionItemMetadata>): void;
  hasExtension(category: string, id: string): boolean;
  getExtension<T = unknown>(category: string, id: string): T | undefined;
  listExtensions(category?: string): ReadonlyArray<ExtensionItemMetadata>;
  listCategories(): ReadonlyArray<string>;
}
```

### 与 `ContributionRegistry` 的双向同步
当插件初始化或平台启动时，`UnifiedExtensionRegistry` 自动调用 `syncContributionRegistry()`，将所有声明式的 UI 贡献自动提升并归纳为统一分类，使得前端和 AI 智能体能以同一视角检索系统中的全量扩展组件。

---

## 3. 前端 UI 扩展槽与渲染流程

前端 React 层（位于 `src/components/PluginTabPanel.tsx` 与 `src/components/PluginCardRenderer.tsx`）：

1. 用户点击插件提供的 `teacher.tab` 菜单。
2. 前端根据 `manifest.id` 与 `staticRoute` 渲染安全 `<iframe>` 沙箱或动态组件。
3. `<iframe>` 内通过 Bridge SDK 发起 `vfs.read_file` 或跨插件 Command 命令。
4. 主应用路由与 CommandBus 处理请求并返回状态。
