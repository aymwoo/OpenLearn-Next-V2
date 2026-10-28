import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_VIEW_CHANNEL, PLUGIN_VIEW_CSP, PLUGIN_VIEW_BRIDGE_JS } from '../plugin-view-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_TS = path.resolve(__dirname, '../../../server.ts');

describe('Plugin View Bridge', () => {
  it('defines correct channel and sandboxed CSP', () => {
    expect(PLUGIN_VIEW_CHANNEL).toBe('ol-plugin-view');
    expect(PLUGIN_VIEW_CSP).toContain('sandbox allow-scripts allow-forms allow-downloads');
    expect(PLUGIN_VIEW_CSP).toContain("frame-ancestors 'self'");
    expect(PLUGIN_VIEW_CSP).not.toContain('allow-same-origin');
  });

  it('bridge script exposes standard OpenLearnPluginBridge methods', () => {
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('window.OpenLearnPluginBridge');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('onInit:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('onContextUpdate:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('getContext:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('invokeCommand:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('ui:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('toast:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('resize:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('api:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain('storage:');
    expect(PLUGIN_VIEW_BRIDGE_JS).toContain("post({ type: 'ready' })");
  });

  it('server.ts mounts /plugin-sandbox/view-bridge.js and enhances /plugins authentication', () => {
    const serverSrc = fs.readFileSync(SERVER_TS, 'utf-8');
    expect(serverSrc).toContain("app.get('/plugin-sandbox/view-bridge.js'");
    expect(serverSrc).toContain('PLUGIN_VIEW_BRIDGE_JS');
    expect(serverSrc).toContain('PLUGIN_VIEW_CSP');
    expect(serverSrc).toContain('req.query.token');
    expect(serverSrc).toContain('sec-fetch-dest');
  });
});
