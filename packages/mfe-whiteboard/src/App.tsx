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

  let instance: Awaited<ReturnType<typeof mount>> | null = null;

  const mount = async (container: HTMLElement, props?: Record<string, any>) => {
    const root = createRoot(container);
    root.render(<App {...props} />);
    instance = {
      unmount: async () => { root.unmount(); },
      update: async (newProps: Record<string, any>) => { root.render(<App {...newProps} />); },
    };
    return instance;
  };

  return {
    mount,
    unmount: async () => {
      if (instance) {
        await instance.unmount();
        instance = null;
      }
    },
    update: async (props: Record<string, any>) => {
      await instance?.update(props);
    },
    styles: [] as string[],
  };
}
