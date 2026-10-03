#!/usr/bin/env python3
"""
extractors.py — 从 docs 和代码里提取结构化事实

输入: docs/*.md, packages/core/, packages/plugins/, src/, server.ts
输出: JSON (intermediate/extracts.json)

设计原则:
- 不调任何 AI
- 只用正则 / 简单解析
- 所有数据带 source ref (path:line)
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class DocFact:
    name: str
    kind: str  # subsystem | module | interface | command | table | api | env_var
    source_path: str
    line: int
    excerpt: str = ""


@dataclass
class CodeFact:
    name: str
    kind: str
    source_path: str
    line: int
    excerpt: str = ""


@dataclass
class Extracts:
    doc_facts: list[DocFact] = field(default_factory=list)
    code_facts: list[CodeFact] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Doc side — parse Markdown
# ---------------------------------------------------------------------------

# 匹配形如 "## Subsystem: command-bus" 或 "## command-bus" 的标题
# Subsystems referenced from docs/, by filename pattern.
# Each entry: (filename-stem → canonical-name, kind, description)
# filename-stem is matched against basename without .md, lowercase.
DOC_SUBSYSTEM_BY_FILE = {
    "platform-kernel":            ("kernel",                   "subsystem"),
    "command-event-bus":          [("command-bus", "subsystem"),
                                   ("event-bus", "subsystem")],
    "dependency-injection":       ("di",                       "subsystem"),
    "service-registry":           ("service-registry",         "subsystem"),
    # 注意: capability-gateway.md 一篇同时描述三个子面（能力网关 / 运行时 / 治理）。
    # 早先这里把同一个键写了三遍，Python 字典字面量只保留最后一个，前两个映射被静默
    # 覆盖 —— 直接导致 capability / capability-runtime 被误报成"代码有文档无"。
    # 现改为各自独立的文件名入口，避免重复键。
    "capability-gateway":         ("capability-governance",    "subsystem"),
    "capability-system":          ("capability",               "subsystem"),
    "capability-runtime":         ("capability-runtime",       "subsystem"),
    "composition-root":           ("bootstrap",                "subsystem"),
    "bootstrap-pipeline":         ("bootstrap",                "subsystem"),
    # configuration.md 记录的恰恰是"平台没有集中配置子系统"这一事实
    # （packages/core/configuration/ 已于 207ca36 作为死子系统整体删除）。
    # 它不对应任何代码目录，因此**不**登记为 subsystem 事实 —— 否则工具会
    # 永远报一个 MISSING_IN_CODE，而文档本身是正确的。
    "database-and-migrations":    ("db",                       "subsystem"),
    "security-permissions":       ("capability",               "subsystem"),
    "workspace-runtime":          ("workspace-runtime",        "subsystem"),
    "whiteboard-runtime":         ("whiteboard-runtime",       "subsystem"),
    "lesson-runtime":             ("lesson-engine",            "subsystem"),
    "presence-collaboration":     [("presence-engine", "subsystem"),
                                   ("collaboration-engine", "subsystem")],
    "system-overview":            ("system",                   "subsystem"),
    "theming-system":             ("theming",                  "subsystem"),
    "layer-topology":             ("kernel",                   "subsystem"),
    "classroom-runtime":          ("classroom-runtime",        "subsystem"),
    "interaction-runtime":        ("interaction-runtime",      "subsystem"),
    "resource-runtime":           ("resource-runtime",         "subsystem"),
}


def _kebab(name: str) -> str:
    """把 CamelCase 目录名转成 kebab-case（与文档文件名的风格一致）。"""
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", name)
    return s.replace("_", "-").lower()


def extract_doc_facts(docs_root: Path, packages_root: Path) -> list[DocFact]:
    """Heuristic: each docs/architecture/<name>.md describes one subsystem.

    Also scans inline text for explicit subsystem mentions (kernel, di, etc).
    Also scans docs/<other>/<name>.md (e.g. docs/plugin/, docs/ai/) for
    subsystem-focused docs.
    """
    facts: list[DocFact] = []
    if not docs_root.exists():
        return facts

    seen: set[tuple[str, str, str]] = set()

    # 代码侧真实存在的子系统名（packages/core/* 与 src/features/* 的顶层目录）。
    # 用于判断"未登记的文档"是否真的在描述一个代码子系统：只有能对上代码目录的
    # 文档才回退为子系统事实，否则它只是分类页/说明页，强行纳入只会制造噪声。
    code_subsystems: set[str] = set()
    for base in (packages_root / "packages" / "core", packages_root / "src" / "features"):
        if base.exists():
            for child in base.iterdir():
                if child.is_dir() and not child.name.startswith(("__", ".")):
                    code_subsystems.add(child.name.lower())
                    code_subsystems.add(_kebab(child.name))
    # 长名优先：canvas-object-model 应对上 whiteboard 而不是 canvas
    code_subsystems_sorted = sorted(code_subsystems, key=len, reverse=True)

    def _matches_code(stem: str) -> str | None:
        """返回该文档 stem 命中的代码子系统 canonical key，未命中则 None。"""
        head = stem.split("-")[0]
        for cand in code_subsystems_sorted:
            if cand == stem or cand == head or stem.startswith(cand + "-") or cand.startswith(stem + "-"):
                return cand
        return None

    # (1) File-based: one fact per architecture doc
    arch_dir = docs_root / "architecture"
    if arch_dir.exists():
        for md in sorted(arch_dir.glob("*.md")):
            stem = md.stem.lower()
            # 映射表优先；未登记的文件不再被静默跳过，而是回退到由文件名推导的
            # canonical key —— 但仅当它确实能对上某个代码子系统时才纳入比对，
            # 避免"白名单外的文档完全不参与"与"分类页全部变噪声"两个极端。
            targets: list[tuple[str, str]] = []
            if stem in DOC_SUBSYSTEM_BY_FILE:
                entry = DOC_SUBSYSTEM_BY_FILE[stem]
                # 一篇文档可能同时描述多个代码子系统（如 command-event-bus 同时覆盖
                # command-bus 与 event-bus），因此允许映射值为"目标列表"。
                targets = entry if isinstance(entry, list) else [entry]
            else:
                hit = _matches_code(stem)
                if hit is not None:
                    targets = [(hit, "subsystem")]
            if not targets:
                continue
            # find first heading as excerpt
            excerpt = ""
            try:
                for line in md.read_text(encoding="utf-8", errors="replace").splitlines():
                    if line.startswith("#"):
                        excerpt = line.strip()[:160]
                        break
            except Exception:
                pass
            for canonical, kind in targets:
                key = (canonical, kind, str(md))
                if key in seen:
                    continue
                seen.add(key)
                facts.append(DocFact(
                    name=canonical,
                    kind=kind,
                    source_path=str(md),
                    line=1,
                    excerpt=excerpt,
                ))

    # (1b) File-based: docs/<other>/<name>.md also describes subsystems
    # E.g. docs/plugin/plugin-architecture.md describes plugin-host
    #      docs/ai/ai-runtime.md describes ai subsystem
    #      docs/analytics/learning-analytics-engine.md describes analytics-engine
    FILE_NAME_TO_CANONICAL = {
        # docs/plugin/
        "plugin-architecture": "plugin-host",
        "plugin-lifecycle": "plugin-host",
        "plugin-registry": "plugin-host",
        "extension-registry": "plugin-host",
        "plugin-manifest-spec": "plugin-host",
        "plugin-documentation-report": "plugin-host",
        # docs/ai/
        "ai-runtime": "ai",
        "ai-documentation-report": "ai",
        # docs/analytics/
        "learning-analytics-engine": "analytics-engine",
        # docs/reference/
        "activity-ecosystem": "activity-ecosystem",
        "plugin-capability-matrix": "esm-loader",  # 描述 plugin 能力矩阵, 涉及 esm-loader
        # docs/lesson/ 与 docs/workspace/ —— 文件名与代码目录不同名，需显式登记，
        # 否则前缀匹配会漏掉这两个子系统（曾被误报为"有代码无文档"）。
        "lesson-runtime": "lesson-engine",
        "lesson-lifecycle": "lesson-engine",
        "workspace-runtime": "workspace",
        # docs/core/（已废弃删除，保留映射以兼容历史链接）
        "platform-kernel": "kernel",
    }
    for md in sorted(docs_root.rglob("*.md")):
        if any(p.startswith(("_build", "node_modules")) for p in md.relative_to(docs_root).parts):
            continue
        # Skip architecture/ (already handled above)
        if "architecture" in md.relative_to(docs_root).parts:
            continue
        stem = md.stem.lower()
        # 同上：表未登记时，仅当能对上代码子系统才纳入，避免分类页造成噪声。
        if stem in FILE_NAME_TO_CANONICAL:
            canonical = FILE_NAME_TO_CANONICAL[stem]
        else:
            hit = _matches_code(stem)
            if hit is None:
                continue
            canonical = hit
        key = (canonical, "subsystem", str(md))
        if key in seen:
            continue
        seen.add(key)
        excerpt = ""
        try:
            for line in md.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.startswith("#"):
                    excerpt = line.strip()[:160]
                    break
        except Exception:
            pass
        facts.append(DocFact(
            name=canonical,
            kind="subsystem",
            source_path=str(md),
            line=1,
            excerpt=excerpt,
        ))

    # (2) Inline mentions: scan all docs for capitalized subsystem names
    # (kernel, command-bus, event-bus, di, registry, db, ...)
    INLINE_PATTERNS = [
        (re.compile(r"\bCommandBus\b"),                  "command-bus"),
        (re.compile(r"\bEventBus\b"),                    "event-bus"),
        (re.compile(r"\bCapabilityGateway\b"),            "capability"),
        (re.compile(r"\bCapabilityRuntime\b"),           "capability-runtime"),
        (re.compile(r"\bKernel\b"),                      "kernel"),
        (re.compile(r"\bDI Container\b"),                "di"),
        (re.compile(r"\bServiceRegistry\b"),             "service-registry"),
        (re.compile(r"\bPresenceEngine\b"),              "presence-engine"),
        (re.compile(r"\bCollaborationEngine\b"),         "collaboration-engine"),
        (re.compile(r"\bAnalyticsEngine\b"),             "analytics-engine"),
        (re.compile(r"\bConfigurationService\b"),        "configuration"),
        (re.compile(r"\bDatabase\b"),                    "db"),
        (re.compile(r"\bESM[ -]Loader\b"),               "esm-loader"),
        (re.compile(r"\bPluginRuntime\b"),               "plugin-host"),
        (re.compile(r"\bProcessManager\b"),              "process-manager"),
        (re.compile(r"\bWorkerRuntime\b"),               "worker-runtime"),
        (re.compile(r"\bLessonEngine\b"),                "lesson-engine"),
        (re.compile(r"\bClassroomRuntime\b"),            "classroom-runtime"),
    ]

    # A built-in plugin module named by its real path inside any doc.
    PLUGIN_PATH_PATTERN = re.compile(r"packages/plugins/([A-Za-z0-9_\-./]+)\.ts")

    for md in sorted(docs_root.rglob("*.md")):
        rel = md.relative_to(docs_root)
        if any(p.startswith(("_build", "node_modules")) for p in rel.parts):
            continue
        try:
            text = md.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            for pat, name in INLINE_PATTERNS:
                if pat.search(line):
                    key = (name, "subsystem", str(md))
                    if key in seen:
                        continue
                    seen.add(key)
                    facts.append(DocFact(
                        name=name,
                        kind="subsystem",
                        source_path=str(md),
                        line=line_no,
                        excerpt=line.strip()[:160],
                    ))
                    break  # one fact per line

        # (3) Plugin module mentions: docs that name a built-in plugin by its real
        # path (e.g. inline code `packages/plugins/courseware-score.ts`) document
        # that module, so the aligner can match it against the code-side fact of
        # the same name. Without this rule the only doc facts a plugin could ever
        # obtain were the file-name/sub-system mappings above, which silently
        # turned every newly documented built-in plugin into a drift item.
        for line_no, line in enumerate(text.splitlines(), 1):
            for m in PLUGIN_PATH_PATTERN.finditer(line):
                stem = m.group(1).rsplit("/", 1)[-1]
                if stem.startswith(("__", ".")):
                    continue
                key = (stem, "plugin", str(md))
                if key in seen:
                    continue
                seen.add(key)
                facts.append(DocFact(
                    name=stem,
                    kind="plugin",
                    source_path=str(md),
                    line=line_no,
                    excerpt=line.strip()[:160],
                ))

    return facts


# ---------------------------------------------------------------------------
# Code side — parse TypeScript / directory listings
# ---------------------------------------------------------------------------

def extract_code_facts(packages_root: Path) -> list[CodeFact]:
    """Extract subsystems from packages/core/* + src/features/* + plugins.

    Strategy:
    - Each top-level dir under packages/core/ is a subsystem (backend core)
    - Each top-level dir under src/features/ is a subsystem (frontend feature)
    - Each .ts file under packages/plugins/ is a plugin
    """
    facts: list[CodeFact] = []

    # --- core subsystems (backend) ---
    core = packages_root / "packages" / "core"
    if core.exists():
        for child in sorted(core.iterdir()):
            if not child.is_dir():
                continue
            if child.name.startswith(("__", ".")):
                continue
            facts.append(CodeFact(
                name=child.name,
                kind="subsystem",
                source_path=str(child),
                line=0,
                excerpt=f"packages/core/{child.name}/",
            ))

    # --- feature subsystems (frontend) ---
    features = packages_root / "src" / "features"
    if features.exists():
        for child in sorted(features.iterdir()):
            if not child.is_dir():
                continue
            if child.name.startswith(("__", ".")):
                continue
            facts.append(CodeFact(
                name=child.name,
                kind="subsystem",
                source_path=str(child),
                line=0,
                excerpt=f"src/features/{child.name}/",
            ))

    # --- plugins ---
    plugins_dir = packages_root / "packages" / "plugins"
    if plugins_dir.exists():
        for child in sorted(plugins_dir.iterdir()):
            if child.is_dir():
                continue
            if not child.suffix == ".ts":
                continue
            if child.name.startswith(("__", ".")):
                continue
            stem = child.stem  # e.g. "builtin"
            facts.append(CodeFact(
                name=stem,
                kind="plugin",
                source_path=str(child),
                line=0,
                excerpt=f"plugin file: {child.name}",
            ))

    return facts


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def run(docs_root: Path, packages_root: Path, out_path: Path) -> Extracts:
    ex = Extracts()
    ex.doc_facts = extract_doc_facts(docs_root, packages_root)
    ex.code_facts = extract_code_facts(packages_root)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(
            {
                "doc_facts": [asdict(f) for f in ex.doc_facts],
                "code_facts": [asdict(f) for f in ex.code_facts],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return ex


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--docs", required=True, type=Path)
    p.add_argument("--packages", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    args = p.parse_args()

    ex = run(args.docs, args.packages, args.out)
    print(f"docs facts: {len(ex.doc_facts)}")
    print(f"code facts: {len(ex.code_facts)}")
    print(f"wrote: {args.out}")