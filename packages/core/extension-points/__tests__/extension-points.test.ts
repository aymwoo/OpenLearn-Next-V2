import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CORE_EXTENSION_POINTS,
  getExtensionPointMetadata,
  warnDeprecation,
  resetDeprecationWarnings,
  generateUpgradeCompatibilityReport,
} from '../index.js';
import { CommandBus } from '../../command-bus/index.js';
import { EventBus } from '../../event-bus/index.js';
import { ContributionRegistry } from '../../plugin-host/contribution-registry.js';
import { ServiceRegistry } from '../../di/service-registry.js';
import { ResourceTracker } from '../../plugin-host/resource-tracker.js';
import {
  ICommandBusServiceToken,
  IEventBusServiceToken,
  IActionRegistryServiceToken,
  ICapabilityServiceToken,
  IProcessServiceToken,
  IStorageServiceToken,
  IAIServiceToken,
} from '../../di/interfaces.js';
import { buildContext } from '../../plugin-host/context-builder.js';
import type { Manifest } from '../../esm-loader/manifest-schema.js';

async function createMockRegistry() {
  const registry = new ServiceRegistry();
  await registry.register(ICommandBusServiceToken, {
    execute: vi.fn(),
    registerHandler: vi.fn(),
    unregisterHandler: vi.fn(),
  } as any);
  await registry.register(IEventBusServiceToken, {
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  } as any);
  await registry.register(IActionRegistryServiceToken, {
    register: vi.fn(),
    unregister: vi.fn(),
    getAllActions: vi.fn().mockReturnValue([]),
    getAgentTools: vi.fn().mockReturnValue([]),
    getActionByToolName: vi.fn(),
    getActionByCommandType: vi.fn(),
  } as any);
  await registry.register(ICapabilityServiceToken, {
    grant: vi.fn(),
    revokeAll: vi.fn(),
    check: vi.fn().mockReturnValue(true),
  } as any);
  await registry.register(IProcessServiceToken, {
    spawn: vi.fn(),
    kill: vi.fn(),
    registerHandler: vi.fn(),
    unregisterHandler: vi.fn(),
  } as any);
  await registry.register(IStorageServiceToken, {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  } as any);
  await registry.register(IAIServiceToken, {
    generateText: vi.fn(),
  } as any);
  return registry;
}

function createMockDb() {
  return {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
    transaction: vi.fn((fn: any) => fn),
    exec: vi.fn(),
  };
}

