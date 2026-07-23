# RFC-005: Permission (平台权限与安全治理规范)

| Key | Value |
|---|---|
| **RFC Number** | RFC-005 |
| **Title** | Permission (平台权限与安全治理规范) |
| **Author** | OpenLearn Architecture Working Group |
| **Status** | Approved / Standard |
| **Target Version** | OpenLearn Platform v2.5+ |
| **Created At** | 2026-07-23 |

---

## 1. Executive Summary (概述)

RFC-005 定义了 OpenLearn 平台统一权限与安全治理规范，涵盖 Capability 访问权限（Capability Permission）、插件能力卫士（Plugin Permission & CapabilityGuard）及运行时角色控制（Runtime Role-Based Access Control）。

---

## 2. Motivation & Context (背景与动因)

在多角色（教师、学生、助教、AI Agent、社区插件）并发协作的课堂环境中，未经授权的指令执行或高风险操作（如删除课件、修改学生成绩、操作系统文件）可能造成重大数据与教学事故。必须确立平台级强权限校验规则。

---

## 3. Specification & Rules (规范与条规)

### 3.1 Capability Permission (能力访问权限)
- 能力在 `CapabilityDescriptor` 中必须申明允许的 `permission` 角色列表：
  `Teacher` | `Student` | `Plugin` | `AI` | `Observer` | `System`
- 当请求发起时，`CapabilityPipeline` 中的 `PermissionChecker` 自动比对 `context.actorRole`。若角色不在允许列表中，直接拦截并抛出 `Access Denied` 异常。

### 3.2 Plugin Permission (插件能力卫士)
- 插件在注册与运行 Action 命令时受到 `CapabilityGuard`（`packages/core/capability-guard/`）强校验：
  - 核心功能需匹配 `capabilityRequired`（如 `lesson:write`, `process:write`）
  - 高风险操作（如删除数据、修改成绩）必须声明 `isHighRisk: true`
  - 高风险操作必须经过教师审批网关（Approvals Gateway）批准后方可生效执行。

### 3.3 Runtime Permission (运行时角色控制)
- `ClassroomRuntimeKernel` 与 `TeachingCollaborationEngine` 维护统一的参与者角色控制：
  - **Teacher (教师)**：拥有一切课堂与引擎控制的最高指挥权
  - **Student (学生)**：受教师模式控制（只读/协同/自由练习）
  - **AI Agent**: 受 Tool 权限与审批网关限制，高风险操作需授权
  - **Plugin**: 沙箱权限隔离

---

## 4. Architecture & Design (架构与设计)

```
[ Multi-tier Security Architecture ]
Invocation Request / Command Execution
   ↓ (1. CapabilityGuard Check)
Check capabilityRequired (e.g. 'lesson:write')
   ↓ (2. PermissionChecker Check)
Check CapabilityRole (Teacher / Student / System)
   ↓ (3. High Risk Gate)
Is High Risk Action?
   ├── Yes → Approvals Gateway (Teacher Review)
   └── No  → Execute Action / Capability
```

---

## 5. Backward Compatibility & Evolution (向后兼容性与演进)

`CapabilityGuard` 与 `PermissionChecker` 双层防御保持完全兼容，既不破坏现有的内置插件权限声明，又能为未来拓展的 Teaching Agent 提供强安全边界。
