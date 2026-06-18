/**
 * Unit tests for NodeEsmLoader — data: URL + import().
 *
 * Covers:
 * - Successful load of valid ESM code (PluginModule shape verification)
 * - Named exports without default export
 * - EsmSyntaxError on syntax-invalid code
 * - Timeout strategy via Promise.race (load() itself doesn't hang)
 * - Cache isolation: two load() calls return different module instances
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

/** Helper: creates a promise that rejects after `ms` milliseconds. */
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
  );
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

  it('should not hang indefinitely on infinite-loop code — timeout via Promise.race', async () => {
    const code = fixture('timeout-plugin.js');
    // D-14: Timeout is handled by PluginRuntime's Promise.race, not by NodeEsmLoader layer.
    // Here we verify that wrapping load() with Promise.race behaves correctly.
    await expect(
      Promise.race([loader.load(code), timeout(3000)])
    ).rejects.toThrow();
  }, 5000);

  it('should return different module instances for two load() calls (no cache)', async () => {
    const code = fixture('valid-plugin.js');
    const mod1 = await loader.load(code);
    const mod2 = await loader.load(code);

    // Module namespace objects from different import() calls should be distinct
    expect(mod1).not.toBe(mod2);
    expect(mod1.default).not.toBe(mod2.default);
  });
});
