#!/usr/bin/env python3
"""
normalize.py — 把 docs 标题和代码目录名归一化为统一 key

规则:
- "Platform Kernel" → "platform-kernel" → "kernel" (canonical)
- "Command & Event Bus" → "command-event-bus" → "command-bus" + "event-bus" (split)
- "Bootstrap Pipeline" → "bootstrap-pipeline" → "bootstrap"
- "Workspace Runtime" → "workspace-runtime" → "workspace"

归一化 key = canonical-name（最具体的标识符）
"""
from __future__ import annotations

import re


# ---------------------------------------------------------------------------
# canonical table: directory-name → canonical-name
# 多个目录可能归一到同一个 canonical
# ---------------------------------------------------------------------------

# 所有可能出现的目录/标题名 → canonical
# 注意: 这是双向映射的右值
CANONICAL_OVERRIDES = {
    # 系统层
    "system-overview": "_macro_",  # 架构全景鸟瞰图, 不是具体 subsystem
    "system": "_macro_",
    "platform-kernel": "kernel",
    "kernel": "kernel",
    "layer-topology": "kernel",

    # 总线
    "command-event-bus": "command-bus-event-bus",
    "command-bus": "command-bus-event-bus",
    "event-bus": "command-bus-event-bus",
    "command-bus-runtime": "command-bus-event-bus",
    "event-bus-runtime": "command-bus-event-bus",

    # DI / Registry / 容器
    "dependency-injection": "di",
    "di": "di",
    "service-registry": "service-registry",
    "registry": "service-registry",

    # 能力网关
    "capability-gateway": "capability",
    "capability": "capability",
    "capability-system": "capability",
    "security-permissions": "capability",
    "ai-capability": "capability",

    # Bootstrap / Composition
    "bootstrap-pipeline": "bootstrap",
    "composition-root": "bootstrap",
    "bootstrap": "bootstrap",

    # DB
    "database-and-migrations": "db",
    "db": "db",

    # Configuration
    "configuration": "configuration",

    # Workspace / Whiteboard / Theme
    "workspace-runtime": "workspace",
    "workspace": "workspace",
    "student-workspace": "workspace",
    "teacher-workspace": "workspace",
    "ai-teacher-workspace": "workspace",
    "whiteboard-runtime": "whiteboard",
    "whiteboard": "whiteboard",
    "theming-system": "_crosscutting_",  # 跨多个文件的 cross-cutting concern,不是单一 subsystem
    "theming": "_crosscutting_",

    # Lesson / Education runtime
    "lesson-runtime": "lesson-engine",
    "lesson-engine": "lesson-engine",
    "lesson-workflow": "lesson-engine",
    "classroom-runtime": "classroom-runtime",
    "courseware": "_small-ui_",  # InteractiveCoursewareViewer, 小型 UI 组件

    # Presence / Collaboration
    "presence-collaboration": "presence-collaboration",
    "presence-engine": "presence-collaboration",
    "collaboration-engine": "presence-collaboration",

    # Analytics / Activity
    "analytics-engine": "analytics",
    "activity-ecosystem": "activity-ecosystem",

    # AI 套件
    "ai": "ai",
    "ai-classroom-context": "ai",
    "ai-action-api": "ai",
    "ai-prompt-registry": "ai",
    "ai-skill-registry": "ai",
    "ai-teaching-workflow": "ai",
    "ai-planner": "ai-plugins",
    "ai-submit-injector": "ai-plugins",

    # Plugins / 进程
    "plugin-host": "plugin-host",
    "plugin-runtime": "plugin-host",
    "plugin": "plugin-host",
    "process-manager": "process",
    "process": "process",
    "assignment-eval": "plugins",
    "builtin": "plugins",
    "management": "plugins",
    "vfs": "plugins",

    # Workers / Loaders
    "worker-runtime": "worker-runtime",
    "esm-loader": "esm-loader",

    # UI shell
    "navigation": "navigation",
    "command-palette": "command-palette",
    "quick-insert": "quick-insert",
    "interaction-runtime": "interaction-runtime",
    "modals": "modals",
    "resource-runtime": "resource-runtime",
    "shared": "shared",
    "student": "student",
    "teacher": "teacher",

    # 审计报告 / 元数据（不算 subsystem）
    "architecture-synchronization-report": "_meta_",
    "navigation-audit-report": "_meta_",
    "platform-foundation-audit-report": "_meta_",

    # 宏观描述文档 (鸟瞰图 / 跨切面 concern), 不算具体 subsystem
    # 这些归为 _macro_ 和 _crosscutting_, aligner 会过滤
    "_macro_": "_macro_",
    "_crosscutting_": "_crosscutting_",
}


# ---------------------------------------------------------------------------
# 归一化入口
# ---------------------------------------------------------------------------

def canonical(name: str) -> str:
    """返回 canonical key. 没找到返回原始 name."""
    n = name.lower().strip()
    # 去前后缀空白
    n = re.sub(r"[^a-z0-9-]+", "-", n).strip("-")
    return CANONICAL_OVERRIDES.get(n, name)


def is_excluded(canonical_key: str) -> bool:
    """判断 canonical key 是否应当被 aligner 排除."""
    return canonical_key.startswith("_") and canonical_key.endswith("_")