import { describe, it, expect, beforeEach } from 'vitest';
import {
  AIContextProviderRegistry,
  registerDefaultAIContextProviders,
  IAIContextProvider,
} from '../index.js';

describe('Sprint P5-01 AI Classroom Context Test Suite', () => {
  let registry: AIContextProviderRegistry;

  beforeEach(() => {
    registry = new AIContextProviderRegistry();
  });

  it('should assemble a complete read-only AIClassroomContextSnapshot across 11 context sections', () => {
    registerDefaultAIContextProviders(registry);
    const snapshot = registry.buildSnapshot({ classroomId: 'cls_test_01' });

    expect(snapshot.classroomId).toBe('cls_test_01');
    expect(snapshot.lesson.title).toBe('Advanced Calculus');
    expect(snapshot.teacher.name).toBe('Prof. Alan Turing');
    expect(snapshot.students.length).toBe(2);
    expect(snapshot.whiteboard.elementCount).toBe(12);
    expect(snapshot.analyticsSummary.totalInteractions).toBe(128);

    // Verify Read-Only Object Immutability
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.lesson)).toBe(true);
  });

  it('should prevent mutating read-only snapshot properties', () => {
    registerDefaultAIContextProviders(registry);
    const snapshot = registry.buildSnapshot();

    expect(() => {
      // @ts-expect-error testing immutability
      snapshot.classroomId = 'hacked_id';
    }).toThrow();
  });

  it('should allow third-party plugins to contribute custom AI Context Providers', () => {
    registerDefaultAIContextProviders(registry);

    const pluginProvider: IAIContextProvider = {
      id: 'provider_plugin_homework_hub',
      name: 'Homework Hub AI Provider',
      provideContext: () => ({
        extensionData: {
          pendingAssignmentsCount: 5,
          topScorerStudentId: 'stu_01',
        },
      }),
    };

    registry.registerProvider(pluginProvider);
    const snapshot = registry.buildSnapshot();

    expect(snapshot.extensionData.pendingAssignmentsCount).toBe(5);
    expect(snapshot.extensionData.topScorerStudentId).toBe('stu_01');
  });
});
