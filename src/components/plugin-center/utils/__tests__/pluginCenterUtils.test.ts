import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLUGIN, parsePluginSource } from '../pluginCenterUtils';

describe('parsePluginSource', () => {
  it('extracts id and name from a static manifest object', () => {
    const source = `
      exports.default = {
        manifest: {
          id: "ext-sample",
          name: "Sample Plugin",
          version: "1.2.3",
          author: "Ada"
        }
      };
    `;
    const parsed = parsePluginSource(source);
    expect(parsed?.manifest.id).toBe('ext-sample');
    expect(parsed?.manifest.name).toBe('Sample Plugin');
    expect(parsed?.manifest.version).toBe('1.2.3');
    expect(parsed?.manifest.author).toBe('Ada');
  });

  it('extracts the bundled quiz sample without executing it', () => {
    const parsed = parsePluginSource(DEFAULT_PLUGIN);
    expect(parsed?.manifest.id).toBe('ext-ai-quiz-gen');
    expect(parsed?.manifest.name).toBe('AI Course Quiz Generator (智能测验生成器)');
    expect(parsed?.manifest.version).toBe('1.0.0');
    expect(parsed?.manifest.author).toBe('Openlearn Next AI Team');
  });

  it('does not execute a string that contains process.exit', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit was executed');
    }) as typeof process.exit);

    const source = `
      process.exit(1);
      exports.default = {
        manifest: {
          id: "ext-static",
          name: "Static Only"
        }
      };
    `;

    try {
      expect(() => parsePluginSource(source)).not.toThrow();
      const parsed = parsePluginSource(source);
      expect(exit).not.toHaveBeenCalled();
      expect(parsed?.manifest.id).toBe('ext-static');
      expect(parsed?.manifest.name).toBe('Static Only');
    } finally {
      exit.mockRestore();
    }
  });

  it('returns null for empty input', () => {
    expect(parsePluginSource('')).toBeNull();
  });
});
