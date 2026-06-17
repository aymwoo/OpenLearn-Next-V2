# Testing Patterns

**Analysis Date:** 2026-06-17

## Test Framework

**Runner:**
- No test runner configured
- No `jest.config.*`, `vitest.config.*`, or test configuration files found
- No test scripts in `package.json` scripts block

**Assertion Library:**
- None installed

**Run Commands:**
```bash
npm run lint    # Only runs `tsc --noEmit` — type checking, not tests
```

## Test File Organization

**Location:**
- No test files exist anywhere in the project (`find` returns zero `*.test.*` / `*.spec.*` files)

**Naming:**
- Not applicable — no test files

**Structure:**
- Not applicable — no test infrastructure set up

## Current State

The codebase currently has **zero tests** across the entire project:
- No unit tests for any of the 6 core subsystems (CommandBus, EventBus, ActionRegistry, CapabilityGuard, PluginRuntime, ProcessManager)
- No integration tests for REST API endpoints in `server.ts`
- No component tests for the React components in `src/components/`
- No end-to-end tests
- No test fixtures, factories, or mock utilities

## What Should Be Tested

Based on the architecture, the following are high-priority targets for testing:

### Critical Core Systems (highest impact, well-contained)

**CommandBus** (`packages/core/command-bus/index.ts`):
- Handler registration and duplicate prevention
- Command execution with interceptor
- Error propagation after logging
- Missing handler error
- Command creation (metadata defaults)

**EventBus** (`packages/core/event-bus/index.ts`):
- Subscribe/unsubscribe lifecycle
- Event publication to all subscribers
- Wildcard (`*`) subscription handling
- Subscriber error isolation (errors in one subscriber don't break others)

**CapabilityGuard** (`packages/core/capability-system/index.ts`):
- Wildcard capability matching (`*:*:*`, `lesson:*`)
- Grant/revoke operations
- Default actor grants

**ActionRegistry** (`packages/core/registry/index.ts`):
- Registration and duplicate prevention
- agentTools formatting for Gemini/OpenAI
- Tool name normalization
- Lookup by commandType vs toolName

**PluginRuntime** (`packages/core/plugin-runtime/index.ts`):
- Plugin install/uninstall lifecycle
- Safe wrapping of kernel APIs
- Plugin deactivation cleanup
- VM sandbox security (timeout enforcement, prototype freezing)

**ProcessManager** (`packages/core/process-manager/index.ts`):
- Process spawn/kill lifecycle
- Interval registration and cleanup
- State persistence to database
- Handler error handling

### REST API Endpoints (medium priority)

- `POST /api/agent/chat` — the core AI interaction endpoint
- `POST /api/commands` — manual command execution
- `POST /api/courseware/upload` — file upload with AI injection
- Cookie-based session authentication flow
- Response format consistency

### Frontend Components (lower priority, harder to test)

- `InteractiveWhiteboard` — Konva canvas operations
- `LiveClassroomView` — WebSocket state management
- `App.tsx` — would need extensive refactoring before testing is feasible

## Recommended Testing Setup

**For core packages (unit tests):**
```json
// package.json additions
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  },
  "devDependencies": {
    "vitest": "^1.x",
    "@vitest/coverage-v8": "^1.x"
  }
}
```

Test files should be co-located with source: `packages/core/command-bus/__tests__/index.test.ts`

**For API endpoints (integration tests):**
```json
{
  "devDependencies": {
    "supertest": "^6.x"
  }
}
```

Tests in a top-level `__tests__/` directory, starting with an in-memory SQLite database.

## Mocking Patterns (for future reference)

Since better-sqlite3 uses synchronous calls, the database can be mocked before each test:

```typescript
// Hypothetical test pattern for CommandBus
import { CommandBus } from '../command-bus/index.js';
import { EventBus } from '../event-bus/index.js';

describe('CommandBus', () => {
  let eventBus: EventBus;
  let commandBus: CommandBus;

  beforeEach(() => {
    eventBus = new EventBus();
    commandBus = new CommandBus(eventBus);
  });

  it('should register and execute a handler', async () => {
    commandBus.registerHandler('test.cmd', {
      execute: async (cmd) => ({ received: cmd.payload })
    });
    const cmd = commandBus.createCommand('test.cmd', { hello: 'world' }, 'test-actor');
    const result = await commandBus.execute(cmd);
    expect(result).toEqual({ received: { hello: 'world' } });
  });

  it('should throw when handler not found', async () => {
    const cmd = commandBus.createCommand('unknown.cmd', {}, 'test-actor');
    await expect(commandBus.execute(cmd)).rejects.toThrow('No handler registered');
  });
});
```

## Coverage

**Requirements:** None currently — no coverage targets enforced or measured

**Coverage gaps by criticality:**
| Area | Risk | Priority |
|------|------|----------|
| CommandBus | High — all AI agent operations flow through it | High |
| CapabilityGuard | High — security boundary | High |
| PluginRuntime | High — VM sandbox escape risk | High |
| EventBus | Medium — local event dispatch | Medium |
| ActionRegistry | Medium — tool schema formatting | Medium |
| ProcessManager | Medium — background tasks | Medium |
| REST API routes | High — user-facing entry points | High |
| Frontend components | Medium — UI correctness | Low (needs refactoring first) |

---

*Testing analysis: 2026-06-17*
