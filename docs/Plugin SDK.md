# Plugin SDK (插件开发 SDK)

> Public extension API for plugins, and how official features (including the
> Student Workspace) reuse the **same** seams.

---

## 1. Frontend extension points

Plugins register UI contributions through `FrontendPluginContext`:

```ts
export function activate(ctx: FrontendPluginContext) {
  // Widget / panel in a workspace slot
  ctx.ui.registerExtensionPoint('student.view', {
    id: 'my-student-panel',
    label: 'My Panel',
    component: () => import('./MyPanel'),
  });

  // Toolbar button that fires a command
  ctx.ui.registerExtensionPoint('classroom.tool', {
    id: 'my-tool',
    label: 'My Tool',
    commandType: 'myplugin.do_thing',
  });

  // Invoke a backend command (auto-namespaced for non-@openlearn plugins)
  await ctx.invokeCommand('myplugin.do_thing', { value: 1 });
}
```

Student-facing slots (declared and consumed by the Student Workspace):

- `student.view` — general student widgets/panels (rendered by `StudentPluginWidgets`).
- `student.lesson.tool` — lesson toolbar tools.
- `student.fullscreen` — fullscreen student surfaces.

They are rendered by the **same** `ExtensionPointRenderer` as teacher slots.

---

## 2. Backend services (official features use these too)

```ts
export function activate(ctx: PluginContext) {
  // Register a command handler
  ctx.services.commandBus.registerHandler('myplugin.do_thing', {
    execute: async (cmd) => { /* ... */ },
  });

  // Register an AI Action (the official AI Action seam)
  ctx.services.actionRegistry.register({
    id: 'myplugin.action',
    commandType: 'myplugin.action',
    description: 'Does a thing',
    inputSchema: { /* json-schema */ },
    capabilityRequired: 'ai:invoke',
  });
}
```

Official implementations and plugins share these exact service tokens
(`ICommandBusServiceToken`, `IActionRegistryServiceToken`,
`ICapabilityServiceToken`, `IAIServiceToken`, …) exported from
`@openlearn/plugin-sdk`.

---

## 3. Consistency rule

The Student Workspace and Teacher Workspace are composed from the **same**
infrastructure. Any widget a plugin contributes to `student.view` is rendered by
the identical `ExtensionPointRenderer` used for teacher slots, so a plugin that
works for one workspace works for the other through the same seam.

> Note: AI Skills, AI Prompts, Resources and the frontend `ActivityRegistry`
> are currently wired through internal feature registries rather than the public
> SDK. Plugins that need those should ride on the `student.view` /
> `classroom.tool` extension points or the command/action services above until
> those registries are surfaced in `@openlearn/plugin-sdk`.

---

## 4. See also

- [`Workspace Guide.md`](Workspace Guide.md) — shell & slot model.
- [`Student Workspace.md`](Student Workspace.md) — Student composition.
- [`Product SDK.md`](Product SDK.md) — product-layer APIs.
- `docs/plugin-development-tutorial.md` — full plugin tutorial.
- `packages/plugin-sdk/` — the published SDK package.
