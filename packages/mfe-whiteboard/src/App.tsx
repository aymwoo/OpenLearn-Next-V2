import React from 'react';
import { createRoot } from 'react-dom/client';
import type { MfeContext } from '../../../src/mfe/types';

// ── Component ────────────────────────────────────────────────────

export default function App() {
  return <div>Whiteboard MFE</div>;
}

// ── Lifecycle Factory ────────────────────────────────────────────

export function createMfeApp(ctx: MfeContext) {
  console.log('[mfe-whiteboard] Initialized with context:', ctx);

  return {
    mount: async (container: HTMLElement, props?: Record<string, any>) => {
      const root = createRoot(container);
      root.render(<App {...props} />);

      return {
        unmount: async () => {
          root.unmount();
        },
        update: async (newProps: Record<string, any>) => {
          root.render(<App {...newProps} />);
        },
      };
    },
    styles: [] as string[],
  };
}
