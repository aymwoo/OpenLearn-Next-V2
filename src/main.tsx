import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { PluginHostProvider } from './plugin-host/plugin-host-context';
import { FrontendPluginHost } from './plugin-host/plugin-host';
import { MfeConfigProvider } from './mfe/MfeConfigProvider';
import { init, getInstance } from '@module-federation/runtime';
import './index.css';

const pluginHost = new FrontendPluginHost();

// Initialize Module Federation runtime only if not already initialized by the plugin (D-25).
if (!getInstance()) {
  try {
    init({
      name: 'host_shell',
      remotes: [],
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        zustand: { singleton: true },
        konva: { singleton: true },
        'react-konva': { singleton: true },
        'react-konva-utils': { singleton: true },
      },
    });
  } catch (e) {
    console.error('[MF] Failed to initialize Module Federation runtime fallback:', e);
  }
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
