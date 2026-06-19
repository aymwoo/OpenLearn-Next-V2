import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { PluginHostProvider } from './plugin-host/plugin-host-context';
import { FrontendPluginHost } from './plugin-host/plugin-host';
import { MfeConfigProvider } from './mfe/MfeConfigProvider';
import { init } from '@module-federation/runtime';
import './index.css';

const pluginHost = new FrontendPluginHost();

// Initialize Module Federation runtime once at app startup (D-25).
// Wrapped in try/catch because @module-federation/vite plugin may already
// have initialized the runtime internally — double init causes duplicate
// shared scope registrations.
try {
  init({
    name: 'host_shell',
    remotes: [],
    shared: {
      react: { singleton: true },
      'react-dom': { singleton: true },
      zustand: { singleton: true },
    },
  });
} catch {
  console.warn('[MF] Runtime already initialized by Vite plugin, skipping explicit init()');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MfeConfigProvider>
      <PluginHostProvider host={pluginHost}>
        <App />
      </PluginHostProvider>
    </MfeConfigProvider>
  </StrictMode>,
);
