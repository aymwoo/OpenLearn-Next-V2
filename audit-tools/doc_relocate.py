#!/usr/bin/env python3
"""
doc_relocate.py — 文档目录搬迁后的链接重定位。

用法：
    # move 为 "旧路径:新路径" 的映射，可多次
    python3 audit-tools/doc_relocate.py --root docs/agent \
        --move reference/agent-playbook.md:playbook/agent-playbook.md \
        --move reference/pitfalls.md:playbook/pitfalls.md
"""

from __future__ import annotations

import argparse
import posixpath
import re
import sys
from pathlib import Path

DOC_ROLE_RE = re.compile(r"\{doc\}`([^`]+)`")
MD_LINK_RE = re.compile(r"\]\(([^)]+\.md)(#[^)]*)?\)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--move", action="append", default=[])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    moves = {}
    for m in args.move:
        old, new = m.split(":", 1)
        old_n = posixpath.normpath(old)
        new_n = posixpath.normpath(new)
        moves[old_n] = new_n
        # 链接目标可能省略 .md（MyST 的 {doc} 角色按 docname 解析），
        # 所以「带扩展名」与「不带扩展名」两种键都要登记。
        moves[posixpath.splitext(old_n)[0]] = posixpath.splitext(new_n)[0]

    changed_files = 0
    changed_links = 0

    for md in sorted(root.rglob("*.md")):
        rel = md.relative_to(root).as_posix()
        # 该文件当前所在目录（搬迁后）
        cur_dir = posixpath.dirname(rel)
        # 该文件搬迁前的目录
        orig_dir = cur_dir
        for old, new in moves.items():
            if posixpath.normpath(new) == rel:
                orig_dir = posixpath.dirname(old)
                break

        text = md.read_text(encoding="utf-8")
        original = text

        def remap(target: str) -> str:
            """把「相对旧目录的路径」重写为「相对新目录的路径」。"""
            t = target.strip()
            if not t or t.startswith(("http://", "https://", "#")):
                return target
            # 解析为相对 root 的绝对路径
            abs_old = posixpath.normpath(posixpath.join(orig_dir, t))
            # 映射到搬迁后的位置
            abs_new = moves.get(abs_old, abs_old)
            # 重新计算为相对当前目录
            new_rel = posixpath.relpath(abs_new, cur_dir)
            return new_rel

        def role_sub(m: re.Match) -> str:
            nonlocal changed_links
            new = remap(m.group(1))
            if new != m.group(1):
                changed_links += 1
            return "{doc}`" + new + "`"

        def link_sub(m: re.Match) -> str:
            nonlocal changed_links
            new = remap(m.group(1))
            if new != m.group(1):
                changed_links += 1
            suffix = m.group(2) or ""
            return "](" + new + suffix + ")"

        text = DOC_ROLE_RE.sub(role_sub, text)
        text = MD_LINK_RE.sub(link_sub, text)

        if text != original:
            changed_files += 1
            if not args.dry_run:
                md.write_text(text, encoding="utf-8")

    print(f"处理 {changed_files} 个文件，重定位 {changed_links} 条链接（dry-run={args.dry_run}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
