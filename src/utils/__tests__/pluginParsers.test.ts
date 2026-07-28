import { describe, it, expect } from 'vitest';
import { parsePluginSource, parseCSV } from '../pluginParsers';

describe('parseCSV', () => {
  it('parses comma-separated name/email with header auto-detection', () => {
    const text = 'name,email\nAlice,alice@example.com\nBob,bob@example.com';
    const result = parseCSV(text);
    expect(result).toEqual([
      { name: 'Alice', email: 'alice@example.com' },
      { name: 'Bob', email: 'bob@example.com' },
    ]);
  });

  it('auto-detects semicolon separator', () => {
    const text = 'name;email\nAlice;alice@example.com';
    const result = parseCSV(text);
    expect(result).toEqual([{ name: 'Alice', email: 'alice@example.com' }]);
  });

  it('handles quoted fields containing the separator', () => {
    const text = 'name,email\n"Smith, John",john@example.com';
    const result = parseCSV(text);
    expect(result[0].name).toBe('Smith, John');
  });

  it('maps Chinese headers 姓名/邮箱', () => {
    const text = '姓名,邮箱\n小明,xiaoming@example.com';
    const result = parseCSV(text);
    expect(result).toEqual([{ name: '小明', email: 'xiaoming@example.com' }]);
  });

  it('returns empty array when fewer than 2 lines', () => {
    expect(parseCSV('name,email')).toEqual([]);
    expect(parseCSV('')).toEqual([]);
  });

  it('skips blank lines and rows without a name', () => {
    const text = 'name,email\nAlice,alice@example.com\n\n,bob@example.com';
    const result = parseCSV(text);
    expect(result).toEqual([{ name: 'Alice', email: 'alice@example.com' }]);
  });
});

describe('parsePluginSource', () => {
  it('extracts manifest + capabilities from a default export', () => {
    const source = `
      exports.default = {
        manifest: {
          id: "my-plugin",
          name: "My Plugin",
          version: "1.0.0",
          capabilitiesProposed: ["lesson:read", "whiteboard:write"]
        },
        activate: () => {}
      };
      actionRegistry.register({ id: 'a1', commandType: 'lesson.do', description: 'does a thing' });
    `;
    const result = parsePluginSource(source);
    expect(result.error).toBeNull();
    expect(result.manifest?.id).toBe('my-plugin');
    expect(result.manifest?.name).toBe('My Plugin');
    expect(result.manifest?.version).toBe('1.0.0');
    expect(result.manifest?.capabilitiesProposed).toEqual(['lesson:read', 'whiteboard:write']);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].commandType).toBe('lesson.do');
    expect(result.actions[0].id).toBe('a1');
  });

  it('falls back to regex parsing when no default export is present', () => {
    const source = `
      const manifest = {
        id: "regex-plugin",
        name: "Regex Plugin",
        version: "2.0.0"
      };
      actionRegistry.register({ id: 'b1', commandType: 'whiteboard.draw' });
    `;
    const result = parsePluginSource(source);
    expect(result.error).toBeNull();
    expect(result.manifest?.id).toBe('regex-plugin');
    expect(result.manifest?.name).toBe('Regex Plugin');
    expect(result.actions[0].commandType).toBe('whiteboard.draw');
  });

  it('does not throw on malformed source', () => {
    const result = parsePluginSource('this is ((( not valid <<<');
    expect(result).toHaveProperty('manifest');
    expect(result).toHaveProperty('actions');
  });
});
