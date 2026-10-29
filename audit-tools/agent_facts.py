#!/usr/bin/env python3
"""
agent_facts.py — 从源码抽取「AI 插件开发手册」所需的全部权威事实表。

为什么需要这一层：
    插件文档里最容易「骗过 AI」的不是描述性文字，而是**枚举表**——
    能力字符串、Token 名、槽位名、bridge op、禁写表。一旦这些表和源码脱节，
    照着写的 Agent 会写出「看起来合理但根本不存在」的调用。
    本脚本把这些表从源码直接抽出，生成机器可读契约：
      docs/agent/contracts/*.json
    手册正文引用这些 JSON，门禁（plugin_docs_check.py 的 P6-P9）也用同一份数据。

用法：
    python3 audit-tools/agent_facts.py [--out docs/agent/contracts] [--check]

    --check  只比对现有产物是否与源码一致，不写文件；有漂移则退出码 1。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# 字符类要同时吃单引号与双引号。注意：Python raw string 里写 r"['\"]"
# 得到的是 {反斜杠, 双引号} —— 单引号漏掉。故统一用 r"""['"]"""。
Q = r"""['"]"""


def _quoted(inner: str) -> str:
    """构造「引号 + 捕获组 + 引号」的正则片段。"""
    return Q + "(" + inner + ")" + Q


# ──────────────────────────────────────────────────────────────────────────
# 1. 能力（capability）——三套互不相干的登记，混用是 AI 最高频的错误
# ──────────────────────────────────────────────────────────────────────────

def extract_capabilities() -> dict:
    # 1a. 命令总线闸门：命令自身声明的 capabilityRequired（生产代码，排除测试）
    #     注意：必须排除 *.d.ts —— SDK 的 .d.ts 里带 JSDoc 注释，
    #     注释里的 `capabilityRequired: 'segment:gate_eval'` 会被误当成真声明。
    #     （这个坑已经踩过一次：把注释算进去会得到 20，而真值是 19。）
    required: set[str] = set()
    for root in ("packages", "server", "src"):
        for ext in ("*.ts", "*.tsx"):
            for path in (REPO / root).rglob(ext):
                if "__tests__" in path.parts or path.name.endswith(".test.ts"):
                    continue
                if path.name.endswith(".d.ts") or "dist" in path.parts:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
                required.update(
                    re.findall(r"capabilityRequired:\s*" + _quoted(r"[^'\"]+"), text)
                )

    # 1b. 方法级策略闸门：method-policy.ts 的 CAP_* 常量
    mp = (REPO / "packages/core/plugin-host/method-policy.ts").read_text(encoding="utf-8")
    method_policy = dict(
        re.findall(r"export const (CAP_\w+)\s*=\s*" + _quoted(r"[^'\"]+"), mp)
    )

    # 1c. 第三套：classroom-runtime 的 RuntimePermission（与上面两套正交）
    #     定义在 packages/core/classroom-runtime/types.ts 的 `RuntimePermission` 联合类型。
    #     注意别去 activity-ecosystem 找 —— 那里只有 providers 的 permissions 数组，
    #     覆盖不到全部 7 个值。
    runtime_permissions: set[str] = set()
    rt = REPO / "packages/core/classroom-runtime/types.ts"
    if rt.exists():
        text = rt.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"export type RuntimePermission\s*=\s*(.*?);", text, re.S)
        if m:
            runtime_permissions.update(re.findall(_quoted(r"[a-z]+:[a-z_]+"), m.group(1)))

    # 1d. 被硬拒的能力形态（通配符）
    grants = (REPO / "packages/core/plugin-host/plugin-grants.ts").read_text(encoding="utf-8")
    blocked = re.findall(r"value\s*===\s*" + _quoted(r"[^'\"]+"), grants)

    return {
        "_note": "三套登记互不相干，混用即错：command_required 管命令闸门，"
                 "method_policy 管具体 ctx 方法，runtime_permission 是活动生态的第三套权限。",
        "_no_global_whitelist": "manifest-schema.ts 的 capabilitiesProposed 是 z.array(z.string())，"
                                "不存在全局能力白名单。杜撰的能力名会被安静地授予，"
                                "真正致命的失败是「少声明」——目标命令要的 capabilityRequired "
                                "与你声明的字符串必须逐字相等，否则 403 COMMAND_CAPABILITY_DENIED。",
        "command_required": sorted(required),
        "method_policy": method_policy,
        "runtime_permission": sorted(runtime_permissions),
        "blocked_wildcard": blocked,
    }


