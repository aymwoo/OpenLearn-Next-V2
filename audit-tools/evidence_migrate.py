#!/usr/bin/env python3
"""
evidence_migrate.py — 把文档里的「repomix 行号」取证坐标迁移为「仓库真实路径 + 符号名 + 行号区间」。

为什么：
    repomix 坐标绑定的是某一份 18MB 的快照产物（repomix-output.xml）。
    仓库一变，坐标就静默失效，且读者无法直接定位。真实路径 + 符号名跨版本稳定，
    还能被 audit-tools/symbolcheck.py 校验。

做法：
    1. 解析 repomix-output.xml，得到「文件路径 → 该文件块在 dump 中的起始行」；
       文件块内的第 k 行 = 仓库里的第 k 行（dump 逐行复制，无增删）。
    2. 扫描文档里的 `路径 ... L123456` 形式的引用，把 dump 行号换算回仓库行号；
    3. 在仓库文件里从该行向前回溯，定位包围它的顶层声明（function / const / class /
       interface / type / enum），得到「符号名 + 声明行号区间」；
    4. 输出新制式的取证条目。

用法：
    python3 audit-tools/evidence_migrate.py --dump <repomix-output.xml> --docs <dir> [--dry-run]
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# 引用行形如：
#   `packages/core/plugin-host/types.ts`，repomix L113656
#   `packages/core/plugin-host/types.ts`（L113656–L113905）
#   `docs/sdk/plugin-test-kit.md` L28807
CITE_RE = re.compile(
    r"(?P<path>(?:packages|server|src|docs|scripts|audit-tools|migrations|tests|e2e)/[A-Za-z0-9_./\-]+\.(?:ts|tsx|js|mjs|cjs|json|md|sql|py|sh))"
    r"(?P<sep>[`」』]*\s*[，,（(]?\s*)"
    r"(?P<qual>(?:repomix\s*)?)"
    r"L(?P<n1>\d{4,})"
    r"(?:\s*[–\-—]\s*L?(?P<n2>\d{4,}))?"
)

DECL_RE = re.compile(
    r"^\s*(?:export\s+)?(?:default\s+)?"
    r"(?:async\s+)?"
    r"(?P<kind>function|const|let|class|interface|type|enum)\s+"
    r"(?P<name>[A-Za-z_$][\w$]*)"
)


def parse_dump(dump_path: Path) -> dict[str, int]:
    """文件路径 → 该文件块在 dump 中的起始行号（1-based）。"""
    starts: dict[str, int] = {}
    with dump_path.open("r", encoding="utf-8", errors="ignore") as fh:
        for idx, line in enumerate(fh, start=1):
            if line.startswith("<file path="):
                m = re.match(r'<file path="([^"]+)"', line)
                if m:
                    starts.setdefault(m.group(1), idx)
    return starts


def build_decl_index(repo: Path, rel: str) -> list[tuple[int, str, str]]:
    """返回 [(行号, 种类, 符号名)]，按行号升序。"""
    f = repo / rel
    if not f.exists():
        return []
    decls: list[tuple[int, str, str]] = []
    for idx, line in enumerate(f.read_text(encoding="utf-8", errors="ignore").splitlines(), start=1):
        m = DECL_RE.match(line)
        if m:
            decls.append((idx, m.group("kind"), m.group("name")))
    return decls


def enclosing_symbol(decls: list[tuple[int, str, str]], line: int) -> tuple[str, int, int] | None:
    """找出包围 line 的最内层顶层声明，返回 (符号名, 起始行, 结束行)。"""
    chosen = None
    for idx, (dline, kind, name) in enumerate(decls):
        if dline > line:
            break
        end = decls[idx + 1][0] - 1 if idx + 1 < len(decls) else line
        chosen = (name, dline, max(end, dline))
    return chosen


def migrate_file(doc_path: Path, repo: Path, starts: dict[str, int], dry: bool) -> tuple[int, list[str]]:
    text = doc_path.read_text(encoding="utf-8")
    changes: list[str] = []
    cache: dict[str, list[tuple[int, str, str]]] = {}

    def repl(m: re.Match) -> str:
        rel = m.group("path")
        n1 = int(m.group("n1"))
        n2 = int(m.group("n2")) if m.group("n2") else 0
        start = starts.get(rel)
        if start is None:
            return m.group(0)
        # dump 中 <file path=...> 那一行是首行，文件内容从下一行开始
        repo_line = n1 - start
        if repo_line < 1:
            return m.group(0)
        # 文档（.md）没有「符号」概念，只换算行号
        if rel.endswith(".md"):
            changes.append(f"{rel} L{n1}->L{repo_line}")
            if n2:
                return f"`{rel}`（L{repo_line}–L{n2 - start}）"
            return f"`{rel}`（L{repo_line}）"
        if rel not in cache:
            cache[rel] = build_decl_index(repo, rel)
        sym = enclosing_symbol(cache[rel], repo_line)
        if sym is None:
            return f"`{rel}`（L{repo_line}）"
        name, dline, dend = sym
        changes.append(f"{rel} L{n1}->L{repo_line} ({name})")
        if n2:
            repo_end = n2 - start
            return f"`{rel}` → `{name}`（L{repo_line}–L{repo_end}）"
        return f"`{rel}` → `{name}`（L{repo_line}）"

    new = CITE_RE.sub(repl, text)

    # 「同上 L123456」——沿用上一行出现的文件路径。
    # 必须逐行推进，否则 re.sub 扫全文时 last_path 会被最后一行覆盖。
    def repl_same(m: re.Match) -> str:
        if not last_path[0]:
            return m.group(0)
        n1 = int(m.group(1))
        n2 = int(m.group(2)) if m.group(2) else 0
        start = starts.get(last_path[0])
        if start is None:
            return m.group(0)
        repo_line = n1 - start
        if repo_line < 1:
            return m.group(0)
        changes.append(f"{last_path[0]} [同上] L{n1}->L{repo_line}")
        if n2:
            return f"`{last_path[0]}`（L{repo_line}–L{n2 - start}）"
        return f"`{last_path[0]}`（L{repo_line}）"

    out_lines = []
    last_path = [None]
    path_pat = re.compile(r"`((?:packages|server|src|docs)/[A-Za-z0-9_./\-]+\.(?:ts|tsx|md|mjs|cjs|json))`")
    for line in new.splitlines():
        line = re.sub(r"同上\s*L(\d{4,})(?:\s*[–\-—]\s*L?(\d{4,}))?", repl_same, line)
        hit = path_pat.search(line)
        if hit:
            last_path[0] = hit.group(1)
        out_lines.append(line)
    new = "\n".join(out_lines) + ("\n" if text.endswith("\n") else "")
    if not dry and new != text:
        doc_path.write_text(new, encoding="utf-8")
    return len(changes), changes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True)
    ap.add_argument("--docs", required=True)
    ap.add_argument("--repo", default=".")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    dump = Path(args.dump).resolve()
    repo = Path(args.repo).resolve()
    docs = Path(args.docs).resolve()
    if not dump.exists():
        print(f"dump 不存在: {dump}")
        return 1

    starts = parse_dump(dump)
    print(f"dump 解析到 {len(starts)} 个文件块")

    total = 0
    for md in sorted(docs.rglob("*.md")):
        if "_build" in md.parts or ".venv" in md.parts:
            continue
        n, changes = migrate_file(md, repo, starts, args.dry_run)
        if n:
            total += n
            print(f"  {md.relative_to(docs)}: {n} 处")
            for c in changes[:3]:
                print(f"      · {c}")
    print(f"合计迁移 {total} 处引用（dry-run={args.dry_run}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
