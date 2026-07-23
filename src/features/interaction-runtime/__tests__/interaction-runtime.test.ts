import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InteractionRuntimeService,
  InteractionRegistry,
  InteractionHandler,
} from '../index.js';

describe('Sprint P2-09 Interaction Runtime Test Suite', () => {
  let runtime: InteractionRuntimeService;

  beforeEach(() => {
    runtime = new InteractionRuntimeService();
  });

  it('should dispatch events across all 9 interaction domains cleanly', () => {
    const domains = [
      'Keyboard',
      'Mouse',
      'Touch',
      'Gesture',
      'Drag',
      'Clipboard',
      'Focus',
      'ContextMenu',
      'Selection',
    ] as const;

    domains.forEach((dom) => {
      const handlerSpy = vi.fn();
      runtime.contributeHandler({
        id: `handler_${dom}`,
        domain: dom,
        handle: handlerSpy,
      });

      runtime.emitEvent(dom, { testPayload: true });
      expect(handlerSpy).toHaveBeenCalled();
    });
  });

  it('should respect handler priority order and support event interception', () => {
    const lowPrioritySpy = vi.fn();
    const highPrioritySpy = vi.fn().mockReturnValue(true); // Consumes event

    runtime.contributeHandler({
      id: 'handler_low',
      domain: 'Keyboard',
      priority: 10,
      handle: lowPrioritySpy,
    });

    runtime.contributeHandler({
      id: 'handler_high',
      domain: 'Keyboard',
      priority: 100,
      handle: highPrioritySpy,
    });

    const intercepted = runtime.dispatchKeyboard('Enter', 'Cmd+Enter');
    expect(intercepted).toBe(true);
    expect(highPrioritySpy).toHaveBeenCalled();
    expect(lowPrioritySpy).not.toHaveBeenCalled();
  });

  it('should support plugin interaction contributions and handler unregistration', () => {
    const pluginHandlerSpy = vi.fn();
    const pluginHandler: InteractionHandler = {
      id: 'handler_plugin_gesture',
      domain: 'Gesture',
      handle: pluginHandlerSpy,
    };

    runtime.contributeHandler(pluginHandler);
    runtime.dispatchGesture('pinch', 1.5);
    expect(pluginHandlerSpy).toHaveBeenCalledTimes(1);

    runtime.removeHandler('handler_plugin_gesture');
    runtime.dispatchGesture('pinch', 2.0);
    expect(pluginHandlerSpy).toHaveBeenCalledTimes(1);
  });

  it('should track Focus and Selection state accurately', () => {
    expect(runtime.getFocusedTargetId()).toBeNull();
    runtime.setFocus('element_canvas_1');
    expect(runtime.getFocusedTargetId()).toBe('element_canvas_1');

    expect(runtime.getSelection().length).toBe(0);
    runtime.setSelection(['shape_1', 'shape_2']);
    expect(runtime.getSelection()).toEqual(['shape_1', 'shape_2']);
  });
});
