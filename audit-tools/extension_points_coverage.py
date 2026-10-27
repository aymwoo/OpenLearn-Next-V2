#!/usr/bin/env python3
"""extension_points_coverage.py — 校验「插件可注册的领域扩展点」是否被文档覆盖。

为什么需要这一层：
    `plugin_docs_check.py` 查代码块里的调用形状（ctx.xxx 存不存在），
    `slots_coverage.py` 查 UI 槽位的覆盖。两者都不查**内核注册表** ——
    即「插件往内核注册一个领域扩展点」这件事本身有没有写进文档。

    现实代价已经付过一次（2026-10-27）：6 个真实扩展点里有 5 个在 `docs/plugin/`
    与 `docs/tutorials/` 下**一次都没出现**（题库题型只散落在 `docs/architecture/assessment-model.md`），
    第三方作者的合理结论是「平台只支持 UI 槽位」。

真值从源码推导，不靠人手维护：
    1. `packages/core/di/interfaces.ts` 的 `PLUGIN_RESOLVABLE_TOKENS`（插件可解析的公开承诺面）
    2. 每个 token 对应接口体里的 `register*` 方法（可选方法 `registerX?()` 也算）
    3. `audit-tools/extension-point-policy.json` 里的豁免（必须指明覆盖它的文档）

分级（沿用 slots_coverage 的哲学）：
    L0 MISSING   方法名在插件文档语料里从未出现        → 计 drift
    L1 LISTED    出现了，但不在 canonicalIndexDoc 的索引表里 → 仅提示
    L2 INDEXED   在索引表里有对应行                    → 提示
    L3 FULL      在索引表里 + 有专节/代码示例           → 通过

豁免完整性：
    豁免必须给出 `coveredBy`；门禁核对该文档确实含有该方法名。
    豁免过期（文档改了名/删了该段）→ 计 drift，避免『一刀切豁免』长期存活。

用法：
    python3 audit-tools/extension_points_coverage.py [--json OUT] [--md OUT]
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

INTERFACES = "packages/core/di/interfaces.ts"
POLICY = "audit-tools/extension-point-policy.json"

TOKEN_LIST_RE = re.compile(r"export const PLUGIN_RESOLVABLE_TOKENS = \[(.*?)\] as const;", re.S)
TOKEN_NAME_RE = re.compile(r"\b(I[A-Za-z0-9]+Token)\b")
# 可选方法也要算：`registerAIPersona?(...)`
REGISTER_METHOD_RE = re.compile(r"\b(register[A-Z][A-Za-z0-9]*)\s*\??\s*\(")


def strip_comments(src: str) -> str:
    """去掉注释 —— 否则接口体里的文档注释（`Corresponds to CommandBus.registerHandler()`）
    会被当成方法声明，同一个方法被数两次。"""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", src)


def load_policy(repo: Path) -> dict:
    path = repo / POLICY
    if not path.exists():
        raise SystemExit(f"missing policy file: {POLICY}")
    return json.loads(path.read_text(encoding="utf-8"))


def interface_bodies(src: str) -> dict[str, str]:
    """interface 名 → 接口体（`export interface IX { ... }`，按首个 `}` 截断）。"""
    out: dict[str, str] = {}
    for m in re.finditer(r"export interface ([A-Za-z0-9_]+)\s*\{", src):
        name = m.group(1)
        start = m.end()
        depth = 1
        i = start
        while i < len(src) and depth > 0:
            if src[i] == "{":
                depth += 1
            elif src[i] == "}":
                depth -= 1
            i += 1
        out[name] = src[start : i - 1]
    return out


def extract_candidates(repo: Path) -> list[dict]:
    """从源码推导扩展点候选：(token, interface, method)。"""
    src = (repo / INTERFACES).read_text(encoding="utf-8")
    m = TOKEN_LIST_RE.search(src)
    if not m:
        raise SystemExit(f"cannot locate PLUGIN_RESOLVABLE_TOKENS in {INTERFACES}")
    tokens = []
    for t in TOKEN_NAME_RE.findall(m.group(1)):
        if t not in tokens:
            tokens.append(t)

    bodies = interface_bodies(src)
    candidates: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for token in tokens:
        iface = token[: -len("Token")]
        body = bodies.get(iface)
        if body is None:
            # 接口体跨文件定义（少见）→ 无法判定，跳过而不是误报
            continue
        for method in REGISTER_METHOD_RE.findall(strip_comments(body)):
            if (token, method) not in seen:
                seen.add((token, method))
                candidates.append({"token": token, "interface": iface, "method": method})
    return candidates


def load_docs(repo: Path, globs: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for pattern in globs:
        for path in sorted(repo.glob(pattern)):
            out[str(path.relative_to(repo))] = path.read_text(encoding="utf-8")
    return out


def mentions(text: str, name: str) -> bool:
    """整词出现 —— 避免 `registerGuard` 命中 `registerGuardXxx`。"""
    return re.search(r"(?<![A-Za-z0-9_])" + re.escape(name) + r"(?![A-Za-z0-9_])", text) is not None


def index_table_lines(index_text: str) -> list[str]:
    """canonicalIndexDoc 里索引表的表格行（以 `|` 开头的行）。"""
    return [ln for ln in index_text.splitlines() if ln.strip().startswith("|")]


def has_dedicated_section(method: str, docs: dict[str, str]) -> bool:
    """该方法是否有**专节**说明。

    判据不是「标题里出现方法名」—— 人写的标题通常是中文概念名
    （「题库题型」而不是「registerQuestionType」）。真正的判据是：
    某个标题所辖的段落里出现了该方法名。
    """
    for text in docs.values():
        # 按标题切段：`## 标题` 之后到下一个标题之前
        parts = re.split(r"^#{2,6} .*$", text, flags=re.M)
        # parts[0] 是首个标题之前的前言，从 parts[1] 起每个元素对应一个标题下的正文
        for body in parts[1:]:
            if mentions(body, method):
                return True
    return False


def grade(candidate: dict, docs: dict[str, str], index_doc: str, index_text: str) -> dict:
    method = candidate["method"]
    files = [f for f, t in docs.items() if mentions(t, method)]
    if not files:
        return {
            **candidate,
            "grade": "L0",
            "files": [],
            "inIndex": False,
            "reason": "方法名从未出现在插件文档语料中",
        }

    in_index = any(mentions(ln, method) for ln in index_table_lines(index_text))
    has_section = has_dedicated_section(method, docs)
    if in_index and has_section:
        grade, reason = "L3", "索引表有对应行 + 文档有专节"
    elif in_index:
        grade, reason = "L2", "索引表有对应行，缺专节说明"
    else:
        grade, reason = "L1", "插件文档有提及，但不在索引表里"
    return {**candidate, "grade": grade, "files": files, "inIndex": in_index, "reason": reason}


def check_exemptions(policy: dict, candidates: list[dict], docs: dict[str, str], repo: Path) -> list[dict]:
    """豁免完整性：豁免项必须真实存在，且 coveredBy 文档确实提到该方法。

    `coveredBy` 从磁盘直接读（而不是从插件语料里取）—— 豁免目标可以是任意文档，
    例如 `docs/api/di-tokens.md` 不在插件语料 globs 里，但它是合法的覆盖位置。
    """
    problems: list[dict] = []
    known = {(c["token"], c["method"]) for c in candidates}
    for ex in policy.get("exemptions", []):
        key = (ex["token"], ex["method"])
        if key not in known:
            problems.append(
                {
                    "kind": "stale_exemption",
                    "token": ex["token"],
                    "method": ex["method"],
                    "reason": "豁免指向的 (token, method) 在源码中已不存在（改名/删除）",
                }
            )
            continue
        covered_by = ex.get("coveredBy")
        if not covered_by:
            problems.append(
                {
                    "kind": "exemption_without_target",
                    "token": ex["token"],
                    "method": ex["method"],
                    "reason": "豁免必须指明 coveredBy 文档",
                }
            )
            continue
        target = repo / covered_by
        text = target.read_text(encoding="utf-8") if target.exists() else None
        if text is None or not mentions(text, ex["method"]):
            problems.append(
                {
                    "kind": "expired_exemption",
                    "token": ex["token"],
                    "method": ex["method"],
                    "reason": f"豁免声明由 {covered_by} 覆盖，但该文档里没有出现 {ex['method']}",
                }
            )
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--json", default="audit-tools/reports/extension_points_report.json")
    ap.add_argument("--md", default="audit-tools/reports/extension_points_report.md")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()

    policy = load_policy(repo)
    candidates = extract_candidates(repo)
    docs = load_docs(repo, policy.get("pluginDocGlobs", []))

    index_doc = policy.get("canonicalIndexDoc", "")
    index_text = docs.get(index_doc, "")
    if not index_text:
        # 索引文档不在插件语料 globs 里 → 单独读
        p = repo / index_doc
        index_text = p.read_text(encoding="utf-8") if p.exists() else ""

    exempt_keys = {(e["token"], e["method"]) for e in policy.get("exemptions", [])}
    graded: list[dict] = []
    for c in candidates:
        if (c["token"], c["method"]) in exempt_keys:
            continue
        graded.append(grade(c, docs, index_doc, index_text))

    problems = check_exemptions(policy, candidates, docs, repo)

    l0 = [g for g in graded if g["grade"] == "L0"]
    l1 = [g for g in graded if g["grade"] == "L1"]
    l2 = [g for g in graded if g["grade"] == "L2"]
    l3 = [g for g in graded if g["grade"] == "L3"]
    drift = len(l0) + len(problems)

    data = {
        "candidates": len(candidates),
        "exempted": len(exempt_keys),
        "graded": len(graded),
        "L0_missing": l0,
        "L1_listed": l1,
        "L2_indexed": l2,
        "L3_full": l3,
        "problems": problems,
        "stats": {"drift": drift, "L0": len(l0), "L1": len(l1), "L2": len(l2), "L3": len(l3)},
    }
    out = repo / args.json
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    md = repo / args.md
    md.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 插件可注册扩展点 · 文档覆盖报告",
        "",
        f"真值来源：`{INTERFACES}` 的 `PLUGIN_RESOLVABLE_TOKENS` + 接口体里的 `register*` 方法",
        f"（自动推导，不靠人手维护清单）。豁免见 `{POLICY}`。",
        "",
        "| 分级 | 含义 | 数量 |",
        "| --- | --- | --- |",
        f"| L3 | 索引表有对应行 + 文档有专节 | {len(l3)} |",
        f"| L2 | 索引表有对应行，缺专节说明 | {len(l2)} |",
        f"| L1 | 插件文档有提及，但不在索引表里 | {len(l1)} |",
        f"| L0 | 插件文档里从未出现（计 drift） | {len(l0)} |",
        "",
        f"候选 {len(candidates)} 个，豁免 {len(exempt_keys)} 个，参与评级 {len(graded)} 个。",
        f"**drift = {drift}**（L0 {len(l0)} + 豁免问题 {len(problems)}）",
        "",
    ]
    if l0:
        lines += ["## L0 — 完全缺失（drift）", ""]
        lines += [f"- `{g['token']}.{g['method']}` — {g['reason']}" for g in l0]
        lines += [""]
    if problems:
        lines += ["## 豁免问题（drift）", ""]
        lines += [f"- `{p['token']}.{p['method']}` — {p['reason']}" for p in problems]
        lines += [""]
    if l1:
        lines += ["## L1 — 仅被提及（提示）", ""]
        lines += [f"- `{g['token']}.{g['method']}`（{', '.join(g['files'][:3])}）" for g in l1]
        lines += [""]
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"extension_points_drift={drift}")
    print(f"L0 missing: {[g['method'] for g in l0]}")
    print(f"L1 listed : {[g['method'] for g in l1]}")
    if problems:
        print(f"exemption problems: {len(problems)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
