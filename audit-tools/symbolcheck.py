#!/usr/bin/env python3
"""
symbolcheck.py — L2 符号层检查：文档提到的类型/类/Token 在代码中是否存在。

## 定位：**审阅清单，不是门禁**

与 refchecks.py 的 path-existence 不同，这里判定的是「语义漂移」：
文档提到了某个类型名，但代码里找不到。这比路径检查有价值得多（枚举改名、
方法重命名、Token 消失都能抓到），**但误报率显著更高** —— 约有 50% 的命中
是下列不可消除的噪声：

- JS / DOM / React 全局（`Promise`、`Proxy`、`ResizeObserver`…）
- 第三方包导出（`Recharts`、`lucide` 的图标名如 `Grid`/`Text`/`Wand2`）
- 历史文档里描述**已删除**子系统的符号（release-notes / 迁移指南）
- 计划类文档里**尚未实现**的符号

因此本检查的 status 恒为 `SYMBOL_HINT`，**不计入 drift、不阻断 CI**，
只在报告中列出供逐篇审阅时取用。把它当门禁只会训练团队忽略告警。

## 用法

    python3 audit-tools/symbolcheck.py --docs docs --repo .

输出 JSON 到 stdout，供 refchecks/aligner 消费。
"""

from __future__ import annotations

import argparse
import glob
import json
import re
from pathlib import Path

# ── 外部标识符（不属于本仓库的符号）────────────────────────────────────────
# 维护原则：宁可漏报也不要让噪声淹没真问题。新增 npm 包时同步补充其导出名。

# JS / DOM / Node 全局
JS_GLOBALS = set(
    """
AbortController Array AsyncLocalStorage BigInt BroadcastChannel Buffer ClassList CustomEvent
DataTransfer Error ErrorBoundary Event EventTarget File FileReader Float32Array FormData
Headers Infinity Intl JSON Map Math MessageChannel MessageEvent MutationObserver Navigator
Node Number Object Promise Proxy ReadableStream Reflect Request Response ResizeObserver
Set SharedArrayBuffer String Symbol Text TextDecoder TextEncoder TypeError URL
URLSearchParams WeakMap WeakSet WebSocket Worker XMLHttpRequest
AbortSignal AggregateError Int32Array Uint8Array Uint8ClampedArray Float64Array
Int16Array Uint16Array Uint32Array Intl WebAssembly performance crypto navigator
window document localStorage sessionStorage console globalThis structuredClone
queueMicrotask setTimeout clearTimeout setInterval clearInterval requestAnimationFrame
cancelAnimationFrame
""".split()
)

# 常见的包名 / 框架名（文档会直接提，但它们不是本仓库导出的符号）
KNOWN_PACKAGE_NAMES = set(
    """
React ReactDOM ReactDOMClient ReactDOMServer Recharts Recharts2 LucideReact Konva
Express ExpressError Koa Fastify Vite Vitest Jest Webpack Rollup esbuild TypeScript
Zustand ReactRouter TanStackQuery Axios Lodash Ramda RxJS SocketIO SocketIoClient
Dayjs Moment Luxon Zod Yup Joi Commander Inquirer Chalk Ora
jsPDF jspdfAutotable ExcelJS SheetJS XLSX JSZip PptxGenJS
TailwindCSS Lucide Bootstrap Antd MUI Chakra
""".split()
)

# SQL / 协议 / 策略字面量
DOMAIN_LITERALS = set(
    """
SELECT INSERT UPDATE DELETE ALTER ATTACH DETACH PRAGMA VACUUM CREATE DROP FROM WHERE
JOIN INDEX TABLE PRIMARY FOREIGN KEY UNIQUE NOT NULL DEFAULT REFERENCES BEGIN COMMIT
ROLLBACK VALUES SET GROUP ORDER LIMIT OFFSET NULL TRUE FALSE
AVG SUM COUNT MAX MIN ROUND TOTAL LATEST AVERAGE FIRST SECOND TCOUNT
GET POST PUT PATCH DELETE HEAD OPTIONS
EADDRINUSE ECONNRESET SIGINT SIGTERM HEALTHCHECK CMD ENTRYPOINT ENV EXPOSE WORKDIR
VOLUME USER PORT HOST TERM VITEST NODE_ENV
Dockerfile DockerCompose Makefile
""".split()
)

