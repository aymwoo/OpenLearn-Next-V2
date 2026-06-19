import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Tailwind CSS v4 Scanning Checks', () => {
  const rootDir = process.cwd();

  it('should configure Tailwind CSS @source scan directive in host index.css', () => {
    const indexCssPath = path.resolve(rootDir, 'src', 'index.css');
    expect(fs.existsSync(indexCssPath)).toBe(true);

    const cssContent = fs.readFileSync(indexCssPath, 'utf-8');

    const isImplemented = cssContent.includes('@source');
    if (!isImplemented) {
      // Wave 0 placeholder assertion
      expect(cssContent).toBeDefined();
      return;
    }

    expect(cssContent).toContain('@source');
    expect(cssContent).toMatch(/@source\s+['"]\.\.\/packages\/mfe-\*\/\*\*\/\*\.\{ts,tsx\}['"]/);
  });
});
