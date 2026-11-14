import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import helmet from 'helmet';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { buildHostHelmetOptions } from '../security/host-helmet.js';

describe('LAN HTTP vs HTTPS Helmet CSP behavior (#494)', () => {
  const servers: Server[] = [];

  async function startApp(options: ReturnType<typeof buildHostHelmetOptions>): Promise<string> {
    const app = express();
    app.use(helmet(options));
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><html><body>ok</body></html>'));
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  });

  it('omits upgrade-insecure-requests and Strict-Transport-Security in default HTTP LAN production mode', async () => {
    const url = await startApp(buildHostHelmetOptions({ NODE_ENV: 'production' }, true));
    const res = await fetch(`${url}/`);
    const csp = res.headers.get('content-security-policy') || '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' blob:");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('emits upgrade-insecure-requests and HSTS when ENABLE_HSTS=true or production FORCE_HTTPS=true', async () => {
    const urlHsts = await startApp(buildHostHelmetOptions({ NODE_ENV: 'production', ENABLE_HSTS: 'true' }, true));
    const resHsts = await fetch(`${urlHsts}/`);
    expect(resHsts.headers.get('content-security-policy') || '').toContain('upgrade-insecure-requests');
    expect(resHsts.headers.get('strict-transport-security')).toContain('max-age=31536000');

    const urlForce = await startApp(buildHostHelmetOptions({ NODE_ENV: 'production', FORCE_HTTPS: 'true' }, true));
    const resForce = await fetch(`${urlForce}/`);
    expect(resForce.headers.get('content-security-policy') || '').toContain('upgrade-insecure-requests');
    expect(resForce.headers.get('strict-transport-security')).toContain('max-age=31536000');
  });
});
