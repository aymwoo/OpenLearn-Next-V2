// @vitest-environment jsdom

/**
 * Smoke tests for BrowserEsmLoader — Blob URL + import().
 *
 * Phase 3 scope: basic Blob URL creation, revoke verification, and error classification.
 * Full browser integration tests deferred to Phase 9.
 *
 * Covers:
 * - Successful load of valid ESM code via Blob URL
 * - URL.revokeObjectURL is called in finally block
 * - EsmSyntaxError on syntax-invalid code
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserEsmLoader } from '../browser-loader.js';
import { EsmSyntaxError } from '../errors.js';

describe('BrowserEsmLoader', () => {
  let loader: BrowserEsmLoader;

  beforeEach(() => {
    loader = new BrowserEsmLoader();
  });

  it('should load valid ESM code and return named exports', async () => {
    const mod = await loader.load('export const hello = "world";');
    expect(mod.hello).toBe('world');
  });

  it('should call URL.revokeObjectURL after load', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    await loader.load('export const x = 1;');
    expect(revokeSpy).toHaveBeenCalled();
    revokeSpy.mockRestore();
  });

  it('should throw EsmSyntaxError for syntax-invalid code', async () => {
    await expect(loader.load('const x =')).rejects.toThrow(EsmSyntaxError);
  });
});
