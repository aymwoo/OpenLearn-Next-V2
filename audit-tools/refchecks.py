#!/usr/bin/env python3
"""
refchecks.py — 文档引用完整性检查（path-existence / doc-link / duplicate-docs）

与 extractors.py + aligner.py 的区别:
- extractors.py 走 canonical-key 比对,只覆盖 24 个硬编码白名单文件名;
  本模块**不使用任何白名单**,直接扫描 docs/ 下全部 .md。

三项检查:
1. path-existence  — 反引号包裹的仓库内路径是否真实存在
2. doc-link         — 文档间相对链接的目标 .md 是否存在
3. duplicate-docs   — 同一篇文档在多个路径重复存在

降噪机制（可解释、不靠"压数字"）:
不存在的路径按下列**有序规则级联**分类,每条命中都带 reason 说明:
- PLACEHOLDER  R1 路径名含占位符标记
- MISSING      R5 迁移编号冲突（高价值信号,优先于一切降噪）
- PLACEHOLDER  R4 引用位于代码块内（示意代码）
- PLACEHOLDER  R2/R3 上下文为示例/脚手架模板
- PLANNED      R6 上下文为"计划中/待实现"
- PLANNED      R7 上下文为"已废弃/已删除"的历史墓碑记录
- HISTORICAL   R9 引用来自 docs/release-notes/（历史档案,不算 drift 但仍列出）
- MISSING      R8 其余一律算 drift
规则顺序即优先级,越靠前越权威;R5 特意放在所有降噪规则之前,避免 roadmap 里
"计划中的迁移文件名与既有文件重号"这种真问题被 PLANNED 吃掉。
R9 是**按目录**的兜底降级,故放在所有上下文规则之后、R8 之前:它只在没有更贴切的
成因可解释时才生效,既不抢 R1/R5 的诊断,也不改变其它目录的任何既有判定。

只用标准库,不依赖任何第三方包。
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path


# ---------------------------------------------------------------------------
# 提取规则
# ---------------------------------------------------------------------------

# 反引号包裹的仓库内路径（与人工实测基线一致: 455 条引用）
PATH_RE = re.compile(
    r"`([A-Za-z0-9_./@-]+\.(?:ts|tsx|js|mjs|cjs|sql|yml|yaml|json|py|md|sh|css|html))`"
)

# 只有这些顶层目录开头的才算"仓库内路径",避免误伤 npm 包名等
REPO_PREFIXES = (
    "packages/", "server/", "src/", "scripts/", "e2e/", ".github/",
    "migrations/", "audit-tools/", "v2_plugins/", "docs/",
)

# 文档间相对链接；排除行首 ! 的图片引用
LINK_RE = re.compile(r"(?<!!)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")

# Markdown ATX 标题
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")

# 围栏代码块起止
FENCE_RE = re.compile(r"^\s*(?:```+|~~~+)")

# 迁移文件编号: migrations/006_xxx.sql
MIGRATION_RE = re.compile(r"^migrations/(\d+)_")

# 文档就地承认了迁移编号冲突（如"编号已被占用""计划作废""实际落地为 X"）。
# 命中即视为知情记录，不算漂移 —— 避免已修正的文档让 CI 永久报红。
ACKNOWLEDGED_CONFLICT_RE = re.compile(
    r"编号已被占用|已被\s*`?migrations/[^`]*`?\s*占用|计划作废|已作废|"
    r"实际已落地为|实际落地为|必须改用未占用|不可沿用"
)

# 排除的目录片段（构建产物 / 依赖）
SKIP_DIR_PREFIXES = ("_build", "node_modules", ".venv", "__pycache__")


# ---------------------------------------------------------------------------
# 降噪规则
# ---------------------------------------------------------------------------

# R1: 路径名里的占位符标记 —— 显然不是真实引用
R1_NAME_PLACEHOLDER = re.compile(
    r"(?i)(xxx|00x|nnn|example|examples|sample|placeholder|your-|my-|"
    r"<|>|\.\.\.|\{\}|\bn\b|\*)"
)

# R2: 上下文示例标记（中文文档常用）
R2_EXAMPLE_CONTEXT = re.compile(
    r"(比如|例如|举例|以\s*\S{0,8}\s*为例|假设|示意|假想|entryPoints|scaffold)"
)

# R3: 上下文脚手架/模板标记
R3_TEMPLATE_CONTEXT = re.compile(
    r"(脚手架|模板|示例|样例|生成的核心文件|标准插件|工程结构|目录结构|"
    r"entryPoints|scaffold|boilerplate)"
)

# R6: 计划中/待实现语义
R6_PLANNED_CONTEXT = re.compile(
    r"(计划中|计划|规划|roadmap|待实现|待补充|待新增|待添加|尚未|未来|"
    r"后续版本|下一版本|将要|将由|将把|将创建|将新增|将编写|将实现|"
    r"将引入|将迁移|将重写|\bTODO\b|\bFIXME\b|\bWIP\b|拟新增|proposal|\bplanned\b)"
)

# R7: 墓碑标记 —— 文档自己声明该文件已被删除/废弃，不是坏引用
#     注意: 故意不含"已迁移到/已更名"，那类语义是"新路径应该存在",属真 drift
R7_TOMBSTONE_CONTEXT = re.compile(r"(已废弃|已删除|已移除|已下线|不再存在)")

# R7 的 section 级放宽条件: 文件名或所在小节标题带 roadmap 语义才放宽
R6_SECTION_GUARD = re.compile(r"(?i)(roadmap|plan|proposal|design|rfc|road-map)")
R6_HEADING_GUARD = re.compile(r"(计划|规划|路线图|待办|roadmap|TODO|里程碑|阶段)")

# R9: 发布说明属于历史档案 —— 该目录下的坏引用不算文档漂移
#     严格限定 docs/release-notes/,**不**扩展到其它目录
R9_RELEASE_NOTES_DIR = re.compile(r"(?:^|/)docs/release-notes/.+")

# 不做仓库内路径判定的外链协议
EXTERNAL_LINK_RE = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//)", re.IGNORECASE)


def _posix(p) -> str:
    """把 Path 统一成正斜杠字符串,便于目录前缀匹配（Windows 路径也能命中）。"""
    return str(p).replace("\\", "/")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class RefItem:
    check: str        # path-existence | doc-link | duplicate-docs
    status: str       # MISSING | PLANNED | PLACEHOLDER | HISTORICAL | BROKEN_LINK | DUPLICATE
    target: str       # 被引用的路径 / 链接 / 标题或 stem
    source_path: str  # 引用所在文件
    line: int
    rule: str = ""    # 命中的规则名
    reason: str = ""  # 人类可读解释
    occurrences: list[str] = field(default_factory=list)  # 同名目标出现的所有位置


@dataclass
class RefReport:
    items: list[RefItem] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    @property
    def drift_count(self) -> int:
        """只有 MISSING / BROKEN_LINK / DUPLICATE 算 drift。"""
        return sum(1 for i in self.items if i.status in
                   ("MISSING", "BROKEN_LINK", "DUPLICATE"))


# ---------------------------------------------------------------------------
# 文档清单
# ---------------------------------------------------------------------------

def iter_doc_files(docs_root: Path) -> list[Path]:
    """docs/ 下全部 .md（跳过构建产物目录）。不使用任何白名单。"""
    if not docs_root.exists():
        return []
    out: list[Path] = []
    for md in sorted(docs_root.rglob("*.md")):
        rel = md.relative_to(docs_root)
        if any(p.startswith(SKIP_DIR_PREFIXES) for p in rel.parts):
            continue
        out.append(md)
    return out


class DocContext:
    """把一个 md 文件切成 段落(near) / 小节(section) / 代码块(fence) 三个作用域。"""

    def __init__(self, path: Path, text: str):
        self.path = path
        self.lines = text.splitlines()
        n = len(self.lines)

        # --- 代码块标记 ---
        self.fence: list[bool] = []
        inside = False
        for line in self.lines:
            if FENCE_RE.match(line):
                inside = not inside
                self.fence.append(inside)  # 开栏行本身算"在块内"
            else:
                self.fence.append(inside)

        # --- 段落：以空行分隔的连续非空行 ---
        self.para: list[int] = [0] * n
        pid = 0
        prev_blank = True
        for i, line in enumerate(self.lines):
            if not line.strip():
                self.para[i] = -1
                prev_blank = True
            else:
                if prev_blank:
                    pid += 1
                    prev_blank = False
                self.para[i] = pid

        # --- 小节：从最近的 ATX 标题到下一个同级/更高级标题 ---
        self.section: list[int] = [0] * n
        # 逐行扫描,记录"最近一个标题所在行",即可切出小节范围
        heading_lines = {i for i, line in enumerate(self.lines) if HEADING_RE.match(line)}
        cur = 0
        for i in range(n):
            if i in heading_lines:
                cur = i
            self.section[i] = cur

    def near(self, line: int) -> str:
        """所在段落文本。"""
        pid = self.para[line] if 0 <= line < len(self.para) else -1
        if pid < 0:
            return ""
        return "\n".join(l for i, l in enumerate(self.lines) if self.para[i] == pid)

    def section_text(self, line: int) -> str:
        """所在小节（最近标题之后）的文本 + 标题本身。"""
        if not (0 <= line < len(self.section)):
            return ""
        start = self.section[line]
        # 小节结束 = 下一个标题行
        end = len(self.lines)
        for i in range(line + 1, len(self.lines)):
            if HEADING_RE.match(self.lines[i]):
                end = i
                break
        return "\n".join(self.lines[start:end])


# ---------------------------------------------------------------------------
# R5: 迁移编号冲突
# ---------------------------------------------------------------------------

def build_migration_index(repo_root: Path) -> dict[str, str]:
    """migrations/ 目录下 '编号 -> 实际文件名' 的索引。"""
    idx: dict[str, str] = {}
    mig_dir = repo_root / "migrations"
    if not mig_dir.is_dir():
        return idx
    for f in sorted(mig_dir.glob("*.sql")):
        m = re.match(r"^(\d+)_", f.name)
        if m:
            idx[m.group(1)] = f"migrations/{f.name}"
    return idx


# ---------------------------------------------------------------------------
# 检查 1: path-existence
# ---------------------------------------------------------------------------

def check_path_existence(
    docs: list[Path], repo_root: Path
) -> tuple[list[RefItem], dict]:
    items: list[RefItem] = []
    mig_index = build_migration_index(repo_root)

    total_refs = 0
    unique_paths: set[str] = set()
    exists_count = 0

    for md in docs:
        text = md.read_text(encoding="utf-8", errors="replace")
        ctx = DocContext(md, text)
        # 同一文件内同一路径只记第一次出现，避免报告被重复引用刷屏
        seen_here: set[str] = set()

        for line_no, line in enumerate(ctx.lines):
            for m in PATH_RE.finditer(line):
                target = m.group(1)
                if not target.startswith(REPO_PREFIXES):
                    continue
                total_refs += 1
                unique_paths.add(target)

                if (repo_root / target).exists():
                    exists_count += 1
                    continue

                if target in seen_here:
                    continue
                seen_here.add(target)

                status, rule, reason = _classify_missing(
                    target, ctx, line_no, repo_root, mig_index
                )
                items.append(RefItem(
                    check="path-existence",
                    status=status,
                    target=target,
                    source_path=str(md),
                    line=line_no + 1,
                    rule=rule,
                    reason=reason,
                ))

    stats = {
        "docs_scanned": len(docs),
        "refs_total": total_refs,
        "refs_unique": len(unique_paths),
        "refs_exist": exists_count,
        "refs_missing": total_refs - exists_count,
    }
    return items, stats


def _classify_missing(
    target: str, ctx: DocContext, line_no: int,
    repo_root: Path, mig_index: dict[str, str],
) -> tuple[str, str, str]:
    """有序规则级联,返回 (status, rule, reason)。顺序即优先级。"""
    near = ctx.near(line_no)
    section = ctx.section_text(line_no)
    in_fence = ctx.fence[line_no] if 0 <= line_no < len(ctx.fence) else False

    # --- R1: 路径名本身含占位符 ---
    if R1_NAME_PLACEHOLDER.search(target):
        return ("PLACEHOLDER", "R1_NAME_PLACEHOLDER",
                "路径名含占位符标记（xxx/00X/example/my-/<> 等），是文档示意写法")

    # --- R5: 迁移编号冲突（优先于所有降噪,高价值真问题）---
    mm = MIGRATION_RE.match(target)
    if mm:
        num = mm.group(1)
        actual = mig_index.get(num)
        if actual and actual != target:
            # 文档若已就地说明"编号被占用/已作废/实际落地为 X"，说明作者已知情并在
            # 提醒读者不要再用该编号 —— 这是正确的写法，不应继续当作漂移报红。
            # 未标注的才是真问题：读者会照着写出一个不可能落地的迁移。
            if ACKNOWLEDGED_CONFLICT_RE.search(near or "") or ACKNOWLEDGED_CONFLICT_RE.search(section or ""):
                return ("PLANNED", "R5B_MIGRATION_CONFLICT_ACKNOWLEDGED",
                        f"迁移编号 {num} 已被 `{actual}` 占用，文档已就地标注该冲突"
                        f"（属知情记录，无需修改）")
            return ("MISSING", "R5_MIGRATION_NUMBER_CONFLICT",
                    f"迁移编号 {num} 已被 `{actual}` 占用，文档写的 `{target}` 不可能再落地")

    # --- R4: 位于代码块内 = 示意代码 ---
    if in_fence:
        return ("PLACEHOLDER", "R4_IN_CODE_FENCE",
                "引用位于围栏代码块内，属于示意代码而非仓库现状断言")

    # --- R2: 示例上下文 ---
    if R2_EXAMPLE_CONTEXT.search(near):
        return ("PLACEHOLDER", "R2_EXAMPLE_CONTEXT",
                "所在段落含示例标记（比如/例如/假设等），是举例说明")
    if R2_EXAMPLE_CONTEXT.search(section):
        return ("PLACEHOLDER", "R2_EXAMPLE_CONTEXT",
                "所在小节含示例标记，是举例说明")

    # --- R3: 脚手架/模板上下文 ---
    if R3_TEMPLATE_CONTEXT.search(near) or R3_TEMPLATE_CONTEXT.search(section):
        return ("PLACEHOLDER", "R3_TEMPLATE_CONTEXT",
                "所在段落/小节在讲脚手架或目录模板，路径是模板产物而非仓库路径")

    # --- R6: 计划中/待实现 ---
    if R6_PLANNED_CONTEXT.search(near):
        return ("PLANNED", "R6_PLANNED_CONTEXT",
                "所在段落含计划/待实现语义，文件尚未创建")
    # section 级放宽: 仅当文档本身或小节标题带 roadmap 语义时才生效
    # （避免在普通章节里因为隔三差五一句"未来将…"就把真 drift 放行）
    if R6_PLANNED_CONTEXT.search(section) and (
        R6_SECTION_GUARD.search(str(ctx.path)) or R6_HEADING_GUARD.search(section[:200])
    ):
        return ("PLANNED", "R6_PLANNED_CONTEXT_SECTION",
                "所在 roadmap/计划类小节含计划语义，文件尚未创建")

    # --- R7: 墓碑记录（文档自己声明该文件已删除）---
    if R7_TOMBSTONE_CONTEXT.search(near):
        return ("PLANNED", "R7_TOMBSTONE_CONTEXT",
                "所在段落声明该文件已废弃/已删除，属于历史记录而非坏引用")
    if R7_TOMBSTONE_CONTEXT.search(section):
        return ("PLANNED", "R7_TOMBSTONE_CONTEXT",
                "所在小节声明该文件已废弃/已删除，属于历史记录而非坏引用")

    # --- R9: docs/release-notes/ 属历史档案 ---
    # 发布说明记录的是"当时做了什么",事后路径重构或目录被 gitignore 都不构成文档错误。
    # 取舍: 按目录整体降级,不逐条判断引用是否像笔误 —— 笔误检测需要语义推理,
    # 成本高且误报多; 宁可少报,不可漏报的行为由 R9 **之前**的 R1/R5/R4/R2/R3/R6/R7 保持,
    # 这些更贴切的成因仍会优先命中并给出精确诊断。
    if R9_RELEASE_NOTES_DIR.search(_posix(ctx.path)):
        return ("HISTORICAL", "R9_RELEASE_NOTES_HISTORICAL",
                "引用位于 docs/release-notes/ 历史档案目录：该文档描述的是当时的仓库状态，"
                "事后路径变更或目录被 gitignore 造成的缺失不计入漂移"
                "（取舍：按目录整体降级，不再逐条判断是否笔误，条目仍在此列出以便人工抽查）")

    # --- R8: 其余一律 drift ---
    return ("MISSING", "R8_MISSING",
            "路径不存在且无占位符/计划/墓碑语义，判定为坏引用")


# ---------------------------------------------------------------------------
# 检查 2: doc-link
# ---------------------------------------------------------------------------

def check_doc_links(docs: list[Path]) -> tuple[list[RefItem], dict]:
    """文档间相对链接的目标 .md 是否存在。MyST 允许省略 .md 后缀。"""
    items: list[RefItem] = []
    total = 0

    for md in docs:
        text = md.read_text(encoding="utf-8", errors="replace")
        for line_no, line in enumerate(text.splitlines(), 1):
            for m in LINK_RE.finditer(line):
                target = m.group(2).strip()
                if not target:
                    continue
                if EXTERNAL_LINK_RE.match(target) or target.startswith("#"):
                    continue  # http/mailto/协议相对/纯锚点

                path_part = target.split("#", 1)[0]
                if not path_part:
                    continue  # 形如 foo.md#section 的纯页内跳转
                total += 1
                # MyST 允许省略 .md,两种都试
                if path_part.endswith(".md"):
                    candidates = [md.parent / path_part]
                else:
                    candidates = [
                        md.parent / (path_part + ".md"),
                        md.parent / path_part,
                        md.parent / path_part / "index.md",
                    ]
                if any(c.exists() for c in candidates):
                    continue

                items.append(RefItem(
                    check="doc-link",
                    status="BROKEN_LINK",
                    target=target,
                    source_path=str(md),
                    line=line_no,
                    rule="LINK_TARGET_MISSING",
                    reason="链接目标（含省略 .md 的 MyST 写法）均不存在",
                ))

    stats = {
        "links_total": total,
        "links_broken": len(items),
    }
    return items, stats


# ---------------------------------------------------------------------------
# 检查 3: duplicate-docs
# ---------------------------------------------------------------------------

def _normalize_title(t: str) -> str:
    return re.sub(r"\s+", " ", t.strip().lower())


def check_duplicate_docs(docs: list[Path]) -> tuple[list[RefItem], dict]:
    """同一内容在多个路径重复: 首个 # 标题相同 或 文件名 stem 相同。"""
    items: list[RefItem] = []

    by_title: dict[str, list[str]] = defaultdict(list)
    by_stem: dict[str, list[str]] = defaultdict(list)

    for md in docs:
        by_stem[md.stem].append(str(md))
        text = md.read_text(encoding="utf-8", errors="replace")
        for line in text.splitlines():
            if line.startswith("# "):
                by_title[_normalize_title(line[2:])].append(f"{md}:1")
                break

    for title, paths in sorted(by_title.items()):
        uniq = sorted(set(paths))
        if len(uniq) >= 2:
            items.append(RefItem(
                check="duplicate-docs", status="DUPLICATE", target=title,
                source_path=uniq[0].rsplit(":", 1)[0], line=1,
                rule="SAME_H1_TITLE", reason="同一 H1 标题出现在多个路径",
                occurrences=uniq,
            ))

    for stem, paths in sorted(by_stem.items()):
        uniq = sorted(set(paths))
        if len(uniq) >= 2:
            items.append(RefItem(
                check="duplicate-docs", status="DUPLICATE", target=stem,
                source_path=uniq[0], line=1,
                rule="SAME_FILENAME_STEM",
                reason="同一文件名 stem 出现在多个路径（标题可能略有差异）",
                occurrences=uniq,
            ))

    stats = {
        "docs_scanned": len(docs),
        "duplicate_groups": len(items),
    }
    return items, stats


