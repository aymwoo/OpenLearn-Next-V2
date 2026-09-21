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
    "command-event-bus":          ("command-bus",              "subsystem"),
    "command-event-bus":          ("event-bus",                "subsystem"),
    "dependency-injection":       ("di",                       "subsystem"),
    "service-registry":           ("service-registry",         "subsystem"),
    "capability-gateway":         ("capability",               "subsystem"),
    "capability-gateway":         ("capability-runtime",       "subsystem"),
    "capability-gateway":         ("capability-governance",    "subsystem"),
    "composition-root":           ("bootstrap",                "subsystem"),
    "bootstrap-pipeline":         ("bootstrap",                "subsystem"),
    "database-and-migrations":    ("db",                       "subsystem"),
    "configuration":              ("configuration",            "subsystem"),
    "security-permissions":       ("capability",               "subsystem"),
    "workspace-runtime":          ("workspace-runtime",        "subsystem"),
    "whiteboard-runtime":         ("whiteboard-runtime",       "subsystem"),
    "lesson-runtime":             ("lesson-engine",            "subsystem"),
    "presence-collaboration":     ("presence-engine",          "subsystem"),
    "presence-collaboration":     ("collaboration-engine",     "subsystem"),
    "system-overview":            ("system",                   "subsystem"),
    "theming-system":             ("theming",                  "subsystem"),
    "layer-topology":             ("kernel",                   "subsystem"),
    "classroom-runtime":          ("classroom-runtime",        "subsystem"),
    "interaction-runtime":        ("interaction-runtime",      "subsystem"),
    "resource-runtime":           ("resource-runtime",         "subsystem"),
}


def extract_doc_facts(docs_root: Path) -> list[DocFact]:
    """Heuristic: each docs/architecture/<name>.md describes one subsystem.

    Also scans inline text for explicit subsystem mentions (kernel, di, etc).
    Also scans docs/<other>/<name>.md (e.g. docs/plugin/, docs/ai/) for
    subsystem-focused docs.
    """
    facts: list[DocFact] = []
    if not docs_root.exists():
        return facts

    seen: set[tuple[str, str, str]] = set()

    # (1) File-based: one fact per architecture doc
    arch_dir = docs_root / "architecture"
    if arch_dir.exists():
        for md in sorted(arch_dir.glob("*.md")):
            stem = md.stem.lower()
            if stem in DOC_SUBSYSTEM_BY_FILE:
                canonical, kind = DOC_SUBSYSTEM_BY_FILE[stem]
                key = (canonical, kind, str(md))
                if key in seen:
                    continue
                seen.add(key)
                # find first heading as excerpt
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
        # docs/core/
        "platform-kernel": "kernel",
    }
    for md in sorted(docs_root.rglob("*.md")):
        if any(p.startswith(("_build", "node_modules")) for p in md.relative_to(docs_root).parts):
            continue
        # Skip architecture/ (already handled above)
        if "architecture" in md.relative_to(docs_root).parts:
            continue
        stem = md.stem.lower()
        if stem in FILE_NAME_TO_CANONICAL:
            canonical = FILE_NAME_TO_CANONICAL[stem]
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
    ex.doc_facts = extract_doc_facts(docs_root)
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