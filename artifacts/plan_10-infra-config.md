# Plan: Phase 10 Infrastructure Configuration & Engineering Integration

This plan outlines the execution steps for Phase 10 (`10-infra-config`) of the OpenLearnV2 microfrontend migration. It is split into two waves: Wave 1 (Test Skeletons) and Wave 2 (Configuration Implementation).

## Goals & Success Criteria

1. **Vite 6 & Module Federation 2.0 Integration**: Host and remote subprojects (`mfe-whiteboard`, `mfe-courseware`) correctly configured with `@module-federation/vite`.
2. **Strict Singletons**: `react`, `react-dom`, and `zustand` shared as singletons across the host and remotes with `strictVersion: false`.
3. **Compilation Target & Base**: Target set to `esnext` and asset path resolution set to `base: 'auto'`.
4. **Tailwind CSS v4 Scanning**: Host configured to scan remote styles using the `@source` directive in `src/index.css`.
5. **No Console Errors & Passing Tests**: The codebase compiles, dev servers run on ports 5174/5175, and all tests pass.

## Wave Breakdown

### Wave 1: Test Skeletons (Plan 10-01)
We will create three test files under `packages/core/__tests__/` to serve as our TDD verification suite. To ensure the tests pass during Wave 1 (before configurations are implemented) and perform full verification during Wave 2, we will design them to check the host config, and gracefully check remote configs only if they exist on disk.

* **Test Files to Create**:
  1. [mfe-config.test.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/mfe-config.test.ts): Checks Module Federation plugin usage, shared dependencies, and singleton settings.
  2. [mfe-build.test.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/mfe-build.test.ts): Checks `build.target` and `base` config.
  3. [tailwind-scan.test.ts](file:///home/wuxf/Develop/openlearnv2/packages/core/__tests__/tailwind-scan.test.ts): Checks Tailwind CSS `@source` scanning directives in `src/index.css`.

### Wave 2: Implementation (Plan 10-02)
We will install the required dependencies, set up the workspaces, configure the host and remotes, and verify everything works.

1. **Step 1: Security Audit Checkpoint**
   * Manually verify the legitimacy of `@module-federation/vite` (1.16.8), `@module-federation/runtime` (2.5.1), and `@module-federation/retry-plugin` (2.5.1) (Completed in `10-RESEARCH.md`).
2. **Step 2: Setup Workspace & Host Environment**
   * Install `@module-federation/vite` in `devDependencies`, and `@module-federation/runtime` / `@module-federation/retry-plugin` in `dependencies` in the root `package.json`.
   * Register subpackages `packages/mfe-whiteboard` and `packages/mfe-courseware` in `pnpm-workspace.yaml`.
   * Configure `@module-federation/vite` in the root `vite.config.ts` with React, React-DOM, and Zustand shared as singletons.
   * Add `@source "../packages/mfe-*/**/*.{ts,tsx}"` to the host's `src/index.css`.
   * Run `pnpm install` at the root.
3. **Step 3: Create & Configure Remote Packages**
   * Create packages under `packages/mfe-whiteboard` and `packages/mfe-courseware`.
   * Set up `package.json` and `vite.config.ts` for each remote.
   * Remote configurations will export entry files and run on ports 5174 and 5175 respectively.
   * Run `pnpm install` and run the tests to verify the setup.

## Verification Protocol

We will run the following commands to verify:
* `pnpm install` (checks lockfile validity)
* `pnpm test packages/core/__tests__/mfe-config.test.ts`
* `pnpm test packages/core/__tests__/mfe-build.test.ts`
* `pnpm test packages/core/__tests__/tailwind-scan.test.ts`

## Rollback Plan

If execution fails or needs to be rolled back:
* Revert the `package.json`, `pnpm-workspace.yaml`, `vite.config.ts`, and `src/index.css` changes via `git checkout -- <file>`.
* Delete `packages/mfe-whiteboard` and `packages/mfe-courseware` directories.
* Delete the created test files in `packages/core/__tests__/`.
* Run `pnpm install` to restore `pnpm-lock.yaml`.
