import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { isSafeExternalUrl } from '../utils/url-safety.js';

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
  ])('rejects %s (%s)', (url) => {
    const result = isSafeExternalUrl(url);
    expect(result.safe).toBe(false);
    expect(result.reason).toBeTruthy();
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
