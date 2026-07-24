import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  ActivityRegistry,
  BaseActivityProvider,
  defineActivityProvider,
  createActivityContext,
  registerOfficialActivities,
  ACTIVITY_EVENTS,
  IActivityRegistryToken,
  OFFICIAL_ACTIVITY_DEFINITIONS,
} from '../index.js';
import type { ActivityProviderDescriptor } from '../types.js';
import {
  createMockContext,
  MockCommandBus,
  MockEventBus,
  MockActionRegistry,
  MockCapability,
  MockAI,
} from '../../plugin-test-kit/index.js';

/** Build a minimal ActivityContext from the test-kit mocks. */
function makeContext(overrides: Partial<Record<string, any>> = {}) {
  const commandBus = overrides.commandBus ?? new MockCommandBus();
  const eventBus = overrides.eventBus ?? new MockEventBus();
  const actionRegistry = overrides.actionRegistry ?? new MockActionRegistry();
  const capability = overrides.capability ?? new MockCapability();
  const ai = overrides.ai ?? new MockAI();
  return {
    commandBus,
    eventBus,
    actionRegistry,
    capability,
    ai,
    classroom: { classroomId: 'cls_1', sessionId: 'ses_1', role: 'teacher' },
    // expose mocks for assertions
    _mocks: { commandBus, eventBus, actionRegistry, capability, ai },
  } as any;
}

function makeDescriptor(id: string, extra: Partial<ActivityProviderDescriptor> = {}): ActivityProviderDescriptor {
  return {
    id,
    name: id,
    category: 'custom',
    version: '1.0.0',
    provider: 'official',
    supportedRoles: ['all'],
    ...extra,
  };
}

describe('Activity Ecosystem — Registry & Official Activities', () => {
  let registry: ActivityRegistry;

  beforeEach(() => {
    registry = new ActivityRegistry();
  });

  it('registers official activity providers as Activity Providers', () => {
    registerOfficialActivities(registry);
    // 9 official activities: quiz, vote, poll, discussion, grouping,
    // assignment, competition, checkin, homework
    expect(registry.listProviders().length).toBe(OFFICIAL_ACTIVITY_DEFINITIONS.length);
    // Every official provider exposes the required descriptor fields.
    for (const p of registry.listProviders()) {
      expect(p.descriptor.id).toBeTruthy();
      expect(p.descriptor.name).toBeTruthy();
      expect(p.descriptor.category).toBeTruthy();
      expect(Array.isArray(p.descriptor.supportedRoles)).toBe(true);
      expect(p.descriptor.version).toBeTruthy();
      expect(p.descriptor.provider).toBe('official');
    }
  });

  it('throws on duplicate registration', () => {
    registry.registerProvider(new BaseActivityProvider({ descriptor: makeDescriptor('dup') }));
    expect(() =>
      registry.registerProvider(new BaseActivityProvider({ descriptor: makeDescriptor('dup') })),
    ).toThrow(/already registered/);
  });

  it('rejects a provider without a descriptor id', () => {
    expect(
      () => new BaseActivityProvider({ descriptor: makeDescriptor('') }),
    ).toThrow();
  });

  it('filters activities by role', () => {
    registerOfficialActivities(registry);
    const teacherOnly = registry.listByRole('teacher');
    // grouping + checkin are teacher-only
    expect(teacherOnly.length).toBeGreaterThan(0);
    expect(teacherOnly.every((p) => p.descriptor.supportedRoles.includes('teacher') || p.descriptor.supportedRoles.includes('all'))).toBe(true);

    const student = registry.listByRole('student');
    const ids = student.map((p) => p.descriptor.id);
    expect(ids).toContain('official_quiz');
    expect(ids).not.toContain('official_grouping'); // teacher-only
  });

  it('contributes AI Actions into the ActionRegistry', () => {
    const actionRegistry = new MockActionRegistry();
    registerOfficialActivities(registry, actionRegistry);
    // each official activity contributed one AI action
    expect(actionRegistry.actions.size).toBe(OFFICIAL_ACTIVITY_DEFINITIONS.length);
    const quizAction = actionRegistry.actions.get('activity_ai_official_quiz');
    expect(quizAction).toBeDefined();
    expect(quizAction?.commandType).toBe('quiz.create');
  });
});

