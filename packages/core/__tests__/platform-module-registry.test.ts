import { describe, it, expect } from 'vitest';
import {
  PlatformModuleRegistry,
  PlatformModuleDescriptor,
} from '../bootstrap/module-registry/index.js';

describe('Sprint A1 Platform Module Registry Test Suite', () => {
  const mockAIModule: PlatformModuleDescriptor = {
    id: 'mod_ai_runtime',
    name: 'ai-runtime',
    displayName: 'AI Runtime Module',
    version: '1.0.0',
    description: 'Generative AI Service Runtime',
    category: 'AI',
    status: 'Registered',
    health: { isHealthy: true, status: 'Healthy' },
    capabilities: ['text-generation', 'prompt-analysis'],
  };

  const mockLessonModule: PlatformModuleDescriptor = {
    id: 'mod_lesson_engine',
    name: 'lesson-engine',
    displayName: 'Lesson Flow Engine',
    version: '2.0.0',
    description: 'Educational Lesson Flow Management',
    category: 'Core',
    status: 'Active',
    health: { isHealthy: true, status: 'Healthy' },
  };

  it('should register and find module descriptors', () => {
    const registry = new PlatformModuleRegistry();
    registry.register(mockAIModule);

    expect(registry.exists('mod_ai_runtime')).toBe(true);
    const found = registry.find('mod_ai_runtime');
    expect(found).toBeDefined();
    expect(found?.displayName).toBe('AI Runtime Module');
    expect(found?.category).toBe('AI');
  });

  it('should prevent duplicate module registration', () => {
    const registry = new PlatformModuleRegistry();
    registry.register(mockAIModule);

    expect(() => registry.register(mockAIModule)).toThrow('already registered');
  });

  it('should list all registered modules and filter/find properly', () => {
    const registry = new PlatformModuleRegistry();
    registry.register(mockAIModule);
    registry.register(mockLessonModule);

    const modules = registry.list();
    expect(modules.length).toBe(2);
    expect(modules.some((m) => m.id === 'mod_lesson_engine')).toBe(true);
  });

  it('should unregister a module by ID', () => {
    const registry = new PlatformModuleRegistry();
    registry.register(mockAIModule);

    expect(registry.unregister('mod_ai_runtime')).toBe(true);
    expect(registry.exists('mod_ai_runtime')).toBe(false);
  });

  it('should update status and health of registered modules', () => {
    const registry = new PlatformModuleRegistry();
    registry.register(mockAIModule);

    registry.updateStatus('mod_ai_runtime', 'Active');
    expect(registry.find('mod_ai_runtime')?.status).toBe('Active');

    registry.updateHealth('mod_ai_runtime', { isHealthy: false, status: 'Degraded' });
    expect(registry.find('mod_ai_runtime')?.health.isHealthy).toBe(false);
  });
});