# 计划 / 快照类文档：合法引用不存在的符号
PLAN_DOC_RE = re.compile(
    r"(roadmap/|audit-report|audit\.md|synchronization-report|optimization-plan"
    r"|remediation-and-opt|navigation-audit|quality-audit|foundation-audit"
    r"|interactive-classroom-and-editor|whiteboard-realtime-sync-audit)"
)

# 行内计划语境
PLAN_CTX_RE = re.compile(
    r"(计划|待实现|尚未|将要|未来|规划|建议|应当|拟|TODO|roadmap|后续|设想|预期)"
)

# 否定语境：文档**刻意**引用不存在的符号来警示读者（"此 Token 不存在"、
# "该文件已整体删除"、"全仓零命中"…）。这类不是漂移，必须排除 ——
# 否则本检查最集中的命中会全部来自"反面教材"章节。
NEGATION_RE = re.compile(
    r"(不存在|切勿捏造|已整体删除|已删除|零命中|不再存在|已废弃|已移除|无生产消费方"
    r"|曾存在|历史上确实|历史包袱|并非当前|不代表当前存在|并不存在|没有对应|未定义)"
)

# 文档里反引号包裹的 PascalCase 标识符
DOC_SYMBOL_RE = re.compile(r"`([A-Z][a-zA-Z0-9]{3,})`")

