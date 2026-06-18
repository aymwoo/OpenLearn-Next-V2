/**
 * 集成测试 — esbuild 打包 + ZIP 解压 + NodeEsmLoader 端到端。
 *
 * 覆盖:
 * - Test 1: bundlePlugin 打包单文件 ESM 代码
 * - Test 2: bundlePlugin 保留 @openlearn/* Token import 为 external
 * - Test 3: bundlePlugin 拒绝非法 npm import（非相对路径且非 Token 服务）
 * - Test 4: validateAndBundleZip 解压合法 sample.zip
 * - Test 5: validateAndBundleZip 拒绝缺少 manifest.json 的 ZIP
 * - Test 6: NodeEsmLoader.load(bundledCode) 端到端加载 + 激活
 * - Test 7: 路径穿越 ZIP 被 validateAndBundleZip 拒绝
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { bundlePlugin, validateAndBundleZip } from '../install-utils.js';
import { NodeEsmLoader } from '../node-loader.js';
import { manifestSchema } from '../manifest-schema.js';
import JSZip from 'jszip';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, 'fixtures');

// 读取 sample.zip fixture
function sampleZipBuffer(): Buffer {
  return fs.readFileSync(path.join(fixturesDir, 'sample.zip'));
}

// 创建临时目录 helper
function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `bundle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('bundlePlugin', () => {
  let resolveDir: string;

  beforeAll(() => {
    resolveDir = tmpDir();
  });

  // Test 1: 打包单文件 ESM 代码
  it('should bundle a single-file ESM module', async () => {
    const code = 'export const x = 1; export default { hello: "world" };';
    const result = await bundlePlugin(code, resolveDir);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // esbuild 打包后可能保留 export 或内联所有内容
    expect(result).toBeTruthy();
  });

  // Test 2: @openlearn/* Token import 保留为 external
  it('should preserve @openlearn/* Token imports as external', async () => {
    const code = `import { Token } from "@openlearn/core:ITest";
export const x = 1;`;
    const result = await bundlePlugin(code, resolveDir);

    // Token import 应被保留（未被内联）
    expect(result).toContain('@openlearn/core:ITest');
  });

  // Test 3: 拒绝非法 npm import
  it('should reject non-relative, non-Token imports', async () => {
    const code = 'import lodash from "lodash"; export const x = 1;';
    // esbuild 无法解析 lodash，应抛出错误
    await expect(bundlePlugin(code, resolveDir)).rejects.toThrow();
  });
});

describe('validateAndBundleZip', () => {
  // Test 4: 解压合法 sample.zip
  it('should extract and bundle a valid ZIP package', async () => {
    const zipBuffer = sampleZipBuffer();
    const result = await validateAndBundleZip(zipBuffer);

    // 校验 manifest
    expect(result.manifest).toBeDefined();
    expect(result.manifest.id).toBe('ext-sample');
    expect(result.manifest.name).toBe('Sample Plugin');
    expect(result.manifest.version).toBe('1.0.0');

    // 校验 bundledCode
    expect(typeof result.bundledCode).toBe('string');
    expect(result.bundledCode.length).toBeGreaterThan(0);

    // 校验 entryFileName
    expect(result.entryFileName).toBe('index.js');
  });

  // Test 5: 拒绝缺少 manifest.json 的 ZIP
  it('should reject ZIP without manifest.json', async () => {
    const zip = new JSZip();
    zip.file('index.js', 'export default {}');
    const badZipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(validateAndBundleZip(badZipBuffer)).rejects.toThrow(/manifest\.json/i);
  });

  // Test 7: 路径穿越防护
  it('should reject ZIP with path traversal entries', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
      id: 'ext-traversal',
      name: 'Traversal',
      version: '1.0.0',
      main: 'index.js',
    }));
    zip.file('../etc/passwd', 'malicious content');
    zip.file('index.js', 'export default { manifest: { id: "ext-traversal", name: "T", version: "1.0.0" }, activate: async () => {} };');

    const badZipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(validateAndBundleZip(badZipBuffer)).rejects.toThrow(/path traversal/i);
  });
});

describe('NodeEsmLoader + bundle E2E', () => {
  // Test 6: 端到端 — esbuild bundle → NodeEsmLoader.load() → PluginModule
  it('should load esbuild-bundled code via NodeEsmLoader', async () => {
    // Step 1: ZIP → bundle
    const zipBuffer = sampleZipBuffer();
    const { bundledCode, manifest } = await validateAndBundleZip(zipBuffer);

    expect(manifest.id).toBe('ext-sample');

    // Step 2: NodeEsmLoader.load()
    const loader = new NodeEsmLoader();
    const mod = await loader.load(bundledCode);

    // Step 3: 验证 PluginModule 结构
    expect(mod).toBeDefined();
    expect(mod.default).toBeDefined();
    expect(mod.default.manifest).toBeDefined();
    expect(mod.default.manifest.id).toBe('ext-sample');
    expect(typeof mod.default.activate).toBe('function');
  });

  // 端到端 schema 验证
  it('should validate manifest via zod schema', () => {
    const validManifest = {
      id: 'ext-sample',
      name: 'Sample Plugin',
      version: '1.0.0',
      main: 'index.js',
    };
    expect(() => manifestSchema.parse(validManifest)).not.toThrow();

    const invalidManifest = { id: 'ext-x' };
    expect(() => manifestSchema.parse(invalidManifest)).toThrow();
  });
});
