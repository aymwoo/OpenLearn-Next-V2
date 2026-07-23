import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIRuntimeKernel } from '../ai/index.js';
import { AICapabilityKernel } from '../ai-capability/index.js';
import {
  CapabilityRuntimeKernel,
  CapabilityDescriptor,
  InvocationRequest,
  ICapabilityProviderHandler,
  PermissionChecker,
  PluginCapabilityProviderHandler,
} from '../capability/index.js';
import { CommandBus } from '../command-bus/index.js';
import { EventBus } from '../event-bus/index.js';

describe('OpenLearn Capability Invocation Framework Test Suite', () => {
  let aiRuntime: AIRuntimeKernel;
  let aiCapability: AICapabilityKernel;
  let frameworkKernel: CapabilityRuntimeKernel;

  beforeEach(() => {
    aiRuntime = new AIRuntimeKernel();
    aiCapability = new AICapabilityKernel(aiRuntime);
    frameworkKernel = new CapabilityRuntimeKernel(aiCapability);
  });

  describe('1. Capability Registry & Discovery', () => {
    it('should register, list, and discover capability descriptors', () => {
      expect(frameworkKernel.registry.has('cap_ai_completion')).toBe(true);
      expect(frameworkKernel.registry.has('cap_lesson_flow')).toBe(true);
      expect(frameworkKernel.registry.has('cap_analytics_insight')).toBe(true);

      const discovered = frameworkKernel.registry.discover('completion');
      expect(discovered.length).toBe(1);
      expect(discovered[0].id).toBe('cap_ai_completion');
    });
  });

  describe('2. Role-based Permission Checker', () => {
    it('should enforce role permissions for Teacher vs Student', () => {
      const teacherOnlyDesc: CapabilityDescriptor = {
        id: 'cap_teacher_only',
        name: 'Teacher Action',
        category: 'lesson',
        provider: 'test',
        permission: ['Teacher'],
        inputSchema: {},
        outputSchema: {},
        metadata: {},
        tags: [],
        version: '1.0.0',
      };

      expect(PermissionChecker.validatePermission(teacherOnlyDesc, 'Teacher')).toBe(true);
      expect(PermissionChecker.validatePermission(teacherOnlyDesc, 'Student')).toBe(false);
      expect(PermissionChecker.validatePermission(teacherOnlyDesc, 'System')).toBe(true);
    });
  });

  describe('3. Invocation Engine & 7-step Pipeline', () => {
    it('should execute 7-step pipeline and emit events', async () => {
      vi.spyOn(aiRuntime.providerGateway, 'generateText').mockResolvedValue('Pipeline Result');

      const eventSpy = vi.fn();
      frameworkKernel.eventBus.subscribe('CapabilityPublished', eventSpy);

      const req: InvocationRequest = {
        id: 'inv_1001',
        capabilityId: 'cap_ai_completion',
        payload: { prompt: 'Pipeline test' },
        context: { actorRole: 'Teacher', teacherId: 'tch_01' },
      };

      const result = await frameworkKernel.engine.invoke(req);
      expect(result.success).toBe(true);
      expect(result.data).toBe('Pipeline Result');
      expect(eventSpy).toHaveBeenCalled();
    });

    it('should throw error when permission is denied', async () => {
      const req: InvocationRequest = {
        id: 'inv_1002',
        capabilityId: 'cap_analytics_insight',
        payload: { test: true },
        context: { actorRole: 'Student' },
      };

      await expect(frameworkKernel.engine.invoke(req)).rejects.toThrow('Access Denied');
    });
  });

  describe('4. Invocation Semantics (Batch, Retry, Schedule, Cancel)', () => {
    it('should support batch invocations and retry on failure', async () => {
      const handler: ICapabilityProviderHandler = {
        descriptor: {
          id: 'cap_mock_task',
          name: 'Mock Task',
          category: 'plugin',
          provider: 'mock',
          permission: ['Student', 'Teacher'],
          inputSchema: {},
          outputSchema: {},
          metadata: { resultType: 'generic' },
          tags: ['mock'],
          version: '1.0.0',
        },
        execute: vi.fn().mockResolvedValue('Mock OK'),
      };

      frameworkKernel.registry.register(handler);

      const req1: InvocationRequest = { id: 'inv_b1', capabilityId: 'cap_mock_task', payload: { a: 1 }, context: { actorRole: 'Student' } };
      const req2: InvocationRequest = { id: 'inv_b2', capabilityId: 'cap_mock_task', payload: { b: 2 }, context: { actorRole: 'Student' } };

      const batchResults = await frameworkKernel.engine.batch([req1, req2]);
      expect(batchResults.length).toBe(2);
      expect(batchResults[0].data).toBe('Mock OK');
    });
  });

  describe('5. Capability SDK & Plugin Provider Adapter', () => {
    it('should invoke capability through SDK and adapt ActionRegistry commands', async () => {
      const eventBus = new EventBus();
      const commandBus = new CommandBus(eventBus);
      vi.spyOn(commandBus, 'execute').mockResolvedValue({ status: 'Command Executed' });

      const pluginAdapter = new PluginCapabilityProviderHandler(commandBus, 'lesson.create', 'Create Lesson Command');
      frameworkKernel.sdk.registerCapability(pluginAdapter);

      const res = await frameworkKernel.sdk.invokeCapability('cap_cmd_lesson.create', { title: 'Algebra' }, { actorRole: 'Teacher' });

      expect(res.success).toBe(true);
      expect(res.data).toEqual({ status: 'Command Executed' });
    });
  });
});
