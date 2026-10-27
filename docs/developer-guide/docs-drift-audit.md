# 架构文档一致性审计（Architecture Docs Drift Audit）

> **目的**：保证 `docs/` 中的架构描述与 `packages/core/`、`src/features/`、`packages/plugins/` 中的实际代码保持一致，防止文档漂移。

## 一句话总结

每次改代码时，**改动如果新增/删除/重命名了一个 subsystem**，你必须**同时更新或新增对应的 `docs/architecture/<name>.md`**。CI 和 pre-commit hook 会强制检查。

---

## 什么时候需要手动跑审计

| 改动类型                  | 是否需要手动跑 | 说明                                                           |
| ------------------------- | -------------- | -------------------------------------------------------------- |
| 改业务逻辑                | ❌ 不需要      | 架构没变                                                       |
| **新增 subsystem 目录**   | ✅ **必须**    | CI 会拦住，先跑一遍确认能写出文档                              |
| **删除 subsystem 目录**   | ✅ **必须**    | CI 会拦住，必须删对应文档                                      |
| **重命名 subsystem 目录** | ✅ **必须**    | CI 会拦住，必须改文档 + 改脚本                                 |
| **新增/改名环境变量**     | ✅ **必须**    | `envcheck.py` 会拦住：生产读取的键必须进配置清单               |
| **改插件文档里的代码块**  | ✅ **必须**    | `plugin_docs_check.py` 会拦住：示例里的 `ctx.xxx` 必须真实存在 |
| 改 plugin 行为            | ❌ 不需要      | plugin 本身有 plugin 文档体系                                  |
| 改 capability 名称        | ⚠️ 可能需要    | 看 `normalize.py` 是否仍能归一化                               |

---

## 快速命令

```bash
# 跑审计（应在 openlearnv2/ 目录下执行）
bash audit-tools/run.sh

# 期望输出：
# canonical_drift=0
# ref_drift=0
# env_drift=0
# symbol_hints=42  （仅提示，不计入 drift）
# drift_count=0
# ✅ No architecture drift detected.

# 出错时看报告
cat audit-tools/reports/drift_report.md   # 子系统 / 路径 / 内链
cat audit-tools/reports/env_report.md     # 环境变量三方比对
```

---

## 五类检查分别抓什么

`run.sh` 串起五个脚本，覆盖五种不同形态的「文档引用代码事实」：

| 脚本                   | 事实形态                | 抓什么                                                                              | 计入 drift |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------- | ---------- |
| `extractors.py`        | 子系统名                | 代码有目录但无对应架构文档，反之亦然                                                | ✅         |
| `refchecks.py`         | 文件路径 / 内链         | 文档里反引号包裹的路径不存在、文档间链接失效、重复文档                              | ✅         |
| `envcheck.py`          | 配置键                  | 文档登记了但代码从不读取；代码读取但任何清单都没登记                                | ✅         |
| `plugin_docs_check.py` | **代码示例的 API 用法** | 从 SDK 导入不存在的符号、`ctx.xxx` 不存在、`ctx.services.xxx` / `ctx.ui.xxx` 不存在 | ✅         |
| `symbolcheck.py`       | 代码符号                | 文档引用的类/函数/Token 在仓内零命中                                                | ❌ 仅提示  |

`symbolcheck.py` 刻意不计入门禁：它能抓到枚举改名、Token 消失这类语义漂移，但仍有约
15–20% 精度问题（JS 全局、第三方包导出、历史文档引用已删子系统）。当门禁会训练团队
忽略告警，故它的输出只作为**逐篇审阅清单**。

`plugin_docs_check.py` 为什么单独存在：前三段只关心「这个路径/符号/键名是否存在」，
不关心**代码块里怎么调用它**。而面向插件作者的文档一旦写出 `ctx.commandBus`（真实入口
是 `ctx.services.commandBus`）或 `import type { FrontendPluginContext } from '@openlearn/plugin-sdk'`
（SDK 从未导出该类型），照抄的 Agent 一定编译失败。它把文档代码块当成"会被执行的代码"来核对，
契约从 `packages/plugin-sdk/*.d.ts` 与 `PluginContext` / `FrontendPluginContext` 定义**实时解析**，
不维护硬编码白名单。

---

## 三层防护

### L1 — CI 自动检查（最关键，必备）

`.github/workflows/ci.yml` 中新增了 `docs-drift-audit` job：

- 触发：所有 PR 和 push 到 main
- 行为：跑 `audit-tools/run.sh`，drift > 0 时 **PR 合并被阻止**
- 失败时：自动上传 `audit-tools/reports/drift_report.md` 到 PR Artifacts，并在 PR 评论中贴出报告

**这是最强约束**——只要文档没跟上，PR 合并按钮变灰。

### L2 — Pre-commit Hook（本地拦截，CI 之前的兜底）

安装：

