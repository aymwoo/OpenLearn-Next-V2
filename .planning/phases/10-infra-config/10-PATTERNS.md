# Phase 10: 基础设施配置与工程集成 - Pattern Map

**Mapped:** 2026-06-19
**Files analyzed:** 11
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/mfe-whiteboard/vite.config.ts` | config | transform | `vite.config.ts` | role-match |
| `packages/mfe-courseware/vite.config.ts` | config | transform | `packages/mfe-whiteboard/vite.config.ts` | exact |
| `packages/mfe-whiteboard/package.json` | config | transform | `package.json` | role-match |
| `packages/mfe-courseware/package.json` | config | transform | `packages/mfe-whiteboard/package.json` | exact |
| `vite.config.ts` | config | transform | `vite.config.ts` (self) | exact |
| `package.json` | config | transform | `package.json` (self) | exact |
| `pnpm-workspace.yaml` | config | transform | `pnpm-workspace.yaml` (self) | exact |
| `src/index.css` | config | transform | `src/index.css` (self) | exact |
| `packages/core/__tests__/mfe-config.test.ts` | test | transform | `packages/core/__tests__/kernel-plugins.test.ts` | role-match |
| `packages/core/__tests__/mfe-build.test.ts` | test | transform | `packages/core/__tests__/legacy-cleanup.test.ts` | role-match |
| `packages/core/__tests__/tailwind-scan.test.ts` | test | transform | `packages/core/__tests__/legacy-cleanup.test.ts` | role-match |

## Pattern Assignments

### `packages/mfe-whiteboard/vite.config.ts` & `packages/mfe-courseware/vite.config.ts` (config, transform)

**Analog:** `vite.config.ts` (host Vite config)

**Imports pattern** (lines 1-4):
```typescript
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
```

**Core configuration pattern** (lines 6-22):
```typescript
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
```

**MFE specific config to add** (derived from `10-RESEARCH.md` guidelines):
- Build target set to `esnext` and `base: 'auto'`
- Module Federation configuration with shared dependencies (`react`, `react-dom`, `zustand`) dynamically versions-loaded.

---

### `packages/mfe-whiteboard/package.json` & `packages/mfe-courseware/package.json` (config, transform)

**Analog:** `package.json` (root package.json)

**Basic package definition pattern** (lines 1-14):
```json
{
  "name": "react-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "node scripts/build-plugins.mjs && vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "start": "node dist/server.cjs",
    "preview": "vite preview",
    "clean": "rm -rf dist server.js",
    "lint": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

---

### `vite.config.ts` (config, transform - modified)

**Analog:** `vite.config.ts` (self)

**Vite 6 Configuration** (lines 1-22):
```typescript
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
```

---

### `package.json` (config, transform - modified)

**Analog:** `package.json` (self)

**Dependencies section** (lines 15-45):
```json
  "dependencies": {
    "@google/genai": "^2.4.0",
    "@tailwindcss/vite": "^4.1.14",
    ...
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    ...
    "zustand": "^5.0.14"
  }
```

---

### `pnpm-workspace.yaml` (config, transform - modified)

**Analog:** `pnpm-workspace.yaml` (self)

**Workspace structure** (lines 1-6):
```yaml
allowBuilds:
  '@google/genai': true
  better-sqlite3: true
  core-js: true
  esbuild: true
  protobufjs: true
```

---

### `src/index.css` (config, transform - modified)

**Analog:** `src/index.css` (self)

**CSS Tailwind v4 Imports** (lines 1-2):
```css
@import "tailwindcss";
```

---

### `packages/core/__tests__/mfe-config.test.ts` (test, transform)

**Analog:** `packages/core/__tests__/kernel-plugins.test.ts`

**Vitest setup and hooks pattern** (lines 1-18):
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { Kernel } from '../kernel/index.js';
import { PluginState } from '../plugin-host/types.js';

describe('Kernel System Plugins Auto-loading', () => {
  let kernel: Kernel;

  beforeAll(async () => {
    // Clear existing built-in plugin rows if any to test insertion
    const tempKernel = new Kernel();
    await tempKernel.ready;
    const db = tempKernel.db;
    db.prepare("DELETE FROM plugins WHERE id = ?").run('@openlearn/plugin-vfs');
    db.prepare("DELETE FROM plugins WHERE id = ?").run('@openlearn/plugin-process');

    kernel = new Kernel();
    await kernel.ready;
  });
```

**Assertion pattern** (lines 20-31):
```typescript
  it('should automatically insert system plugins into the plugins table', () => {
    const vfsRow = kernel.db.prepare('SELECT * FROM plugins WHERE id = ?').get('@openlearn/plugin-vfs') as any;
    const processRow = kernel.db.prepare('SELECT * FROM plugins WHERE id = ?').get('@openlearn/plugin-process') as any;

    expect(vfsRow).toBeDefined();
    expect(vfsRow.execution_mode).toBe('inline');
    expect(vfsRow.loader_version).toBe('esm');

    expect(processRow).toBeDefined();
    expect(processRow.execution_mode).toBe('inline');
    expect(processRow.loader_version).toBe('esm');
  });
```

---

### `packages/core/__tests__/mfe-build.test.ts` & `packages/core/__tests__/tailwind-scan.test.ts` (test, transform)

**Analog:** `packages/core/__tests__/legacy-cleanup.test.ts`

**Imports and workspace file checks** (lines 1-16):
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Kernel } from '../kernel/index.js';
import fs from 'fs';
import path from 'path';

describe('Legacy Cleanup (Phase 8)', () => {
  it('should not have packages/core/plugin-runtime directory', () => {
    const runtimePath = path.resolve(process.cwd(), 'packages', 'core', 'plugin-runtime');
    expect(fs.existsSync(runtimePath)).toBe(false);
  });

  it('should not expose pluginRuntime on Kernel instance', () => {
    const kernel = new Kernel();
    expect((kernel as any).pluginRuntime).toBeUndefined();
    expect(kernel.pluginHost).toBeDefined();
  });
```

---

## Shared Patterns

### Dynamic Module Federation Dependency Resolution
**Source:** `10-RESEARCH.md` (Pattern 1)
**Apply to:** All microfrontend and host configuration files (`vite.config.ts`)
```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';

function getSharedDependencies() {
  try {
    const pkgPath = resolve(__dirname, './package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = pkg.dependencies || {};
    
    return {
      react: {
        singleton: true,
        requiredVersion: deps['react'],
        strictVersion: false,
      },
      'react-dom': {
        singleton: true,
        requiredVersion: deps['react-dom'],
        strictVersion: false,
      },
      zustand: {
        singleton: true,
        requiredVersion: deps['zustand'],
        strictVersion: false,
      }
    };
  } catch (e) {
    console.error('Failed to read package.json dependencies', e);
    return {};
  }
}
```

### Tailwind CSS v4 `@source` Configuration
**Source:** `10-RESEARCH.md` (Section 3)
**Apply to:** `src/index.css`
```css
@import "tailwindcss";

/* Scan all TSX files in MFE subpackages */
@source "../packages/mfe-*/**/*.{ts,tsx}";
```

### Vitest Test Assertion Structure
**Source:** `packages/core/__tests__/kernel-plugins.test.ts` & `packages/core/__tests__/legacy-cleanup.test.ts`
**Apply to:** All new test files under `packages/core/__tests__/`
```typescript
import { describe, it, expect, beforeAll } from 'vitest';

describe('Suite Name', () => {
  beforeAll(async () => {
    // Setup environment
  });

  it('should perform verification', () => {
    expect(value).toBe(expected);
  });
});
```

## No Analog Found

None. All files have analogs or self-references.

## Metadata

**Analog search scope:** Workspace root, `packages/core/__tests__/`
**Files scanned:** 11
**Pattern extraction date:** 2026-06-19
