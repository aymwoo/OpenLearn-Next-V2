# OpenLearn Whiteboard Plugin Integration Analysis (白板插件扩展扩展分析)

## 1. Executive Summary (概述)

本报告审查第三方插件在白板画布上的扩展机制（UI Slot, Custom Tools, Overlay Components）。

---

## 2. Plugin Extension Points (插件扩展点)

1. **Toolbar Extension**: 插件可通过 `ContributionRegistry` 在白板工具栏注入自定义按钮（如公式编辑器、科学计算器）。
2. **Canvas Layer Overlay**: 支持插件创建透明上层 Canvas Overlay，用于呈现特定领域的动效或互动小游戏。
3. **Custom Shape Handler**: 支持插件自定义 Shape 的序列化与反序列化渲染逻辑。
