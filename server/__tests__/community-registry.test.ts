import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import {
  COMMUNITY_REGISTRY_ENV,
  __resetCommunityRegistryCache,
  annotateInstallState,
  downloadPluginPackage,
  fetchCommunityRegistry,
  isValidPluginId,
  normalizeCommunityEntry,
  normalizeCommunityRegistry,
  resolveCommunityRegistryUrl,
  type CommunityPluginEntry,
  type FetchLike,
} from '../services/community-registry.js';
import {
  isSafeExternalUrl,
  assertSafeResolvedAddresses,
  fetchWithSafeRedirects,
  UrlSafetyError,
} from '../utils/url-safety.js';

// ── Fixtures & helpers ──────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status < 400,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  } as unknown as Response;
}

function binaryResponse(bytes: number, headers: Record<string, string> = {}): Response {
  const buf = Buffer.alloc(bytes, 7);
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  } as unknown as Response;
}

function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ext-homework-hub',
    name: '作业中心',
    description: '面向课堂的作业收发与批改面板',
    author: 'aymwoo',
    version: '1.2.0',
    downloadUrl: 'https://plugins.example.com/ext-homework-hub/1.2.0.zip',
    ...overrides,
  };
}

const REGISTRY_URL = 'https://registry.example.com/community-plugins.json';

