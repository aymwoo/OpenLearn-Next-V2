# OpenLearn Plugin Host Permission Analysis (插件宿主权限分析报告)

## 1. Executive Summary (概述)

本报告分析现存插件清单中的权限声明（`plugin.json` -> `permissions`）与平台基础设施权限框架（`PermissionManager` PI-012）的映射关系。

---

## 2. Permission Mapping Strategy (权限映射策略)

插件权限属于扩展隔离权限，用于限制插件在沙箱内可访问的底层资源。在平台接入阶段，插件宿主权限将映射至平台权限分类的 `Infrastructure` 类别：

```
====================================================================
 Plugin Permission Symbol    | Platform Permission Category | Policy
====================================================================
 `vfs:read`                 | Infrastructure               | Allow / Deny
 `vfs:write`                | Infrastructure               | Deny (Requires Explicit Grant)
 `network:fetch`            | Infrastructure               | Allow
 `command:execute`          | Infrastructure               | Controlled Policy
====================================================================
```

---

## 3. Scope Boundary Confirmation (作用域边界确认)

插件权限仅防范恶意或越权插件调用底层系统 API，**绝对不包含用户业务 RBAC 逻辑，完全符合 PI-012 架构规约**。
