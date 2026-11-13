import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Modern Web CSS & HTML baseline (Issue #486)', () => {
  const root = process.cwd();
  const indexHtml = fs.readFileSync(path.resolve(root, 'index.html'), 'utf-8');
  const indexCss = fs.readFileSync(path.resolve(root, 'src/index.css'), 'utf-8');
  const mainTsx = fs.readFileSync(path.resolve(root, 'src/main.tsx'), 'utf-8');

  it('declares color-scheme meta tag in index.html', () => {
    expect(indexHtml).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/);
  });

  it('declares CSS color-scheme, standard scrollbar utilities, modal scroll containment, and reduced-motion rules', () => {
    expect(indexCss).toContain('color-scheme: light;');
    expect(indexCss).toContain('color-scheme: dark;');
    expect(indexCss).toContain('@utility scrollbar-thin');
    expect(indexCss).toContain('@utility scrollbar-none');
    expect(indexCss).toContain('dialog:modal');
    expect(indexCss).toContain('dialog::backdrop');
    expect(indexCss).toContain('overscroll-behavior: contain;');
    expect(indexCss).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(indexCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(indexCss).not.toContain('0.01ms');
  });

  it('configures global MotionConfig with reducedMotion="user"', () => {
    expect(mainTsx).toContain('<MotionConfig reducedMotion="user">');
  });
});