describe('isSafeExternalUrl', () => {
  it('accepts plain public HTTPS and HTTP URLs', () => {
    expect(isSafeExternalUrl('https://plugins.example.com/a.zip').safe).toBe(true);
    expect(isSafeExternalUrl('http://plugins.example.com/a.zip').safe).toBe(true);
  });

  it.each([
    ['file:///etc/passwd', 'non-HTTP protocol'],
    ['ftp://plugins.example.com/a.zip', 'FTP protocol'],
    ['http://localhost/a.zip', 'localhost'],
    ['http://127.0.0.1/a.zip', 'IPv4 loopback'],
    ['http://10.1.2.3/a.zip', 'IPv4 private 10/8'],
    ['http://172.16.0.9/a.zip', 'IPv4 private 172.16/12'],
    ['http://192.168.1.5/a.zip', 'IPv4 private 192.168/16'],
    ['http://169.254.1.1/a.zip', 'link-local'],
    ['http://224.0.0.1/a.zip', 'multicast'],
    ['http://[::1]/a.zip', 'IPv6 loopback'],
    // SEC-LOW-02: IPv6 私网/保留段字面量
    ['http://[::ffff:127.0.0.1]/a.zip', 'IPv4-mapped IPv6 loopback'],
    ['http://[::ffff:10.0.0.1]/a.zip', 'IPv4-mapped IPv6 private'],
    ['http://[fd00::1]/a.zip', 'IPv6 ULA fc00::/7'],
    ['http://[fe80::1]/a.zip', 'IPv6 link-local'],
    ['http://[ff02::1]/a.zip', 'IPv6 multicast'],
    ['http://[::]/a.zip', 'IPv6 unspecified'],
    // SEC-LOW-02: IP 编码绕过（十进制整数 / 十六进制 / 八进制）
    ['http://2130706433/a.zip', 'decimal integer loopback'],
    ['http://0x7f000001/a.zip', 'hex integer loopback'],
    ['http://0x7f.0.0.1/a.zip', 'hex octet loopback'],
    ['http://0177.0.0.1/a.zip', 'octal octet loopback'],
    // 超出 32 位的十进制主机名：WHATWG URL 解析器识别为 IPv4 但校验失败，
    // new URL 直接抛错 → 走 Invalid URL format 拒绝
    ['http://12345678901/a.zip', 'out-of-range decimal (URL parser throws)'],
    ['http://999.1.1.1/a.zip', 'invalid octet (URL parser throws)'],
  ])('rejects %s (%s)', (url) => {
    const result = isSafeExternalUrl(url);
    expect(result.safe).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it.each([
    ['https://abc123.com/a.zip', 'domain containing digits'],
    ['https://1x.dev/a.zip', 'short domain starting with digit'],
    ['http://8.8.8.8/a.zip', 'public IPv4'],
    ['http://[2001:db8::1]/a.zip', 'public IPv6 (documentation range)'],
  ])('accepts %s (%s)', (url) => {
    expect(isSafeExternalUrl(url).safe).toBe(true);
  });

  it('reports invalid URL syntax instead of throwing', () => {
    const result = isSafeExternalUrl('not a url');
    expect(result.safe).toBe(false);
    expect(result.reason).toMatch(/Invalid URL format/);
  });
});

describe('normalizeCommunityEntry', () => {
  it('normalizes a complete entry', () => {
    const entry = normalizeCommunityEntry(
      validRaw({
        icon: '📚',
        homepage: 'https://example.com/home',
        repository: 'https://github.com/aymwoo/ext-homework-hub',
        tags: ['作业', '评价'],
        capabilities: ['student:read'],
        downloads: '1234',
        stars: 45,
        verified: true,
        featured: 'true',
        publishedAt: '2026-01-02T03:04:05Z',
      }),
    );

    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      id: 'ext-homework-hub',
      name: '作业中心',
      version: '1.2.0',
      author: 'aymwoo',
      tags: ['作业', '评价'],
      capabilities: ['student:read'],
      downloads: 1234,
      stars: 45,
      verified: true,
      featured: true,
      installedVersion: null,
      hasUpdate: false,
    });
  });

  it.each([
    ['null', null],
    ['a string', 'ext-homework-hub'],
    ['an entry without id', validRaw({ id: undefined })],
    ['an id with illegal characters', validRaw({ id: 'ext home; rm -rf /' })],
    ['an entry without downloadUrl', validRaw({ downloadUrl: undefined })],
    ['an empty downloadUrl', validRaw({ downloadUrl: '   ' })],
    ['a loopback downloadUrl', validRaw({ downloadUrl: 'http://127.0.0.1/evil.zip' })],
    ['a file:// downloadUrl', validRaw({ downloadUrl: 'file:///etc/passwd' })],
  ])('discards %s', (_label, raw) => {
    expect(normalizeCommunityEntry(raw)).toBeNull();
  });

  it('drops unsafe homepage/repository but keeps the entry itself', () => {
    const entry = normalizeCommunityEntry(
      validRaw({ homepage: 'http://192.168.0.10/admin', repository: 'file:///tmp/repo' }),
    );
    expect(entry).not.toBeNull();
    expect(entry?.homepage).toBeNull();
    expect(entry?.repository).toBeNull();
  });

  it('falls back to the id for a missing name and to Community for a missing author', () => {
    const entry = normalizeCommunityEntry(validRaw({ name: undefined, author: undefined }));
    expect(entry?.name).toBe('ext-homework-hub');
    expect(entry?.author).toBe('Community');
    expect(normalizeCommunityEntry(validRaw({ description: undefined }))?.description).toBe('');
  });

  it('keeps an unparsable version verbatim but never treats it as semver', () => {
    expect(normalizeCommunityEntry(validRaw({ version: '2026.02-beta' }))?.version).toBe('2026.02-beta');
    expect(normalizeCommunityEntry(validRaw({ version: 'not-a-version' }))?.version).toBe('not-a-version');
  });

  it('caps tag and capability list sizes', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `tag-${i}`);
    const entry = normalizeCommunityEntry(validRaw({ tags }));
    expect(entry?.tags).toHaveLength(8);
    expect(entry?.tags[0]).toBe('tag-0');
  });

  it('accepts comma separated tags and snake_case aliases', () => {
    const entry = normalizeCommunityEntry(
      validRaw({ tags: 'a, b ,a', download_url: validRaw().downloadUrl, downloadUrl: undefined }),
    );
    expect(entry?.tags).toEqual(['a', 'b']);
  });
});

