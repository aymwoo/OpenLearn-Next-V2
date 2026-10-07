# 恶意插件样本（静态门回归用）

本目录存放**故意违规**的插件入口样本，用于验证 A-1 / A-2 的静态门会拒绝它们。

> 这些代码**永不执行** —— 它们只被送进 `assertPluginCodeSafe()` 做静态检查，
> 或送进 `bundlePlugin()` 观察 esbuild 的处理结果。任何一条能真正跑起来都算门失效。

每个样本导出 `pluginSource`（字符串）与 `expectRejected`（该样本是否应被静态门拒绝）。