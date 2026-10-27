/**
 * 构建期守卫：frontend 产物不得残留裸模块说明符。
 *
 * 背景：远程插件的前端跑在不透明源 iframe（`sandbox="allow-scripts"`）里，那里
 * 没有 React、没有 `window.HostSharedDeps`、也没有 importmap，加载方式是
 * `Blob` + 动态 `import()` —— 裸说明符无从解析。宿主的 `transformBareModuleImports`
 * 会把 `import React from 'react'` 改写成 `window.HostSharedDeps.React`，但改写后的
 * 源码是在**没有 HostSharedDeps** 的 iframe 里求值的，结果就是激活即 TypeError，
 * 而报错完全不指向真正原因。
 *
 * 本测试锁住三件事：
 * 1. frontend 里 `import React` → build **失败**，输出点明「裸模块说明符」与具体说明符；
 * 2. 纯桥接 frontend（无任何 import）→ build 成功，产物干净；
 * 3. 对 `@openlearn/plugin-sdk` 的**值导入**同样被拦（它也在 external 里）。
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const cliPath = path.resolve(__dirname, '../cli.mjs');

const INDEX_TS = [
  'export default {',
  "  manifest: { id: 'ext-guard-test', name: 'Guard Test', version: '1.0.0', main: 'index.js' },",
  '  async activate() {},',
  '};',
  '',
].join('\n');

function makeProject(frontendSource: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-sdk-guard-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'openlearn-plugin-guard-test', version: '1.0.0', type: 'module' }, null, 2),
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), INDEX_TS, 'utf8');
  if (frontendSource !== null) {
    fs.writeFileSync(path.join(dir, 'src', 'frontend.tsx'), frontendSource, 'utf8');
  }
  return dir;
}

function runBuild(dir: string): { code: number; out: string } {
  try {
    const out = execSync(`node ${cliPath} build 2>&1`, { cwd: dir, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('构建期守卫：frontend 产物不得有裸模块说明符', () => {
  it('import React → 构建失败，且输出点名该说明符与改法', () => {
    const dir = makeProject(
      [
        "import React from 'react';",
        // 必须真的用到 React，否则 esbuild 会 tree-shake 掉整个 import、
        // 产物里自然没有裸说明符 —— 那是真干净，不是逃过守卫。
        'async function activate() { return React.version; }',
        'function deactivate() {}',
        'export default { activate, deactivate };',
        '',
      ].join('\n'),
    );
    try {
      const { code, out } = runBuild(dir);
      expect(code).not.toBe(0);
      expect(out).toContain('裸模块说明符');
      expect(out).toContain('"react"');
      expect(out).toContain('frontend-sandbox-capability-boundary');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('值导入 @openlearn/plugin-sdk 同样被拦（它在 external 里）', () => {
    const dir = makeProject(
      [
        "import { Token } from '@openlearn/plugin-sdk';",
        'async function activate() { void Token; }',
        'function deactivate() {}',
        'export default { activate, deactivate };',
        '',
      ].join('\n'),
    );
    try {
      const { code, out } = runBuild(dir);
      expect(code).not.toBe(0);
      expect(out).toContain('@openlearn/plugin-sdk');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('纯桥接 frontend（无 import）→ 构建成功，产物干净', () => {
    const dir = makeProject(
      [
        'async function activate(ctx: any) {',
        '  await ctx.ui.showToast("ok");',
        '}',
        'function deactivate() {}',
        'export default { activate, deactivate };',
        '',
      ].join('\n'),
    );
    try {
      const { code, out } = runBuild(dir);
      expect(code).toBe(0);
      expect(out).toContain('Packaged');

      const bundle = fs.readFileSync(path.join(dir, 'dist', 'frontend.js'), 'utf8');
      expect(bundle).not.toMatch(/\bfrom\s*["'][^./][^"']*["']/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