describe('Activity Ecosystem — Lifecycle', () => {
  it('walks through register → initialize → start → pause → resume → finish → dispose', async () => {
    const registry = new ActivityRegistry();
    const ctx = makeContext();
    const provider = new BaseActivityProvider({ descriptor: makeDescriptor('lifecycle_demo', { commandType: 'demo.run' }) });
    registry.registerProvider(provider);

    expect(provider.state).toBe('registered');
    expect(provider.startedAt).toBeUndefined();
    await provider.initialize(ctx);
    expect(provider.state).toBe('initialized');

    await provider.start(ctx, { foo: 'bar' });
    expect(provider.state).toBe('running');
    // startedAt is recorded on start and exposed via the getter.
    expect(provider.startedAt).toBeTypeOf('number');
    expect(provider.startedAt).toBeGreaterThan(0);

    await provider.pause(ctx);
    expect(provider.state).toBe('paused');
    await provider.resume(ctx);
    expect(provider.state).toBe('running');

    await provider.finish(ctx);
    expect(provider.state).toBe('finished');
    await provider.dispose(ctx);
    expect(provider.state).toBe('disposed');

    // Events published on the reused Event Bus.
    const published = (ctx._mocks.eventBus as MockEventBus).publishCalls.map((e: any) => e.type);
    expect(published).toContain(ACTIVITY_EVENTS.INITIALIZED);
    expect(published).toContain(ACTIVITY_EVENTS.STARTED);
    expect(published).toContain(ACTIVITY_EVENTS.PAUSED);
    expect(published).toContain(ACTIVITY_EVENTS.RESUMED);
    expect(published).toContain(ACTIVITY_EVENTS.FINISHED);
    expect(published).toContain(ACTIVITY_EVENTS.DISPOSED);
  });

  it('reuses the Command Bus to execute the backing classroom command on start', async () => {
    const registry = new ActivityRegistry();
    const ctx = makeContext();
    const commandBus = ctx._mocks.commandBus as MockCommandBus;
    let handled = false;
    commandBus.registerHandler('demo.run', { execute: async (c: any) => { handled = true; return { ok: true, id: c.payload?.id }; } });

    const provider = new BaseActivityProvider({ descriptor: makeDescriptor('cmd_demo', { commandType: 'demo.run' }) });
    registry.registerProvider(provider);

    const result = await provider.start(ctx, { id: 'xyz' });
    expect(handled).toBe(true);
    expect((result as any).ok).toBe(true);
    // The command was created + executed through the existing Command Bus.
    expect(commandBus.executeCalls.length).toBe(1);
    expect(commandBus.executeCalls[0].type).toBe('demo.run');
  });

  it('degrades gracefully when the backing command handler is absent', async () => {
    const registry = new ActivityRegistry();
    const ctx = makeContext();
    const commandBus = ctx._mocks.commandBus as MockCommandBus;
    const provider = new BaseActivityProvider({ descriptor: makeDescriptor('opt_demo', { commandType: 'missing.cmd' }) });
    registry.registerProvider(provider);
    // Should NOT throw — only publishes activity.started.
    await expect(provider.start(ctx, {})).resolves.toBeUndefined();
    expect(commandBus.executeCalls.length).toBe(1);
  });

  it('supports custom onStart hooks (plugin-defined behaviour)', async () => {
    const registry = new ActivityRegistry();
    const ctx = makeContext();
    let called = false;
    const provider = new BaseActivityProvider({
      descriptor: makeDescriptor('hook_demo'),
      onStart: async (_c, payload) => { called = true; return { echoed: payload }; },
    });
    registry.registerProvider(provider);
    const result = await provider.start(ctx, { v: 1 });
    expect(called).toBe(true);
    expect((result as any).echoed).toEqual({ v: 1 });
  });
});

