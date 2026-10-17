import { describe, it, expect, vi } from 'vitest';
import { handleNetProxy, type NetProxyRequest } from '../plugin-net-proxy.js';
import { normalizeNetHost } from '../../plugin-host/plugin-grants.js';
import { cleanupStaleBootstrapFiles, writeBootstrapTempFile } from '../child-spawn.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

    it('即使 approvedHosts 被塞入私有 IP、环回地址或 IPv6 本地地址也必须强制阻断', async () => {
      for (const badUrl of [
        'http://127.0.0.1:8080/internal',
        'http://192.168.1.1/admin',
        'http://169.254.169.254/latest/meta-data/',
        'http://[::1]:9000/health',
        'http://2130706433/secret',
      ]) {
        let sentMsg: any = null;
        const fakeChild = {
          send: vi.fn((m) => {
            sentMsg = m;
          }),
        };
        const host = new URL(badUrl).hostname.toLowerCase();
        await handleNetProxy(fakeChild as any, { type: 'ol-net-proxy', id: 'ssrf-1', url: badUrl }, new Set([host]));
        expect(sentMsg?.ok).toBe(false);
        expect(sentMsg?.error).toContain('blocked');
      }
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
    it('文件名带上属主 pid，供并发进程互相识别', () => {
      const file = writeBootstrapTempFile('console.log("test");');
      expect(path.basename(file)).toMatch(new RegExp(`^ol-bootstrap-${process.pid}-[0-9a-f]+\\.mjs$`));
      fs.rmSync(file, { force: true });
    });

    it('⚠️ 属主仍存活的 bootstrap 文件不会被当成残留删除（CI 随机挂的根因防盗门）', () => {
      // 回归测试：临时目录是全局共享的，vitest fileParallelism 下另一个 worker
      // 在模块加载时会跑一次孤儿清理。如果「见到就删」，对方刚写好、子进程还没 exec
      // 的文件就会被删 → 子进程 MODULE_NOT_FOUND → 激活失败。
      const liveFile = writeBootstrapTempFile('console.log("live");');
      expect(fs.existsSync(liveFile), '前置条件：文件应已落盘').toBe(true);

      cleanupStaleBootstrapFiles();

      expect(fs.existsSync(liveFile), '属主（本进程）还没退出，这不是残留文件').toBe(true);
      fs.rmSync(liveFile, { force: true });
    });

    it('cleanupStaleBootstrapFiles 清除属主已退出的遗留文件', () => {
      // 900001 是一个不可能存在的 pid（Linux pid_max 默认 4194304，但该进程不存在），
      // 用它构造「属主已死」的孤儿文件。
      const orphan = path.join(os.tmpdir(), `ol-bootstrap-900001-${Date.now().toString(16)}.mjs`);
      fs.writeFileSync(orphan, 'console.log("orphan");', { mode: 0o600 });

      const cleaned = cleanupStaleBootstrapFiles();
      expect(cleaned).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(orphan), '属主已退出的文件应被清除').toBe(false);
    });

    it('旧格式（无属主 pid）只清明显过期的，不误删并发的在用文件', () => {
      const legacyFresh = path.join(os.tmpdir(), `ol-bootstrap-${Date.now().toString(16)}.mjs`);
      fs.writeFileSync(legacyFresh, 'console.log("legacy");', { mode: 0o600 });

      cleanupStaleBootstrapFiles();
      expect(fs.existsSync(legacyFresh), '刚写入的旧格式文件无从判断属主，不该删').toBe(true);

      // 把「现在」拨快 2 小时，同一文件就该被认为过期
      cleanupStaleBootstrapFiles(Date.now() + 2 * 60 * 60 * 1000);
      expect(fs.existsSync(legacyFresh), '超过 1 小时才视为残留').toBe(false);
    });
  });
});
