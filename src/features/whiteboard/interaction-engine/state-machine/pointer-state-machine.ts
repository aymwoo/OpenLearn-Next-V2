import type { PointerState } from '../types.js';

export class PointerStateMachine {
  private state: PointerState = 'Idle';
  private listeners: Array<(state: PointerState, previousState: PointerState) => void> = [];

  /**
   * Get current pointer state
   */
  public getState(): PointerState {
    return this.state;
  }

  /**
   * Transition to a new pointer state
   */
  public transitionTo(nextState: PointerState): void {
    if (this.state === nextState) return;

    const previous = this.state;
    this.state = nextState;

    this.listeners.forEach((fn) => {
      try {
        fn(nextState, previous);
      } catch (err) {
        console.error('[PointerStateMachine] Error in state listener:', err);
      }
    });
  }

  /**
   * Subscribe to pointer state changes
   */
  public onChange(listener: (state: PointerState, previousState: PointerState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Reset state back to Idle
   */
  public reset(): void {
    this.transitionTo('Idle');
  }
}

export const pointerStateMachine = new PointerStateMachine();
