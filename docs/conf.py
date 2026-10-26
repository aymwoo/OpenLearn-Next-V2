# Sphinx documentation configuration for OpenLearnV2
# https://www.sphinx-doc.org/en/master/usage/configuration.html

project = 'OpenLearnV2'
copyright = '2026, OpenLearn Team'
author = 'OpenLearn Team'

# Chinese language
language = 'zh_CN'

extensions = [
    'myst_parser',
    'sphinxcontrib.mermaid',
    'sphinx_rtd_theme',
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store', 'requirements.txt', '.venv']

html_theme = 'sphinx_rtd_theme'
html_static_path = ['_static']

# MyST extensions for Markdown
myst_enable_extensions = [
    'colon_fence',
    'deflist',
    'fieldlist',
]
myst_heading_anchors = 4
myst_fence_as_directive = ["mermaid"]


# ── 标题锚点：对齐 GitHub 规则 ────────────────────────────────────────────────
# docutils 0.22 起 make_id() 只保留 ASCII，纯中文标题的 slug 会退化成 id1/id2…；
# 而文档作者是按 GitHub 的规则写锚点的（#4-公测上线检查清单），于是站内锚点全死。
# 这里改用 GitHub 的 slug 算法（小写 → 去标点 → 空格转连字符 → 保留中文），
# 让同一份文档在 GitHub 与 RTD 站点上跳转到同一个位置。
# 函数体放在 _slug.py：config 值会被 pickle 进 environment，写在 __main__ 里无法序列化。
import sys as _sys
from pathlib import Path as _Path

_sys.path.insert(0, str(_Path(__file__).resolve().parent))
from _slug import github_slug as _github_slug  # noqa: E402

myst_heading_slug_func = _github_slug

# Source suffix
source_suffix = {
    '.md': 'markdown',
}
import json
from pathlib import Path

# Version: dynamically synchronized from root package.json to prevent version drift
_pkg_json_path = Path(__file__).resolve().parent.parent / "package.json"
try:
    with open(_pkg_json_path, "r", encoding="utf-8") as _f:
        _pkg_data = json.load(_f)
        version = _pkg_data.get("version", "0.3.5")
        release = version
except Exception:
    version = '0.3.5'
    release = '0.3.5'

# ── 让 section 的 id 也用 GitHub slug ────────────────────────────────────────
# `myst_heading_slug_func` 只影响 MyST 另外加的 anchor，section 本身的 id 由
# docutils 的 make_id() 生成，而它用 encode('ascii', 'ignore') 把中文整段丢掉，
# 空串只好退化成 id1/id2…。这里替换掉 make_id，使 `<h2>` 的锚点与 GitHub 一致，
# 站内 `#中文标题` 链接才能真正跳转。
try:
    import docutils.nodes as _dn

    _dn.make_id = _github_slug
except Exception:  # docutils 不在时不影响其余功能
    pass
