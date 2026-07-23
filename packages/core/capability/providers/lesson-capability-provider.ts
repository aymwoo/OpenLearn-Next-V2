/**
 * OpenLearn Capability Invocation Framework - Lesson Capability Provider Adapter
 * Adapts LessonRuntime into standard Capability Framework Handlers.
 */

import {
  CapabilityDescriptor,
  ICapabilityProviderHandler,
  InvocationRequest,
} from '../types/index.js';

export class LessonCapabilityProviderHandler implements ICapabilityProviderHandler {
  public readonly descriptor: CapabilityDescriptor;

  constructor() {
    this.descriptor = {
      id: 'cap_lesson_flow',
      name: 'Lesson Flow Capability',
      category: 'lesson',
      provider: 'lesson_capability_provider',
      permission: ['Teacher', 'Student', 'System'],
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      metadata: { resultType: 'teaching_object' },
      tags: Object.freeze(['lesson', 'flow', 'stage']),
      version: '1.0.0',
    };
  }

  public async execute(request: InvocationRequest): Promise<unknown> {
    return {
      lessonId: request.context.lessonId || 'les_demo',
      stage: '新知讲解',
      status: 'active',
      payload: request.payload,
    };
  }
}
