"""标题锚点 slug：与 GitHub 保持一致。

为什么需要它：docutils 0.22 起 `make_id()` 只保留 ASCII，纯中文标题的 slug 会退化成
`id1`/`id2`…；而文档作者是按 GitHub 的规则写锚点的（如 `#4-公测上线检查清单`），
于是站内锚点全部失效。这里复用 GitHub 的算法，让同一份 Markdown 在 GitHub 与
Read the Docs 上跳到同一个位置。

两个实现细节都是踩出来的：
  · 放独立模块而不是写在 conf.py —— Sphinx 会把 config 值 pickle 进 environment，
    `__main__` 里的函数无法序列化，构建直接崩。
  · 用「可调用对象」而不是函数 —— Sphinx 的 `is_serializable()` 拦的是
    `FunctionType`/`type`/`ModuleType`，函数会触发 "cannot cache unpickleable
    configuration value" 警告，实例能正常 pickle 且不告警。
"""

import re

_UNSAFE = re.compile(r'[^\w\s-]')
_SPACES = re.compile(r'\s+')


class GithubHeadingSlug:
    """复刻 GitHub 的 heading anchor 算法：小写 → 去标点 → 空格转连字符（保留中文）。"""

    def __call__(self, title: str) -> str:
        s = title.strip().lower()
        s = _UNSAFE.sub('', s)  # \w 已含中文
        s = _SPACES.sub('-', s)
        return s or 'section'


github_slug = GithubHeadingSlug()
