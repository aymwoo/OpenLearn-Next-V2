import { describe, it, expect, vi } from 'vitest';
import {
  LessonStateMachine,
  VALID_LESSON_TRANSITIONS,
  InvalidLessonStateTransitionError,
} from '../state-machine.js';

describe('LessonStateMachine (Phase C3)', () => {
  it('should initialize with default status idle', () => {
    const sm = new LessonStateMachine();
    expect(sm.status).toBe('idle');
    expect(sm.lessonId).toBe('');
  });

  it('should allow valid transition from idle to active, paused, completed and reset', () => {
    const sm = new LessonStateMachine('idle', 'les_001');
    const listener = vi.fn();
    sm.onTransition(listener);

    // idle -> active
    expect(sm.canTransitionTo('active')).toBe(true);
    expect(sm.transitionTo('active')).toBe('active');
    expect(listener).toHaveBeenCalledWith('idle', 'active', 'les_001');

    // active -> paused
    expect(sm.canTransitionTo('paused')).toBe(true);
    expect(sm.transitionTo('paused')).toBe('paused');
    expect(listener).toHaveBeenCalledWith('active', 'paused', 'les_001');

    // paused -> active
    expect(sm.canTransitionTo('active')).toBe(true);
    expect(sm.transitionTo('active')).toBe('active');

    // active -> completed
    expect(sm.canTransitionTo('completed')).toBe(true);
    expect(sm.transitionTo('completed')).toBe('completed');

    // completed -> idle (reset)
    expect(sm.canTransitionTo('idle')).toBe(true);
    expect(sm.transitionTo('idle')).toBe('idle');
  });

  it('should reject invalid transition and throw InvalidLessonStateTransitionError', () => {
    const sm = new LessonStateMachine('idle', 'les_002');

    // idle cannot transition to completed
    expect(sm.canTransitionTo('completed')).toBe(false);
    expect(() => sm.transitionTo('completed')).toThrow(InvalidLessonStateTransitionError);

    // transition to active
    sm.transitionTo('active');

    // active cannot transition directly to idle
    expect(sm.canTransitionTo('idle')).toBe(false);
    expect(() => sm.transitionTo('idle')).toThrow(
      /Invalid state transition for lesson "les_002": cannot transition from "active" to "idle"/,
    );
  });

  it('should reject double-activation (active -> active)', () => {
    const sm = new LessonStateMachine('idle', 'les_003');
    sm.transitionTo('active');

    expect(() => sm.transitionTo('active')).toThrow(InvalidLessonStateTransitionError);
  });

  it('should allow unsubscribing from onTransition', () => {
    const sm = new LessonStateMachine('idle', 'les_004');
    const listener = vi.fn();
    const unsub = sm.onTransition(listener);

    sm.transitionTo('ready');
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    sm.transitionTo('active');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should reset back to idle state', () => {
    const sm = new LessonStateMachine('active', 'les_005');
    sm.reset('les_006');

    expect(sm.status).toBe('idle');
    expect(sm.lessonId).toBe('les_006');
  });
});
