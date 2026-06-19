import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { PluginHostProvider } from './plugin-host/plugin-host-context';
import { FrontendPluginHost } from './plugin-host/plugin-host';
import './index.css';

const pluginHost = new FrontendPluginHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PluginHostProvider host={pluginHost}>
      <App />
    </PluginHostProvider>
  </StrictMode>,
);