describe('Activity Ecosystem — Permission Isolation', () => {
  it('denies start when the actor lacks a required permission', async () => {
    const registry = new ActivityRegistry();
    const capability = new MockCapability();
    const ctx = makeContext({ capability });
    const provider = new BaseActivityProvider({
      descriptor: makeDescriptor('secret_demo', { permissions: ['activity:secret'] }),
    });
    registry.registerProvider(provider);

    await expect(registry.startActivity('secret_demo', ctx, {}, 'usr_student')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('allows start once the required permission is granted', async () => {
    const registry = new ActivityRegistry();
    const capability = new MockCapability();
    const ctx = makeContext({ capability });
    const provider = new BaseActivityProvider({
      descriptor: makeDescriptor('secret_demo', { permissions: ['activity:secret'] }),
    });
    registry.registerProvider(provider);

    capability.grant('usr_teacher', 'activity:secret');
    await expect(registry.startActivity('secret_demo', ctx, {}, 'usr_teacher')).resolves.toBeDefined();
  });

  it('skips permission check when no permissions are declared', async () => {
    const registry = new ActivityRegistry();
    const ctx = makeContext();
    const provider = new BaseActivityProvider({ descriptor: makeDescriptor('open_demo') });
    registry.registerProvider(provider);
    await expect(registry.startActivity('open_demo', ctx, {}, 'usr_anon')).resolves.toBeDefined();
  });
});

describe('Activity Ecosystem — Plugin Extensibility (same API as official)', () => {
  it('a third-party plugin registers an Activity Provider via ctx.resolve(token)', async () => {
    const registry = new ActivityRegistry();
    // Simulate the host registering the singleton registry as a DI service.
    const ctx = createMockContext({
      pluginId: 'ext-activity-demo',
      customTokens: { [IActivityRegistryToken.name]: registry },
    });

    // This is exactly what a real plugin would do in its activate(ctx):
    const resolved = await (ctx as any).resolve(IActivityRegistryToken);
    const pluginProvider = new BaseActivityProvider({
      descriptor: makeDescriptor('ext_my_activity', {
        name: 'My Plugin Activity',
        provider: 'ext-activity-demo',
        category: 'engagement',
        supportedRoles: ['all'],
      }),
    });
    resolved.registerProvider(pluginProvider);

    // Now the activity is discoverable through the SAME registry.
    expect(registry.getProvider('ext_my_activity')).toBeDefined();
    expect(registry.listProviders().some((p) => p.descriptor.provider === 'ext-activity-demo')).toBe(true);
  });

  it('defineActivityProvider produces a usable provider', () => {
    const provider = defineActivityProvider(makeDescriptor('defined_demo'));
    expect(provider).toBeInstanceOf(BaseActivityProvider);
    expect(provider.descriptor.id).toBe('defined_demo');
  });
});

describe('Activity Ecosystem — Regression / Backward Compatibility', () => {
  it('keeps the official activity ids stable (consumer contract)', () => {
    const registry = new ActivityRegistry();
    registerOfficialActivities(registry);
    const ids = registry.listProviders().map((p) => p.descriptor.id).sort();
    expect(ids).toEqual([
      'official_assignment',
      'official_checkin',
      'official_competition',
      'official_discussion',
      'official_grouping',
      'official_homework',
      'official_poll',
      'official_quiz',
      'official_vote',
    ]);
  });

  it('does not break when started with the kernel-shaped service surface', async () => {
    // Mirror the shape used by server.ts (commandBus/eventBus/actionRegistry/
    // capability/ai). Confirms the ActivityContext contract is stable.
    const registry = new ActivityRegistry();
    const ctx = createActivityContext({
      commandBus: new MockCommandBus() as any,
      eventBus: new MockEventBus() as any,
      actionRegistry: new MockActionRegistry() as any,
      capability: new MockCapability() as any,
      ai: new MockAI() as any,
      classroom: { classroomId: uuidv4(), role: 'teacher' },
    });
    registerOfficialActivities(registry);
    const result = await registry.startActivity('official_assignment', ctx, { title: 'HW1' });
    expect(result.provider).toBe('official');
    expect(result.dispatched).toBe(true);
  });
});
