/**
 * Unit tests for manifestSchema — zod runtime validation.
 *
 * Covers:
 * - Valid manifest.json passes parse()
 * - Rejects missing id/name/version/main
 * - Optional fields accept valid arrays
 * - Empty arrays for requires/optional/capabilitiesProposed accepted
 * - Type inference via z.infer
 */
import { describe, it, expect } from 'vitest';
import { manifestSchema, manifestSchemaV3 } from '../manifest-schema.js';

describe('manifestSchema', () => {
  // --- 合法 manifest 通过 ------------------------------------------------

  it('should accept valid manifest with all required fields', () => {
    const manifest = {
      id: 'ext-countdown-timer',
      name: 'Countdown Timer',
      version: '1.0.0',
      main: 'index.js',
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  // --- 非法 manifest 被拒绝 ------------------------------------------------

  it.each([
    { missing: 'id', data: { name: 'X', version: '1.0.0', main: 'index.js' } },
    { missing: 'name', data: { id: 'x', version: '1.0.0', main: 'index.js' } },
    { missing: 'version', data: { id: 'x', name: 'X', main: 'index.js' } },
    { missing: 'main', data: { id: 'x', name: 'X', version: '1.0.0' } },
  ])('should reject manifest missing $missing', ({ data }) => {
    expect(() => manifestSchema.parse(data)).toThrow();
  });

  // --- 空字符串被拒绝 -----------------------------------------------------

  it.each([
    { field: 'id', data: { id: '', name: 'X', version: '1.0.0', main: 'index.js' } },
    { field: 'name', data: { id: 'x', name: '', version: '1.0.0', main: 'index.js' } },
    { field: 'version', data: { id: 'x', name: 'X', version: '', main: 'index.js' } },
    { field: 'main', data: { id: 'x', name: 'X', version: '1.0.0', main: '' } },
  ])('should reject manifest with empty $field string', ({ data }) => {
    expect(() => manifestSchema.parse(data)).toThrow();
  });

  // --- 可选字段 ----------------------------------------------------------

  it('should accept manifest with optional fields filled', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService'],
      optional: ['@openlearn/core:IAIService'],
      capabilitiesProposed: ['lesson:write'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept manifest with empty optional arrays', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: [],
      optional: [],
      capabilitiesProposed: [],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  // --- 类型推导 (compile-time check) ------------------------------------

  it('should support type inference via z.infer', () => {
    const manifest = manifestSchema.parse({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      main: 'index.js',
    });
    // TypeScript 编译时类型应为 Manifest (z.infer)
    expect(manifest.id).toBe('test');
    expect(manifest.name).toBe('Test');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.main).toBe('index.js');
  });

  // --- manifest-invalid.json fixture 被拒绝 -----------------------------

  it('should reject manifest-invalid.json fixture (missing name/version/main)', () => {
    const invalidData = { id: 'test' };
    expect(() => manifestSchema.parse(invalidData)).toThrow();
  });
});

describe('manifestSchema — Phase 6 @version regex', () => {
  it('should accept requires with @^version suffix', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService@^1.0.0'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept requires with @~version suffix', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:IEventBusService@~1.2.0'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept requires with exact version (no prefix)', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:IStorageService@1.0.0'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept requires with pre-release version', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:IAIService@^1.0.0-beta.1'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should accept requires without @version (backward compatible)', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });

  it('should reject requires with invalid format', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['invalid-format'],
    };
    expect(() => manifestSchema.parse(manifest)).toThrow();
  });

  it('should reject requires with incomplete version (missing patch)', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService@^1.0'],
    };
    // ^1.0 is not a valid semver — should be ^1.0.0
    expect(() => manifestSchema.parse(manifest)).toThrow();
  });

  // optional field also supports @version
  it('should accept optional with @^version suffix', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      optional: ['@openlearn/core:IAIService@^2.0.0'],
    };
    expect(() => manifestSchema.parse(manifest)).not.toThrow();
  });
});

describe('manifestSchemaV3 — Phase 3 backward compatibility', () => {
  it('should accept requires without @version', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService'],
    };
    expect(() => manifestSchemaV3.parse(manifest)).not.toThrow();
  });

  it('should reject requires with @version suffix', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: ['@openlearn/core:ICommandBusService@^1.0.0'],
    };
    expect(() => manifestSchemaV3.parse(manifest)).toThrow();
  });

  it('should accept optional without @version', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      optional: ['@openlearn/core:IAIService'],
    };
    expect(() => manifestSchemaV3.parse(manifest)).not.toThrow();
  });

  it('should accept empty requires/optional', () => {
    const manifest = {
      id: 'ext-quiz',
      name: 'Quiz Generator',
      version: '1.0.0',
      main: 'index.js',
      requires: [],
      optional: [],
    };
    expect(() => manifestSchemaV3.parse(manifest)).not.toThrow();
  });
});
