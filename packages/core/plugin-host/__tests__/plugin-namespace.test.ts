/**
 * Integration smoke test for the plugin command namespace fix.
 *
 * Bug history:
 *   Worker plugins registered handlers under `{manifest.id}.{type}` (via
 *   the worker bootstrap), but the frontend `invokeCommand` was sending
 *   `{type}` unmodified. As a result, the main CommandBus threw
 *   "No handler registered for command: courseware.query".
 *
 *   The root cause was that the namespace-prefix rule was inlined in
 *   multiple places with subtly different shapes:
 *     - frontend:  `type.includes('.') ? type : ${pluginId}.${type}` (skipped dotted)
 *     - worker:     `startsWith(prefix) ? type : prefix + type`     (always prefixed)
 *     - host:       `startsWith(pluginActorId) ? ... : ...`          (UUID-based prefix)
 *
 *   Plus a secondary bug: the host ServiceHost constructor was being
 *   called with the DB UUID as the `pluginId` argument (instead of the
 *   manifest id), so the host prefixed with the UUID, while the frontend
 *   prefixed with the manifest id. The two never matched.
 *
 * Fix:
 *   - {@link resolvePluginCommandType} is now the single source of truth.
 *   - Both the worker bootstrap and the host ServiceHost receive
 *     `manifest.id` (NOT the DB UUID).
 *   - All three call sites (frontend, worker, host) compute the same
 *     fully-qualified key for the same `(type, manifest.id)` pair.
 */

import { resolvePluginCommandType } from '../plugin-namespace.js';

interface Case {
  name: string;
  type: string;
  pluginId: string;
  expected: string;
}

const cases: Case[] = [
  // Bug scenario: bare dotted command was mismatched before the fix
  {
    name: 'bare dotted command gets prefixed (the bug case)',
    type: 'courseware.query',
    pluginId: '@courseware-hub/plugin',
    expected: '@courseware-hub/plugin.courseware.query',
  },
  // Idempotent: if caller already passed the prefixed form, leave it alone
  {
    name: 'already-prefixed command is returned as-is',
    type: '@courseware-hub/plugin.courseware.query',
    pluginId: '@courseware-hub/plugin',
    expected: '@courseware-hub/plugin.courseware.query',
  },
  // Bare undotted command also gets prefixed (worker default)
  {
    name: 'bare undotted command gets prefixed',
    type: 'listUsers',
    pluginId: '@my-scope/hello',
    expected: '@my-scope/hello.listUsers',
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const actual = resolvePluginCommandType(c.type, c.pluginId);
  if (actual === c.expected) {
    console.log(`PASS [${c.name}] -> ${actual}`);
    pass++;
  } else {
    console.error(`FAIL [${c.name}]`);
    console.error(`  expected: ${c.expected}`);
    console.error(`  actual:   ${actual}`);
    fail++;
  }
}

// Two plugins registering the same bare command must end up with distinct keys.
// This is the safety property that justified the worker-side prefix in the first place.
const a = resolvePluginCommandType('createItem', '@scope-a/plugin');
const b = resolvePluginCommandType('createItem', '@scope-b/plugin');
if (a !== b && a === '@scope-a/plugin.createItem' && b === '@scope-b/plugin.createItem') {
  console.log(`PASS [two plugins registering same bare command get distinct keys] -> ${a} != ${b}`);
  pass++;
} else {
  console.error(`FAIL [two plugins registering same bare command get distinct keys]`);
  console.error(`  a: ${a}`);
  console.error(`  b: ${b}`);
  fail++;
}

console.log(`\nResult: ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