# ---------------------------------------------------------------------------
# Markdown 输出（作为 drift_report.md 的追加章节）
# ---------------------------------------------------------------------------

def render_markdown(rep: RefReport) -> str:
    L: list[str] = []
    ps = rep.stats.get("path_existence", {})
    ls = rep.stats.get("doc_link", {})
    ds = rep.stats.get("duplicate_docs", {})

    L.append("---")
    L.append("")
    L.append("## 🔍 新增检查: 文档引用完整性 (path-existence / doc-link / duplicate-docs)")
    L.append("")
    L.append("> 与上文 canonical-key 比对互补: **不使用任何文件白名单**, 直接扫描 `docs/` 下全部")
    L.append("> `.md`，验证被引用的路径、链接和文档重复。")
    L.append("")
    L.append(f"- 扫描文档数: **{ps.get('docs_scanned', 0)}** 篇")
    L.append(f"- 提取仓库内路径引用: **{ps.get('refs_total', 0)}** 条 "
             f"(去重 {ps.get('refs_unique', 0)} 条, 存在 {ps.get('refs_exist', 0)} 条)")
    L.append(f"- 新增检查 drift 项: **{rep.drift_count}**")
    L.append("")

    by_check: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for it in rep.items:
        by_check[it.check][it.status] += 1
    for check in ("path-existence", "doc-link", "duplicate-docs"):
        st = by_check.get(check)
        if st:
            L.append(f"- `{check}`: " + ", ".join(f"{k}={v}" for k, v in sorted(st.items())))
    L.append("")

    # 待复核横幅台账：横幅是过渡标记，必须可见且可统计，否则会退化成噪声。
    banners = rep.stats.get("drift_banners", {})
    L.append("### 🚧 待复核横幅台账 (drift-banner)")
    L.append("")
    L.append("> 这些文档顶部带有 `<!-- drift-banner -->` 标记，表示**内容已知与代码不符、"
             "尚未修复**。横幅本身不算 drift（内容已如实警示），但它是待办清单：")
    L.append("> 修好对应内容后**必须连同横幅一起删除**，否则会与已修正的内容冲突。")
    L.append("")
    if not banners.get("files"):
        L.append("✅ 当前没有任何待复核横幅。")
        L.append("")
    else:
        L.append(f"- 带横幅文档: **{banners.get('count', 0)}** 篇 / 共 "
                 f"{banners.get('docs_scanned', 0)} 篇")
        L.append("")
        L.append("| 文档 |")
        L.append("| --- |")
        for f in banners["files"]:
            L.append(f"| `{f}` |")
        L.append("")

    def section(title: str, items: list[RefItem], note: str) -> None:
        L.append(f"### {title}")
        L.append("")
        L.append(note)
        L.append("")
        if not items:
            L.append("✅ 无命中。")
            L.append("")
            return
        L.append("| 状态 | 规则 | 目标 | 引用位置 | 说明 |")
        L.append("| --- | --- | --- | --- | --- |")
        for it in sorted(items, key=lambda x: (x.status, x.target)):
            loc = f"`{it.source_path}:{it.line}`"
            L.append(
                f"| `{it.status}` | `{it.rule}` | `{it.target}` | {loc} | {it.reason} |"
            )
        L.append("")

    path_items = [i for i in rep.items if i.check == "path-existence"]
    section(
        "路径存在性 (path-existence)", path_items,
        "> 分类含义: `MISSING`=坏引用(算 drift) / `PLANNED`=计划中或已废弃(不算) / "
        "`PLACEHOLDER`=占位符或示意代码(不算) / `HISTORICAL`=历史档案引用(不算)。"
        "规则按级联优先级判定，R5 迁移编号冲突优先于所有降噪规则。\n"
        "> **R9_RELEASE_NOTES_HISTORICAL**: `docs/release-notes/` 是历史档案，其中引用的"
        "历史路径（如事后被重构、或被 `.gitignore` 的 `v2_plugins/`）不构成文档错误，"
        "故不计 drift；**但条目仍完整列在下表**以便人工抽查，不做静默吞掉。"
        "**取舍**: 规则按目录整体降级，不逐条判断某条引用是否笔误指向现存但无关的目录"
        "（笔误需语义推理，成本高、误报多）；为守住「宁可报多不漏」，该规则置于级联末端"
        "（R1/R5/R4/R2/R3/R6/R7 之后、R8 之前），更贴切的成因仍会优先命中并精确归类，"
        "且作用范围严格限定 `docs/release-notes/`，不扩展到其它目录。",
    )
    link_items = [i for i in rep.items if i.check == "doc-link"]
    section(
        "文档内链完整性 (doc-link)", link_items,
        f"> 共检查 {ls.get('links_total', 0)} 条文档间相对链接（已排除 http/mailto/锚点/图片）。",
    )
    dup_items = [i for i in rep.items if i.check == "duplicate-docs"]
    section(
        "重复文档 (duplicate-docs)", dup_items,
        "> 同时按 H1 标题（`SAME_H1_TITLE`）和文件名 stem（`SAME_FILENAME_STEM`）分组，"
        "命中即提示两处内容应合并。",
    )

    return "\n".join(L)


# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

def run(docs_root: Path, repo_root: Path) -> RefReport:
    docs = iter_doc_files(docs_root)
    rep = RefReport()

    path_items, path_stats = check_path_existence(docs, repo_root)
    rep.items.extend(path_items)
    rep.stats["path_existence"] = path_stats

    link_items, link_stats = check_doc_links(docs)
    rep.items.extend(link_items)
    rep.stats["doc_link"] = link_stats

    dup_items, dup_stats = check_duplicate_docs(docs)
    rep.items.extend(dup_items)
    rep.stats["duplicate_docs"] = dup_stats

    # 待复核横幅台账（不计入 drift，只做可见性统计）
    banner_files = sorted(
        p for p in docs
        if "<!-- drift-banner:" in p.read_text(encoding="utf-8", errors="replace")
    )
    rep.stats["drift_banners"] = {
        "count": len(banner_files),
        "docs_scanned": len(docs),
        "files": [str(p.relative_to(repo_root)) for p in banner_files],
    }

    return rep


def main() -> None:
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--docs", required=True, type=Path)
    p.add_argument("--repo", required=True, type=Path)
    p.add_argument("--out-md", required=True, type=Path)
    p.add_argument("--out-json", required=True, type=Path)
    args = p.parse_args()

    rep = run(args.docs, args.repo)

    args.out_md.parent.mkdir(parents=True, exist_ok=True)
    args.out_md.write_text(render_markdown(rep), encoding="utf-8")
    args.out_json.write_text(
        json.dumps(
            {"total": rep.drift_count, "stats": rep.stats,
             "items": [asdict(i) for i in rep.items]},
            ensure_ascii=False, indent=2,
        ),
        encoding="utf-8",
    )

    ps = rep.stats["path_existence"]
    print(f"ref checks: {rep.drift_count} drift item(s)")
    print(f"  docs scanned:        {ps['docs_scanned']}")
    print(f"  path refs:           {ps['refs_total']} "
          f"(unique {ps['refs_unique']}, exist {ps['refs_exist']})")
    for st in ("MISSING", "PLANNED", "PLACEHOLDER", "HISTORICAL"):
        print(f"    {st:<12}: {sum(1 for i in rep.items if i.check == 'path-existence' and i.status == st)}")
    print(f"  doc links:           {rep.stats['doc_link']['links_total']} "
          f"(broken {rep.stats['doc_link']['links_broken']})")
    print(f"  duplicate groups:    {rep.stats['duplicate_docs']['duplicate_groups']}")
    print(f"wrote: {args.out_md}")


if __name__ == "__main__":
    main()