# ──────────────────────────────────────────────────────────────────────────
# 2. 可解析 Token（ctx.resolve 白名单）
# ──────────────────────────────────────────────────────────────────────────

def extract_tokens() -> dict:
    src = (REPO / "packages/core/di/interfaces.ts").read_text(encoding="utf-8")
    block = re.search(r"export const PLUGIN_RESOLVABLE_TOKENS\s*=\s*\[(.*?)\]\s*as const;", src, re.S)
    tokens = re.findall(r"\b(I\w+Token)\b", block.group(1)) if block else []

    names_block = re.search(
        r"export const PLUGIN_RESOLVABLE_TOKEN_NAMES[^=]*=\s*new Set\(\[(.*?)\]\)", src, re.S
    )
    extra_names = re.findall(_quoted(r"[^'\"]+"), names_block.group(1)) if names_block else []

    return {
        "_note": "字符串 resolve 只允许命中本集合；Token 对象路径不受限。"
                 "越界会显式报错（不是静默降级）。",
        "_count_trap": "三个数字都对，口径不同，别混："
                      "① SDK 值导出的 Token 对象共 32 个；"
                      "② 其中能用 Token 对象 resolve 的 30 个；"
                      "③ IActivityRegistryToken 只能用名字字符串 "
                      "'@openlearn/activity-ecosystem:IActivityRegistry' 收录（Token 对象不在白名单里）；"
                      "④ INetworkProxyServiceToken 导出但**完全不可解析** —— "
                      "插件按名字 resolve 它会显式报错。",
        "_source": "packages/core/di/interfaces.ts:946",
        "tokens": tokens,
        "extra_names": extra_names,
        "total": len(tokens) + len(extra_names),
        "sdk_exported": _sdk_token_exports(),
        "sdk_token_meta": _sdk_token_meta(),
    }


def _sdk_token_meta() -> dict:
    """SDK 导出的每个 Token → {接口类型, 标识字符串, 定义文件}。

    声明常跨行（`new Token<T>(\n  '@openlearn/core:...',\n)`），正则需多行匹配。
    """
    meta: dict[str, dict] = {}
    roots = [REPO / "packages", REPO / "src"]
    for root in roots:
        for f in root.rglob("*.ts"):
            if "__tests__" in f.parts or f.name.endswith(".d.ts") or "dist" in f.parts:
                continue
            txt = f.read_text(encoding="utf-8", errors="ignore")
            for m in re.finditer(
                r"export const (I[A-Za-z]+Token)\s*=\s*new Token<([A-Za-z]+)>\(\s*'([^']+)'",
                txt,
                re.S,
            ):
                meta.setdefault(
                    m.group(1),
                    {
                        "interface": m.group(2),
                        "identifier": m.group(3),
                        "file": str(f.relative_to(REPO)),
                    },
                )
    return meta


def _sdk_token_exports() -> list[str]:
    """SDK index.ts 里以 value 形式导出的 Token。"""
    src = (REPO / "packages/plugin-sdk/index.ts").read_text(encoding="utf-8")
    out: set[str] = set()
    for m in re.finditer(r"export\s*\{([^}]*)\}", src):
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            name = part.split(" as ")[-1].strip()
            if name.endswith("Token") and name != "Token":
                out.add(name)
    return sorted(out)


# ──────────────────────────────────────────────────────────────────────────
# 3. 扩展槽位（ExtensionSlot 联合类型 + anchor 命名空间）
# ──────────────────────────────────────────────────────────────────────────

