# Extension Registry 扩展点注册表

Extension Registry 机制在 `packages/core/plugin-host/contribution-registry.ts` 与 `UnifiedExtensionRegistry` 中实现，用于声明和管理 UI 扩展点与系统 Hook。

---

## Contribution 注册类型

第三方插件可在 `manifest.json` 或代码中通过 `ContributionConfig` 注册以下扩展点：

```typescript
export interface ContributionConfig {
  classroomTools?: ClassroomToolConfig[];
  teacherTabs?: TeacherTabConfig[];
  dashboardWidgets?: DashboardWidgetConfig[];
  studentViews?: StudentViewConfig[];
  studentLessonTools?: StudentLessonToolConfig[];
  helpDocs?: HelpDocConfig[];
}
```

---

## 扩展点机制使用示例

插件注册课堂工具按钮（ClassroomToolConfig）：

```typescript
ctx.contributions.registerClassroomTool({
  id: 'tool-quiz-bank',
  title: '题库抽题',
  icon: 'help-circle',
  onClick: async () => {
    // 触发抽题逻辑
  },
});
```

微前端 shell 自动扫描扩展点并在 Teacher/Student Workspace 相应位置动态渲染该组件。