describe('normalizeCommunityRegistry', () => {
  it('accepts the v1 envelope and reports the schema version', () => {
    const result = normalizeCommunityRegistry({ version: 1, plugins: [validRaw()] });
    expect(result.registryVersion).toBe(1);
    expect(result.plugins).toHaveLength(1);
    expect(result.skipped).toBe(0);
  });

  it('accepts a bare array and an items alias', () => {
    expect(normalizeCommunityRegistry([validRaw()]).plugins).toHaveLength(1);
    expect(normalizeCommunityRegistry({ items: [validRaw()] }).plugins).toHaveLength(1);
  });

  it.each([
    ['null', null],
    ['a string body', 'oops'],
    ['an object without a list', { version: 1 }],
    ['a list of scalars', [1, 'two', null]],
  ])('returns an empty result for %s', (_label, raw) => {
    expect(normalizeCommunityRegistry(raw).plugins).toEqual([]);
  });

  it('counts skipped entries so the UI can report partial data', () => {
    const result = normalizeCommunityRegistry({
      plugins: [validRaw(), validRaw({ id: 'bad id' }), { id: 'no-url' }, validRaw({ id: 'ext-second' })],
    });
    expect(result.plugins.map((p) => p.id)).toEqual(expect.arrayContaining(['ext-homework-hub', 'ext-second']));
    expect(result.plugins).toHaveLength(2);
    expect(result.skipped).toBe(2);
  });

  it('keeps only the first record when the registry repeats an id', () => {
    const result = normalizeCommunityRegistry({
      plugins: [validRaw({ version: '1.0.0' }), validRaw({ version: '9.9.9' })],
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0].version).toBe('1.0.0');
    expect(result.skipped).toBe(1);
  });

  it('sorts featured first, then downloads, with unranked entries last', () => {
    const result = normalizeCommunityRegistry({
      plugins: [
        validRaw({ id: 'plain', name: 'Plain', downloads: 10 }),
        validRaw({ id: 'hot', name: 'Hot', downloads: 900 }),
        validRaw({ id: 'featured', name: 'Featured', downloads: 1, featured: true }),
        validRaw({ id: 'starred', name: 'Starred', stars: 500 }),
      ],
    });
    expect(result.plugins.map((p) => p.id)).toEqual(['featured', 'hot', 'plain', 'starred']);
  });
});

describe('annotateInstallState', () => {
  const entry = (version: string): CommunityPluginEntry => ({
    ...(normalizeCommunityEntry(validRaw({ version })) as CommunityPluginEntry),
  });

  it('marks an installed plugin with an available upgrade', () => {
    const [annotated] = annotateInstallState([entry('1.3.0')], new Map([['ext-homework-hub', '1.2.0']]));
    expect(annotated.installedVersion).toBe('1.2.0');
    expect(annotated.hasUpdate).toBe(true);
  });

  it.each([
    ['the same version', '1.2.0'],
    ['an older registry version', '1.1.0'],
  ])('does not flag %s as an update', (_label, registryVersion) => {
    const [annotated] = annotateInstallState([entry(registryVersion)], new Map([['ext-homework-hub', '1.2.0']]));
    expect(annotated.installedVersion).toBe('1.2.0');
    expect(annotated.hasUpdate).toBe(false);
  });

  it('treats a plugin absent from the local DB as not installed', () => {
    const [annotated] = annotateInstallState([entry('1.2.0')], new Map());
    expect(annotated.installedVersion).toBeNull();
    expect(annotated.hasUpdate).toBe(false);
  });

  it('ignores a garbage installed version instead of throwing', () => {
    const [annotated] = annotateInstallState([entry('1.2.0')], new Map([['ext-homework-hub', 'nightly']]));
    expect(annotated.installedVersion).toBe('nightly');
    expect(annotated.hasUpdate).toBe(false);
  });
});

describe('resolveCommunityRegistryUrl', () => {
  beforeEach(() => {
    delete process.env[COMMUNITY_REGISTRY_ENV];
  });
  afterEach(() => {
    delete process.env[COMMUNITY_REGISTRY_ENV];
  });

  it('returns null when the env var is unset', () => {
    expect(resolveCommunityRegistryUrl()).toBeNull();
    expect(resolveCommunityRegistryUrl('   ')).toBeNull();
  });

  it('reads a valid URL from the environment', () => {
    process.env[COMMUNITY_REGISTRY_ENV] = REGISTRY_URL;
    expect(resolveCommunityRegistryUrl()).toBe(REGISTRY_URL);
  });

  it('rejects an unsafe URL from the environment', () => {
    process.env[COMMUNITY_REGISTRY_ENV] = 'http://169.254.169.254/latest/meta-data';
    expect(resolveCommunityRegistryUrl()).toBeNull();
  });

  it('prefers an explicit url over the environment', () => {
    process.env[COMMUNITY_REGISTRY_ENV] = 'https://env.example.com/r.json';
    expect(resolveCommunityRegistryUrl(REGISTRY_URL)).toBe(REGISTRY_URL);
  });
});

