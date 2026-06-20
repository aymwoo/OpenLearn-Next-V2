import React from 'react';
import { createRoot } from 'react-dom/client';
import type { MfeContext } from '../../../src/mfe/types';
import { InteractiveWhiteboard } from './components/InteractiveWhiteboard';
import './index.css';

// ── Component ────────────────────────────────────────────────────

export default function App(props: any & { mfeContext?: MfeContext }) {
  return (
    <div className="mfe-whiteboard-root">
      <InteractiveWhiteboard {...props} />
    </div>
  );
}

// ── Lifecycle Factory ────────────────────────────────────────────

export function createMfeApp(ctx: MfeContext) {
  console.log('[mfe-whiteboard] Initialized with context:', ctx);

  let instance: Awaited<ReturnType<typeof mount>> | null = null;

  const mount = async (container: HTMLElement, props?: Record<string, any>) => {
    const root = createRoot(container);
    root.render(<App {...props} mfeContext={ctx} />);
    instance = {
      unmount: async () => { root.unmount(); },
      update: async (newProps: Record<string, any>) => { root.render(<App {...newProps} mfeContext={ctx} />); },
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
    styles: ['/src/index.css'],
  };
}
