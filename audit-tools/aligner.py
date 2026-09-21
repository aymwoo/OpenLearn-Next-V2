#!/usr/bin/env python3
"""
aligner.py — 对齐 docs 事实 vs code 事实，输出 drift 清单

使用归一化层 (normalize.py) 把 docs 标题和代码目录名映射到同一 canonical key。

Drift 类型:
- MISSING_IN_CODE: docs 提到但代码不存在
- MISSING_IN_DOCS:  代码存在但 docs 没提到
- META_ONLY:       docs 是审计快照/历史报告,不算真 drift

输入: extracts.json (from extractors.py)
输出: drift_report.md, drift_report.json
"""
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path

from extractors import CodeFact, DocFact
from normalize import canonical, is_excluded


@dataclass
class DriftItem:
    kind: str                # MISSING_IN_CODE | MISSING_IN_DOCS | META_ONLY
    name: str                # 原始名 (最直观的标识)
    canonical: str           # 归一化 key
    target_kind: str
    evidence: list[dict]
    recommendation: str
    confidence: str = "high" # high / medium (low = Jev 复核过但 still 模糊)
    notes: str = ""          # 自然语言结论


def load_extracts(path: Path) -> tuple[list[DocFact], list[CodeFact]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    docs = [DocFact(**f) for f in data.get("doc_facts", [])]
    code = [CodeFact(**f) for f in data.get("code_facts", [])]
    return docs, code


def find_drift(docs: list[DocFact], code: list[CodeFact]) -> list[DriftItem]:
    drift: list[DriftItem] = []

    # Group by canonical
    doc_index: dict[str, list[DocFact]] = defaultdict(list)
    code_index: dict[str, list[CodeFact]] = defaultdict(list)

    for f in docs:
        c = canonical(f.name)
        doc_index[c].append(f)

    for f in code:
        c = canonical(f.name)
        code_index[c].append(f)

    seen_canonicals = set(doc_index) | set(code_index)

    for c in seen_canonicals:
        if is_excluded(c):
            # 元数据/宏观/跨切面 — 跳过,不算 drift
            continue

        in_doc = doc_index.get(c, [])
        in_code = code_index.get(c, [])

        if in_doc and not in_code:
            # 文档提到但代码不存在
            drift.append(DriftItem(
                kind="MISSING_IN_CODE",
                name=in_doc[0].name,
                canonical=c,
                target_kind=in_doc[0].kind,
                evidence=[
                    {"source_path": d.source_path, "line": d.line, "excerpt": d.excerpt}
                    for d in in_doc
                ],
                recommendation=_rec_missing_code(in_doc[0].name, c),
                confidence="medium",  # 需要人工看一眼是不是分布到多个目录
                notes=f"docs 中以 `{in_doc[0].name}` 形式引用,canonical 归一为 `{c}`",
            ))

        elif in_code and not in_doc:
            # 代码存在但 docs 没提到
            # 过滤掉: ui shell 类(shared/student/teacher), 内置插件目录
            if _should_skip_code_only(c, in_code[0].name):
                continue
            drift.append(DriftItem(
                kind="MISSING_IN_DOCS",
                name=in_code[0].name,
                canonical=c,
                target_kind=in_code[0].kind,
                evidence=[
                    {"source_path": c0.source_path, "line": c0.line, "excerpt": c0.excerpt}
                    for c0 in in_code
                ],
                recommendation=_rec_missing_docs(in_code[0].name, c),
                confidence="high",
                notes=f"代码侧存在 `{in_code[0].name}`,docs 未单独描述,canonical=`{c}`",
            ))

        elif in_doc and in_code:
            # 都有 — 不算 drift
            pass

    return drift


# ---------------------------------------------------------------------------
# 过滤规则: 某些 code-only 项不算 drift
# ---------------------------------------------------------------------------

SKIP_CODE_ONLY_NAMES = {
    # UI Shell 通用资源,不需要架构文档单独覆盖
    "shared", "student", "teacher", "modals", "navigation",
    "command-palette", "quick-insert",
    # 通用 plugin 文件,docs 已经在 plugin-guide 提了
    "ai-planner", "ai-submit-injector", "assignment-eval",
    "builtin", "management", "vfs", "process",
    # ai 子目录都被 "ai" canonical 覆盖, 不必单独报告
    "ai-action-api", "ai-classroom-context", "ai-prompt-registry",
    "ai-skill-registry", "ai-teaching-workflow", "ai-teacher-workspace",
    # workspace 子目录都被 "workspace" canonical 覆盖
    "teacher-workspace", "student-workspace",
}


def _should_skip_code_only(canonical: str, original_name: str) -> bool:
    if original_name in SKIP_CODE_ONLY_NAMES:
        return True
    if canonical.startswith("ai-plugins"):
        return True
    return False


# ---------------------------------------------------------------------------
# 推荐语
# ---------------------------------------------------------------------------

def _rec_missing_code(name: str, canonical_key: str) -> str:
    return (
        f"调查 docs 中提到的 `{name}` 在代码里的真实位置(可能在 `src/features/`、"
        f"`server/`、`src/` 而非 `packages/core/`)。如果代码已分布到其他目录,"
        f"在 `docs/architecture/` 里加交叉引用说明实际代码位置。"
    )


def _rec_missing_docs(name: str, canonical_key: str) -> str:
    return (
        f"为代码侧的 `{name}` 在 `docs/architecture/` 中新建/补充描述章节,"
        f"或在现有架构文档(canonical=`{canonical_key}`)中显式提及该组件。"
    )


# ---------------------------------------------------------------------------
# Markdown writer
# ---------------------------------------------------------------------------

def write_markdown(
    drifts: list[DriftItem],
    docs_count: int,
    code_count: int,
    out_path: Path,
) -> None:
    lines: list[str] = []
    lines.append("# Architecture Documentation Drift Report")
    lines.append("")
    lines.append("> **方法**: 静态事实提取 + 归一化层(canonical key)对比,无 AI 依赖。")
    lines.append(">")
    lines.append("> 归一化层 (`normalize.py`) 把 docs 标题 (`Platform Kernel`) 和代码目录名")
    lines.append("> (`packages/core/kernel/`) 映射到同一 canonical key (`kernel`),从而避免")
    lines.append("> \"docs 说 Platform Kernel 但代码叫 kernel\" 这类伪 drift。")
    lines.append("")
    lines.append("---")
    lines.append("")

    # Summary
    by_kind: dict[str, int] = defaultdict(int)
    for d in drifts:
        by_kind[d.kind] += 1
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- 总事实点: docs={docs_count}, code={code_count}")
    lines.append(f"- 归一化后 canonical 数: {len(set(d.canonical for d in drifts)) + sum(1 for _ in drifts) - len(drifts)}")
    lines.append(f"- 实际 drift 项: **{len(drifts)}**")
    for k, v in sorted(by_kind.items()):
        lines.append(f"  - `{k}`: {v}")
    lines.append("")

    # MISSING_IN_CODE
    missing_code = [d for d in drifts if d.kind == "MISSING_IN_CODE"]
    if missing_code:
        lines.append("---")
        lines.append("")
        lines.append("## 🚨 docs 提到但代码不存在 (MISSING_IN_CODE)")
        lines.append("")
        lines.append("> ⚠️ 这些可能不是真 drift — docs 提到的代码实际可能位于 `src/features/`、`server/` 等非 `packages/core/` 目录。")
        lines.append("> 行动项: 人工到 docs 文件首段确认实际代码路径,然后去那里 grep 一份。")
        lines.append("")
        for d in sorted(missing_code, key=lambda x: x.name):
            lines.append(f"### `{d.name}` → canonical `{d.canonical}`")
            lines.append("")
            lines.append(f"- **静态判定**: `{d.kind}` (置信度: {d.confidence})")
            lines.append(f"- **注脚**: {d.notes}")
            lines.append(f"- **证据**:")
            for ev in d.evidence:
                line_ref = ev["line"] if ev["line"] else "-"
                lines.append(f"  - `{ev['source_path']}:{line_ref}` — {ev['excerpt']}")
            lines.append(f"- **建议**: {d.recommendation}")
            lines.append("")

    # MISSING_IN_DOCS
    missing_docs = [d for d in drifts if d.kind == "MISSING_IN_DOCS"]
    if missing_docs:
        lines.append("---")
        lines.append("")
        lines.append("## 📝 代码存在但 docs 没有 (MISSING_IN_DOCS)")
        lines.append("")
        lines.append("> ✅ 这些是确定性 drift — 代码明确存在,docs 真的没提到。")
        lines.append("> 行动项: 人工确认这是不是应该补文档的子系统。")
        lines.append("")
        for d in sorted(missing_docs, key=lambda x: x.name):
            lines.append(f"### `{d.name}` → canonical `{d.canonical}`")
            lines.append("")
            lines.append(f"- **静态判定**: `{d.kind}` (置信度: {d.confidence})")
            lines.append(f"- **注脚**: {d.notes}")
            lines.append(f"- **证据**:")
            for ev in d.evidence:
                line_ref = ev["line"] if ev["line"] else "-"
                lines.append(f"  - `{ev['source_path']}:{line_ref}` — {ev['excerpt']}")
            lines.append(f"- **建议**: {d.recommendation}")
            lines.append("")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines), encoding="utf-8")


def write_json(drifts: list[DriftItem], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(
            {"total": len(drifts), "items": [asdict(d) for d in drifts]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def main() -> None:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--extracts", required=True, type=Path)
    p.add_argument("--out-md", required=True, type=Path)
    p.add_argument("--out-json", required=True, type=Path)
    args = p.parse_args()

    docs, code = load_extracts(args.extracts)
    drifts = find_drift(docs, code)
    write_markdown(drifts, len(docs), len(code), args.out_md)
    write_json(drifts, args.out_json)
    print(f"drift items: {len(drifts)}")
    print(f"  MISSING_IN_CODE: {sum(1 for d in drifts if d.kind == 'MISSING_IN_CODE')}")
    print(f"  MISSING_IN_DOCS:  {sum(1 for d in drifts if d.kind == 'MISSING_IN_DOCS')}")
    print(f"wrote: {args.out_md}")


if __name__ == "__main__":
    main()