describe('fetchCommunityRegistry', () => {
  beforeEach(() => {
    __resetCommunityRegistryCache();
    process.env[COMMUNITY_REGISTRY_ENV] = REGISTRY_URL;
  });
  afterEach(() => {
    __resetCommunityRegistryCache();
    delete process.env[COMMUNITY_REGISTRY_ENV];
  });

  it('reports configured=false without any network call when the URL is unset', async () => {
    delete process.env[COMMUNITY_REGISTRY_ENV];
    const fetchImpl = vi.fn<FetchLike>();
    const result = await fetchCommunityRegistry({ fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toMatchObject({ configured: false, plugins: [], source: null, fetchedAt: null });
  });

  it('fetches, normalizes and annotates installed plugins', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(jsonResponse({ version: 1, plugins: [validRaw(), validRaw({ id: 'ext-plain' })] }));

    const result = await fetchCommunityRegistry({
      installed: new Map([['ext-homework-hub', '1.0.0']]),
      fetchImpl,
      now: 1_000,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.configured).toBe(true);
    expect(result.cached).toBe(false);
    expect(result.fetchedAt).toBe(1_000);
    expect(result.plugins).toHaveLength(2);
    expect(result.plugins.find((p) => p.id === 'ext-homework-hub')).toMatchObject({
      installedVersion: '1.0.0',
      hasUpdate: true,
    });
    expect(result.plugins.find((p) => p.id === 'ext-plain')).toMatchObject({
      installedVersion: null,
      hasUpdate: false,
    });
  });

  it('serves a warm cache entry without refetching', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ plugins: [validRaw()] }));

    await fetchCommunityRegistry({ fetchImpl, now: 1_000 });
    const second = await fetchCommunityRegistry({ fetchImpl, now: 2_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
    expect(second.plugins).toHaveLength(1);
  });

  it('refetches when the cache entry has expired', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ plugins: [validRaw()] }));

    await fetchCommunityRegistry({ fetchImpl, now: 0 });
    const second = await fetchCommunityRegistry({ fetchImpl, now: 6 * 60 * 1000 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(second.cached).toBe(false);
  });

  it('bypasses a warm cache when forceRefresh is set', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ plugins: [validRaw()] }));

    await fetchCommunityRegistry({ fetchImpl, now: 1_000 });
    await fetchCommunityRegistry({ fetchImpl, now: 1_100, forceRefresh: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses a distinct cache slot per installed-plugin set', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ plugins: [validRaw()] }));

    await fetchCommunityRegistry({ fetchImpl, now: 1_000, installed: new Map() });
    await fetchCommunityRegistry({ fetchImpl, now: 1_000, installed: new Map([['ext-homework-hub', '1.0.0']]) });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns a retryable error instead of throwing on a non-OK response', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse('nope', 503));
    const result = await fetchCommunityRegistry({ fetchImpl });

    expect(result.plugins).toEqual([]);
    expect(result.error).toMatch(/HTTP 503/);
    expect(result.configured).toBe(true);
  });

  it('returns a retryable error on malformed JSON', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse('{ not json'));
    const result = await fetchCommunityRegistry({ fetchImpl });
    expect(result.error).toMatch(/拉取社区注册表失败/);
  });

  it('names a timeout explicitly', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const fetchImpl = vi.fn<FetchLike>().mockRejectedValue(timeout);
    const result = await fetchCommunityRegistry({ fetchImpl });
    expect(result.error).toBe('拉取社区注册表超时');
  });

  it('does not cache failures', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse('down', 500))
      .mockResolvedValueOnce(jsonResponse({ plugins: [validRaw()] }));

    const first = await fetchCommunityRegistry({ fetchImpl, now: 1_000 });
    const second = await fetchCommunityRegistry({ fetchImpl, now: 1_100 });

    expect(first.error).toBeTruthy();
    expect(second.plugins).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('downloadPluginPackage', () => {
  it('rejects an unsafe URL before any network call', async () => {
    const fetchImpl = vi.fn<FetchLike>();
    await expect(downloadPluginPackage('http://127.0.0.1/plugin.zip', { fetchImpl })).rejects.toThrow(
      /安全拦截: 非法下载地址/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the buffer and derives the filename from content-disposition', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(binaryResponse(2048, { 'content-disposition': 'attachment; filename="homework-hub.zip"' }));

    const pkg = await downloadPluginPackage('https://plugins.example.com/download?id=7', { fetchImpl });

    expect(pkg.bytes).toBe(2048);
    expect(pkg.buffer).toHaveLength(2048);
    expect(pkg.filename).toBe('homework-hub.zip');
  });

  it('falls back to the URL basename when no disposition header is present', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(binaryResponse(64));
    const pkg = await downloadPluginPackage('https://plugins.example.com/releases/ext-plain-1.0.0.zip', { fetchImpl });
    expect(pkg.filename).toBe('ext-plain-1.0.0.zip');
  });

  it('rejects a package whose declared content-length exceeds the cap', async () => {
    const fetchImpl = vi
      .fn<FetchLike>()
      .mockResolvedValue(binaryResponse(8, { 'content-length': String(201 * 1024 * 1024) }));
    await expect(downloadPluginPackage('https://plugins.example.com/huge.zip', { fetchImpl })).rejects.toThrow(
      /超过 200MB 上限/,
    );
  });

  it('rejects an empty package body', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(binaryResponse(0));
    await expect(downloadPluginPackage('https://plugins.example.com/empty.zip', { fetchImpl })).rejects.toThrow(
      '插件包为空',
    );
  });

  it('surfaces an HTTP failure as a descriptive error', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(jsonResponse('missing', 404));
    await expect(downloadPluginPackage('https://plugins.example.com/gone.zip', { fetchImpl })).rejects.toThrow(
      /HTTP 404/,
    );
  });
});

