/**
 * UIService — Toast/Modal management for frontend plugins.
 *
 * RESEARCH.md anti-pattern #4: Keep toast state local in App.tsx.
 * This service wraps the existing addToast callback rather than
 * replicating toast state in zustand.
 *
 * showModal/closeModal manage an internal modalState for future
 * integration with App.tsx's modal rendering.
 */

import type React from 'react';
import type { IUIService } from '../plugin-host/types';

export interface ModalState {
  visible: boolean;
  title: string;
  content: React.ReactNode;
}

export class UIService implements IUIService {
  private addToastFn: ((title: string, message: string, type: 'info' | 'success' | 'warning') => void) | null;
  private modalState: ModalState | null = null;

  constructor(
    addToast?: (title: string, message: string, type: 'info' | 'success' | 'warning') => void,
  ) {
    this.addToastFn = addToast ?? null;
  }

  showToast(title: string, message: string, type: 'info' | 'success' | 'warning' = 'info'): void {
    if (this.addToastFn) {
      this.addToastFn(title, message, type);
    } else {
      console.warn('[UIService] No addToast callback registered — toast not shown:', title, message);
    }
  }

  showModal(title: string, content: React.ReactNode): void {
    this.modalState = { visible: true, title, content };
  }

  closeModal(): void {
    this.modalState = null;
  }

  /** Get the current modal state (for App.tsx to read and render). */
  getModalState(): ModalState | null {
    return this.modalState;
  }
}
