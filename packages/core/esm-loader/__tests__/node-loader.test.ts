/**
 * Unit tests for NodeEsmLoader — data: URL + import().
 *
 * Covers:
 * - Successful load of valid ESM code (PluginModule shape verification)
 * - Named exports without default export
 * - EsmSyntaxError on syntax-invalid code
 * - Cache isolation: two load() calls return different module instances
 * - Timeout wrapping pattern: Promise.race correctly interrupts load()
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NodeEsmLoader } from '../node-loader.js';
import {
  EsmSyntaxError,
} from '../errors.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

function fixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('NodeEsmLoader', () => {
  let loader: NodeEsmLoader;

  beforeEach(() => {
    loader = new NodeEsmLoader();
  });

  it('should load valid ESM code and return correct PluginModule shape', async () => {
    const code = fixture('valid-plugin.js');
    const mod = await loader.load(code);

    expect(mod.default).toBeDefined();
    expect(mod.default!.manifest).toBeDefined();
    expect(mod.default!.manifest!.id).toBe('test-plugin');
    expect(typeof mod.default!.activate).toBe('function');
  });

  it('should return named exports for module without default export', async () => {
    const code = fixture('no-default.js');
    const mod = await loader.load(code);

    expect(mod.hello).toBe('world');
    expect(mod.default).toBeUndefined();
  });

  it('should throw EsmSyntaxError for syntax-invalid code', async () => {
    const code = fixture('syntax-error.js');
    await expect(loader.load(code)).rejects.toThrow(EsmSyntaxError);
  });

  it('should support timeout via Promise.race wrapping pattern', async () => {
    // D-14: NodeEsmLoader.load() does not implement its own timeout.
    // PluginRuntime wraps load() with Promise.race(timeoutPromise) to enforce limits.
    // This test verifies the wrapping pattern works for fast-loading modules.
    const code = fixture('valid-plugin.js');
    const timeoutMs = 50;

    const result = await Promise.race([
      loader.load(code),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
    expect(result.default!.manifest!.id).toBe('test-plugin');
  });

  it('should return different module instances for two load() calls (no cache)', async () => {
    const code = fixture('valid-plugin.js');
    const mod1 = await loader.load(code);
    const mod2 = await loader.load(code);

    // Module namespace objects from different import() calls should be distinct
    expect(mod1).not.toBe(mod2);
    expect(mod1.default).not.toBe(mod2.default);
  });
});
