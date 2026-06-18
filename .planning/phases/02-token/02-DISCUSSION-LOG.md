# Phase 2: 现有能力 Token 化 — Discussion Log

**Date:** 2026-06-18
**Areas discussed:** 4
**Decisions captured:** 17 (D-01 ~ D-17)

---

## 领域 1: IService 接口设计与粒度

### Q1: 接口粒度划分
- **选项**: 一个子系统一个 IService / 合并部分小接口 / 仅暴露插件可见的接口
- **选择**: 一个子系统一个 IService（7 个独立接口）
- **理由**: 遵循单一职责原则，与 Phase 1 DI 设计一致

### Q2: 接口方法暴露范围
- **选项**: 暴露全部公开方法 / 只暴露插件安全方法 / 由你决定
- **选择**: 暴露全部公开方法
- **理由**: 接口即文档，完整性优于最小暴露

### Q3: 接口文件位置
- **选项**: packages/core/di/ / 分散在各子系统 / 新建 packages/core/services/
- **选择**: 集中在 packages/core/di/ 目录
- **理由**: 单一入口点，与现有 DI 目录一致

### Q4: DB Token 化 + 生命周期预留
- **选项**: DB 不做 Token 化 + 不预留 / DB 需 IDatabaseService + 预留 / 由你决定
- **选择**: DB 不做 Token 化 + 不预留 dispose/cleanup
- **理由**: DB 通过 kernelContainer.db 直接访问，Phase 4 生命周期由 PluginHost 管理

---

## 领域 2: Storage/AI 提取 + wrapped* 层处理

### Q1: Storage/AI 提取策略
- **选项**: 提取为独立 IService 实现类 / 仅接口+内联注册 / 保留在 PluginRuntime
- **选择**: 提取为独立 IService 实现类（StorageService, AIService）
- **理由**: 独立类可测试、可替换，Phase 5 可无缝换为 RPC proxy

### Q2: wrapped* 包装器处理
- **选项**: 保留包装器 + IService 代理 / 安全逻辑移至 IService / 不做改变
- **选择**: 保留包装器 + IService 代理
- **理由**: 两层分离——IService = 功能层，wrapped* = 安全层。PluginRuntime 不改动

### Q3: Storage/AI 实现文件位置
- **选项**: packages/core/di/ / packages/core/services/ / 接口 di+实现各子系统
- **选择**: packages/core/di/ 目录（与接口定义同一位置）

### Q4: 现有子系统需要适配器类？
- **选项**: 注册现有实例 + 类型断言 / 创建独立适配器类 / 由你决定
- **选择**: 注册现有实例 + 类型断言
- **理由**: 最小代码量，无冗余委托层

---

## 领域 3: 接口方法签名与类型规范

### Q1: 同步/异步方法处理
- **选项**: 接口统一 async / 区分同步异步 / 由你决定
- **选择**: 接口统一 async 返回 Promise
- **理由**: 符合 Phase 1 D-05，Worker RPC 代理无需修改接口

### Q2: any 类型减少策略
- **选项**: 渐进式收紧 / 接口 strict 类型 / 保持现有风格
- **选择**: 渐进式收紧——优先返回值类型
- **理由**: 先建立接口契约框架，后续 Phase 逐步收紧参数

### Q3: Storage/AI 方法签名
- **选项**: 基于现有 wrapped API / 收紧泛型 / 由你决定
- **选择**: 基于现有 wrapped API 提取
- **理由**: 与现有 PluginRuntime 接口一致，零修改

### Q4: Token 常量命名
- **选项**: ICommandBusServiceToken / CommandBusServiceToken / COMMAND_BUS_SERVICE
- **选择**: ICommandBusServiceToken（接口名 + Token 后缀）

---

## 领域 4: 注册时机/依赖顺序/Token 范围

### Q1: 注册时机
- **选项**: Kernel 构造函数中 / server.ts bootstrap / 混合
- **选择**: Kernel 构造函数中注册
- **理由**: 与子系统实例化时机一致，构造函数结束时所有服务可用

### Q2: 注册顺序
- **选项**: 按依赖层级注册 / 不声明依赖 / 仅非构造依赖声明
- **选择**: 按依赖层级注册——Layer 0/1/2 顺序
- **理由**: 符合 D-06 按依赖顺序注册，不会触发 MissingDependencyError

### Q3: IService 最终范围
- **选项**: 仅 7 个 / +PluginRuntime 管理 API / +Kernel 本身
- **选择**: 仅 7 个
- **理由**: ROADMAP Phase 2 明确范围，PluginRuntime 是 Phase 4 目标

### Q4: 是否需要测试
- **选项**: 需要——测试注册和解析 / 仅测试 Storage/AI / 不需要
- **选择**: 需要——测试接口注册和解析流程
- **理由**: Phase 1 建立测试文化，Phase 2 作为基石应可靠

---

## 总结

**17 个决策（D-01 ~ D-17）** 涵盖接口设计、提取策略、类型规范、注册顺序。
无延期想法——讨论完全在 Phase 2 范围内。

*Log generated: 2026-06-18*