def extract_slots() -> dict:
    src = (REPO / "src/plugin-host/types.ts").read_text(encoding="utf-8")
    m = re.search(r"export type ExtensionSlot\s*=\s*(.*?);", src, re.S)
    body = m.group(1) if m else ""
    # 槽位名用「点」分隔：teacher.tab / classroom.tool / ai.prompt.template
    slots = sorted({s for s in re.findall(r"'([a-z_][a-z_.\-]*)'", body) if "." in s})

    # anchor:* 是模板字面量类型 `anchor:${string}` —— 类型上开放，
    # 真正被渲染的是那些有 <ExtensionPointRenderer slot="anchor:..."> 调用点的。
    anchors: set[str] = set()
    for path in (REPO / "src").rglob("*.tsx"):
        if "__tests__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        anchors.update(re.findall(r'slot="(anchor:[a-z0-9\-:]+)"', text))
    return {
        "_note": "ExtensionSlot 是联合类型（点分），未声明的字符串编译期即报错。"
                 "anchor:* 是另一套开放命名空间 —— 类型上 `anchor:${string}` 全放行，"
                 "但只有下表这些锚点真有渲染调用点；往别的锚点写不会报错，"
                 "只是永远不会被渲染。两者不等价。",
        "_source": "src/plugin-host/types.ts:95（ExtensionSlot）/ :265（AnchorSlot）",
        "extension_slots": slots,
        "anchor_slots": sorted(anchors),
        "total": len(slots),
    }


# ──────────────────────────────────────────────────────────────────────────
# 4. bridge op 白名单
# ──────────────────────────────────────────────────────────────────────────

def extract_bridge_ops() -> dict:
    # 两条通道是两套东西，别混：
    #   frame 通道 = 隐藏 iframe 里的 frontend.js ↔ 宿主，走 op 字符串
    #   view  通道 = 可视沙箱页里的 window.OpenLearnPluginBridge ↔ 宿主
    frame_src = REPO / "src/plugin-host/plugin-host.ts"
    frame_text = frame_src.read_text(encoding="utf-8", errors="ignore") if frame_src.exists() else ""
    frame_ops = sorted(set(re.findall(r"op === '([a-z]+\.[a-z]+)'", frame_text)))

    view_src = REPO / "server/utils/plugin-view-bridge.ts"
    view_text = view_src.read_text(encoding="utf-8", errors="ignore") if view_src.exists() else ""
    view_ops = sorted(set(re.findall(r"call\('([a-z]+\.[a-z]+)'", view_text)))

    return {
        "_note": "两套通道不是一回事。frame（隐藏 iframe）用 op 字符串，宿主侧在 "
                 "src/plugin-host/plugin-host.ts 分发，越界抛 "
                 "`Unsupported sandbox bridge op \"xxx\"`；view（可视沙箱页）"
                 "拿到的是 window.OpenLearnPluginBridge 对象，方法名与 frame op 不同名"
                 "（invokeCommand ↔ command.invoke、getContext ↔ context.get）。"
                 "view 通道没有 Barrier 3 方法级能力门禁。",
        "_source": "src/plugin-host/plugin-host.ts / server/utils/plugin-view-bridge.ts",
        "frame_ops": frame_ops,
        "view_wire_ops": view_ops,
        "frame_total": len(frame_ops),
        "view_total": len(view_ops),
    }


# ──────────────────────────────────────────────────────────────────────────
# 5. 禁写表（SQL 守卫黑名单）
# ──────────────────────────────────────────────────────────────────────────

def extract_forbidden_tables() -> dict:
    src = (REPO / "packages/core/plugin-host/sql-guard.ts").read_text(encoding="utf-8")
    m = re.search(r"export const FORBIDDEN_CORE_TABLES\s*=\s*Object\.freeze\(\[(.*?)\]\)", src, re.S)
    tables = re.findall(_quoted(r"[a-z_]+"), m.group(1)) if m else []
    return {
        "_note": "命中黑名单即拒绝读写，与是否属于插件自身前缀无关。"
                 "文档若写「36 张」即为过期，真值以本表为准。",
        "_source": "packages/core/plugin-host/sql-guard.ts:13",
        "tables": tables,
        "total": len(tables),
    }


