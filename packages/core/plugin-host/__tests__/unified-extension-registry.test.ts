import { describe, it, expect } from 'vitest';
import { UnifiedExtensionRegistry } from '../unified-extension-registry.js';
import { PluginCompositionModule } from '../../bootstrap/composition/plugin-composition-module.js';

describe('UnifiedExtensionRegistry (P7-B5 EU-01)', () => {
  it('should register and resolve extensions across categories', () => {
    const registry = new UnifiedExtensionRegistry();

    const mockWidget = { component: 'WidgetA' };
    const mockCommand = { execute: () => 'done' };

    registry.registerExtension('widget', 'widget_a', mockWidget, {
      name: 'Widget A',
      providerId: 'plugin-quiz',
    });

    registry.registerExtension('command', 'cmd_b', mockCommand, {
      name: 'Command B',
    });

    expect(registry.hasExtension('widget', 'widget_a')).toBe(true);
    expect(registry.hasExtension('command', 'cmd_b')).toBe(true);
    expect(registry.hasExtension('widget', 'unknown')).toBe(false);

    expect(registry.getExtension('widget', 'widget_a')).toBe(mockWidget);
    expect(registry.getExtension('command', 'cmd_b')).toBe(mockCommand);
  });

  it('should list extensions by category and categories list', () => {
    const registry = new UnifiedExtensionRegistry();
    registry.registerExtension('widget', 'w1', {});
    registry.registerExtension('widget', 'w2', {});
    registry.registerExtension('ai_skill', 's1', {});

    const widgets = registry.listExtensions('widget');
    expect(widgets.length).toBe(2);

    const categories = registry.listCategories();
    expect(categories).toContain('widget');
    expect(categories).toContain('ai_skill');

    const all = registry.listExtensions();
    expect(all.length).toBe(3);
  });

  it('should throw on duplicate registrations', () => {
    const registry = new UnifiedExtensionRegistry();
    registry.registerExtension('panel', 'p1', {});

    expect(() => {
      registry.registerExtension('panel', 'p1', {});
    }).toThrow(/Duplicate extension registration/);
  });

  it('should report health and register in PluginCompositionModule', () => {
    const registry = new UnifiedExtensionRegistry();
    registry.registerExtension('menu', 'm1', {});

    const health = registry.health();
    expect(health.isHealthy).toBe(true);
    expect(health.details?.totalExtensions).toBe(1);

    const module = new PluginCompositionModule();
    const refs = new Map<string, unknown>();
    refs.set('extensionRegistry', registry);

    expect(() => {
      module.compose({ infrastructureRefs: refs });
    }).not.toThrow();
  });

  it('should sync contributions and activity providers via bridge methods', () => {
    const registry = new UnifiedExtensionRegistry();

    const mockContrib = {
      listAll: () => [
        {
          slot: 'teacher.tab',
          pluginId: 'ext-homework',
          configs: [{ id: 'hw_tab', name: 'Homework Tab' }],
        },
      ],
    };

    const mockActivityReg = {
      listProviders: () => [
        {
          descriptor: {
            id: 'act_quiz',
            name: 'Quiz Activity',
            provider: 'ext-quiz',
          },
        },
      ],
    };

    registry.syncContributionRegistry(mockContrib);
    registry.syncActivityRegistry(mockActivityReg);

    expect(registry.hasExtension('teacher.tab', 'hw_tab')).toBe(true);
    expect(registry.hasExtension('activity', 'act_quiz')).toBe(true);
  });
});
