# OpenLearn Plugin Host Configuration Analysis (插件宿主配置分析报告)

## 1. Executive Summary (概述)

本报告审查 Plugin Host 的配置管理机制（`ConfigService`）、`plugin.json` 清单校验规则以及与 `PlatformConfigurationSystem` 的对接方案。

---

## 2. Configuration Structure & Validation (配置结构与校验)

1. **Manifest Configuration (`plugin.json`)**:
   - 定义插件基本元数据（`id`, `name`, `version`, `main`, `permissions`, `contributions`）。
2. **Runtime Configuration (`ConfigService`)**:
   - 包含 `autoActivate`, `sandboxTimeoutMs` (默认 10000ms), `maxMemoryMb` (默认 128MB)。
3. **Storage Configuration**:
   - `storage/plugins/` 目录用于插件 ZIP 解压与隔离存储。

---

## 3. Platform Integration Recommendation (接入推荐)

`PluginConfigService` 全局选项可直接对接 `PlatformConfigurationSystem` 节点，享有配置变更动态监听与只读保护。
