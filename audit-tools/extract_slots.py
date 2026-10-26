#!/usr/bin/env python3
"""Extract the authoritative extension-slot inventory from source code.

Three sources are merged:

  1. `src/plugin-host/types.ts`  -> `ExtensionSlot` union members (declared truth)
  2. `src/**/*.tsx` (non-test)   -> `<ExtensionPointRenderer slot="..." />` call sites
  3. `packages/core/plugin-host/contribution-registry.ts` + `manifest-schema.ts`
                                 -> manifest `contributes` keys

Output is JSON so downstream checks can diff it against the docs.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SLOT_UNION_RE = re.compile(r"export type ExtensionSlot =(.*?);", re.S)
MEMBER_RE = re.compile(r"\|\s*'([^']+)'")

# <ExtensionPointRenderer ... slot="a.b" ... />
RENDERER_TAG_RE = re.compile(r"<ExtensionPointRenderer\b(.*?)/?>", re.S)
SLOT_ATTR_RE = re.compile(r"""slot=(?:"([^"]+)"|\{'([^']+)'\}|'([^']+)')""")
SLOTPROPS_RE = re.compile(r"slotProps=\{\{(.*?)\}\}", re.S)


def extract_declared(repo: Path) -> list[str]:
    src = (repo / "src/plugin-host/types.ts").read_text(encoding="utf-8")
    m = SLOT_UNION_RE.search(src)
    if not m:
        raise SystemExit("cannot locate `export type ExtensionSlot =` in src/plugin-host/types.ts")
    out: list[str] = []
    for name in MEMBER_RE.findall(m.group(1)):
        if name not in out:
            out.append(name)
    return out


def extract_call_sites(repo: Path) -> dict[str, list[dict]]:
    """slot -> [{file, line, slot_props}] for every production renderer call."""
    found: dict[str, list[dict]] = {}
    for path in sorted((repo / "src").rglob("*.tsx")):
        if "__tests__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for tag in RENDERER_TAG_RE.finditer(text):
            body = tag.group(1)
            sm = SLOT_ATTR_RE.search(body)
            if not sm:
                continue
            slot = next(g for g in sm.groups() if g)
            line = text[: tag.start()].count("\n") + 1
            sp = SLOTPROPS_RE.search(body)
            props = " ".join(sp.group(1).split()) if sp else None
            found.setdefault(slot, []).append(
                {
                    "file": str(path.relative_to(repo)),
                    "line": line,
                    "slotProps": props,
                }
            )
    return found


def extract_anchor_call_sites(repo: Path) -> list[dict]:
    """Anchor slots are built dynamically (`anchor:${anchorId}`), so scan literals."""
    out = []
    pat = re.compile(r"anchor:([a-z0-9_-]+):([a-z0-9_-]+)", re.I)
    for path in sorted((repo / "src").rglob("*.tsx")):
        if "__tests__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for m in pat.finditer(text):
            out.append(
                {
                    "slot": f"anchor:{m.group(1)}:{m.group(2)}",
                    "file": str(path.relative_to(repo)),
                    "line": text[: m.start()].count("\n") + 1,
                }
            )
    return out


def extract_contributes_keys(repo: Path) -> list[str]:
    """Manifest `contributes` slot keys declared in the backend registry/schema."""
    keys: set[str] = set()
    for rel in (
        "packages/core/plugin-host/contribution-registry.ts",
        "packages/core/esm-loader/manifest-schema.ts",
    ):
        path = repo / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for m in re.finditer(r"""['"]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"]\s*:""", text):
            keys.add(m.group(1))
    return sorted(keys)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--out", default="audit-tools/reports/slots_inventory.json")
    args = ap.parse_args()

    repo = Path(args.repo).resolve()
    declared = extract_declared(repo)
    call_sites = extract_call_sites(repo)
    anchors = extract_anchor_call_sites(repo)
    contributes = extract_contributes_keys(repo)

    anchor_names = sorted({a["slot"] for a in anchors})
    declared_set = set(declared)
    rendered_fixed = sorted(s for s in call_sites if not s.startswith("anchor:"))

    data = {
        "declared": declared,
        "declared_count": len(declared),
        "rendered_fixed": rendered_fixed,
        "rendered_fixed_count": len(rendered_fixed),
        "declared_but_never_rendered": sorted(declared_set - set(rendered_fixed)),
        "rendered_but_not_declared": sorted(set(rendered_fixed) - declared_set),
        "anchor_slots": anchor_names,
        "anchor_count": len(anchor_names),
        "call_sites": call_sites,
        "contributes_keys": contributes,
    }
    out = repo / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"declared            : {len(declared)}")
    print(f"rendered (fixed)    : {len(rendered_fixed)}")
    print(f"anchor slots        : {len(anchor_names)}")
    print(f"declared-not-render : {len(data['declared_but_never_rendered'])} {data['declared_but_never_rendered']}")
    print(f"render-not-declared : {len(data['rendered_but_not_declared'])} {data['rendered_but_not_declared']}")
    print(f"contributes keys    : {len(contributes)}")
    print(f"-> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
