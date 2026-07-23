import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClassroomEventBus } from '../index.js';

describe('Sprint P4-03 Classroom Event Model Test Suite', () => {
  let eventBus: ClassroomEventBus;

  beforeEach(() => {
    eventBus = new ClassroomEventBus();
  });

  it('should publish and subscribe to namespaced classroom events under classroom.* namespace', () => {
    const teachingSpy = vi.fn();
    const unsubscribe = eventBus.subscribe('classroom.teaching', teachingSpy);

    eventBus.publish('classroom.teaching', 'cls_math_101', { teacherId: 'tch_01' });

    expect(teachingSpy).toHaveBeenCalled();
    const event = teachingSpy.mock.calls[0][0];
    expect(event.type).toBe('classroom.teaching');
    expect(event.classroomId).toBe('cls_math_101');
    expect(event.payload).toEqual({ teacherId: 'tch_01' });

    unsubscribe();
    eventBus.publish('classroom.teaching', 'cls_math_101');
    expect(teachingSpy).toHaveBeenCalledTimes(1);
  });

  it('should support wildcard * subscription for all classroom.* events', () => {
    const wildcardSpy = vi.fn();
    eventBus.subscribe('*', wildcardSpy);

    eventBus.publish('classroom.created', 'cls_01');
    eventBus.publish('classroom.prepared', 'cls_01');
    eventBus.publish('classroom.ready', 'cls_01');

    expect(wildcardSpy).toHaveBeenCalledTimes(3);
  });
});
