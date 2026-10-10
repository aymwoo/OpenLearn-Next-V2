/**
 * 测试用临时 ZIP helper（R-4 路径化契约的适配层）。
 *
 * 生产 API（`installPluginFromZip` / `updatePluginFromZip` / `validateAndBundleZip`）
 * 从 Buffer 改为路径后，测试持有的 Buffer 需要落成临时文件。与生产
 * `writeBufferToTempZip` 的区别：本 helper **自动清理**（vitest afterEach）——
 * 否则每个安装测试都在 /tmp 留一个 zip，正是 H-8「测试污染工作树」那类问题
 * （当时是仓库内 plugins/ 目录，这里是 /tmp，性质相同：无人清理、逐次增长）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach } from 'vitest';

const created: string[] = [];

/** 把 Buffer 落成临时 ZIP 文件并返回路径（自动登记清理） */
export function tmpZipPath(buffer: Buffer): string {
  const p = path.join(os.tmpdir(), `test-plugin-zip-${randomUUID()}.zip`);
  fs.writeFileSync(p, buffer);
  created.push(p);
  return p;
}

/** 手动清理（一般不需要 —— afterEach 已自动执行） */
export function cleanupTmpZips(): void {
  for (const p of created.splice(0)) {
    try {
      fs.rmSync(p, { force: true });
    } catch {
      /* best effort */
    }
  }
}

// 模块级注册：导入本 helper 的测试文件在一个用例结束后自动清理全部临时 ZIP。
// vitest 的 afterEach 支持文件作用域注册，且测试文件相互隔离、不会重复清理。
afterEach(() => {
  cleanupTmpZips();
});
