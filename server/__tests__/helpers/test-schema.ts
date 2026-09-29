/**
 * 测试库 Schema 兜底
 *
 * 背景（曾导致 `classroom-session-resume.test.ts` 间歇性报 `no such table: classroom_sessions`）：
 *   - `packages/core/db/index.ts` 的内联 schema 块**不包含**课堂相关表
 *     （classroom_sessions / classroom_feed / teaching_modes 等都来自 migrations/*.sql）；
 *   - `runMigrations` 只在 `server.ts` 启动时执行，**测试环境从不在 setup 阶段跑迁移**；
 *   - 于是有 7 个测试文件各自在 `beforeAll` 里手动 `runMigrations` 兜底，
 *     而没兜底的文件就依赖「同 worker 里恰好有别的文件先跑过迁移」。
 *
 * 后果：vitest `fileParallelism: true` 下文件到 worker 的分配不确定，
 * 某文件独占一个全新 worker 时必然缺表 → 时好时坏的 flaky。
 *
 * 修法：把「补齐迁移」上移到 `vitest.setup.ts`，对所有 server 测试统一兜底。
 * `runMigrations` 自身幂等（按 `_migrations` 记账），首个文件建表后其余文件直接跳过。
 * 本模块用模块级标记保证同一 worker 内只真正执行一次。
 *
 * 用法：服务端集成测试在 `beforeAll` 里调用 `ensureTestSchema()` 即可，
 * 不再需要各自 import 迁移工具。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMigrationsFromDirectory, runMigrations } from '../../utils/migrate.js';
import { kernelContainer } from '../../../packages/core/kernel/index.js';

// 本文件位于 server/__tests__/helpers/ → 上溯三级到仓库根才是 migrations/
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');

/** 同一 worker 内只真正跑一次；模块级变量依赖 vitest 的模块缓存跨测试文件复用 */
let ensured = false;

/**
 * 确保测试库已应用全部 migrations（幂等、可重复调用）。
 * @param force 即使本 worker 已执行过也强制再跑一次（默认 false）
 */
export function ensureTestSchema(force = false): void {
  if (ensured && !force) return;
  ensured = true;
  try {
    runMigrations(kernelContainer.db as any, loadMigrationsFromDirectory(migrationsDir));
  } catch (e) {
    // 兜底本身失败不应让整个测试文件无法启动：让具体用例去暴露真正的缺表问题
    console.warn('[test-db] ensureTestSchema failed:', e);
  }
}
