/**
 * Smoke tests for BrowserEsmLoader — Blob URL + import().
 *
 * Phase 3 scope: verify Blob URL lifecycle (create + revoke) and error classification.
 * jsdom 不支持 Blob URL 的 import()（ERR_MODULE_NOT_FOUND），因此使用 TestBrowserEsmLoader
 * 子类覆盖 doImport() 来模拟模块加载行为。
 *
 * Covers:
 * - Successful load via doImport mock
 * - URL.revokeObjectURL is called in finally block
 * - EsmSyntaxError on SyntaxError from import()
 * - revokeObjectURL is called even when import() fails
 *
 * Full browser integration tests deferred to Phase 9.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserEsmLoader } from '../browser-loader.js';
import type { PluginModule } from '../esm-loader.js';
import { EsmSyntaxError } from '../errors.js';

/**
 * 测试子类 — 覆盖 doImport() 以绕过 Node.js/jsdom 中 Blob URL import() 的限制。
 */
class TestBrowserEsmLoader extends BrowserEsmLoader {
  private mockImport: (url: string) => Promise<PluginModule>;

  constructor(mockImport: (url: string) => Promise<PluginModule>) {
    super();
    this.mockImport = mockImport;
  }

  protected override async doImport(url: string): Promise<PluginModule> {
    return this.mockImport(url);
  }
}

describe('BrowserEsmLoader', () => {
  it('should load valid ESM code via mock import and return module exports', async () => {
    const mockModule: PluginModule = { hello: 'world' };
    const loader = new TestBrowserEsmLoader(async (_url: string) => mockModule);

    const mod = await loader.load('export const hello = "world";');
    expect(mod).toBe(mockModule);
    expect(mod.hello).toBe('world');
  });

  it('should call URL.revokeObjectURL after successful load', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const loader = new TestBrowserEsmLoader(async (_url: string) => ({ x: 1 }));

    await loader.load('export const x = 1;');

    expect(createSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalled();

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it('should call URL.revokeObjectURL even when doImport throws', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const loader = new TestBrowserEsmLoader(async (_url: string) => {
      throw new Error('load failed');
    });

    await expect(loader.load('const x =')).rejects.toThrow();
    expect(revokeSpy).toHaveBeenCalled();

    revokeSpy.mockRestore();
  });

  it('should throw EsmSyntaxError when doImport throws SyntaxError', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const loader = new TestBrowserEsmLoader(async (_url: string) => {
      throw new SyntaxError('Unexpected token');
    });

    await expect(loader.load('const x =')).rejects.toThrow(EsmSyntaxError);
    expect(revokeSpy).toHaveBeenCalled();

    revokeSpy.mockRestore();
  });
});