describe('isValidPluginId', () => {
  it.each(['ext-homework-hub', '@openlearn/builtin', 'ext_homework', 'a'])('accepts %s', (id) => {
    expect(isValidPluginId(id)).toBe(true);
  });

  it.each([undefined, null, 42, '', ' has-space', 'ext home', 'x'.repeat(200)])('rejects %s', (id) => {
    expect(isValidPluginId(id)).toBe(false);
  });
});

/**
 * G-4c：DNS rebinding 与重定向防护
 *
 * 审计标注该项为「待验证」，本次**先复现再修复**，两处缺口均已实测确认：
 *
 *   ① 重定向不复检
 *      fetch 默认 redirect=follow → 最终 status 200
 *      fetch 最终 response.url: http://127.0.0.1:33409/latest/meta-data/…
 *      内网端点被真实命中: 是
 *
 *   ② DNS 从不解析
 *      isSafeExternalUrl('http://metadata.google.internal/pkg.zip') → { safe: true }
 *      （它只看 URL 字面量，从不调用 DNS）
 */
describe('G-4c: 出站 SSRF 防护', () => {
  /** 内网「元数据服务」—— 只在测试内监听，用来验证是否真被命中 */
  let innerServer: http.Server;
  let innerPort: number;
  const innerHits: string[] = [];

  beforeAll(async () => {
    innerServer = http.createServer((req, res) => {
      innerHits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ stolen: 'SECRET' }));
    });
    await new Promise<void>((r) => innerServer.listen(0, '127.0.0.1', () => r()));
    innerPort = (innerServer.address() as any).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => innerServer.close(() => r()));
  });

  beforeEach(() => {
    innerHits.length = 0;
  });

  /** 起一个「表面合规」的服务器：302 到内网元数据端点 */
  async function withRedirector(fn: (base: string) => Promise<void>) {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, {
        Location: `http://127.0.0.1:${innerPort}/latest/meta-data/iam/security-credentials/`,
      });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    try {
      await fn(`http://127.0.0.1:${port}/pkg.zip`);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  describe('① 重定向后复检（防 302 → 内网）', () => {
    it('fetch 默认会跟随重定向打到内网 —— 这是修复前的基线行为', async () => {
      await withRedirector(async (url) => {
        const res = await fetch(url); // 裸 fetch，无任何防护
        await res.text();
        // 证明这条攻击链真实可行；若将来 Node 改变了默认行为，本断言会提醒更新
        expect(res.url).toContain('127.0.0.1');
        expect(innerHits.length).toBeGreaterThan(0);
      });
    });

    it('fetchWithSafeRedirects 拦截指向内网的重定向', async () => {
      await withRedirector(async (url) => {
        await expect(
          fetchWithSafeRedirects(url, {
            // 首跳是 127.0.0.1，字面量校验本就该拦 —— 但仍要确认抛出的是
            // UrlSafetyError 而非别的错
            timeoutMs: 3000,
          }),
        ).rejects.toThrow(UrlSafetyError);
      });
    });

    it('fetchWithSafeRedirects 用 redirect:manual 逐跳跟随', async () => {
      // 注入 fetch 实现，验证它确实传了 redirect:'manual'，
      // 并对每跳重新走校验（而不是一次性跟随）。
      const seenRedirectModes: Array<string | undefined> = [];
      const fakeFetch = (input: string, init?: RequestInit) => {
        seenRedirectModes.push(init?.redirect as string);
        return Promise.resolve({
          status: 302,
          ok: false,
          headers: { get: (k: string) => (k === 'location' ? 'https://cdn.example.com/next.zip' : null) },
          url: input,
        } as any);
      };
      await expect(
        fetchWithSafeRedirects('https://cdn.example.com/a.zip', {
          fetchImpl: fakeFetch,
          lookupImpl: async () => [{ address: '93.184.216.34' }],
          timeoutMs: 1000,
        }),
      ).rejects.toThrow(/Too many redirects/);
      expect(seenRedirectModes.length).toBeGreaterThan(1);
      expect(new Set(seenRedirectModes)).toEqual(new Set(['manual']));
    });
  });

  describe('② DNS 解析校验（防 rebinding）', () => {
    it('解析到 169.254.169.254（云元数据端点）被拒', async () => {
      const result = await assertSafeResolvedAddresses('evil.example', async () => [{ address: '169.254.169.254' }]);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('169.254.169.254');
    });

    it.each([
      ['127.0.0.1', '回环'],
      ['10.0.0.5', '私网 10/8'],
      ['172.16.3.4', '私网 172.16/12'],
      ['192.168.1.1', '私网 192.168/16'],
      ['0.0.0.0', '未指定'],
      ['169.254.169.254', '云元数据端点'],
      ['100.64.0.1', 'CGNAT 100.64/10（k8s/容器网段）'],
      ['192.0.0.1', 'IETF 协议分配 192.0.0/24'],
      ['192.0.2.1', 'TEST-NET-1'],
      ['198.18.0.1', '基准测试 198.18/15'],
      ['198.51.100.1', 'TEST-NET-2'],
      ['203.0.113.1', 'TEST-NET-3'],
      ['::1', 'IPv6 回环'],
      ['fd00::1', 'IPv6 ULA'],
      ['fe80::1', 'IPv6 链路本地'],
      ['::ffff:127.0.0.1', 'IPv4 映射回环（内嵌点分十进制记法）'],
      ['::ffff:7f00:1', 'IPv4 映射回环（十六进制记法）'],
    ])('%s 被拒（%s）', async (address) => {
      const result = await assertSafeResolvedAddresses('evil.example', async () => [{ address }]);
      expect(result.safe, `${address} 应被拒`).toBe(false);
    });

    it('保留段边界不得误杀相邻公网段', async () => {
      // 掩码写错一位就会误杀生产地址 —— 这些都在禁止段之外，必须放行
      for (const address of [
        '100.63.255.255',
        '100.128.0.1',
        '172.15.0.1',
        '172.32.0.1',
        '192.0.1.1',
        '198.20.0.1',
        '203.0.112.1',
      ]) {
        const result = await assertSafeResolvedAddresses('ok.example', async () => [{ address }]);
        expect(result.safe, `${address} 被误杀`).toBe(true);
      }
    });

    it('解析到公网地址放行', async () => {
      const result = await assertSafeResolvedAddresses('ok.example', async () => [
        { address: '93.184.216.34' },
        { address: '2606:2800:220:1:248:1893:25c8:1946' },
      ]);
      expect(result.safe).toBe(true);
    });

    it('DNS 解析失败不放行（解析异常 ≠ 安全）', async () => {
      const result = await assertSafeResolvedAddresses('nx.example', async () => {
        throw Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' });
      });
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('ENOTFOUND');
    });

    it('空解析结果不放行', async () => {
      const result = await assertSafeResolvedAddresses('empty.example', async () => []);
      expect(result.safe).toBe(false);
    });

    it('isSafeExternalUrl 对域名只做字面量校验（这是为何需要 DNS 层）', () => {
      // 反向断言：锁住「字面量校验挡不住 rebinding」这一事实，
      // 若将来 isSafeExternalUrl 开始解析 DNS，本用例提醒同步更新实现。
      expect(isSafeExternalUrl('http://metadata.google.internal/pkg.zip').safe).toBe(true);
      expect(isSafeExternalUrl('http://localhost.attacker.example/pkg.zip').safe).toBe(true);
    });
  });

  describe('③ downloadPluginPackage 端到端', () => {
    it('重定向到内网时抛 UrlSafetyError，且内网端点未被命中', async () => {
      await withRedirector(async (url) => {
        await expect(downloadPluginPackage(url)).rejects.toThrow();
        // 首跳字面量就是 loopback，本就该被拦；关键是**不能**拿到内网响应体
        expect(innerHits).toEqual([]);
      });
    });
  });
});
