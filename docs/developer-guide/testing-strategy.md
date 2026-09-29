# Testing Strategy 测试策略

OpenLearn V2 使用 **Vitest** 搭配 `jsdom` 环境作为标准测试框架。配置位于根目录的 `vitest.config.ts`。

---

## 运行测试命令

```bash
# 运行完整测试套件
pnpm test

# 运行特定模块测试
pnpm vitest run -t "Kernel"

# 监听模式
pnpm vitest watch
```

---

## 测试规范与原则

1. **测试文件放置**: 所有测试存放在对应模块同级目录下的 `__tests__/` 文件夹中，后缀为 `.test.ts` 或 `.test.tsx`。
2. **并发策略**: `vitest.config.ts` 启用了 `fileParallelism: true`（文件级并行），安全性由 **per-worker 临时 SQLite 数据库**保证 —— 每个测试 worker 通过 `VITEST_POOL_ID` 在 `/tmp/openlearn_test_dbs/` 下获得独立数据库，互不干扰。不要在测试中写死或共享数据库路径。
3. **插件独立测试**: 使用 `@openlearn/plugin-test-kit` 的 `createMockContext()` 隔离插件测试环境。
4. **服务端测试的数据库 Schema**: 课堂相关表（`classroom_sessions` / `classroom_feed` / `teaching_modes` 等）只存在于 `migrations/*.sql` —— `packages/core/db/index.ts` 的内联 schema 块里没有，而 `runMigrations` 仅在 `server.ts` 启动时执行。`vitest.setup.ts` 已对 `server/__tests__/` 下的测试**统一补齐迁移**，因此新增服务端集成测试**不需要**自己调用迁移工具；若确有需要（如使用独立的 `:memory:` 库），在 `beforeAll` 里调用 `ensureTestSchema()`（`server/__tests__/helpers/test-schema.ts`，幂等）。
   - 历史教训：曾有 7 个测试文件各自在 `beforeAll` 手动补跑迁移，其余文件则依赖「同 worker 里恰好有别人先跑过」。在 `fileParallelism: true` 下文件到 worker 的分配不确定，导致 `classroom-session-resume.test.ts` 间歇性报 `no such table: classroom_sessions`。**依赖同 worker 内其他文件的执行顺序 = flaky**。
