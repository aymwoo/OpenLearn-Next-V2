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
2. **并发策略**: 为避免 SQLite 并发写死锁，`vitest.config.ts` 中禁用了文件并行运行 (`singleThread: true` / `fileParallelism: false`)。
3. **插件独立测试**: 使用 `@openlearn/plugin-test-kit` 的 `createMockContext()` 隔离插件测试环境。
