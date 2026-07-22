/**
 * Plugin Command Namespace — single source of truth for plugin command type resolution.
 *
 * Bug history:
 *   Prior to this module, three sites applied inconsistent namespace-prefix rules:
 *     1. Worker `commandBus.registerHandler(...)` (worker-manager.ts) — prefixed any
 *        command whose `.` did not start with `${pluginId}.`
 *     2. Frontend `ctx.invokeCommand(...)` (src/plugin-host/plugin-host.ts) — prefixed
 *        only when the command did not contain any `.`
 *     3. Host-side `commandBus.registerHandler(...)` (service-host.ts) — same as (1)
 *
 *   The rules drifted: a worker plugin registering `courseware.query` ended up
 *   registered in the main CommandBus as `@courseware-hub/plugin.courseware.query`,
 *   while a frontend `invokeCommand('courseware.query')` was sent unmodified — so
 *   the main CommandBus threw "No handler registered for command: courseware.query".
 *
 * Fix: centralize the rule. The unified rule is:
 *   - If the type already starts with `${pluginId}.`, leave it alone (caller opted
 *     into the explicit namespace).
 *   - Otherwise, prepend `${pluginId}.` to prevent cross-plugin command collisions
 *     in the shared global CommandBus.
 *
 * Both ends now call {@link resolvePluginCommandType} with the same `(type, pluginId)`
 * pair, guaranteeing the register-site and the execute-site use the same key.
 */

/**
 * Resolve the canonical CommandBus command type for a plugin-issued command.
 *
 * IMPORTANT — call with `manifest.id`, NOT the DB-generated UUID.
 *
 *   The kernel assigns each uploaded plugin a fresh DB id (a UUID v7),
 *   stored in `plugins.id`. But the plugin's commands are addressed under
 *   the plugin AUTHOR's chosen identifier — `manifest.id` (e.g.
 *   `@courseware-hub/plugin`). The two diverge for ZIP-uploaded plugins:
 *
 *     DB id:  019f6029-884d-71dd-a4f1-31f815fa9698   (server-only key)
 *     Manifest id:  @courseware-hub/plugin          (author's identity)
 *
 *   Both sides of the boundary (frontend `invokeCommand`, worker
 *   `registerHandler`, host `service-host` intercept) MUST pass
 *   `manifest.id` here, otherwise the prefix is invisible to the frontend
 *   and the main CommandBus throws "No handler registered for command".
 *
 * @param type      The command type the plugin wrote in its source (e.g. `courseware.query`)
 * @param pluginId  The plugin's manifest id (e.g. `@courseware-hub/plugin`)
 * @returns The fully-qualified command type stored in the main CommandBus
 *          (e.g. `@courseware-hub/plugin.courseware.query`)
 *
 * @example
 *   resolvePluginCommandType('courseware.query', '@courseware-hub/plugin')
 *   // => '@courseware-hub/plugin.courseware.query'
 *
 *   resolvePluginCommandType('@courseware-hub/plugin.courseware.query', '@courseware-hub/plugin')
 *   // => '@courseware-hub/plugin.courseware.query' (already prefixed, returned as-is)
 *
 *   resolvePluginCommandType('listUsers', '@my-scope/hello')
 *   // => '@my-scope/hello.listUsers'
 */
const UUID_V7_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}\./i;

export function resolvePluginCommandType(type: string, pluginId: string): string {
  const prefix = pluginId + '.';
  if (type.startsWith(prefix)) return type;
  if (UUID_V7_PREFIX.test(type)) return type;
  return prefix + type;
}

export function stripPluginCommandPrefix(type: string, pluginId: string): string {
  const prefix = pluginId + '.';
  if (type.startsWith(prefix)) return type.slice(prefix.length);
  if (UUID_V7_PREFIX.test(type)) {
    const idx = type.indexOf('.');
    return type.slice(idx + 1);
  }
  return type;
}
