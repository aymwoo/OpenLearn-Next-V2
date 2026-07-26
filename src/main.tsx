import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { PluginHostProvider } from './plugin-host/plugin-host-context';
import { FrontendPluginHost } from './plugin-host/plugin-host';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as Recharts from 'recharts';
import * as LucideReact from 'lucide-react';
import './index.css';

(window as any).React = React;
(window as any).ReactDOM = ReactDOM;
(window as any).HostSharedDeps = {
  React,
  ReactDOM,
  Recharts,
  LucideReact,
};

const pluginHost = new FrontendPluginHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PluginHostProvider host={pluginHost}>
      <App />
    </PluginHostProvider>
  </StrictMode>,
);
