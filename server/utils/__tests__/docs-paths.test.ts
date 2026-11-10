import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_GUIDE_FILENAME, resolvePluginGuidePath } from '../docs-paths.js';

describe('resolvePluginGuidePath', () => {
  const created: string[] = [];

  function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearn-guide-'));
    created.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the guide from the published package layout (<pkg>/dist)', () => {
    const pkgRoot = tempDir();
    const dist = path.join(pkgRoot, 'dist');
    fs.mkdirSync(dist);
    const guide = path.join(pkgRoot, PLUGIN_GUIDE_FILENAME);
    fs.writeFileSync(guide, '# guide');

    expect(resolvePluginGuidePath([dist], tempDir())).toBe(guide);
  });

  it('resolves the guide from the source layout (server/utils)', () => {
    const repoRoot = tempDir();
    const utilsDir = path.join(repoRoot, 'server', 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });
    const guide = path.join(repoRoot, PLUGIN_GUIDE_FILENAME);
    fs.writeFileSync(guide, '# guide');

    expect(resolvePluginGuidePath([utilsDir], tempDir())).toBe(guide);
  });

  it('falls back to cwd and returns null when the guide is absent', () => {
    const cwd = tempDir();
    const guide = path.join(cwd, PLUGIN_GUIDE_FILENAME);
    fs.writeFileSync(guide, '# guide');

    expect(resolvePluginGuidePath([], cwd)).toBe(guide);

    fs.rmSync(guide);
    expect(resolvePluginGuidePath([], cwd)).toBeNull();
  });
});
