import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { PluginHostProvider } from './plugin-host/plugin-host-context';
import { FrontendPluginHost } from './plugin-host/plugin-host';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as Recharts from 'recharts';
import * as LucideReact from 'lucide-react';
import * as JsxRuntime from 'react/jsx-runtime';
import './index.css';

(window as any).React = React;
(window as any).ReactDOM = ReactDOM;
(window as any).HostSharedDeps = {
  React,
  ReactDOM,
  ReactDOMClient,
  Recharts,
  LucideReact,
  jsxRuntime: JsxRuntime,
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': JsxRuntime,
  recharts: Recharts,
  'lucide-react': LucideReact,
};

import { GlobalErrorBoundary } from './components/common/GlobalErrorBoundary';

const pluginHost = new FrontendPluginHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <PluginHostProvider host={pluginHost}>
        <App />
      </PluginHostProvider>
    </GlobalErrorBoundary>
  </StrictMode>,
);
