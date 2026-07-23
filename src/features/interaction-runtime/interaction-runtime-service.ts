/**
 * OpenLearn Interaction Runtime - Runtime Service Facade (Sprint P2-09)
 * Central interaction orchestrator for Keyboard, Mouse, Touch, Gesture, Drag, Clipboard, Focus, ContextMenu & Selection.
 */

import { InteractionDomain, InteractionHandler, InteractionEvent } from './interaction-types.js';
import { InteractionRegistry } from './interaction-registry.js';

export class InteractionRuntimeService {
  private registry: InteractionRegistry;
  private currentFocusTargetId: string | null = null;
  private currentSelectionIds: string[] = [];

  constructor(registry?: InteractionRegistry) {
    this.registry = registry ?? new InteractionRegistry();
  }

  public getRegistry(): InteractionRegistry {
    return this.registry;
  }

  // Plugin Interaction Contribution API
  public contributeHandler(handler: InteractionHandler): void {
    this.registry.register(handler);
  }

  public removeHandler(handlerId: string): boolean {
    return this.registry.unregister(handlerId);
  }

  // Domain Dispatch Helpers
  public emitEvent<T = Record<string, unknown>>(
    domain: InteractionDomain,
    payload: T,
    targetId?: string
  ): boolean {
    const event: InteractionEvent<T> = {
      id: `evt_${domain.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      domain,
      targetId,
      payload,
      timestamp: Date.now(),
    };
    return this.registry.dispatch(event as unknown as InteractionEvent);
  }

  // 1. Keyboard Domain
  public dispatchKeyboard(key: string, shortcut?: string, targetId?: string): boolean {
    return this.emitEvent('Keyboard', { key, shortcut }, targetId);
  }

  // 2. Mouse Domain
  public dispatchMouse(type: 'click' | 'dblclick' | 'move' | 'down' | 'up', x: number, y: number, targetId?: string): boolean {
    return this.emitEvent('Mouse', { type, x, y }, targetId);
  }

  // 3. Touch Domain
  public dispatchTouch(type: 'start' | 'move' | 'end', touches: Array<{ x: number; y: number }>, targetId?: string): boolean {
    return this.emitEvent('Touch', { type, touches }, targetId);
  }

  // 4. Gesture Domain
  public dispatchGesture(type: 'pinch' | 'rotate' | 'swipe', scale?: number, rotation?: number, targetId?: string): boolean {
    return this.emitEvent('Gesture', { type, scale, rotation }, targetId);
  }

  // 5. Drag Domain
  public dispatchDrag(phase: 'start' | 'drag' | 'drop' | 'cancel', deltaX: number, deltaY: number, targetId?: string): boolean {
    return this.emitEvent('Drag', { phase, deltaX, deltaY }, targetId);
  }

  // 6. Clipboard Domain
  public dispatchClipboard(action: 'copy' | 'cut' | 'paste', content?: string, targetId?: string): boolean {
    return this.emitEvent('Clipboard', { action, content }, targetId);
  }

  // 7. Focus Domain
  public setFocus(targetId: string | null): boolean {
    this.currentFocusTargetId = targetId;
    return this.emitEvent('Focus', { focused: targetId !== null, targetId }, targetId ?? undefined);
  }

  public getFocusedTargetId(): string | null {
    return this.currentFocusTargetId;
  }

  // 8. ContextMenu Domain
  public openContextMenu(x: number, y: number, menuItems?: Array<{ id: string; label: string }>, targetId?: string): boolean {
    return this.emitEvent('ContextMenu', { x, y, menuItems }, targetId);
  }

  // 9. Selection Domain
  public setSelection(selectionIds: string[], targetId?: string): boolean {
    this.currentSelectionIds = [...selectionIds];
    return this.emitEvent('Selection', { selectionIds: this.currentSelectionIds }, targetId);
  }

  public getSelection(): ReadonlyArray<string> {
    return Object.freeze([...this.currentSelectionIds]);
  }
}
