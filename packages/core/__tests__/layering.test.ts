import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * 分层守卫（ARCH）：`packages/core` 是内核层，依赖方向必须是「应用 → 内核」，
 * **永远不能反向** import 应用层（server/**）。
 *
 * 历史：2026-09-25 审计 H-7 发现 worker-runtime / plugin-host 反向 import
 * `server/utils/logger.js`，拖了逾一版才整改（2026-09-30，logger 已下沉至
 * `packages/core/observability/logger.ts`）。本测试把「core 生产代码零 server
 * 依赖」钉死，防止下一个 import 把分层再次击穿。
 *
 * 范围界定：core 的 `__tests__/` 集成测试允许 import server（它们本就是在
 * 两层之间做集成验证），故仅扫描生产源码。
 */

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectTsFiles(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('ARCH 分层守卫：packages/core 不得反向依赖应用层', () => {
  it('core 生产源码（非 __tests__）不 import server/**', () => {
    const coreDir = path.resolve(process.cwd(), 'packages', 'core');
    const offenders = collectTsFiles(coreDir)
      .filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`))
      .map((file) => ({ file, content: readFileSync(file, 'utf8') }))
      .filter(({ content }) => /from\s+['"][^'"]*\/server\/[^'"]*['"]/.test(content))
      .map(({ file }) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
