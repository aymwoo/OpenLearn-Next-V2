#!/usr/bin/env python3
"""
envcheck.py — 环境变量三方比对（代码 / .env.example / 配置文档）

为什么需要这个检查
------------------
`docs/configuration/system-configuration.md` 声称自己是「全部服务端配置入口」，
但它的正确性此前**完全靠人工维护**。2026-10-26 的文档审计中，仅一个版本就漏登
了 20+ 个变量（插件 RSS/CPU 配额、探活宽限、社区签名公钥、保留策略等），
而 `refchecks.py` / `symbolcheck.py` 都抓不到 —— 变量名既不是文件路径,也不是
代码符号,它是第三种引用形态。

与既有检查的分工
----------------
- refchecks.py    路径 / 内链 / 重复文档
- symbolcheck.py  代码符号存在性（语义提示）
- envcheck.py     **配置键的三方一致性**（本模块）

三个事实源
----------
A. 代码读取   `process.env.X` / `process.env['X']` / `process.env[CONST]`
              （CONST 会先解析同仓内的 `const CONST = 'X'` 字面量）
B. .env.example 声明的键（含被注释的 `# KEY=`）
C. 配置文档    docs/configuration/*.md 表格首列登记的键

判定分级（刻意窄化门禁）
------------------------
沿用 run.sh 的既有哲学：「当门禁会训练团队忽略告警」就不要设成门禁。
故**只有两类计入 drift**：

  D1  DOC_NOT_READ   文档表格登记了,但全仓任何作用域都不读取 —— 改名/删除后
                     文档没跟上,运维照着设了却毫无作用。误报率接近 0。
  D2  CODE_NOT_DOC   生产作用域读取且符合平台命名前缀（OPENLEARN_ / PLUGIN_ /
                     BRIDGE_ / METRICS_）,但配置文档全篇未提。前缀已经宣告了
                     "这是平台自己的开关",故不需要人工判断归属。

其余全部降为 hint（不计入 drift,但进报告）：
  - 无前缀的平台变量（BACKUP_DIR / LOG_LEVEL / RETENTION_* 等历史命名）
  - 仅在测试作用域读取的变量（PLAYWRIGHT_TEST 之类本就该只在测试里）
  - .env.example 与代码的单向不对称
  - 无法静态解析的动态读取点

只用标准库。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# 扫描范围
# ---------------------------------------------------------------------------

SCAN_SUFFIXES = (".ts", ".tsx", ".mjs", ".cjs", ".js")

# 构建产物 / 依赖 / 外部插件目录：不是本仓源码，读了也不算数
SKIP_DIR_PARTS = (
    "node_modules",
    ".git",
    "dist",
    "coverage",
    "__pycache__",
    ".vite-cache",
    ".venv",
    "v2_plugins",  # 第三方插件，不属平台配置面
)

# 配置文档目录（canonical 登记处，D1 只认这里）
CONFIG_DOC_DIR = "docs/configuration"

# 「注册表文档」判定：表格首列出现 >= 5 个 `KEY` 行的 .md 即视为一份环境变量清单。
# 本仓刻意存在两份清单（docs/configuration/system-configuration.md 与
# docs/architecture/configuration.md），后者自陈"覆盖更全"。只认单文件会把
# 另一份里已登记的键误报成未登记，故 documented 取全仓注册表文档的并集。
REGISTRY_MIN_ROWS = 5

# 测试作用域：这些路径下的读取不算"生产读取"
TEST_MARKERS = ("__tests__", "/e2e/", "e2e/")
TEST_FILE_RE = re.compile(r"\.(?:test|spec)\.[cm]?[jt]sx?$")
TEST_CONFIG_FILES = {"vitest.config.ts", "playwright.config.ts", "playwright.beta.config.ts"}

# 开发作用域：dev server / 一次性脚本 / 仓库内工具脚本
DEV_FILE_RE = re.compile(r"^scripts/(?:dev-|seed|fixture)|^scripts/")

# 外部注入：Node / CI / 测试运行器 / 浏览器工具链提供的变量，不属于平台配置。
# 这里用显式清单而非模式匹配 —— 清单短且稳定，比正则更不容易误伤。
EXTERNAL = {
    "NODE_ENV": "Node 运行时",
    "PATH": "进程环境",
    "HOME": "进程环境",
    "TERM": "终端",
    "CI": "CI 平台",
    "FORCE_COLOR": "Node/CLI 工具链",
    "DEBUG": "第三方库调试开关",
    "NODE_OPTIONS": "Node 运行时",
    "VITEST": "vitest",
    "VITEST_MAX_FORKS": "vitest",
    "VITEST_POOL_ID": "vitest",
    "LOCALAPPDATA": "Windows 进程环境",
    "PLAYWRIGHT_TEST": "playwright / 测试基建",
    "PLAYWRIGHT_BASE_URL": "playwright",
    "OPENAI_API_KEY": "第三方模型供应商凭据（测试夹具）",
    "ANTHROPIC_AUTH_TOKEN": "第三方模型供应商凭据（测试夹具）",
    "SENTRY_DSN": "外部监控服务",
    "__PLUGIN_WORKER_DATA": "worker 内部 IPC 载荷",
}

# D2 的判定前缀：带这些前缀的键属于"平台自己宣告的开关"
PLATFORM_PREFIXES = ("OPENLEARN_", "PLUGIN_", "BRIDGE_", "METRICS_")

# ---------------------------------------------------------------------------
# 提取规则
# ---------------------------------------------------------------------------

# process.env.KEY
ENV_DOT_RE = re.compile(r"process\.env\.([A-Za-z_][A-Za-z0-9_]*)")
# process.env['KEY'] / process.env["KEY"]
ENV_IDX_RE = re.compile(r"process\.env\[\s*['\"]([A-Za-z0-9_]+)['\"]\s*\]")
# process.env[SOME_CONST]  —— 需二次解析
ENV_DYN_RE = re.compile(r"process\.env\[\s*([A-Za-z_$][\w$]*)\s*\]")

# `env` 别名绑定：本仓大量使用 `function f(env: NodeJS.ProcessEnv = process.env)`
# 与 `const env = options.env ?? process.env`，只认 process.env 的读取会漏掉整片配额/
# 保留策略/签名相关变量（2026-10-26 实测漏掉 5 个）。故按「文件内存在绑定」放行 env.X。
ENV_BINDING_RE = re.compile(
    r"(?:const|let|var)\s+env\s*=[^;\n]*process\.env"
    r"|env\s*:\s*NodeJS\.ProcessEnv\s*=\s*process\.env"
    r"|env\s*=\s*process\.env"
)
ALIAS_DOT_RE = re.compile(r"(?<![\w.$])env\.([A-Z][A-Z0-9_]{2,})\b")
ALIAS_IDX_RE = re.compile(r"(?<![\w.$])env\[\s*['\"]([A-Za-z0-9_]+)['\"]\s*\]")

# 平台**自己写入**的变量：如 child-spawn 把 manifest 授权的主机名塞进
# OPENLEARN_PLUGIN_NET_ALLOW 传给子进程，preload 读完即 delete。
# 这类键不是用户配置面 —— 用户设了也会被覆盖，登记进文档反而误导。
ENV_WRITE_RE = re.compile(
    r"(?:process\.env|envOverrides|childEnv|childProcessEnv)\.([A-Z][A-Z0-9_]{2,})\s*=(?!=)"
)
# const SOME_CONST = 'OPENLEARN_...';
CONST_LITERAL_RE = re.compile(
    r"(?:^|\s)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*['\"]([A-Z][A-Z0-9_]{2,})['\"]"
)

# .env.example: KEY= 或 # KEY=
DOTENV_RE = re.compile(r"^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=", re.M)

# 配置文档表格首列：| `KEY` | 默认值 | 说明 |
DOC_TABLE_RE = re.compile(r"^\|\s*`([A-Z][A-Z0-9_]{2,})`\s*\|", re.M)
# 文档任意位置的反引号大写 token（宽松口径，仅用于"是否被提及"）
DOC_MENTION_RE = re.compile(r"`([A-Z][A-Z0-9_]{2,})`")

# 看起来像环境变量名的最小约束（避免把 `SQL`、`JSON` 之类当配置键）
def looks_like_env(key: str) -> bool:
    if "_" not in key:
        return key in {"PORT", "HOST", "DEBUG", "CI", "TERM", "HOME", "PATH"}
    return True


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class Read:
    key: str
    file: str
    line: int
    scope: str  # prod | test | dev
    via: str  # dot | index | const:<NAME>


@dataclass
class Finding:
    code: str
    key: str
    detail: str
    evidence: list[str] = field(default_factory=list)


@dataclass
class EnvReport:
    drift: list[Finding] = field(default_factory=list)
    hints: list[Finding] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "drift_count": len(self.drift),
            "hint_count": len(self.hints),
            "drift": [f.__dict__ for f in self.drift],
            "hints": [f.__dict__ for f in self.hints],
            "stats": self.stats,
        }


# ---------------------------------------------------------------------------
# 代码侧采集
# ---------------------------------------------------------------------------


def _skip(path: Path, repo: Path) -> bool:
    rel = path.relative_to(repo)
    if any(part in SKIP_DIR_PARTS for part in rel.parts):
        return True
    return path.suffix not in SCAN_SUFFIXES


def _scope(rel: str) -> str:
    if TEST_FILE_RE.search(rel) or rel.split("/")[0] == "e2e" or Path(rel).name in TEST_CONFIG_FILES:
        return "test"
    if any(m.strip("/") in rel for m in TEST_MARKERS):
        return "test"
    if DEV_FILE_RE.search(rel):
        return "dev"
    return "prod"


def _tokens(key: str) -> set[str]:
    """把键名切成词元，用于识别「同一组词换个顺序」的兼容别名。

    例：OPENLEARN_RETENTION_PENDING_COMMANDS_DAYS
        OPENLEARN_PENDING_COMMANDS_RETENTION_DAYS  → 词元完全相同
        OPENLEARN_EVENT_RETENTION_DAYS / RETENTION_EVENTS_DAYS → 去掉前缀与复数后相同
    """
    k = key
    for p in PLATFORM_PREFIXES:
        if k.startswith(p):
            k = k[len(p) :]
            break
    out = set()
    for tok in k.split("_"):
        if not tok:
            continue
        out.add(tok[:-1] if tok.endswith("S") and len(tok) > 3 else tok)
    return out


def _same_family(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return False
    return len(ta & tb) / len(ta | tb) >= 0.6


def collect_code(repo: Path) -> tuple[
    list[Read], dict[str, str], list[tuple[str, int, str]], dict[str, list[str]], list[tuple[str, str]]
]:
    """返回 (读取点, 常量表, 无法解析的动态读取, 平台自写的键, `||` 链上的候选别名对)。"""
    files: list[tuple[Path, str]] = []
    for path in repo.rglob("*"):
        if not path.is_file() or _skip(path, repo):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        files.append((path, text))

    # 先建常量表：跨文件共享（导出常量常被别处使用）
    const_map: dict[str, str] = {}
    for _, text in files:
        for m in CONST_LITERAL_RE.finditer(text):
            const_map.setdefault(m.group(1), m.group(2))

    reads: list[Read] = []
    unresolved: list[tuple[str, int, str]] = []
    written: dict[str, list[str]] = {}
    aliases: list[tuple[str, str]] = []
    for path, text in files:
        rel = path.relative_to(repo).as_posix()
        scope = _scope(rel)
        # `env` 别名仅在该文件确实把 env 绑到 process.env 时才采信
        alias_bound = bool(ENV_BINDING_RE.search(text))
        for lineno, line in enumerate(text.splitlines(), 1):
            for m in ENV_DOT_RE.finditer(line):
                reads.append(Read(m.group(1), rel, lineno, scope, "dot"))
            for m in ENV_IDX_RE.finditer(line):
                reads.append(Read(m.group(1), rel, lineno, scope, "index"))
            for m in ENV_DYN_RE.finditer(line):
                name = m.group(1)
                # 已被 ENV_IDX_RE 覆盖的字面量跳过
                if name.startswith(("'", '"')):
                    continue
                if name in const_map:
                    reads.append(Read(const_map[name], rel, lineno, scope, f"const:{name}"))
                elif name not in ("process",):
                    unresolved.append((rel, lineno, name))
            if alias_bound:
                for m in ALIAS_DOT_RE.finditer(line):
                    reads.append(Read(m.group(1), rel, lineno, scope, "alias:env"))
                for m in ALIAS_IDX_RE.finditer(line):
                    reads.append(Read(m.group(1), rel, lineno, scope, "alias:env[]"))
            # 只有生产作用域的写入才算"平台内部传递"；
            # 测试里 `process.env.X = ...` 是在造场景，不能据此豁免该键的文档义务。
            if scope == "prod":
                for m in ENV_WRITE_RE.finditer(line):
                    written.setdefault(m.group(1), []).append(f"{rel}:{lineno}")

        # 别名回退：`process.env.OPENLEARN_X || process.env.OLD_Y` 里的旧名。
        # 这类键是刻意保留的兼容回退，不该被要求单独登记成一行。
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if "||" not in line:
                continue
            window = " ".join(lines[max(0, i - 2) : i + 3])
            found = ENV_DOT_RE.findall(window)
            if len(found) < 2:
                continue
            for other in found[1:]:
                if other != found[0] and _same_family(other, found[0]):
                    aliases.append((other, found[0]))
    return reads, const_map, unresolved, written, aliases


# ---------------------------------------------------------------------------
# 文档 / .env.example 侧采集
# ---------------------------------------------------------------------------


def collect_dotenv(repo: Path) -> dict[str, int]:
    p = repo / ".env.example"
    if not p.exists():
        return {}
    text = p.read_text(encoding="utf-8", errors="ignore")
    return {m.group(1): text[: m.start()].count("\n") + 1 for m in DOTENV_RE.finditer(text)}


def collect_docs(repo: Path) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """返回 (配置文档表格键, 注册表文档表格键, 全仓散文提及键)。

    三档口径对应三种不同的举证强度：

    - `table`  docs/configuration/ 下的表格行。D1「登记了就必须能读」只认这一档 ——
      它是唯一被声明为权威清单的地方，写进去却没人读即漂移。
    - `registry` 任意 docs/**/*.md 里表格行 >= REGISTRY_MIN_ROWS 的文档中的表格键。
      本仓刻意存在两份清单，这一档用于避免双清单互为盲区。
    - `prose`   全仓任何 .md 中被反引号包裹的 `KEY`。运维能在某篇文档里读到用法，
      就算"可发现"，不作为 drift —— 检查的目标是"没有隐形旋钮"，不是
      "每个旋钮都必须进同一张表"。
    """
    table: dict[str, str] = {}
    registry: dict[str, str] = {}
    prose: dict[str, str] = {}
    docs_root = repo / "docs"
    if not docs_root.exists():
        return table, registry, prose
    for path in sorted(docs_root.rglob("*.md")):
        rel = path.relative_to(repo).as_posix()
        text = path.read_text(encoding="utf-8", errors="ignore")
        for m in DOC_MENTION_RE.finditer(text):
            prose.setdefault(m.group(1), rel)
        rows = [m.group(1) for m in DOC_TABLE_RE.finditer(text)]
        if len(rows) < REGISTRY_MIN_ROWS:
            continue
        for key in rows:
            registry.setdefault(key, rel)
            if rel.startswith(CONFIG_DOC_DIR + "/"):
                table.setdefault(key, rel)
    return table, registry, prose


# ---------------------------------------------------------------------------
# 比对
# ---------------------------------------------------------------------------


def compare(repo: Path) -> EnvReport:
    reads, const_map, unresolved, written, aliases = collect_code(repo)
    dotenv = collect_dotenv(repo)
    doc_table, doc_registry, doc_prose = collect_docs(repo)

    rep = EnvReport()

    prod: dict[str, list[Read]] = {}
    test: dict[str, list[Read]] = {}
    for r in reads:
        bucket = prod if r.scope == "prod" else test
        bucket.setdefault(r.key, []).append(r)

    documented = set(doc_table) | set(doc_registry) | set(doc_prose) | set(dotenv)
    known = set(prod) | set(test)

    # 别名回退只在其"正名"确实已登记时才算豁免：
    # 正名有文档 → 旧名可解释；正名也没文档 → 两个都得算 drift。
    alias_map: dict[str, str] = {}
    for other, canon in aliases:
        if canon in documented and other not in documented:
            alias_map.setdefault(other, canon)

    def ev(rs: list[Read], n: int = 3) -> list[str]:
        return [f"{r.file}:{r.line} ({r.via})" for r in rs[:n]]

    # --- D1: 文档登记但从不读取 ---
    for key, docfile in sorted(doc_table.items()):
        if key in EXTERNAL:
            continue
        if key in known or key in const_map.values():
            continue
        rep.drift.append(
            Finding(
                code="D1",
                key=key,
                detail=f"{docfile} 表格登记了该键，但全仓无任何读取点（改名或删除后文档未同步）",
                evidence=[f"{docfile}: 表格首列"],
            )
        )

    # --- D2: 生产读取但配置文档未登记 ---
    for key in sorted(prod):
        if key in EXTERNAL:
            continue
        if not key.startswith(PLATFORM_PREFIXES):
            continue  # 无前缀归 hint，避免把历史命名误判成 drift
        if key in documented:
            continue
        if key in written:
            # 平台自己写入再读取的内部传递变量（子进程 env 注入），不是用户配置面
            rep.hints.append(
                Finding(
                    code="H5",
                    key=key,
                    detail="代码自身写入该键后由子进程读取（内部传递），非用户可配置项；登记进文档会误导",
                    evidence=written[key][:3],
                )
            )
            continue
        if key in alias_map:
            rep.hints.append(
                Finding(
                    code="H6",
                    key=key,
                    detail=f"`{alias_map[key]}` 的兼容别名（`||` 回退链），无需单独登记",
                    evidence=ev(prod[key]),
                )
            )
            continue
        rep.drift.append(
            Finding(
                code="D2",
                key=key,
                detail=f"生产代码读取该键（{len(prod[key])} 处），但无任何注册表文档登记",
                evidence=ev(prod[key]),
            )
        )

    # --- D3: 无前缀的生产变量未登记（别名回退除外）---
    for key in sorted(prod):
        if key in EXTERNAL or key.startswith(PLATFORM_PREFIXES):
            continue
        if key in documented:
            continue
        if key in alias_map:
            rep.hints.append(
                Finding(
                    code="H6",
                    key=key,
                    detail=f"`{alias_map[key]}` 的兼容别名（`||` 回退链），无需单独登记",
                    evidence=ev(prod[key]),
                )
            )
            continue
        if key in written:
            rep.hints.append(
                Finding(
                    code="H5",
                    key=key,
                    detail="代码自身写入该键后读取（内部传递），非用户可配置项",
                    evidence=written[key][:3],
                )
            )
            continue
        rep.drift.append(
            Finding(
                code="D3",
                key=key,
                detail=f"生产代码读取该键（{len(prod[key])} 处），但无任何注册表文档登记；运维可调但无从得知",
                evidence=ev(prod[key]),
            )
        )

    # --- H2: 仅测试作用域读取，且文档没提 ---
    for key in sorted(test):
        if key in prod or key in EXTERNAL or key in documented:
            continue
        rep.hints.append(
            Finding(
                code="H2",
                key=key,
                detail="仅测试作用域读取（生产不生效），文档未提；若为测试专用可忽略",
                evidence=ev(test[key]),
            )
        )

    # --- H3: .env.example 与代码不对称 ---
    for key in sorted(set(dotenv) - known):
        if key in EXTERNAL:
            continue
        rep.hints.append(
            Finding(
                code="H3",
                key=key,
                detail=f".env.example 第 {dotenv[key]} 行声明了该键，但代码中无读取点（预留项或已废弃）",
                evidence=[f".env.example:{dotenv[key]}"],
            )
        )

    # --- H4: 无法静态解析的动态读取 ---
    seen: set[tuple[str, str]] = set()
    for rel, lineno, name in unresolved:
        if (rel, name) in seen:
            continue
        seen.add((rel, name))
        rep.hints.append(
            Finding(
                code="H4",
                key=f"process.env[{name}]",
                detail="动态键名无法静态解析，本检查覆盖不到；若确为配置开关请改为字面量",
                evidence=[f"{rel}:{lineno}"],
            )
        )

    rep.stats = {
        "prod_keys": len(prod),
        "test_keys": len(test),
        "dotenv_keys": len(dotenv),
        "doc_table_keys": len(doc_table),
        "doc_registry_keys": len(doc_registry),
        "doc_prose_keys": len(doc_prose),
        "unresolved_dynamic": len(seen),
        "const_aliases": len(const_map),
    }
    return rep


# ---------------------------------------------------------------------------
# 渲染
# ---------------------------------------------------------------------------


def render_md(rep: EnvReport) -> str:
    s = rep.stats
    out: list[str] = []
    out.append("# 环境变量三方比对报告")
    out.append("")
    out.append(
        "自动生成，请勿手工编辑。规则与判定分级见 `audit-tools/envcheck.py` 模块文档。"
    )
    out.append("")
    out.append("## 覆盖摘要")
    out.append("")
    out.append("| 事实源 | 键数 |")
    out.append("| --- | --- |")
    out.append(f"| 代码读取（生产作用域） | {s['prod_keys']} |")
    out.append(f"| 代码读取（测试/开发作用域） | {s['test_keys']} |")
    out.append(f"| `.env.example` 声明 | {s['dotenv_keys']} |")
    out.append(f"| 配置文档表格登记（权威清单） | {s['doc_table_keys']} |")
    out.append(f"| 其它注册表表格登记 | {s['doc_registry_keys']} |")
    out.append(f"| 全仓散文提及 | {s['doc_prose_keys']} |")
    out.append(f"| 常量间接键（`const X = 'KEY'`） | {s['const_aliases']} |")
    out.append(f"| 无法解析的动态读取 | {s['unresolved_dynamic']} |")
    out.append("")
    out.append(f"- **drift: {len(rep.drift)}**")
    out.append(f"- hint（不计入 drift）: {len(rep.hints)}")
    out.append("")

    def block(title: str, items: list[Finding], note: str) -> None:
        out.append(f"## {title}")
        out.append("")
        out.append(note)
        out.append("")
        if not items:
            out.append("（无）")
            out.append("")
            return
        out.append("| 键 | 判定 | 说明 | 证据 |")
        out.append("| --- | --- | --- | --- |")
        for f in items:
            ev = "<br>".join(f"`{e}`" for e in f.evidence[:3]) or "—"
            out.append(f"| `{f.key}` | {f.code} | {f.detail} | {ev} |")
        out.append("")

    d = [f for f in rep.drift]
    block(
        "drift（计入门禁）",
        d,
        "D1 = 文档登记但从不读取；D2 = 生产读取且带平台前缀但文档未登记。",
    )
    for code, title in (
        ("H2", "hint H2：仅测试作用域读取"),
        ("H3", "hint H3：.env.example 单向声明"),
        ("H4", "hint H4：动态读取（覆盖盲区）"),
        ("H5", "hint H5：平台自写的内部传递变量"),
        ("H6", "hint H6：兼容别名回退"),
    ):
        items = [f for f in rep.hints if f.code == code]
        block(title, items, "不计入 drift，供人工确认。")
    return "\n".join(out) + "\n"


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="环境变量三方比对")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--out-md", default="audit-tools/reports/env_report.md")
    ap.add_argument("--out-json", default="audit-tools/reports/env_report.json")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    rep = compare(repo)

    md_path = Path(args.out_md)
    json_path = Path(args.out_json)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(render_md(rep), encoding="utf-8")
    json_path.write_text(json.dumps(rep.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"env drift={len(rep.drift)} hint={len(rep.hints)} -> {md_path}")
    raise SystemExit(0)


if __name__ == "__main__":
    main()
