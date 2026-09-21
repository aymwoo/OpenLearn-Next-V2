/**
 * install-utils.ts 的"旧 build 兼容"测试
 *
 * 场景：plugin manifest 写 "dist/index.js" 但 ZIP 把文件平铺在根目录（典型问题：
 *   openlearn-plugin-learnstar v1.0.0 / openlearn-plugin-lti13 v1.0.0 的 build.mjs
 *   用递归 addDirToZip 但 JSZip 在某些 Node 版本下会扁平化，导致 manifest 路径与
 *   实际文件路径错位）。
 *
 * 期望行为：
 *   - 旧 build（manifest.main="dist/index.js", ZIP root 有 index.js）→ 自动 fallback，
 *     entryFileName 修正为 "index.js"，并 console.warn 提示作者修 build。
 *   - 正常 build（manifest.main="index.js", ZIP root 有 index.js）→ 不触发 fallback，
 *     entryFileName = manifest.main。
 *   - 真正缺失（manifest.main="missing.js", ZIP 里都没有）→ 仍抛出原错误。
 *   - 嵌套真实存在（manifest.main="dist/inner.js", ZIP root 有 dist/inner.js）→
 *     不触发 fallback（说明：只有"manifest 写错前缀但 ZIP 是扁平"才被救）。
 *
 * 相关：plugins/openlearn-plugin-learnstar/build.mjs:62-71,
 *      plugins/openlearn-plugin-lti13/build.mjs:60-69
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { validateAndBundleZip } from '../install-utils.js';

/**
 * 构建测试 ZIP，结构由 `layout` 决定：
 *   layout = 'flat'           → ZIP 根目录：index.js + manifest.json
 *   layout = 'nested'         → ZIP dist/：index.js + manifest.json（manifest 写 dist/index.js 但实际有 dist/ 文件夹）
 *   layout = 'mixed-with-prefix-but-flat' → ZIP 根：index.js, manifest 写 dist/index.js
 */
async function buildTestZip(opts: {
  main: string;
  layout: 'flat' | 'nested' | 'mixed-with-prefix-but-flat';
  id?: string;
  name?: string;
}): Promise<Buffer> {
  const zip = new JSZip();
  const entryCode = 'export default { activate: async () => {} };';
  const manifest = {
    id: opts.id ?? 'ext-fallback-test',
    name: opts.name ?? 'Fallback Test',
    version: '1.0.0',
    main: opts.main,
  };
  const manifestJson = JSON.stringify(manifest);

  if (opts.layout === 'flat') {
    zip.file('manifest.json', manifestJson);
    zip.file('index.js', entryCode);
  } else if (opts.layout === 'nested') {
    zip.file('manifest.json', manifestJson);
    zip.file('dist/index.js', entryCode);
  } else {
    // 'mixed-with-prefix-but-flat'：manifest 写 dist/index.js，但 ZIP 实际是扁平的
    zip.file('manifest.json', manifestJson);
    zip.file('index.js', entryCode);
  }

  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('validateAndBundleZip — manifest.main fallback (兼容旧 build)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('正常 build（main="index.js", ZIP 根有 index.js）— 直接命中，不走 fallback', async () => {
    const buf = await buildTestZip({ main: 'index.js', layout: 'flat' });
    const { entryFileName } = await validateAndBundleZip(buf);

    expect(entryFileName).toBe('index.js');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('旧 build（main="dist/index.js", ZIP 根有 index.js）— 自动 fallback 并 console.warn', async () => {
    const buf = await buildTestZip({
      main: 'dist/index.js',
      layout: 'mixed-with-prefix-but-flat',
      id: 'ext-old-build',
      name: 'Old Build',
    });
    const { entryFileName, manifest } = await validateAndBundleZip(buf);

    expect(entryFileName).toBe('index.js');
    expect(manifest.main).toBe('dist/index.js'); // manifest 原文不动（schema 不接受修改）
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnMsg = warnSpy.mock.calls[0][0] as string;
    expect(warnMsg).toContain('"dist/index.js"');
    expect(warnMsg).toContain('"index.js"');
    expect(warnMsg.toLowerCase()).toMatch(/fallback|falling back/);
  });

  it('真实嵌套存在（main="dist/index.js", ZIP 真的 dist/index.js）— 不走 fallback', async () => {
    const buf = await buildTestZip({ main: 'dist/index.js', layout: 'nested' });
    const { entryFileName } = await validateAndBundleZip(buf);

    expect(entryFileName).toBe('dist/index.js');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('真正缺失（main="missing.js", ZIP 里都没有）— 仍抛出原错误（不被 fallback 误救）', async () => {
    const buf = await buildTestZip({ main: 'missing.js', layout: 'flat' });
    await expect(validateAndBundleZip(buf)).rejects.toThrow(
      /Entry file "missing\.js" specified in manifest not found in ZIP package/,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('真实不存在 + dist 前缀也不存在（main="dist/missing.js", ZIP 里什么都没有）— 仍抛错', async () => {
    const buf = await buildTestZip({ main: 'dist/missing.js', layout: 'flat' });
    await expect(validateAndBundleZip(buf)).rejects.toThrow(
      /Entry file "dist\/missing\.js" specified in manifest not found in ZIP package/,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('dist 嵌套里 fallback 不递归 (legit main="dist/a/b.js", ZIP 只有 dist/a/b.js) — 不走 fallback', async () => {
    // 验证 fallback 只在"扁平 vs 单层 dist"场景生效，不会把"dist/foo/bar.js"误判为"foo/bar.js"
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: 'ext-deep',
        name: 'Deep',
        version: '1.0.0',
        main: 'dist/a/b.js',
      }),
    );
    zip.file('dist/a/b.js', 'export default {};');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const { entryFileName } = await validateAndBundleZip(buf);
    expect(entryFileName).toBe('dist/a/b.js');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('旧 build 端到端：完整 plugin manifest + 真实 dist 前缀', async () => {
    // 模拟 openlearn-plugin-learnstar v1.0.0 旧 build 的实际场景：
    //   - manifest 完整（id/main/version/requires 都对）
    //   - manifest.main = "dist/index.js"
    //   - ZIP 实际扁平（addDirToZip 在 jszip 3.x 下意外扁平化）
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        id: 'openlearn-plugin-learnstar',
        name: 'LearnStar',
        version: '1.0.0',
        main: 'dist/index.js',
        engines: { openlearn: '>=0.3.15' },
      }),
    );
    zip.file('index.js', 'export default { activate: async () => {} };');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });

    const { manifest, entryFileName, bundledCode } = await validateAndBundleZip(buf);

    expect(manifest.id).toBe('openlearn-plugin-learnstar');
    expect(entryFileName).toBe('index.js'); // fallback 后的真实路径
    expect(typeof bundledCode).toBe('string');
    expect(bundledCode.length).toBeGreaterThan(0);
  });
});