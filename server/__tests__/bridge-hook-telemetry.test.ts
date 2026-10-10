import { describe, it, expect } from 'vitest';
import { BRIDGE_SDK_CODE } from '../utils/bridge-sdk.js';
import { injectLmsSdk } from '../routes/shared.js';

describe('bridge HOOK telemetry kill-switch', () => {
  it('全部 5 处 HOOK 上报均受 __hookAllowed() 门控', () => {
    expect(BRIDGE_SDK_CODE).toContain('function __hookAllowed()');
    const hookSites = [...BRIDGE_SDK_CODE.matchAll(/type: "HOOK_[A-Z]+"/g)];
    expect(hookSites.length).toBe(5);
    for (const m of hookSites) {
      const before = BRIDGE_SDK_CODE.slice(Math.max(0, (m.index ?? 0) - 140), m.index ?? 0);
      expect(before).toContain('if (__hookAllowed())');
    }
  });

  it('注入默认开启，BRIDGE_HOOK_TELEMETRY=off 时关闭', () => {
    const req: any = { headers: {} };
    const cw = { id: 'cw-hook-test', name: 'hook', uuid: 'hook-uuid' };
    const htmlOn = injectLmsSdk('<html><head></head><body></body></html>', req, cw);
    expect(htmlOn).toContain('window.__LMS_HOOK_TELEMETRY__ = true');

    const prev = process.env.BRIDGE_HOOK_TELEMETRY;
    process.env.BRIDGE_HOOK_TELEMETRY = 'off';
    try {
      const htmlOff = injectLmsSdk('<html><head></head><body></body></html>', req, cw);
      expect(htmlOff).toContain('window.__LMS_HOOK_TELEMETRY__ = false');
    } finally {
      if (prev === undefined) delete process.env.BRIDGE_HOOK_TELEMETRY;
      else process.env.BRIDGE_HOOK_TELEMETRY = prev;
    }
  });
});
