/**
 * openlearn.d.ts ↔ index.ts Token 一致性防回归测试。
 *
 * openlearn.d.ts 是手工维护的独立声明文件（build.mjs 直接复制为 dist/index.d.ts，
 * 即 npm 包的类型入口）。历史上曾多次出现"index.ts 新增 Token 但 d.ts 未同步"的漂移
 * （v0.3.22 审计时 d.ts 缺 14/33 个 Token，第三方插件按文档 import 直接 TS2305）。
 * 本测试静态解析两个文件，保证两者 Token 集合完全一致。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkDir = path.resolve(__dirname, '..');

/** 从 index.ts 的 value-export 块中提取所有 Token 导出名（不含 Token 类本身） */
function extractTokenExportsFromIndex(): Set<string> {
  const src = fs.readFileSync(path.join(sdkDir, 'index.ts'), 'utf-8');
  const names = new Set<string>();
  // 只匹配值导出 `export { ... } from '...'`（`export type {` 会被排除）
  for (const block of src.matchAll(/(?<!type\s)export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1].split(',')) {
      const name = raw.trim();
      // 排除 Token 类本身（'Token'.endsWith('Token') 为真）
      if (name.endsWith('Token') && name !== 'Token') names.add(name);
    }
  }
  return names;
}

/** 从 openlearn.d.ts 提取 declare const 的 Token 声明与 export 块导出的 Token */
function extractTokenSurfaceFromDts(): { declared: Set<string>; exported: Set<string> } {
  const src = fs.readFileSync(path.join(sdkDir, 'openlearn.d.ts'), 'utf-8');
  const declared = new Set<string>();
  for (const m of src.matchAll(/declare\s+const\s+(\w+Token)\s*:/g)) declared.add(m[1]);
  const exported = new Set<string>();
  for (const block of src.matchAll(/(?<!type\s)export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1].split(',')) {
      const name = raw.trim();
      // 排除 Token 类本身（以 declare class 声明，非 declare const）
      if (name.endsWith('Token') && name !== 'Token') exported.add(name);
    }
  }
  return { declared, exported };
}

describe('openlearn.d.ts ↔ index.ts Token parity', () => {
  const indexTokens = extractTokenExportsFromIndex();
  const { declared, exported } = extractTokenSurfaceFromDts();

  it('index.ts 导出的每个 Token 都必须在 openlearn.d.ts 中 declare', () => {
    const missing = [...indexTokens].filter((t) => !declared.has(t));
    expect(missing, `openlearn.d.ts 缺少以下 Token 声明（dist/index.d.ts 会缺失，插件 import 即 TS2305）`).toEqual([]);
  });

  it('index.ts 导出的每个 Token 都必须出现在 openlearn.d.ts 的 export 列表中', () => {
    const missing = [...indexTokens].filter((t) => !exported.has(t));
    expect(missing, `openlearn.d.ts 的 export 块缺少以下 Token`).toEqual([]);
  });

  it('openlearn.d.ts 不得声明 index.ts 未导出的幽灵 Token', () => {
    const ghost = [...declared].filter((t) => !indexTokens.has(t));
    expect(ghost, `openlearn.d.ts 声明了 index.ts 不存在的 Token（发布类型与运行时不符）`).toEqual([]);
  });

  it('openlearn.d.ts 的 export 列表不得包含未声明的 Token', () => {
    const dangling = [...exported].filter((t) => !declared.has(t));
    expect(dangling).toEqual([]);
  });

  it('Token 总数应达到当前的 33 个（新增 Token 时请同步更新此基线与 docs/api/di-tokens.md）', () => {
    expect(indexTokens.size).toBe(33);
  });
});