```bash
bash audit-tools/install-hook.sh   # 一次性安装
```

之后任何 commit 涉及 `docs/`、`packages/core/`、`src/features/`、`packages/plugins/` 的改动，**提交前**自动跑审计。如果有 drift，commit 被阻止。

**优势**：不用等 CI 反馈就知道哪里需要补文档，节省 review cycle。

**紧急逃生**：`git commit --no-verify`（但 CI 仍会拦截）。

### L3 — 定期复审（兜底）

每周 / 每月手动跑一次完整审计：

```bash
bash audit-tools/run.sh
cat audit-tools/reports/drift_report.md
```

主要作用：捕获那些**不在 git diff 里**的累积漂移（例如有人绕过 hook 直接 push，或 commit 信息不准）。

---

## 工作流程（开发者视角）

### 场景 A：新增一个 subsystem

比如新建 `src/features/my-new-runtime/`：

1. 写代码（types.ts, registry.ts, ...）。
2. **同时**写文档 `docs/architecture/my-new-runtime.md`：
   - 第一段说明定位（在前端架构哪一层、协调谁）
   - 核心数据结构（类型契约）
   - mermaid 组件关系图
   - 核心 API 表
   - 插件贡献协议示例（如果有）
   - 在 Layer-2 中的位置对比表
   - 约束与不变量
3. **同时**改脚本 `audit-tools/extractors.py`，把你的文档文件名加进 `DOC_SUBSYSTEM_BY_FILE`：

   ```python
   DOC_SUBSYSTEM_BY_FILE = {
       ...
       "my-new-runtime": ("my-new-runtime", "subsystem"),
   }
   ```

4. 本地跑 `bash audit-tools/run.sh` 确认 `drift_count=0`。
5. 提交。CI 会再次验证。

### 场景 B：删除一个 subsystem

比如删除 `src/features/old-runtime/`：

1. 删代码。
2. **同时**删 `docs/architecture/old-runtime.md`。
3. 跑 `bash audit-tools/run.sh`，如果有 drift 提示，按指引修复。
4. 提交。

### 场景 C：重命名一个 subsystem

比如把 `kernel` 改名为 `platform-core`：

1. 改代码目录名。
2. 改 `docs/architecture/platform-kernel.md` 文件名为 `platform-core.md`（可选，看团队约定）。
3. **必须**改 `audit-tools/extractors.py` 中的 `DOC_SUBSYSTEM_BY_FILE["platform-kernel"]` 映射。
4. **必须**改 `audit-tools/normalize.py` 中的反向映射。
5. 跑 `bash audit-tools/run.sh` 验证。
6. 提交。

### 场景 D：CI 报错怎么办

如果 PR 上看到：

> 📝 Architecture Docs Drift Audit — FAILED

打开 PR 评论里的 drift report（或下载 Artifact `drift-report`），会列出：

- **`MISSING_IN_DOCS`**：代码侧有，但 docs 没描述 → **新增**对应 `docs/architecture/<name>.md`，并在 `extractors.py` 的 `DOC_SUBSYSTEM_BY_FILE` 加映射。
- **`MISSING_IN_CODE`**：docs 描述了但代码删了 → **删除**对应的文档，或在文档里标 DEPRECATED。

按报告修完后 push 新 commit，CI 自动重跑。

---

## 脚本架构（开发者扩展用）

```
audit-tools/
├── extractors.py        # 提取代码侧和 docs 侧的事实点
├── normalize.py         # 归一化层：docs 标题 → canonical key
├── aligner.py           # 按 canonical key 对比，输出 drift 报告
├── refchecks.py         # 路径存在性 / 文档内链 / 重复文档
├── symbolcheck.py       # 代码符号存在性（仅提示，不计入 drift）
├── envcheck.py          # 环境变量三方比对（代码 / .env.example / 配置文档）
├── plugin_docs_check.py # 插件文档代码示例的 API 用法校验（P1–P5）
├── run.sh               # 一键执行，CI 和 hook 都调它
├── install-hook.sh      # 安装 pre-commit hook（开发者本地执行）
└── reports/
    ├── extracts.json     # 原始事实（debug 用）
    ├── drift_report.md   # 人类可读报告（PR 评论贴这个）
    ├── drift_report.json # JSON 格式（CI 解析用）
    ├── ref_report.md     # 引用完整性报告
    ├── symbol_report.md  # 符号提示清单
    ├── env_report.md     # 环境变量比对报告
    └── plugin_docs_report.md # 插件文档示例校验报告
```

### 改插件文档的代码块时，`plugin_docs_check.py` 怎么判