def extract_contributes_groups() -> dict:
    """manifest.contributes 的三组键：A 严格键 / B 宽松键 / 与 ExtensionSlot 的关系。

    缩进即分组：contributesSchema 的顶层键是 4 空格，frontendSlotsShape 是 2 空格。
    """
    src = (REPO / "packages/core/esm-loader/manifest-schema.ts").read_text(encoding="utf-8")
    lines = src.splitlines()

    def span(pred, start=0):
        for i in range(start, len(lines)):
            if pred(lines[i]):
                return i
        raise SystemExit("manifest-schema.ts 结构与预期不符")

    TOP4 = re.compile(r"^ {4}'?([a-z_][a-z_.\-]*)'?:")
    TOP2 = re.compile(r"^ {2}'?([a-z_][a-z_.\-]*)'?:")
    # frontendSlotsShape 自身在 2 空格缩进下；contributesSchema 的顶层键在 4 空格
    fs_start = span(lambda l: "frontendSlotsShape = {" in l)
    fs_end = span(lambda l: l.strip().startswith("} as const"), fs_start)
    b_keys = [m.group(1) for l in lines[fs_start:fs_end] if (m := TOP2.match(l))]

    cs_start = span(lambda l: l.startswith("const contributesSchema"))
    cs_end = span(lambda l: "...frontendSlotsShape" in l, cs_start)
    a_keys = [m.group(1) for l in lines[cs_start:cs_end] if (m := TOP4.match(l))]

    ext = set(extract_slots()["extension_slots"])
    return {
        "_note": "A 组 = contributesSchema 显式键（严格校验，未声明的键被 strip）；"
                 "B 组 = frontendSlotsShape（宽松，只校验 id 必填）。"
                 "A/B 两组都是「声明式元数据」，不等于前端 ExtensionSlot —— "
                 "写在 manifest 里不会渲染出任何东西，必须再命令式 registerExtensionPoint。",
        "_source": "packages/core/esm-loader/manifest-schema.ts:542（frontendSlotsShape）/ :594（contributesSchema）",
        "a_strict_keys": a_keys,
        "b_loose_keys": b_keys,
        "a_total": len(a_keys),
        "b_total": len(b_keys),
        "a_not_in_extension_slot": sorted(set(a_keys) - ext),
        "b_not_in_extension_slot": sorted(set(b_keys) - ext),
    }


# ──────────────────────────────────────────────────────────────────────────
# 6. 版本基线
# ──────────────────────────────────────────────────────────────────────────

def extract_versions() -> dict:
    def ver(rel: str) -> str | None:
        f = REPO / rel
        if not f.exists():
            return None
        m = re.search(r'"version"\s*:\s*"([^"]+)"', f.read_text(encoding="utf-8"))
        return m.group(1) if m else None

    return {
        "_note": "基线必须与源码一致。文档正文里的 sdk 版本号是 AI 判断"
                 "「这段示例能不能用」的依据，写错代价最高。",
        "platform": ver("package.json"),
        "plugin_sdk": ver("packages/plugin-sdk/package.json"),
        "plugin_test_kit": ver("packages/plugin-test-kit/package.json"),
    }


# ──────────────────────────────────────────────────────────────────────────

BUILDERS = {
    "capabilities.json": extract_capabilities,
    "tokens.json": extract_tokens,
    "slots.json": extract_slots,
    "contributes-groups.json": extract_contributes_groups,
    "bridge-ops.json": extract_bridge_ops,
    "forbidden-tables.json": extract_forbidden_tables,
    "versions.json": extract_versions,
}


def build_all() -> dict[str, dict]:
    return {name: fn() for name, fn in BUILDERS.items()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="docs/agent/contracts")
    ap.add_argument("--check", action="store_true", help="只比对，不写文件")
    args = ap.parse_args()

    out_dir = REPO / args.out
    facts = build_all()

    if args.check:
        # 契约表目录整体不存在 = AI 手册尚未部署到本仓库（还没 commit / 还没合入）。
        # 这不是漂移，跳过即可；但要在报告里显式说明，避免「静默通过」被误读成「已校验」。
        if not out_dir.is_dir():
            print("跳过：contracts 目录不存在（AI 插件开发手册尚未纳入本仓库），无事实表可校验。")
            return 0
        drift = []
        for name, data in facts.items():
            path = out_dir / name
            if not path.exists():
                drift.append(f"{name}: 缺失")
                continue
            cur = json.loads(path.read_text(encoding="utf-8"))
            if cur != data:
                drift.append(f"{name}: 与源码不一致")
        for d in drift:
            print(f"[drift] {d}")
        if drift:
            print(f"事实表漂移 {len(drift)} 处 —— 请重新生成：python3 audit-tools/agent_facts.py")
            return 1
        print(f"事实表与源码一致（{len(facts)} 个文件）")
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    for name, data in facts.items():
        (out_dir / name).write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {out_dir / name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