CODE_GLOBS = (
    "packages/*/**/*.ts",
    "packages/*/**/*.tsx",
    "server/**/*.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "scripts/*.ts",
    "scripts/*.mjs",
)

CODE_PATTERNS = (
    r"export\s+(?:default\s+)?(?:abstract\s+)?(?:class|function|interface|type|enum)\s+([A-Za-z_][\w]*)",
    r"export\s+const\s+([A-Za-z_][\w]*)",
    r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_][\w]*)",
    r"^\s*interface\s+([A-Za-z_][\w]*)",
    r"^\s*(?:export\s+)?enum\s+([A-Za-z_][\w]*)",
    r"^\s*export\s+type\s+([A-Za-z_][\w]*)",
)


def collect_code_symbols(repo_root: Path) -> set[str]:
    """从源码抽取符号。

    覆盖四种声明形态 —— 仓库里四种都在用，漏任何一种都会制造大量误报：
      1. `class/function/interface/type/enum NAME`
      2. `export const NAME`
      3. 枚举体成员 / const 对象键 / interface 成员
      4. **字符串字面量联合成员** `| 'ClassroomCreated'`
         —— 白板/课堂的状态机大量用这种写法而非 enum，漏了它会产生成片误报。
    另加 Token 标识串 `'@openlearn/core:IPluginHost'` → `IPluginHost`。
    """
    symbols: set[str] = set()
    files: set[str] = set()
    for g in CODE_GLOBS:
        files.update(glob.glob(str(repo_root / g), recursive=True))

    for f in files:
        if "node_modules" in f or "__tests__" in f:
            continue
        try:
            src = Path(f).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        for p in CODE_PATTERNS:
            symbols.update(re.findall(p, src, re.M))
        for m in re.finditer(r"(?:export\s+)?enum\s+\w+\s*\{([\s\S]*?)\n\}", src):
            symbols.update(re.findall(r"^\s*([A-Za-z_]\w*)\s*=", m.group(1), re.M))
        for m in re.finditer(r"(?:export\s+)?const\s+\w+\s*(?::[^=]+)?=\s*\{([\s\S]*?)\n\}", src):
            symbols.update(re.findall(r"(?:^|[,{\s])([A-Za-z_]\w*)\s*:", m.group(1)))
        for m in re.finditer(r"interface\s+\w+(?:<[^>]*>)?\s*\{([\s\S]*?)\n\}", src):
            symbols.update(re.findall(r"^\s*(?:readonly\s+)?([A-Za-z_]\w*)\??\s*[:(]", m.group(1), re.M))
        # 字符串字面量联合成员
        symbols.update(re.findall(r"^\s*\|\s*'([A-Za-z_][\w]*)'", src, re.M))
        # Token 标识串
        symbols.update(re.findall(r"['\"]@[\w-]+/[a-z-]+:([A-Za-z_]\w+)['\"]", src))
        # 任意位置的 PascalCase 字符串字面量 —— 事件名（'StageStarted'）、角色名
        # （'teacher' 除外）等大量以字面量而非声明形式存在，只认声明会成片误报。
        symbols.update(re.findall(r"['\"]([A-Z][a-zA-Z0-9]{2,})['\"]", src))

    return symbols


def _external_symbols(repo_root: Path) -> set[str]:
    """外部标识符集合：全局 + 包名 + 包导出名。"""
    ext = JS_GLOBALS | KNOWN_PACKAGE_NAMES | DOMAIN_LITERALS
    for pj in [repo_root / "package.json", *glob.glob(str(repo_root / "packages/*/package.json"))]:
        try:
            pkg = json.loads(Path(pj).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        ext |= set(pkg.get("dependencies") or {})
        ext |= set(pkg.get("devDependencies") or {})
        if pkg.get("name"):
            ext.add(pkg["name"])
    # 图标类包的导出名（lucide 的 `Grid` / `Text` / `Wand2` 等会被文档直接引用）
    for dts in glob.glob(str(repo_root / "node_modules/.pnpm/lucide-react*/node_modules/lucide-react/dist/*.d.ts")):
        try:
            ext.update(re.findall(r"declare const ([A-Z]\w+)", Path(dts).read_text(encoding="utf-8", errors="ignore")))
        except OSError:
            pass
    return ext


def check(docs_root: Path, repo_root: Path) -> dict:
    known = collect_code_symbols(repo_root) | _external_symbols(repo_root)

    # 符号 -> [(文档, 行号)]
    hints: dict[str, list[tuple[str, int]]] = {}
    for md in sorted(glob.glob(str(docs_root / "**/*.md"), recursive=True)):
        if "_build" in md:
            continue
        rel = Path(md).relative_to(repo_root) if str(md).startswith(str(repo_root)) else Path(md)
        is_plan_doc = bool(PLAN_DOC_RE.search(str(rel)))
        try:
            text = Path(md).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lines = text.split("\n")
        for m in DOC_SYMBOL_RE.finditer(text):
            name = m.group(1)
            if name in known or name.isupper():
                continue
            lineno = text[: m.start()].count("\n")
            if is_plan_doc:
                continue
            ctx = "\n".join(lines[max(0, lineno - 3) : lineno + 1])
            if PLAN_CTX_RE.search(ctx):
                continue
            # 否定语境：文档刻意说明该符号不存在（反面教材章节）
            if NEGATION_RE.search(ctx):
                continue
            hints.setdefault(name, []).append((str(rel), lineno + 1))

    by_doc: dict[str, list[str]] = {}
    for name, locs in hints.items():
        for doc, _line in locs:
            by_doc.setdefault(doc, []).append(name)

    return {
        "code_symbols": len(known),
        "hint_count": len(hints),
        "hints": {k: sorted(v) for k, v in sorted(hints.items())},
        "by_doc": {k: sorted(set(v)) for k, v in sorted(by_doc.items())},
    }


def render_markdown(result: dict) -> str:
    L: list[str] = []
    L.append("### 🔤 符号存在性提示 (symbol-existence)")
    L.append("")
    L.append("> **仅供审阅，不计入 drift、不阻断 CI。** 文档提到某个类型/类/Token，"
             "但代码里搜不到。约一半命中是 JS 全局、第三方包导出、历史文档引用已删除"
             "子系统、或计划中的符号 —— 精度不足以当门禁，强行设成阻断只会训练团队忽略告警。")
    L.append(f"> 代码侧已索引符号 **{result['code_symbols']}** 个。")
    L.append("")
    if not result["hints"]:
        L.append("✅ 无命中。")
        return "\n".join(L)
    L.append(f"共 **{result['hint_count']}** 个符号在文档中出现但未在代码中找到：")
    L.append("")
    L.append("| 符号 | 出现位置 |")
    L.append("| --- | --- |")
    for name, locs in result["hints"].items():
        where = "、".join(f"`{d}:{ln}`" for d, ln in locs[:3])
        more = f" 等 {len(locs)} 处" if len(locs) > 3 else ""
        L.append(f"| `{name}` | {where}{more} |")
    L.append("")
    L.append("按文档聚合：")
    L.append("")
    for doc, names in result["by_doc"].items():
        L.append(f"- `{doc}` — {len(names)} 个：" + "、".join(f"`{n}`" for n in names[:8]))
    L.append("")
    return "\n".join(L)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--docs", required=True, type=Path)
    p.add_argument("--repo", required=True, type=Path)
    p.add_argument("--out-json", type=Path)
    p.add_argument("--out-md", type=Path)
    a = p.parse_args()

    result = check(a.docs, a.repo)
    if a.out_json:
        Path(a.out_json).write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    md = render_markdown(result)
    if a.out_md:
        Path(a.out_md).write_text(md, encoding="utf-8")
    else:
        print(md)


if __name__ == "__main__":
    main()