| 判定 | 含义                                                           | 误报率       |
| ---- | -------------------------------------------------------------- | ------------ |
| P1   | `import ... from '@openlearn/plugin-sdk'` 的符号 SDK 没导出    | ≈0           |
| P2   | `ctx.<成员>` 不在 `PluginContext` / `FrontendPluginContext` 里 | ≈0           |
| P3   | `ctx.services.<成员>` 不在任何 `services` 定义里               | ≈0           |
| P4   | `ctx.ui.<方法>` 不是 `FrontendPluginContext.ui` 的方法         | ≈0           |
| P5   | manifest 示例缺 `main`（schema 必填）                          | 低（仅提示） |

两处已知边界，改工具时别踩：

- **整行注释里的反例要跳过**。文档常写 `// import type { X } from '...'  // ❌ SDK 未导出`，
  若不剔除注释会把"正确指出某符号不存在"的说明判成错误。`_code_only()` 负责这件事。
- **只认 `ctx` / `hostCtx` / `pluginCtx` 三个别名**，不要加 `context` —— 内核代码里
  `request.context.actorRole` 会被误伤。
- 它判断的是"符号是否**声明**在 SDK 的 d.ts 里"，不是"是否从 index.ts **导出**"。
  声明了但没导出的情况它看不出来，需要靠人工或类型检查补。

### 新增环境变量时，`envcheck.py` 怎么判

它把三个事实源交叉比对，判定刻意分级（**只有 D1/D2/D3/D4 计入门禁**）：

| 判定 | 含义                                                              |
| ---- | ----------------------------------------------------------------- |
| D1   | 配置文档表格登记了，但全仓没有任何读取点（改名/删除后文档没跟上） |
| D2   | 生产代码读取且带平台前缀，但无任何注册表文档登记                  |
| D3   | 生产代码读取的无前缀变量，且无任何注册表文档登记                  |
| D4   | `docs/configuration/` 之外又出现一份成规模的变量表（≥ 10 行）     |
| H2   | 仅测试作用域读取（生产不生效），文档未提                          |
| H3   | `.env.example` 声明了但代码不读（预留项或已废弃）                 |
| H4   | `process.env[变量名]` 动态读取，静态检查覆盖不到                  |
| H5   | 平台自己写入再读的内部传递变量（如子进程 env 注入），非用户配置   |
| H6   | `\|\|` 回退链上的兼容别名，无需单独登记                           |

「登记」的口径是**三档**：`docs/configuration/` 的表格（权威清单，D1 只认这档）、
任何表格行 ≥ 5 的注册表文档、以及全仓任意文档里被反引号包裹的 `KEY` 散文提及。
目标是「没有隐形旋钮」，而不是「每个旋钮都必须进同一张表」。

**D4 存在的原因**：本仓曾同时维护两份变量清单（`docs/configuration/system-configuration.md`
与 `docs/architecture/configuration.md`），后者自陈"覆盖面更全"，最终两边各自漂移——
一份漏 4 个生产键、另一份停在 25 个（实际 71 个）。并列清单无法被同一道门禁守住，
所以现在只允许一份：`docs/architecture/configuration.md` 只讲设计形态，变量表一律链到配置页。
D4 就是用来拦住"再抄一份"这个念头的。

### 新增 subsystem 文档时，必改两处

```python
# 1. audit-tools/extractors.py
DOC_SUBSYSTEM_BY_FILE = {
    ...
    "your-new-doc-stem": ("your-canonical-name", "subsystem"),  # 加这一行
}

# 2. 如果你的 docs 用了非标准文件名（如 docs/ai/foo.md 而不是 docs/architecture/foo.md）
FILE_NAME_TO_CANONICAL = {
    ...
    "your-doc-stem": "your-canonical-name",  # 可选
}
```

```python
# 3. 如果你的 docs 标题（"Platform Kernel"）和代码目录名（kernel/）拼写不一致
#    在 audit-tools/normalize.py 加一行：
NORMALIZE_MAP = {
    ...
    "platform kernel": "kernel",
    "your docs title": "your-canonical-name",
}
```

---

## 设计原则

1. **静态优先**：纯规则 + 文件名匹配，不依赖 LLM；CI 跑得快（< 5 秒），不烧 token。
2. **归一化层处理变体**：docs 叫 "Platform Kernel"，代码叫 `kernel/`，归一化层把它们都映到 canonical `kernel`，避免伪 drift。
3. **whitelist > blacklist**：识别"已知子系统"用 whitelist（`DOC_SUBSYSTEM_BY_FILE`）；不识别就默认认为是散文，不当 drift 报。
4. **报告可机读**：JSON 输出让 CI 解析，Markdown 输出让人读懂。
5. **fail-fast**：drift > 0 直接 `exit 1`，CI 红，hook 红，强制修复。

---

## 相关文档

- `audit-tools/reports/drift_report.md` — 当前 drift 状态（运行后自动生成）
- [`platform-kernel.md`](../architecture/platform-kernel.md) — Layer 0-3 架构全景图
- [`system-overview.md`](../architecture/system-overview.md) — 系统总览
