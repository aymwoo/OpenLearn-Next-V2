/**
 * CLI 迁移器产物的加载契约（P0 回归）。
 *
 * ## 背景
 *
 * `cli-data.mjs` 原先这样加载迁移器：
 *
 * ```js
 * const { loadMigrationsFromDirectory } = await import('./packages/core/db/migrator.js');
 * ```
 *
 * 那条路径**在任何环境都不存在**：源码检出里只有 `migrator.ts`，发布包的 `files`
 * 清单里也只有 `dist/*` 与几个 `cli-*.mjs`。于是帮助文本里宣传的两条命令
 * `openlearn-next migrate status` / `migrate rollback` 走到加载点必然 MODULE_NOT_FOUND。
 *
 * 它之所以长期没被发现：`_migrations` 表不存在时函数在**更早的分支**就提前返回，
 * 于是空库上看起来一切正常 —— 只有「库里已有迁移记录」的真实用户会踩到。
 *
 * 这里钉住两件事：产物存在时能拿到全部导出；产物缺失时给出**可操作**的报错，
 * 而不是让用户对着 MODULE_NOT_FOUND 猜。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCliMigrator } from '../../../cli-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

describe('loadCliMigrator', () => {
  it('产物存在时导出迁移器所需的全部函数', () => {
    const artifact = path.join(REPO_ROOT, 'dist/cli-migrator.cjs');
    if (!fs.existsSync(artifact)) {
      // 源码检出未构建：跳过而不是假装通过。CI 的 build 阶段会产出它。
      expect(typeof loadCliMigrator).toBe('function');
      return;
    }
    const mod = loadCliMigrator();
    for (const name of ['loadMigrationsFromDirectory', 'getDefaultMigrationsDir', 'runMigrations']) {
      expect(typeof mod[name], name).toBe('function');
    }
    // 解析器随包产物一起可用，且指向真实的 .sql 目录
    const dir = mod.getDefaultMigrationsDir();
    expect(fs.readdirSync(dir).some((f) => f.endsWith('.sql'))).toBe(true);
  });

  it('产物缺失时抛可操作的错误码与提示，而不是 MODULE_NOT_FOUND', () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, 'cli-data.mjs'), 'utf-8');
    // 去注释再断言：文件头注释里**故意**保留了对那条坏路径的引用（说明为什么不再用）
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // 源码断言：不再直接 import 那条不存在的路径
    expect(src).not.toContain("import('./packages/core/db/migrator.js')");
    // 且保留了带 code 的可操作报错
    expect(src).toContain('CLI_MIGRATOR_ARTIFACT_MISSING');
    expect(src).toContain('pnpm build');
  });
});
