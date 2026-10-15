import { describe, it, expect, vi } from 'vitest';
import { handleNetProxy, type NetProxyRequest } from '../plugin-net-proxy.js';
import { normalizeNetHost } from '../../plugin-host/plugin-grants.js';
import { cleanupStaleBootstrapFiles, writeBootstrapTempFile } from '../child-spawn.js';
import fs from 'node:fs';

describe('Plugin Network Hardening & Proxy Security', () => {
  describe('normalizeNetHost IP & domain restrictions', () => {
    it('放行合法公网域名', () => {
      expect(normalizeNetHost('api.openai.com')).toBe('api.openai.com');
      expect(normalizeNetHost('dashscope.aliyuncs.com')).toBe('dashscope.aliyuncs.com');
      expect(normalizeNetHost('example.org')).toBe('example.org');
    });

    it('严格阻断私有网段与本地环回地址', () => {
      // 127.0.0.0/8
      expect(normalizeNetHost('127.0.0.1')).toBeNull();
      expect(normalizeNetHost('127.1.2.3')).toBeNull();
      // 10.0.0.0/8
      expect(normalizeNetHost('10.0.0.1')).toBeNull();
      expect(normalizeNetHost('10.254.254.1')).toBeNull();
      // 172.16.0.0/12
      expect(normalizeNetHost('172.16.0.1')).toBeNull();
      expect(normalizeNetHost('172.31.255.255')).toBeNull();
      // 192.168.0.0/16
      expect(normalizeNetHost('192.168.1.1')).toBeNull();
      // 0.0.0.0
      expect(normalizeNetHost('0.0.0.0')).toBeNull();
      // localhost
      expect(normalizeNetHost('localhost')).toBeNull();
      expect(normalizeNetHost('foo.localhost')).toBeNull();
    });

    it('严格阻断云厂商元数据地址与链路本地地址 169.254.0.0/16', () => {
      expect(normalizeNetHost('169.254.169.254')).toBeNull();
      expect(normalizeNetHost('169.254.1.1')).toBeNull();
    });

    it('阻断畸形格式与通配符', () => {
      expect(normalizeNetHost('*.example.com')).toBeNull();
      expect(normalizeNetHost('example.com/path')).toBeNull();
      expect(normalizeNetHost('example.com:8080')).toBeNull();
      expect(normalizeNetHost('   ')).toBeNull();
    });
  });

  describe('handleNetProxy 宿主网络代发安全', () => {
    it('拒绝未获批的域名', async () => {
      let sentMsg: any = null;
      const fakeChild = {
        send: vi.fn((m) => {
          sentMsg = m;
        }),
      };
      const req: NetProxyRequest = {
        type: 'ol-net-proxy',
        id: 'req-1',
        url: 'https://evil.com/data',
      };
      await handleNetProxy(fakeChild as any, req, new Set(['api.openai.com']));
      expect(sentMsg).toBeDefined();
      expect(sentMsg.ok).toBe(false);
      expect(sentMsg.error).toContain('not approved');
    });

    it('放行 Authorization 头以支持 Bearer Token', async () => {
      let sentMsg: any = null;
      const fakeChild = {
        send: vi.fn((m) => {
          sentMsg = m;
        }),
      };
      const originalFetch = globalThis.fetch;
      let capturedHeaders: any = null;
      globalThis.fetch = vi.fn(async (target, init) => {
        capturedHeaders = init?.headers;
        return {
          status: 200,
          headers: new Map([['content-type', 'application/json']]),
          body: null,
        } as any;
      });

      try {
        const req: NetProxyRequest = {
          type: 'ol-net-proxy',
          id: 'req-2',
          url: 'https://api.openai.com/v1/chat/completions',
          headers: {
            Authorization: 'Bearer sk-fake-key-123',
            'Content-Type': 'application/json',
            Cookie: 'secret-session=123', // Cookie 应被剥离
          },
        };
        await handleNetProxy(fakeChild as any, req, new Set(['api.openai.com']));
        expect(sentMsg).toBeDefined();
        expect(sentMsg.ok).toBe(true);
        expect(capturedHeaders['authorization']).toBe('Bearer sk-fake-key-123');
        expect(capturedHeaders['cookie']).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('超大请求体直接被拒绝，防止内存耗尽', async () => {
      let sentMsg: any = null;
      const fakeChild = {
        send: vi.fn((m) => {
          sentMsg = m;
        }),
      };
      const req: NetProxyRequest = {
        type: 'ol-net-proxy',
        id: 'req-3',
        url: 'https://api.openai.com/v1/upload',
        // 超过 14MB base64
        bodyBase64: 'A'.repeat(15 * 1024 * 1024),
      };
      await handleNetProxy(fakeChild as any, req, new Set(['api.openai.com']));
      expect(sentMsg).toBeDefined();
      expect(sentMsg.ok).toBe(false);
      expect(sentMsg.error).toContain('exceeded maximum size limit');
    });
  });

  describe('child-spawn 临时 bootstrap 文件生命周期', () => {
    it('cleanupStaleBootstrapFiles 扫描并清除遗留的 ol-bootstrap 文件', () => {
      const createdFile = writeBootstrapTempFile('console.log("test");');
      expect(fs.existsSync(createdFile)).toBe(true);

      const cleaned = cleanupStaleBootstrapFiles();
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(createdFile)).toBe(false);
    });
  });
});
