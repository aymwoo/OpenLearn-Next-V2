#!/usr/bin/env python3
"""
plugin_docs_check.py — 校验「面向插件作者的文档」中的代码示例是否与 SDK 真实契约一致。

为什么需要这一层：
    refchecks.py 查文件路径，symbolcheck.py 查代码符号，envcheck.py 查配置键，
    它们都不检查**代码块里的 API 用法**。而对一个照文档写插件的 Agent 来说，
    最致命的错误恰恰是 ctx.xxx() 这类"看着对、实则不存在"的调用 —— 它不报错在
    文档里，只报错在运行时。

检查项：
    P1  从 '@openlearn/plugin-sdk' 导入的符号不存在
    P2  ctx.<成员> 不存在于 PluginContext / FrontendPluginContext
    P3  ctx.services.<成员> 不存在于任一 services 定义
    P4  ctx.ui.<方法> 不存在于 FrontendPluginContext.ui
    P5  manifest 示例缺必填字段 / 字段类型明显不符

判定分级沿用 run.sh 的哲学：P1/P2 计 drift（确定会编译失败），P3/P4 计 drift
（运行时报 undefined is not a function），P5 只提示（示例可能是片段）。

用法：
    python3 audit-tools/plugin_docs_check.py [--json OUT]
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# 面向插件作者的文档（不含 release-notes / audit 快照）
DOC_GLOBS = [
    "docs/tutorials/plugin-development-tutorial.md",
    "docs/tutorials/plugin-frontend-guide.md",
    "docs/tutorials/plugin-courseware-extensions.md",
    "docs/plugin/*.md",
    "docs/sdk/*.md",
    "docs/reference/plugin-*.md",
    # AI 插件开发手册子树（docs/agent/）
    "docs/agent/agent-handbook.md",
    "docs/agent/facts-ledger.md",
    "docs/agent/playbook/*.md",
    "docs/agent/tutorial/*.md",
    "docs/agent/reference/*.md",
]

SDK_FILES = [
    "packages/plugin-sdk/index.ts",
    "packages/plugin-sdk/generated.d.ts",
    "packages/plugin-sdk/openlearn.d.ts",
]

CTX_SOURCES = [
    "packages/plugin-sdk/openlearn.d.ts",
    "packages/core/plugin-host/types.ts",
    "src/plugin-host/types.ts",
]

FENCE_RE = re.compile(r"^```([a-zA-Z]*)\s*$")
SDK_IMPORT_RE = re.compile(
    r"import\s+(?:type\s+)?(?:([\w*\s{},]+?)\s+from\s+)?['\"]@openlearn/plugin-sdk['\"]",
    re.S,
)
CTX_MEMBER_RE = re.compile(r"\b(?:ctx|hostCtx|pluginCtx)\.([A-Za-z_]\w*)")
CTX_SERVICE_RE = re.compile(r"\b(?:ctx|hostCtx|pluginCtx)\.services\.([A-Za-z_]\w*)")
CTX_UI_RE = re.compile(r"\b(?:ctx|hostCtx|pluginCtx)\.ui\.([A-Za-z_]\w*)")

# ── P6/P7/P8/P9 的识别模式 ───────────────────────────────────────────────
CAP_ARRAY_RE = re.compile(r"capabilitiesProposed\s*:\s*\[([^\]]*)\]", re.S)
CAP_REQUIRED_RE = re.compile(r"capabilityRequired\s*:\s*['\"]([^'\"]+)['\"]")
QUOTED_RE = re.compile(r"['\"]([^'\"]+)['\"]")
REGISTER_SLOT_RE = re.compile(r"registerExtensionPoint\s*\(\s*['\"]([^'\"]+)['\"]")
FRAME_CALL_RE = re.compile(r"\bcall\s*\(\s*['\"]([a-z]+\.[a-z]+)['\"]")
BRIDGE_MEMBER_RE = re.compile(r"\bbridge\.([A-Za-z_]\w*)")
# 沙箱里能拿到的上下文对象有**两个**，成员取并集：
#   frame 通道（server/utils/plugin-sandbox-frame.ts 的 makeCtx）：
#     pluginId / manifest / services{frontendApi,storageService} / ui{registerExtensionPoint,showToast}
#     / invokeCommand / context{get}
#   view 通道（window.OpenLearnPluginBridge）：
#     onInit / onContextUpdate / getContext / ui{toast,showToast,resize}
#     / invokeCommand / api{get,post,del} / storage{get,set,delete}
# 两条通道**都没有** `state` —— 它曾被文档捏造过。
BRIDGE_MEMBERS = {
    # frame 侧
    "pluginId",
    "manifest",
    "services",
    "ui",
    "invokeCommand",
    "context",
    # view 侧
    "onInit",
    "onContextUpdate",
    "getContext",
    "api",
    "storage",
}
BRIDGE_FORBIDDEN = {"state", "command"}


def _strip_comment(line: str) -> str:
    """去掉行尾 `//` 注释，但保留 `https://` 这类带冒号的斜杠。"""
    out = []
    i = 0
    while i < len(line):
        if line.startswith("//", i) and (i == 0 or line[i - 1] != ":"):
            break
        out.append(line[i])
        i += 1
    return "".join(out)


def _code_only(body: list[str]) -> list[tuple[int, str]]:
    """返回 (索引, 去注释后的代码行)；整行注释丢弃。

    文档里的反例常写成 `// import type { NotExist } from '...'`，
    不剔除注释会把「正确指出某符号不存在」的说明判成错误。
    """
    kept: list[tuple[int, str]] = []
    for idx, raw in enumerate(body):
        if raw.lstrip().startswith("//"):
            continue
        code = _strip_comment(raw)
        if code.strip():
            kept.append((idx, code))
    return kept


@dataclass
class Finding:
    code: str
    doc: str
    line: int
    detail: str
    symbol: str = ""


@dataclass
class Report:
    drift: list[Finding] = field(default_factory=list)
    hints: list[Finding] = field(default_factory=list)
    stats: dict[str, int] = field(default_factory=dict)


# ── 契约抽取 ────────────────────────────────────────────────────────────


def _declared_names(path: Path) -> set[str]:
    """收集一个 .ts/.d.ts 文件里声明的顶层名字（interface/type/const/class/function/enum）。"""
    text = path.read_text(encoding="utf-8", errors="ignore")
    names: set[str] = set()
    for m in re.finditer(
        r"^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?"
        r"(?:interface|type|const|let|class|function|enum)\s+([A-Za-z_]\w*)",
        text,
        re.M,
    ):
        names.add(m.group(1))
    return names


def _exported_from_index(path: Path) -> set[str]:
    """index.ts 真正对外导出的名字。"""
    text = path.read_text(encoding="utf-8", errors="ignore")
    names: set[str] = set()
    for m in re.finditer(
        r"^export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_]\w*)", text, re.M
    ):
        names.add(m.group(1))
    for m in re.finditer(r"^export\s*\{([^}]*)\}", text, re.M | re.S):
        for part in m.group(1).split(","):
            token = part.strip().split(" as ")[-1].strip()
            if re.fullmatch(r"[A-Za-z_]\w*", token):
                names.add(token)
    for m in re.finditer(r"^export\s+\*\s+from\s+['\"]([^'\"]+)['\"]", text, re.M):
        pass  # 星号重导出交给 generated.d.ts 的声明兜底
    return names


def _interface_body(path: Path, name: str) -> str | None:
    """粗略取出 interface X { ... } 的 body（按大括号配平）。"""
    text = path.read_text(encoding="utf-8", errors="ignore")
    m = re.search(rf"(?:export\s+)?interface\s+{re.escape(name)}\b[^{{]*\{{", text)
    if not m:
        return None
    i = m.end()
    depth = 1
    while i < len(text) and depth:
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
        i += 1
    return text[m.end() : i - 1]


def _members_of(body: str) -> set[str]:
    """从 interface body 里取属性名与方法名。"""
    names: set[str] = set()
    depth = 0
    for raw in body.splitlines():
        line = raw.split("//")[0]
        if depth == 0:
            m = re.match(r"\s*([A-Za-z_]\w*)\??\s*[:(<]", line)
            if m:
                names.add(m.group(1))
        depth += line.count("{") - line.count("}")
        depth = max(depth, 0)
    return names


def _manifest_top_keys() -> set[str]:
    """manifest schema 的顶层键 —— 用于 P9（manifest 键名拼写校验）。"""
    p = REPO / "packages/core/esm-loader/manifest-schema.ts"
    if not p.exists():
        return set()
    lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
    keys: set[str] = set()
    started = False
    depth = 0
    for line in lines:
        if not started:
            if re.match(r"^export const manifestSchema\s*=", line):
                started = True
            continue
        m = re.match(r"^ {4}'?([A-Za-z_]\w*)'?:", line)
        if m:
            keys.add(m.group(1))
        depth += line.count("{") - line.count("}")
        if depth <= 0 and "}" in line:
            break
    return keys


def _load_facts(name: str) -> dict:
    """读取 audit-tools/agent_facts.py 生成的契约表。"""
    p = REPO / "docs/agent/contracts" / name
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def build_fact_contract() -> dict:
    """P6–P9 用的枚举事实表。

    这些表由 audit-tools/agent_facts.py 从源码抽取，与手册正文共用同一份来源，
    避免「门禁认为合法、正文说非法」这种双标。
    """
    contracts_dir = REPO / "docs/agent/contracts"
    # 契约表不在（AI 手册尚未纳入本仓库）→ 事实表整体不可用。
    # 必须整段跳过 P6–P9：下面 capabilities 至少含 segment:gate_eval，
    # 集合非空但内容残缺，会把**所有**真实能力都误报成非法能力 ——
    # 比不检查更糟（门禁会被噪声训练掉）。
    if not contracts_dir.is_dir():
        return {
            "facts_available": False,
            "capabilities": set(),
            "slots": set(),
            "frame_ops": set(),
            "view_ops": set(),
            "manifest_keys": set(),
        }

    caps = _load_facts("capabilities.json")
    slots = _load_facts("slots.json")
    groups = _load_facts("contributes-groups.json")
    ops = _load_facts("bridge-ops.json")

    capabilities: set[str] = set()
    capabilities |= set(caps.get("command_required", []))
    capabilities |= set(caps.get("method_policy", {}).values())
    capabilities |= set(caps.get("runtime_permission", []))
    # segment:gate_eval 是环节门禁服务用的真实能力（server/services/segment-gate-service.ts），
    # 但它不是任何命令的 capabilityRequired，所以不在 command_required 里。
    capabilities.add("segment:gate_eval")

    slot_names: set[str] = set()
    slot_names |= set(slots.get("extension_slots", []))
    slot_names |= set(groups.get("a_strict_keys", []))
    slot_names |= set(groups.get("b_loose_keys", []))

    frame_ops: set[str] = set(ops.get("frame_ops", []))
    view_ops: set[str] = set(ops.get("view_wire_ops", []))

    return {
        "facts_available": True,
        "capabilities": capabilities,
        "slots": slot_names,
        "frame_ops": frame_ops,
        "view_ops": view_ops,
        "manifest_keys": _manifest_top_keys(),
    }


def build_contract() -> dict[str, set[str]]:
    sdk = set()
    for rel in SDK_FILES:
        p = REPO / rel
        if p.exists():
            # .d.ts 是 `declare global` 风格的平铺声明，符号本身没有 export 关键字
            sdk |= _declared_names(p) if p.name.endswith(".d.ts") else _exported_from_index(p)

    ctx_members: set[str] = set()
    services: set[str] = set()
    ui_methods: set[str] = set()

    for rel in CTX_SOURCES:
        p = REPO / rel
        if not p.exists():
            continue
        for iface in ("PluginContext", "FrontendPluginContext"):
            body = _interface_body(p, iface)
            if not body:
                continue
            ctx_members |= _members_of(body)
            svc = re.search(r"services\s*:\s*\{", body)
            if svc:
                i = svc.end()
                depth = 1
                while i < len(body) and depth:
                    if body[i] == "{":
                        depth += 1
                    elif body[i] == "}":
                        depth -= 1
                    i += 1
                services |= _members_of(body[svc.end() : i - 1])
            ui = re.search(r"\bui\s*:\s*\{", body)
            if ui:
                i = ui.end()
                depth = 1
                while i < len(body) and depth:
                    if body[i] == "{":
                        depth += 1
                    elif body[i] == "}":
                        depth -= 1
                    i += 1
                ui_methods |= _members_of(body[ui.end() : i - 1])

    return {
        "sdk": sdk,
        "ctx": ctx_members,
        "services": services,
        "ui": ui_methods,
        **build_fact_contract(),
    }


COUNTER_EXAMPLE_MARKERS = ("❌", "反例", "错误用法", "不要这样写", "写法错误", "错的")


def _is_counter_example(path: Path, start_line: int) -> bool:
    """代码块上方是否标了「这是反例」。

    手册的「陷阱与反例」页会故意展示错误写法（`ctx.logger` 等），
    门禁必须把它们放过，否则手册自己过不了自己的门禁。
    """
    ctx = _block_context(path, start_line, 8)
    return any(mark in ctx for mark in COUNTER_EXAMPLE_MARKERS)


def _object_keys(text: str, brace_pos: int) -> list[str]:
    """取 JSON 对象 `{` 处的顶层键名（brace_pos 指向 `{`）。"""
    depth = 0
    keys: list[str] = []
    i = brace_pos
    in_str = False
    quote = ""
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                in_str = False
            i += 1
            continue
        if ch in "\"'":
            in_str = True
            quote = ch
            i += 1
            continue
        if ch == "{":
            depth += 1
            i += 1
            continue
        if ch == "}":
            depth -= 1
            if depth == 0:
                break
            i += 1
            continue
        if ch == "," and depth == 1:
            m = re.match(r"\s*['\"]([^'\"]+)['\"]\s*:", text[i + 1 :])
            if m:
                keys.append(m.group(1))
        i += 1
    return keys


# ── 文档解析 ────────────────────────────────────────────────────────────


def iter_code_blocks(path: Path):
    """产出 (lang, start_line, [lines])。"""
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    i = 0
    while i < len(lines):
        m = FENCE_RE.match(lines[i])
        if not m:
            i += 1
            continue
        lang = m.group(1).lower()
        start = i + 1
        body: list[str] = []
        i += 1
        while i < len(lines) and not lines[i].startswith("```"):
            body.append(lines[i])
            i += 1
        yield lang, start + 1, body
        i += 1


def _block_context(path: Path, start_line: int, n: int) -> str:
    """取代码块上方 n 行的文字，用于判断这个块在讲什么。"""
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    # start_line 是块内第一行的行号（1-based），围栏在其上一行
    lo = max(0, start_line - 2 - n)
    hi = max(0, start_line - 2)
    return "\n".join(lines[lo:hi])


def check_file(path: Path, contract: dict[str, set[str]], rep: Report, rel: str) -> None:
    for lang, start, body in iter_code_blocks(path):
        if lang not in ("ts", "typescript", "tsx", "js", "javascript", "jsx", "json"):
            continue
        text = "\n".join(code for _, code in _code_only(body))

        # ── P1: SDK 导入符号 ──
        for m in SDK_IMPORT_RE.finditer(text):
            clause = m.group(1) or ""
            for raw in clause.replace("{", " ").replace("}", " ").split(","):
                token = raw.strip().split(" as ")[0].strip()
                if not token or token in ("type", "*"):
                    continue
                if not re.fullmatch(r"[A-Za-z_]\w*", token):
                    continue
                if token not in contract["sdk"]:
                    rep.drift.append(
                        Finding(
                            " P1",
                            rel,
                            start,
                            f"从 SDK 导入了不存在的符号 `{token}`",
                            token,
                        )
                    )

        # ── P2/P3/P4: ctx 成员 ──
        # 反例块（上下文带 ❌ / 反例 / 错误用法）是在**故意**演示错误写法，
        # 不能当成漂移 —— 否则手册自己的「陷阱与反例」页永远过不了门禁。
        if not _is_counter_example(path, start):
            for idx, line in _code_only(body):
                lineno = start + idx
                for m in CTX_SERVICE_RE.finditer(line):
                    name = m.group(1)
                    if name not in contract["services"]:
                        rep.drift.append(
                            Finding("P3", rel, lineno, f"`ctx.services.{name}` 不在任何 Context.services 定义中", name)
                        )
                for m in CTX_UI_RE.finditer(line):
                    name = m.group(1)
                    if name not in contract["ui"]:
                        rep.drift.append(
                            Finding("P4", rel, lineno, f"`ctx.ui.{name}` 不是 FrontendPluginContext.ui 的方法", name)
                        )
                for m in CTX_MEMBER_RE.finditer(line):
                    name = m.group(1)
                    if name not in contract["ctx"]:
                        rep.drift.append(
                            Finding("P2", rel, lineno, f"`ctx.{name}` 不存在于 PluginContext / FrontendPluginContext", name)
                        )

        # ── P5: manifest 示例 ──
        # 只认"上文提到 manifest"的 JSON 块 —— 注册表索引里同样有 id/name/version，
        # 不设这个门槛会把 registry 格式误判成 manifest。
        if lang == "json" and '"id"' in text and '"version"' in text and '"name"' in text:
            if "manifest" not in _block_context(path, start, 6).lower():
                continue
            try:
                data = json.loads(text)
            except Exception:
                continue
            if isinstance(data, dict) and "main" not in data:
                rep.hints.append(Finding("P5", rel, start, "manifest 示例缺 `main`（schema 必填，缺失会导致装不上）"))

        # ── P6: capability 字符串 ──
        # 防的是「看起来合理但系统里不存在的能力名」。不存在的能力名会被安静授予，
        # 所以真正的后果是「少声明」→ 403 COMMAND_CAPABILITY_DENIED。
        #
        # 事实表（docs/agent/contracts/）缺失时 —— 即 AI 手册尚未纳入本仓库 ——
        # 整段跳过：集合残缺会把所有真实能力都误报成非法能力。
        facts_ok = contract.get("facts_available", False)
        cap_set = contract.get("capabilities") or set()
        if cap_set and facts_ok:
            for m in CAP_ARRAY_RE.finditer(text):
                for s in QUOTED_RE.findall(m.group(1)):
                    if s not in cap_set:
                        rep.drift.append(
                            Finding("P6", rel, start, f"`capabilitiesProposed` 里的 `{s}` 不是真实能力字符串", s)
                        )
            for m in CAP_REQUIRED_RE.finditer(text):
                s = m.group(1)
                if s not in cap_set:
                    rep.drift.append(
                        Finding("P6", rel, start, f"`capabilityRequired` 的 `{s}` 不是真实能力字符串", s)
                    )

        # ── P7: 槽位名 ──
        # 槽位名是**点分**的（teacher.tab），不是下划线、也不是冒号。
        # 写错的槽位名不会报错，只是不渲染 —— 最典型的静默失效。
        slot_set = contract.get("slots") or set()
        if slot_set and facts_ok:
            for m in REGISTER_SLOT_RE.finditer(text):
                s = m.group(1)
                if s not in slot_set and not s.startswith("anchor:"):
                    rep.drift.append(
                        Finding("P7", rel, start, f"`registerExtensionPoint` 的槽位 `{s}` 不在槽位全集里", s)
                    )
            for m in re.finditer(r"['\"]contributes['\"]\s*:\s*\{", text):
                keys = _object_keys(text, m.end() - 1)
                for k in keys:
                    if k not in slot_set:
                        rep.drift.append(
                            Finding("P7", rel, start, f"`contributes` 的键 `{k}` 不是合法的 contributes 键", k)
                        )

        # ── P8: bridge op / view 通道成员 ──
        frame_ops = contract.get("frame_ops") or set()
        if frame_ops and facts_ok:
            for m in FRAME_CALL_RE.finditer(text):
                s = m.group(1)
                if s not in frame_ops:
                    rep.drift.append(
                        Finding("P8", rel, start, f"frame 通道 op `{s}` 不在白名单里", s)
                    )
        for m in BRIDGE_MEMBER_RE.finditer(text):
            name = m.group(1)
            if name in BRIDGE_FORBIDDEN:
                rep.drift.append(
                    Finding("P8", rel, start, f"沙箱上下文的 `{name}` 子对象不存在（曾被文档捏造）", name)
                )
            elif name not in BRIDGE_MEMBERS:
                rep.drift.append(
                    Finding("P8", rel, start, f"沙箱上下文没有 `{name}` 成员", name)
                )

        # ── P9: manifest 顶层键名 ──
        # manifest 顶层是 `.passthrough()`，所以未知键**不会**被 strip ——
        # 只会静默失效。合法扩展键（如 updateSource）是有意透传的，不能误报；
        # 所以只报「与真实键高度近似」的拼写错误（如 contributions / contributes）。
        manifest_keys = contract.get("manifest_keys") or set()
        if manifest_keys and facts_ok and lang == "json":
            try:
                data = json.loads(text)
            except Exception:
                data = None
            if (
                isinstance(data, dict)
                and "id" in data
                and "version" in data
                and "manifest" in _block_context(path, start, 6).lower()
            ):
                for k in data:
                    if k in manifest_keys:
                        continue
                    near = difflib.get_close_matches(k, manifest_keys, n=1, cutoff=0.8)
                    if near:
                        rep.drift.append(
                            Finding(
                                "P9",
                                rel,
                                start,
                                f"manifest 顶层键 `{k}` 不存在（真实键是 `{near[0]}`）；"
                                f"顶层是 passthrough，不会报错但也不会生效",
                                k,
                            )
                        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="audit-tools/reports/plugin_docs_report.json")
    args = ap.parse_args()

    contract = build_contract()
    rep = Report(
        stats={
            "sdk_symbols": len(contract["sdk"]),
            "ctx_members": len(contract["ctx"]),
            "services": len(contract["services"]),
            "ui_methods": len(contract["ui"]),
        }
    )

    docs: list[Path] = []
    for pattern in DOC_GLOBS:
        docs.extend(sorted(REPO.glob(pattern)))
    for path in docs:
        check_file(path, contract, rep, path.relative_to(REPO).as_posix())

    # 同一符号在同一文档重复报到只留一条，避免刷屏
    seen: set[tuple[str, str]] = set()
    deduped: list[Finding] = []
    for f in rep.drift:
        key = (f.code, f.doc, f.symbol or f.detail)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(f)
    rep.drift = deduped

    rep.stats["docs_scanned"] = len(docs)
    rep.stats["drift"] = len(rep.drift)
    rep.stats["hints"] = len(rep.hints)

    out = Path(args.json)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "stats": rep.stats,
                "drift": [f.__dict__ for f in rep.drift],
                "hints": [f.__dict__ for f in rep.hints],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    md = out.with_suffix(".md")
    lines = ["# 插件文档示例校验（P1–P5）", ""]
    lines.append(f"扫描文档 {len(docs)} 篇；SDK 符号 {rep.stats['sdk_symbols']} 个。")
    lines.append("")
    lines.append(f"## drift（{len(rep.drift)}）")
    lines.append("")
    if rep.drift:
        lines.append("| 判定 | 文档 | 行 | 说明 |")
        lines.append("| --- | --- | --- | --- |")
        for f in rep.drift:
            lines.append(f"| {f.code.strip()} | `{f.doc}` | {f.line} | {f.detail} |")
    else:
        lines.append("（无）")
    lines.append("")
    lines.append(f"## hint（{len(rep.hints)}）")
    lines.append("")
    if rep.hints:
        for f in rep.hints:
            lines.append(f"- {f.code} `{f.doc}:{f.line}` {f.detail}")
    else:
        lines.append("（无）")
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"docs={len(docs)}  drift={len(rep.drift)}  hints={len(rep.hints)}")
    print(f"report: {md}")
    return 1 if rep.drift else 0


if __name__ == "__main__":
    raise SystemExit(main())
