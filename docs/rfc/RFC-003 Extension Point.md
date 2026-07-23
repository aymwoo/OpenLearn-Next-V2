# RFC-003: Extension Point (扩展点与插件体系规范)

| Key | Value |
|---|---|
| **RFC Number** | RFC-003 |
| **Title** | Extension Point (扩展点与插件体系规范) |
| **Author** | OpenLearn Architecture Working Group |
| **Status** | Approved / Standard |
| **Target Version** | OpenLearn Platform v2.5+ |
| **Created At** | 2026-07-23 |

---

## 1. Executive Summary (概述)

RFC-003 定义了 OpenLearn 扩展点（Extension Point）与插件贡献体系的标准规范，涵盖扩展点定义（Extension）、贡献声明（Contribution）、自动发现机制（Discovery）及生命周期激活（Activation）。

---

## 2. Motivation & Context (背景与动因)

OpenLearn 支持第三方开发者及定制化教学工具通过插件扩展系统功能。为了防止插件直接侵入核心代码或随意越权，必须确立显式声明的扩展点与严格的激活沙箱。

---

## 3. Specification & Rules (规范与条规)

### 3.1 Extension (扩展点)
- 平台预定义四大标准扩展点：
  1. **Command Extension**: 注册新的 Action 命令 (`actionRegistry.register`)
  2. **Capability Extension**: 注册新的 Capability 规格 (`capabilityFrameworkRegistry.register`)
  3. **Process Handler Extension**: 注册后台长任务处理器 (`processManager.registerHandler`)
  4. **AI Prompt Template Extension**: 注册专属提示词模板 (`promptRegistry.registerPrompt`)

### 3.2 Contribution (贡献声明)
- 插件必须在 `manifest.json` 中使用 `capabilitiesProposed` 与 `requires` 显式声明其所请求的权限与依赖版本：
  ```json
  {
    "id": "@openlearn/plugin-custom",
    "name": "自定义教学插件",
    "version": "1.0.0",
    "requires": ["@openlearn/core:ICommandBusService@^1.0.0"],
    "capabilitiesProposed": ["lesson:write", "process:write"]
  }
  ```

### 3.3 Discovery (自动发现机制)
- `PluginHost` 与 `CapabilitySDK` 具备热扫描与自动发现能力：
  - 本地插件目录 `plugins/` 中的 ZIP 包与解压目录在启动时自动扫描 Manifest
  - 核心注册表提供 `discover(tagFilter)` 按标签索引能力扩展

### 3.4 Activation (激活生命周期)
- 插件激活流程统一为：
  `Manifest Scan` → `Dependency Resolution` → `Capability Check` → `Sandbox Instantiation` → `activate(ctx)` → `Ready`
- 停用流程统一为：
  `deactivate()` → `Resource Tracker Cleanup` → `Unregister Actions & Services` → `Disposed`

---

## 4. Architecture & Design (架构与设计)

```
[ Extension Activation Architecture ]
Plugin ZIP / File
   ↓ Scan Manifest
PluginHost (Validation & Security Check)
   ↓ Instantiate ESM
Plugin Context Injection (ctx.services & ctx.resolve)
   ↓ Call activate(ctx)
Register Commands & Capabilities into Core Registries
```

---

## 5. Backward Compatibility & Evolution (向后兼容性与演进)

现有 built-in 插件（如 `@openlearn/plugin-ai-planner`, `@openlearn/plugin-assignment-eval`）无需修改任何代码，其生命周期与扩展点注册均保持 100% 兼容。
