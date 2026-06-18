---
phase: 06-eventbus-semver
plan: 01
subsystem: di-container
tags: [semver, token-di, service-registry, versioning, plugin-host]

# Dependency graph
requires:
  - phase: 01-token-di
    provides: Token<T> class, ServiceRegistry DI container, error hierarchy
  - phase: 05-worker-isolation
    provides: PluginHost lifecycle manager, resolveByName API
provides:
  - Token.version semantic version parameter (default '1.0.0')
  - ServiceEntry.version field stored on registration
  - ServiceRegistry.getVersion() query method
  - SemverMismatchError structured error class
  - semver npm package for version comparison
affects: [06-02-manifest-schema, 06-03-plugin-host-semver]

# Tech tracking
tech-stack:
  added:
    - semver ^7.7.x: semantic version comparison library
  patterns:
    - Token.version: constructor parameter with default '1.0.0' for backward compatibility
    - ServiceRegistry.getVersion(): string-keyed version query for version-check workflows
    - PluginHostError hierarchy: SemverMismatchError follows existing 5-error class pattern with structured fields

key-files:
  created: []
  modified:
    - packages/core/plugin-host/errors.ts
    - packages/core/plugin-host/index.ts
    - packages/core/di/token.ts
    - packages/core/di/types.ts
    - packages/core/di/service-registry.ts
    - packages/core/di/__tests__/token.test.ts
    - packages/core/di/__tests__/service-registry.test.ts
    - package.json

key-decisions:
  - "SemverMismatchError in plugin-host/errors.ts (not di/errors.ts): version mismatch is a PluginHost concern triggered during plugin activation, not a DI container concern"
  - "Token.version is an unvalidated string: format validation deferred to semver.satisfies() usage time per threat model T-6-03"
  - "ServiceEntry.version stored from Token at register() time: version is an immutable property of the Token, not an overrideable option"

patterns-established:
  - "Structed error fields: SemverMismatchError carries 5 structured fields (pluginId, pluginName, tokenName, requiredRange, actualVersion) + human-readable message via PluginHostError super() prefix"

requirements-completed: [PLUG-07, PLUG-09]

# Metrics
duration: 18min
completed: 2026-06-18
---

# Phase 6 Plan 1: Token Version + ServiceRegistry Version Tracking + SemverMismatchError

**Semantic version support for Token DI: Token.version default '1.0.0', ServiceRegistry version storage and query, SemverMismatchError for host-plugin version conflicts, and semver library installation**

## Performance

- **Duration:** 18 min
- **Started:** 2026-06-18T15:50:00Z
- **Completed:** 2026-06-18T16:08:00Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Installed semver npm package (^7.7.x) for semantic version comparison in plugin-host version checks
- Created SemverMismatchError in plugin-host/errors.ts with 5 structured fields (pluginId, pluginName, tokenName, requiredRange, actualVersion) + human-readable message, following PluginHostError hierarchy
- Exported SemverMismatchError from plugin-host/index.ts barrel for internal usage and consumer imports
- Token class now accepts optional version constructor parameter (default '1.0.0'), stored as public readonly property
- ServiceEntry interface extended with `version: string` field
- ServiceRegistry.register() automatically stores token.version in the registry entry
- Added ServiceRegistry.getVersion(tokenName) method returning version string or undefined for unregistered tokens
- Updated resolveByName() JSDoc documenting its Phase 6 Token Registry pattern role
- Added 9 unit tests: 4 for Token.version (default, custom, pre-release, name validation unaffected), 5 for ServiceRegistry (version storage, default version, unregistered, resolveByName success/error)
- All 43 DI tests pass; TypeScript compilation passes (semver type errors excluded as pre-existing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install semver package + create SemverMismatchError** - `3667b8f` (feat)
2. **Task 2: Token version parameter + ServiceEntry.version + ServiceRegistry version tracking** - `7d8a314` (feat)
3. **Task 3: Unit tests for Token version + ServiceRegistry version tracking + resolveByName** - `07f4611` (test)

## Files Created/Modified

- `packages/core/plugin-host/errors.ts` - Added SemverMismatchError class (5 structured fields, PluginHostError prefix)
- `packages/core/plugin-host/index.ts` - Import + re-export SemverMismatchError from barrel
- `packages/core/di/token.ts` - Added optional version constructor parameter (default '1.0.0') + public readonly version property
- `packages/core/di/types.ts` - Added version: string field to ServiceEntry interface
- `packages/core/di/service-registry.ts` - register() stores token.version; added getVersion() method; updated resolveByName JSDoc
- `packages/core/di/__tests__/token.test.ts` - Added 4 Phase 6 Token.version tests
- `packages/core/di/__tests__/service-registry.test.ts` - Added 5 Phase 6 version tracking + resolveByName tests
- `package.json` - Added semver dependency

## Decisions Made

- **SemverMismatchError in plugin-host/errors.ts (not di/errors.ts):** Version mismatch is a PluginHost concern triggered during plugin activation, not a DI container concern. Keeps error hierarchy aligned with their originating subsystems.
- **Token.version is an unvalidated string:** Format validation deferred to semver.satisfies() usage time per threat model T-6-03. Token validation remains focused on name format only.
- **ServiceEntry.version stored from Token at register() time:** Version is an immutable property of the Token, not an overrideable option. Registration options are for dependency declarations, not version overrides.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Pre-existing tsc errors in `packages/core/esm-loader/__tests__/fixtures/syntax-error.js` (intentional syntax error test fixture) — not related to our changes
- Pre-existing test failures in `packages/core/di/__tests__/interfaces.test.ts` (Kernel IService integration tests requiring running kernel) — not related to our changes

## Threat Surface Scan

No new security-relevant surface introduced. Token.version is a public readonly string with no validation (accept per T-6-02). SemverMismatchError is a structured error class with no side effects. semver library is a standard npm package with locked version via package-lock.json (per T-6-03).

## Next Phase Readiness

- Plan 06-02 (manifest-schema extension) can use SemverMismatchError for manifest validation
- Plan 06-03 (PluginHost version check) can use ServiceRegistry.getVersion() + semver.satisfies() for runtime compatibility verification
- All Token instances in the codebase continue to work unchanged with default version '1.0.0'

---
*Phase: 06-eventbus-semver*
*Completed: 2026-06-18*
