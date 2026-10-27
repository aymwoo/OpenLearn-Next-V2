#!/usr/bin/env python3
"""Diff the extension-slot inventory against the developer-facing docs.

Coverage is graded, because "mentioned once in a bullet list" is not the same
as "a plugin author can actually use it":

  L0 MISSING   slot name never appears in the docs
  L1 LISTED    name appears, but no props/usage information anywhere
  L2 PARTIAL   has a props/usage sentence, but no code example
  L3 FULL      has a dedicated section with a code example

The check parses `docs/reference/plugin-ui-extension-slots.md` (the canonical
slot reference) plus every other file under `docs/`, so a slot documented in a
tutorial still counts as covered.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

CODE_FENCE_RE = re.compile(r"```[^\n]*\n(.*?)```", re.S)


def load_inventory(repo: Path) -> dict:
    path = repo / "audit-tools/reports/slots_inventory.json"
    if not path.exists():
        raise SystemExit("run audit-tools/extract_slots.py first")
    return json.loads(path.read_text(encoding="utf-8"))


def doc_texts(repo: Path) -> dict[str, str]:
    out = {}
    for path in sorted((repo / "docs").rglob("*.md")):
        out[str(path.relative_to(repo))] = path.read_text(encoding="utf-8")
    return out


def mentions(text: str, slot: str) -> bool:
    """True if `slot` appears as a whole name, not as part of a longer one.

    Plain `slot in text` gives false positives: renaming `assessment.stats.card`
    to `assessment.stats.card_REMOVED` (or a real typo like `class.tabX`) still
    contains the original name as a prefix, so a slot could look documented
    while the docs actually reference something that does not exist.
    """
    return re.search(r"(?<![a-z0-9_.])" + re.escape(slot) + r"(?![a-z0-9_.])", text) is not None


def grade_slot(slot: str, reference: str, all_docs: dict[str, str]) -> dict:
    """Grade how well `slot` is documented.

    A slot counts as *explained* only where its name is followed by something a
    plugin author can act on. Mentioning the name inside an unrelated sentence
    (e.g. a changelog entry) is graded L1 at best.
    """
    # Where does the name appear at all?
    files = [f for f, t in all_docs.items() if mentions(t, slot)]
    if not files:
        return {"slot": slot, "grade": "L0", "files": [], "reason": "名称从未出现在 docs/ 中"}

    in_reference = mentions(reference, slot)
    # A code example that contains the slot name (fenced block).
    has_code = False
    for text in all_docs.values():
        for block in CODE_FENCE_RE.findall(text):
            if mentions(block, slot):
                has_code = True
                break
        if has_code:
            break

    # A table row or bullet that pairs the name with props/usage prose.
    explanatory = False
    patterns = [
        # markdown table row starting with the slot in backticks
        re.compile(r"^\|\s*`" + re.escape(slot) + r"`", re.M),
        # bullet: - **`slot`**: ...
        re.compile(r"^[-*]\s+\*\*`" + re.escape(slot) + r"`\*\*", re.M),
        # heading mentioning the slot
        re.compile(r"^#{2,4}.*" + re.escape(slot), re.M),
    ]
    for text in all_docs.values():
        if any(p.search(text) for p in patterns):
            explanatory = True
            break

    if has_code and explanatory:
        grade, reason = "L3", "有专项说明 + 代码示例"
    elif explanatory:
        grade, reason = "L2", "有 props/用法说明，缺代码示例"
    elif has_code:
        grade, reason = "L2", "有代码示例，缺 props 说明"
    else:
        grade, reason = "L1", "仅被提及（清单/散文中出现），无 props/用法"

    # Anchor slots share one registration shape (slot name + placement/position +
    # component) and differ only in their name, so one worked example covers all
    # of them. Requiring a per-anchor example would demand 8 copies of the same
    # snippet. Fixed slots, by contrast, each inject different props and do need
    # their own example. Grade anchors on "listed in the anchor catalogue +
    # catalogue has a registration example" instead.
    if slot.startswith("anchor:") and grade == "L2":
        anchor_doc = all_docs.get("docs/plugin/anchor-slots.md", "")
        listed_in_catalogue = re.search(r"^\|\s*`" + re.escape(slot) + r"`", anchor_doc, re.M)
        catalogue_has_example = "registerExtensionPoint('anchor:" in anchor_doc
        if listed_in_catalogue and catalogue_has_example:
            grade, reason = "L3", "锚点目录有清单条目 + 统一注册示例（锚点契约同构）"

    return {"slot": slot, "grade": grade, "files": files, "in_reference": in_reference, "reason": reason}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--out", default="audit-tools/reports/slots_coverage.json")
    ap.add_argument("--md", default="audit-tools/reports/slots_coverage.md")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    inv = load_inventory(repo)
    docs = doc_texts(repo)
    ref_path = "docs/reference/plugin-ui-extension-slots.md"
    reference = docs.get(ref_path, "")

    slots = inv["declared"] + [a for a in inv["anchor_slots"]]
    results = [grade_slot(s, reference, docs) for s in slots]

    by_grade: dict[str, list[str]] = {}
    for r in results:
        by_grade.setdefault(r["grade"], []).append(r["slot"])

    data = {
        "total": len(results),
        "grades": {k: len(v) for k, v in sorted(by_grade.items())},
        "L0_missing": by_grade.get("L0", []),
        "L1_listed": by_grade.get("L1", []),
        "L2_partial": by_grade.get("L2", []),
        "L3_full": by_grade.get("L3", []),
        "details": results,
    }
    out = repo / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [
        "# 扩展槽文档覆盖报告",
        "",
        f"槽位总数（`ExtensionSlot` 联合类型 {inv['declared_count']} + 锚点 {inv['anchor_count']}）：**{data['total']}**",
        "",
        "| 等级 | 含义 | 数量 |",
        "| ---- | ---- | ---- |",
        f"| L3 | 有专项说明 + 代码示例 | {len(data['L3_full'])} |",
        f"| L2 | 有 props/用法说明，缺代码示例 | {len(data['L2_partial'])} |",
        f"| L1 | 仅被提及，无 props/用法 | {len(data['L1_listed'])} |",
        f"| L0 | 文档中完全不存在 | {len(data['L0_missing'])} |",
        "",
    ]
    for grade, title in (("L0", "L0 — 完全缺失"), ("L1", "L1 — 仅被提及")):
        bucket = by_grade.get(grade, [])
        if not bucket:
            continue
        lines += [f"## {title}（{len(bucket)}）", ""]
        lines += [f"- `{s}`" for s in bucket]
        lines.append("")
    md = repo / args.md
    md.write_text("\n".join(lines), encoding="utf-8")

    print(f"total slots      : {data['total']}")
    for g in ("L3", "L2", "L1", "L0"):
        print(f"  {g}: {len(by_grade.get(g, []))}")
    print(f"L0 missing: {data['L0_missing']}")
    print(f"L1 listed : {data['L1_listed']}")
    print(f"-> {out}\n-> {md}")
    # Only L0 blocks the gate: a slot that is nowhere in the docs cannot be used
    # by a plugin author. L1/L2 are reported for review but do not fail CI --
    # a gate that fires on "could be better" trains people to ignore it.
    return 1 if data["L0_missing"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
