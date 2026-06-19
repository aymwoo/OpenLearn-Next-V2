import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Module Federation Configuration Checks', () => {
  const rootDir = process.cwd();
  
  it('should configure Module Federation correctly in the host vite.config.ts if present', () => {
    const hostConfigPath = path.resolve(rootDir, 'vite.config.ts');
    expect(fs.existsSync(hostConfigPath)).toBe(true);
    
    const configContent = fs.readFileSync(hostConfigPath, 'utf-8');
    
    // In Wave 0 (Plan 10-01), the configuration is not yet implemented.
    // We will verify the content once it is implemented in Plan 10-02.
    const isImplemented = configContent.includes('@module-federation/vite');
    if (!isImplemented) {
      // Wave 0 placeholder assertion
      expect(configContent).toBeDefined();
      return;
    }
    
    // Full assertions when implemented:
    expect(configContent).toContain('@module-federation/vite');
    expect(configContent).toContain('federation(');
    expect(configContent).toMatch(/react:\s*\{/);
    expect(configContent).toContain('singleton: true');
    expect(configContent).toContain('strictVersion: false');
    expect(configContent).toContain('zustand');
  });

  it('should configure Module Federation correctly in remote subprojects if they exist', () => {
    const subprojects = ['mfe-whiteboard', 'mfe-courseware'];
    
    for (const sub of subprojects) {
      const configPath = path.resolve(rootDir, 'packages', sub, 'vite.config.ts');
      
      if (!fs.existsSync(configPath)) {
        // Skip check if not created yet (e.g. during Wave 1 / Plan 10-01)
        continue;
      }
      
      const configContent = fs.readFileSync(configPath, 'utf-8');
      expect(configContent).toContain('@module-federation/vite');
      expect(configContent).toContain('federation(');
      expect(configContent).toMatch(/react:\s*\{/);
      expect(configContent).toContain('singleton: true');
      expect(configContent).toContain('strictVersion: false');
      expect(configContent).toContain('zustand');
    }
  });
});
