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
]
myst_heading_anchors = 3

# Source suffix
source_suffix = {
    '.md': 'markdown',
}
# Version (keep in sync with root package.json)
version = '0.1.9'
release = '0.1.9'
