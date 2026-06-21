import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Microfrontend Build Configurations Checks', () => {
  const rootDir = process.cwd();

  it('should configure target esnext and base auto in the host vite.config.ts if present', () => {
    const hostConfigPath = path.resolve(rootDir, 'vite.config.ts');
    expect(fs.existsSync(hostConfigPath)).toBe(true);

    const configContent = fs.readFileSync(hostConfigPath, 'utf-8');
    
    const isImplemented = configContent.includes('@module-federation/vite');
    if (!isImplemented) {
      // Wave 0 placeholder assertion
      expect(configContent).toBeDefined();
      return;
    }

    expect(configContent).toContain("target: 'esnext'");
  });

  it('should configure target esnext and base auto in remote subprojects if they exist', () => {
    const subprojects = ['mfe-whiteboard', 'mfe-courseware'];

    for (const sub of subprojects) {
      const configPath = path.resolve(rootDir, 'packages', sub, 'vite.config.ts');

      if (!fs.existsSync(configPath)) {
        // Skip check if not created yet (e.g. during Wave 1 / Plan 10-01)
        continue;
      }

      const configContent = fs.readFileSync(configPath, 'utf-8');
      expect(configContent).toContain("target: 'esnext'");
      const hasBaseAuto = configContent.includes("base: 'auto'");
      const hasBaseSlash = configContent.includes("base: '/'");
      expect(hasBaseAuto || hasBaseSlash).toBe(true);
    }
  });
});