describe('Extension Points Metadata & Lifecycle Contract (Issue #146)', () => {
  beforeEach(() => {
    resetDeprecationWarnings();
    vi.restoreAllMocks();
  });

  describe('CORE_EXTENSION_POINTS registry', () => {
    it('defines metadata for all 4 primitive kinds', () => {
      const kinds = new Set(CORE_EXTENSION_POINTS.map((ep) => ep.kind));
      expect(kinds.has('command')).toBe(true);
      expect(kinds.has('event')).toBe(true);
      expect(kinds.has('slot')).toBe(true);
      expect(kinds.has('service')).toBe(true);
    });

    it('retrieves metadata by ID correctly', () => {
      const lessonCreate = getExtensionPointMetadata('lesson.create');
      expect(lessonCreate).toBeDefined();
      expect(lessonCreate?.kind).toBe('command');
      expect(lessonCreate?.since).toBe('0.1.0');

      const nonExistent = getExtensionPointMetadata('unknown.non_existent');
      expect(nonExistent).toBeUndefined();
    });

    it('contains deprecation and replacement metadata for deprecated extension points', () => {
      const readPath = getExtensionPointMetadata('vfs.read_path');
      expect(readPath).toBeDefined();
      expect(readPath?.deprecated).toBe('0.6.0');
      expect(readPath?.removedIn).toBe('0.7.0');
      expect(readPath?.replacement).toContain('vfs.read_file');

      const quizAnswered = getExtensionPointMetadata('whiteboard.quiz_answered');
      expect(quizAnswered).toBeDefined();
      expect(quizAnswered?.deprecated).toBe('0.6.0');
      expect(quizAnswered?.removedIn).toBe('0.7.0');
      expect(quizAnswered?.replacement).toContain('quiz.answered');

      const legacyTab = getExtensionPointMetadata('legacy.classroom.tab');
      expect(legacyTab).toBeDefined();
      expect(legacyTab?.deprecated).toBe('0.5.0');
      expect(legacyTab?.removedIn).toBe('0.7.0');

      const legacyAuth = getExtensionPointMetadata('@openlearn/core:ILegacyAuthService');
      expect(legacyAuth).toBeDefined();
      expect(legacyAuth?.deprecated).toBe('0.5.0');
      expect(legacyAuth?.removedIn).toBe('0.7.0');
    });
  });

  describe('warnDeprecation runtime warning emitter', () => {
    it('emits structured DeprecationWarning and deduplicates within same process', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const msg1 = warnDeprecation('command', 'vfs.read_path', 'test-plugin');
      expect(msg1).toContain('[DeprecationWarning]');
      expect(msg1).toContain('Plugin "test-plugin"');
      expect(msg1).toContain('deprecated command "vfs.read_path"');
      expect(msg1).toContain('deprecated since v0.6.0');
      expect(msg1).toContain('will be removed in v0.7.0');
      expect(msg1).toContain("Replacement: Use 'vfs.read_file' instead.");
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Repeated invocation for same plugin and extension point should be deduplicated
      const msg2 = warnDeprecation('command', 'vfs.read_path', 'test-plugin');
      expect(msg2).toBe(msg1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Different caller plugin ID triggers a new warning
      warnDeprecation('command', 'vfs.read_path', 'other-plugin');
      expect(warnSpy).toHaveBeenCalledTimes(2);

      // Non-deprecated extension point returns null and does not warn
      const noWarn = warnDeprecation('command', 'lesson.create', 'test-plugin');
      expect(noWarn).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('CommandBus runtime integration', () => {
    it('warns when registering and executing deprecated command', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const eventBus = new EventBus();
      const commandBus = new CommandBus(eventBus);

      commandBus.registerHandler('vfs.read_path', {
        execute: async () => ({ ok: true }),
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('vfs.read_path'));

      // Execution warning
      resetDeprecationWarnings();
      warnSpy.mockClear();
      await commandBus.execute({
        id: 'cmd-1',
        type: 'vfs.read_path',
        actorId: 'teacher-1',
        payload: { path: '/tmp' },
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('vfs.read_path'));

      // Normal command emits no warning
      resetDeprecationWarnings();
      warnSpy.mockClear();
      commandBus.registerHandler('lesson.create', {
        execute: async () => ({ id: 'new-lesson' }),
      });
      await commandBus.execute({
        id: 'cmd-2',
        type: 'lesson.create',
        actorId: 'teacher-1',
        payload: { title: 'Test Lesson' },
      });
      const deprecationCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[DeprecationWarning]'));
      expect(deprecationCalls.length).toBe(0);
    });
  });

  describe('EventBus runtime integration', () => {
    it('warns when subscribing and publishing deprecated event', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const eventBus = new EventBus();

      const sub = vi.fn();
      eventBus.subscribe('whiteboard.quiz_answered', sub);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('whiteboard.quiz_answered'));

      resetDeprecationWarnings();
      warnSpy.mockClear();
      await eventBus.publish({
        id: 'evt-1',
        type: 'whiteboard.quiz_answered',
        source: 'quiz-1',
        timestamp: Date.now(),
        payload: { answer: 1 },
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('whiteboard.quiz_answered'));
      expect(sub).toHaveBeenCalled();

      // Normal event emits no warning
      resetDeprecationWarnings();
      warnSpy.mockClear();
      eventBus.subscribe('quiz.answered', vi.fn());
      await eventBus.publish({
        id: 'evt-2',
        type: 'quiz.answered',
        source: 'quiz-2',
        timestamp: Date.now(),
        payload: { answer: 1, correctIndex: 1 },
      });
      const deprecationCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[DeprecationWarning]'));
      expect(deprecationCalls.length).toBe(0);
    });
  });

  describe('ContributionRegistry runtime integration', () => {
    it('warns when a plugin contributes to a deprecated UI slot', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const registry = new ContributionRegistry();

      registry.register('plugin-with-legacy-tab', {
        'legacy.classroom.tab': [{ id: 'item-1', label: 'Old Tab' }],
        'teacher.tab': [{ id: 'item-2', label: 'New Tab' }],
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DeprecationWarning] Plugin "plugin-with-legacy-tab" is using deprecated slot "legacy.classroom.tab"',
        ),
      );
      const deprecationCalls = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[DeprecationWarning]'));
      expect(deprecationCalls.length).toBe(1);
    });
  });

  describe('ContextBuilder runtime integration', () => {
    it('warns when a plugin manifest requires a deprecated service token', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const registry = await createMockRegistry();
      const tracker = new ResourceTracker();
      const db = createMockDb();

      const manifest: Manifest = {
        id: 'plugin-needs-auth',
        name: 'Plugin Needs Auth',
        version: '1.0.0',
        main: 'index.js',
        requires: ['@openlearn/core:ILegacyAuthService'],
      };

      await buildContext(registry, tracker, manifest.id, manifest, db);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DeprecationWarning] Plugin "plugin-needs-auth" is using deprecated service "@openlearn/core:ILegacyAuthService"',
        ),
      );
    });
  });

  describe('generateUpgradeCompatibilityReport (Core Engine)', () => {
    it('evaluates compatible, warning, and incompatible plugins accurately', () => {
      const plugins = [
        {
          id: 'clean-plugin',
          name: 'Clean Plugin',
          version: '1.0.0',
          engines: { openlearn: '>=0.2.0' },
          contributes: {
            'teacher.tab': [{ id: 'tab1' }],
          },
          requires: ['@openlearn/core:IStorageService'],
        },
        {
          id: 'warning-plugin',
          name: 'Warning Plugin',
          version: '1.0.0',
          engines: { openlearn: '>=0.5.0' },
          contributes: {
            'legacy.classroom.tab': [{ id: 'old-tab' }],
          },
        },
        {
          id: 'broken-plugin',
          name: 'Broken Plugin',
          version: '1.0.0',
          engines: { openlearn: '<0.6.0' },
        },
      ];

      // At target version 0.6.0:
      // - clean-plugin: compatible
      // - warning-plugin: has_warnings (legacy.classroom.tab deprecated in 0.5.0, removed in 0.7.0)
      // - broken-plugin: incompatible (engines constraint <0.6.0 fails on 0.6.0)
      const report060 = generateUpgradeCompatibilityReport(plugins, '0.6.0');
      expect(report060.targetVersion).toBe('0.6.0');
      expect(report060.overallStatus).toBe('incompatible');
      expect(report060.summary.totalPlugins).toBe(3);
      expect(report060.summary.compatibleCount).toBe(1);
      expect(report060.summary.warningCount).toBe(1);
      expect(report060.summary.incompatibleCount).toBe(1);

      // At target version 0.7.0:
      // - warning-plugin becomes incompatible because legacy.classroom.tab removedIn is 0.7.0!
      const report070 = generateUpgradeCompatibilityReport(plugins, '0.7.0');
      expect(report070.summary.incompatibleCount).toBe(2);
      const warningPluginResult = report070.plugins.find((p) => p.id === 'warning-plugin');
      expect(warningPluginResult?.status).toBe('incompatible');
      expect(warningPluginResult?.issues[0].level).toBe('error');
      expect(warningPluginResult?.issues[0].message).toContain('removed in v0.7.0');
    });
  });
});
