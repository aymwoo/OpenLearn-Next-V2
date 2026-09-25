# Troubleshooting & FAQ 故障排查

覆盖端口占用、SQLite 写锁、Worker 插件启动失败、Manifest 校验错误与 iframe 课件通信问题。错误文案均可在源码中 grep 定位。

---

## 1. 端口占用（`EADDRINUSE`）

**现象**：启动报 `Error: listen EADDRINUSE: address already in use :::9000`。

**A:**
```bash
# 找到占用 9000 端口的进程
lsof -i :9000        # 或 ss -ltnp | grep 9000
kill <pid>
# 或换端口启动（服务端读 PORT 环境变量；npx 场景也可用 -p 参数）
PORT=9001 pnpm dev   # npx 场景：npx openlearn-next -p 9001
```

## 2. SQLite 写锁 / 数据库文件损坏

**现象**：报 `SQLITE_BUSY` / `database is locked`，或数据异常。

**A:** 平台使用 better-sqlite3（同步、单写者模型）：

- 确保**只有一个**服务进程指向同一数据库文件（多个 `pnpm dev` / npx 实例指向同一路径是常见根因）；
- 检查 `OPENLEARN_DB_PATH` 是否被残留环境变量指向了错误文件；
- 备份/重置方法见 [installation-guide FAQ](../getting-started/installation-guide)（开发库位于 `packages/core/db/educational_os.db`）；
- 测试并发场景不适用此问题——Vitest 使用 per-worker 临时库（见 [testing-strategy](../developer-guide/testing-strategy)）。

## 3. Worker 插件激活失败 / 超时

**现象**：插件状态卡在 `ACTIVATING` 后进入 `ERROR`，日志出现激活超时或 `could not be cloned`。

**A:**
- Worker 模式激活默认 **60 秒**超时（inline 为 5 秒）；耗时初始化在插件内周期调用 `ctx.reportProgress(stage, message)` 滑动续期（见 [plugin-update-distribution §5](../reference/plugin-update-distribution)）；
- 可用环境变量 `OPENLEARN_WORKER_ACTIVATE_TIMEOUT_MS` 调大超时排查；
- 报错含 `could not be cloned`：Worker RPC 只能传结构化克隆数据——不要在 Worker 模式下 `ctx.provide()` 函数/类实例，也不要把回调经命令总线跨线程传递；
- Worker 模式 `ctx.resolve(IDatabaseToken)` 的返回是异步代理：`exec()` 等需 `await`，且**不可用 `db.transaction(fn)` 同步回调**（见 [tutorial §8.1](../tutorials/plugin-development-tutorial)）。

## 4. 插件 Manifest 格式错误（Zod 校验失败）

**现象**：安装时报 `manifest.main 必须指定入口文件路径` 等，或激活时 Token 解析失败。

**A:**
- Manifest 经 Zod 强校验（`packages/core/esm-loader/manifest-schema.ts`），常见错误：缺 `main`、`api.routes.method` 使用了不支持的 `ALL`、`requires` Token 名不满足 `domain:Name` 格式；
- `ctx.resolve` 只接受 `Token<T>` 实例，不接受普通对象；自定义服务 Token 名必须满足 `(@scope/)?domain:Name`；
- `updateSource` 不在 Zod 强校验范围（passthrough），其 `repo` 白名单校验发生在服务端更新检测时；
- 完整字段规范见 [plugin-manifest-spec](../plugin/plugin-manifest-spec)。

## 5. iframe 课件报错 `SyntaxError: Failed to execute 'postMessage' on 'Window': Invalid target origin 'null'`

**A:** This is automatically handled by the platform's Bridge SDK which uses `Object.defineProperty + Proxy` to intercept and normalize invalid targetOrigin. If you still see this error, ensure bridge.js is loaded. The platform injects it automatically for `/runtime/` served courseware.
