---
phase: 06-eventbus-semver
plan: 02
subsystem: plugin-manifest
tags: [zod, semver, manifest, typescript, esm-loader]

# Dependency graph
requires:
  - phase: 03-esm
    provides: manifestSchema zod schema, EsmLoader types
  - phase: 01-token-di
    provides: Token<T> class, IService interfaces
provides:
  - Extended manifest.json schema with @version regex (requiresItemSchema)
  - manifestSchemaV3 backward-compatible export for Phase 3-5 code
  - parseRequiresEntry() utility function
  - Full unit test suite for schema + utility
affects:
  - 06-03: PluginHost version checking integration (parseRequiresEntry consumed)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Zod regex-constrained string arrays for plugin manifest validation
    - Second-'@' parsing strategy for version range extraction

key-files:
  created:
    - packages/core/esm-loader/manifest-utils.ts
    - packages/core/esm-loader/__tests__/manifest-utils.test.ts
  modified:
    - packages/core/esm-loader/manifest-schema.ts
    - packages/core/esm-loader/index.ts
    - packages/core/esm-loader/__tests__/manifest-schema.test.ts

key-decisions:
  - "requires/optional entries constrained by regex: @scope/domain:IServiceName[@^x.y.z]"
  - "manifestSchemaV3 exported separately with strict no-@version regex for legacy code"
  - "parseRequiresEntry uses second-'@' search (after scope slash) for reliable split"

patterns-established:
  - "Two-schema approach: main schema (manifestSchema) extended, V3 schema (manifestSchemaV3) frozen for backward compatibility"
  - "parseRequiresEntry returns { tokenName, versionRange: string | null } as the adapter between manifest layer and PluginHost checking layer"

requirements-completed: [PLUG-09]

# Metrics
duration: 4min
completed: 2026-06-18
---

# Phase 06 Plan 02: Manifest Schema Extension Summary

**Extended manifest.json zod schema with @scope:IServiceName@^x.y.z regex validation for semantic version ranges, created parseRequiresEntry() utility, and exported manifestSchemaV3 for backward compatibility**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-18T15:49:00Z
- **Completed:** 2026-06-18T15:51:00Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Extended manifestSchema's requires/optional array items with `requiresItemSchema` regex: `/^@[\w-]+\/[\w-]+:I\w+(?:@[\^~]?\d+\.\d+\.\d+(?:-[\w.]+)?)?$/`
- Exported `manifestSchemaV3` with strict no-@version regex for Phase 3-5 legacy compatibility
- Created `parseRequiresEntry()` utility: `@scope:IName@^1.0.0` → `{ tokenName, versionRange: '^1.0.0' }`
- Both schemas share identical id/name/version/main/capabilitiesProposed fields
- Full unit test suite: 24 new tests (12 schema + 4 V3 compat + 8 utils) across 2 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend manifest-schema regex + export manifestSchemaV3** - `d2ca0e7` (feat)
2. **Task 2: Create parseRequiresEntry() utility function** - `65f838a` (feat)
3. **Task 3: Unit tests for @version regex + parseRequiresEntry + manifestSchemaV3** - `9c0d8f8` (test)

## Files Created/Modified
- `packages/core/esm-loader/manifest-schema.ts` - Extended with requiresItemSchema regex, manifestSchemaV3 export, ManifestV3 type
- `packages/core/esm-loader/index.ts` - Added manifestSchemaV3, ManifestV3, parseRequiresEntry to barrel exports
- `packages/core/esm-loader/manifest-utils.ts` - New file: parseRequiresEntry() utility function
- `packages/core/esm-loader/__tests__/manifest-schema.test.ts` - Added 16 tests (8 @version regex + 4 manifestSchemaV3 + updated import)
- `packages/core/esm-loader/__tests__/manifest-utils.test.ts` - New file: 8 tests for parseRequiresEntry

## Decisions Made
- **Two-schema approach**: `manifestSchema` (Phase 6+) uses the extended regex supporting @version; `manifestSchemaV3` (Phase 3-5) uses strict no-@version regex. This preserves backward compatibility without modifying existing test fixtures or consumer code.
- **Second-'@' parsing strategy**: `parseRequiresEntry` finds the second `@` after the scope's `/` separator rather than using regex, making it resilient to complex version ranges like `>=1.0.0 <2.0.0`.
- **Zod regex is intentional**: The regex is linear (no nested quantifiers), avoiding ReDoS vulnerability per plan's threat model (T-6-04).

## Deviations from Plan

None - plan executed exactly as written.

**Total deviations:** 0

## Issues Encountered
- Node.js `node -e "import(...)"` runtime test failed because `.ts` files are not compiled to `.js` at development time. Resolved by using `npx tsx -e "..."` instead, which is consistent with the project's existing development runtime approach.

## Threat Flags

No new security-relevant surface introduced. The threat model (T-6-04 mitigated, T-6-05 and T-6-06 accepted) applies as documented:
- Zod regex is linear, no ReDoS risk
- parseRequiresEntry is pure string split, no execution/unsafe parsing
- Error messages do not leak internal state

## Next Phase Readiness
- Ready for Plan 06-03: PluginHost version checking integration where `parseRequiresEntry()` will be consumed to verify requires declarations during plugin activation
- manifestSchemaV3 provides backward-compatible path for existing Phase 3-5 code

---
*Phase: 06-eventbus-semver*
*Completed: 2026-06-18*
