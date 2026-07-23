import { describe, it, expect } from 'vitest';
import {
  PlatformDomainRegistry,
  PlatformDomainDescriptor,
} from '../bootstrap/domain-registry/index.js';

describe('Sprint A2 Platform Domain Registry Test Suite', () => {
  const mockTeachingDomain: PlatformDomainDescriptor = {
    id: 'domain_teaching',
    name: 'teaching',
    displayName: 'Teaching & Classroom Domain',
    description: 'Core bounded context for classroom teaching and lesson flow',
    version: '1.0.0',
    category: 'Business',
    modules: ['mod_lesson_engine', 'mod_whiteboard', 'mod_interaction'],
    status: 'Active',
    health: { isHealthy: true, status: 'Healthy' },
    capabilities: ['lesson-flow', 'whiteboard-sync'],
  };

  const mockAIDomain: PlatformDomainDescriptor = {
    id: 'domain_ai',
    name: 'ai',
    displayName: 'AI Capability Domain',
    description: 'Generative AI and Agent Capability Services',
    version: '1.0.0',
    category: 'AI',
    modules: ['mod_ai_runtime', 'mod_prompt_injector'],
    status: 'Active',
    health: { isHealthy: true, status: 'Healthy' },
  };

  it('should register and retrieve domain descriptors', () => {
    const registry = new PlatformDomainRegistry();
    registry.registerDomain(mockTeachingDomain);

    expect(registry.exists('domain_teaching')).toBe(true);
    const found = registry.findDomain('domain_teaching');
    expect(found).toBeDefined();
    expect(found?.displayName).toBe('Teaching & Classroom Domain');
  });

  it('should prevent duplicate domain registration', () => {
    const registry = new PlatformDomainRegistry();
    registry.registerDomain(mockTeachingDomain);

    expect(() => registry.registerDomain(mockTeachingDomain)).toThrow('already registered');
  });

  it('should list all registered domains and retrieve grouped modules for a domain', () => {
    const registry = new PlatformDomainRegistry();
    registry.registerDomain(mockTeachingDomain);
    registry.registerDomain(mockAIDomain);

    const domains = registry.listDomains();
    expect(domains.length).toBe(2);

    const teachingModules = registry.listModules('domain_teaching');
    expect(teachingModules.length).toBe(3);
    expect(teachingModules).toContain('mod_lesson_engine');
    expect(teachingModules).toContain('mod_whiteboard');
  });

  it('should unregister a domain by ID', () => {
    const registry = new PlatformDomainRegistry();
    registry.registerDomain(mockTeachingDomain);

    expect(registry.unregisterDomain('domain_teaching')).toBe(true);
    expect(registry.exists('domain_teaching')).toBe(false);
  });
});
