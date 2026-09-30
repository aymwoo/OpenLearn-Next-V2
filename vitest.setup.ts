import { TextEncoder, TextDecoder } from 'util';
import { expect } from 'vitest';
import path from 'path';

const nodeUint8Array = new TextEncoder().encode('').constructor;
global.Uint8Array = nodeUint8Array as unknown as typeof Uint8Array;
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as unknown as typeof TextDecoder;
process.env.OPENLEARN_MAX_ZIP_SIZE = process.env.OPENLEARN_MAX_ZIP_SIZE || String(5 * 1024 * 1024);

/**
 * 服务端集成测试的 Schema 兜底。
 *
 * 课堂相关表（classroom_sessions / classroom_feed / teaching_modes …）只存在于
 * migrations/*.sql，内联 schema 块里没有，而 runMigrations 仅在 server.ts 启动时执行。
 * 过去靠 7 个测试文件各自在 beforeAll 手动补跑，其余文件则依赖「同 worker 里恰好有别人跑过」——
 * 在 fileParallelism 下 worker 分配不确定，于是间歇性 `no such table: classroom_sessions`。
 *
 * 这里统一兜底：仅当当前测试文件位于 server/__tests__ 下时才加载 DB 并补齐迁移，
 * 避免让 200+ 个纯前端测试付出加载 better-sqlite3 与读迁移文件的代价。
 * 详见 server/__tests__/helpers/test-schema.ts 的注释。
 */
const testPath: string = (() => {
  try {
    return String((expect.getState() as { testPath?: string }).testPath ?? '');
  } catch {
    return '';
  }
})();

const isServerTest = testPath.includes(`${path.sep}server${path.sep}__tests__${path.sep}`);

if (isServerTest) {
  const { ensureTestSchema } = await import('./server/__tests__/helpers/test-schema.js');
  ensureTestSchema();
}
