import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetGiteeStarsCache,
  enrichCommunityGiteeStars,
  fetchGiteeRepoStars,
  normalizeGiteeToken,
  parseGiteeRepo,
  refreshSingleGiteePluginStars,
  toggleGiteeRepoStar,
} from '../services/gitee-stars.js';
import type { CommunityPluginEntry } from '../services/community-registry.js';

function makeEntry(overrides: Partial<CommunityPluginEntry> = {}): CommunityPluginEntry {
  return {
    id: '@ext/class-manager',
    name: 'Class Manager',
    description: 'desc',
    author: 'aymwoo',
    version: '0.3.15',
    downloadUrl: 'https://gitee.com/aymwoo/class_manager/releases/download/v0.3.15/class_manager-0.3.15.zip',
    icon: null,
    homepage: null,
    repository: 'https://gitee.com/aymwoo/class_manager',
    license: 'MIT',
    tags: [],
    capabilities: [],
    minPlatformVersion: null,
    publishedAt: '2026-11-14T10:00:00+08:00',
    packageSize: 12000,
    downloads: null,
    stars: 0,
    verified: false,
    integrity: null,
    signature: null,
    featured: false,
    installedVersion: null,
    hasUpdate: false,
    ...overrides,
  };
}

describe('gitee-stars service', () => {
  afterEach(() => {
    __resetGiteeStarsCache();
  });

  it('parses Gitee repo URLs and rejects non-Gitee or malformed URLs', () => {
    expect(parseGiteeRepo('https://gitee.com/aymwoo/class_manager.git')).toEqual({
      owner: 'aymwoo',
      repo: 'class_manager',
      fullName: 'aymwoo/class_manager',
      htmlUrl: 'https://gitee.com/aymwoo/class_manager',
    });
    expect(parseGiteeRepo('https://github.com/aymwoo/OpenLearn-Next-V2')).toBeNull();
    expect(parseGiteeRepo('not-a-url')).toBeNull();
    expect(parseGiteeRepo('https://gitee.com/only-owner')).toBeNull();
  });

  it('validates Gitee tokens safely', () => {
    expect(normalizeGiteeToken('  abcd1234efgh  ')).toBe('abcd1234efgh');
    expect(normalizeGiteeToken('short')).toBeNull();
    expect(normalizeGiteeToken('has space 12345')).toBeNull();
    expect(normalizeGiteeToken('has\nnewline123')).toBeNull();
  });

  it('reads live stargazers_count from Gitee API, caches result, and falls back to anonymous on 401 token', async () => {
    const seenUrls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seenUrls.push({ url: input, auth: headers.Authorization ?? null });
      if (headers.Authorization === 'Bearer expired_token_123') {
        return new Response(JSON.stringify({ message: '401 Unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify({ stargazers_count: 19 }), { status: 200 });
    };

    const ref = parseGiteeRepo('https://gitee.com/aymwoo/class_manager')!;
    const stars = await fetchGiteeRepoStars(ref, { token: 'expired_token_123', fetchImpl });
    expect(stars).toBe(19);
    expect(seenUrls).toHaveLength(2);
    expect(seenUrls[1].auth).toBeNull();

    // 命中内存缓存，不应再次请求
    const cached = await fetchGiteeRepoStars(ref, { fetchImpl });
    expect(cached).toBe(19);
    expect(seenUrls).toHaveLength(2);
  });

  it('enriches plugin entries with live Gitee stars and user starred flags', async () => {
    const fetchImpl = async (input: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (input.endsWith('/repos/aymwoo/class_manager')) {
        return new Response(JSON.stringify({ stargazers_count: 27 }), { status: 200 });
      }
      if (input.includes('/user/starred') && headers.Authorization === 'Bearer valid_token_abc') {
        return new Response(JSON.stringify([{ full_name: 'aymwoo/class_manager' }]), { status: 200 });
      }
      return new Response(null, { status: 404 });
    };

    const enriched = await enrichCommunityGiteeStars(
      [
        makeEntry({ stars: 0 }),
        makeEntry({
          id: 'non-gitee',
          repository: 'https://github.com/example/non-gitee',
          stars: 5,
        }),
      ],
      { token: 'valid_token_abc', fetchImpl },
    );

    expect(enriched[0].stars).toBe(27);
    expect(enriched[0].starred).toBe(true);
    expect(enriched[0].giteeRepoUrl).toBe('https://gitee.com/aymwoo/class_manager');

    expect(enriched[1].stars).toBe(5);
    expect(enriched[1].starred).toBe(false);
    expect(enriched[1].giteeRepoUrl).toBeNull();
  });

  it('returns requiresGiteeAuth with starUrl when token is missing or invalid', async () => {
    const missing = await toggleGiteeRepoStar({
      pluginId: '@ext/class-manager',
      repository: 'https://gitee.com/aymwoo/class_manager',
      token: null,
    });
    expect(missing).toMatchObject({
      ok: false,
      requiresGiteeAuth: true,
      reason: 'missing_token',
      starUrl: 'https://gitee.com/aymwoo/class_manager',
    });

    const invalid = await toggleGiteeRepoStar({
      pluginId: '@ext/class-manager',
      repository: 'https://gitee.com/aymwoo/class_manager',
      token: 'expired_token_123',
      fetchImpl: async () => new Response(JSON.stringify({ message: '401 Unauthorized' }), { status: 401 }),
    });
    expect(invalid).toMatchObject({
      ok: false,
      requiresGiteeAuth: true,
      reason: 'invalid_token',
      starUrl: 'https://gitee.com/aymwoo/class_manager',
    });
  });

  it('toggles star via Gitee PUT/DELETE and refreshes live count', async () => {
    let starredOnGitee = false;
    let countOnGitee = 10;

    const fetchImpl = async (input: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (input.endsWith('/user/starred/aymwoo/class_manager')) {
        if (method === 'GET') {
          return new Response(null, { status: starredOnGitee ? 204 : 404 });
        }
        if (method === 'PUT') {
          if (!starredOnGitee) {
            starredOnGitee = true;
            countOnGitee += 1;
          }
          return new Response(null, { status: 204 });
        }
        if (method === 'DELETE') {
          if (starredOnGitee) {
            starredOnGitee = false;
            countOnGitee -= 1;
          }
          return new Response(null, { status: 204 });
        }
      }
      if (input.endsWith('/repos/aymwoo/class_manager')) {
        return new Response(JSON.stringify({ stargazers_count: countOnGitee }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    };

    const starRes = await toggleGiteeRepoStar({
      pluginId: '@ext/class-manager',
      repository: 'https://gitee.com/aymwoo/class_manager',
      token: 'valid_token_abc',
      fetchImpl,
    });
    expect(starRes).toEqual({
      ok: true,
      pluginId: '@ext/class-manager',
      starred: true,
      stars: 11,
      starUrl: 'https://gitee.com/aymwoo/class_manager',
    });

    const unstarRes = await toggleGiteeRepoStar({
      pluginId: '@ext/class-manager',
      repository: 'https://gitee.com/aymwoo/class_manager',
      token: 'valid_token_abc',
      fetchImpl,
    });
    expect(unstarRes).toEqual({
      ok: true,
      pluginId: '@ext/class-manager',
      starred: false,
      stars: 10,
      starUrl: 'https://gitee.com/aymwoo/class_manager',
    });

    // 手动模拟外部在 Gitee 网页点星后，调用单插件增量刷新
    starredOnGitee = true;
    countOnGitee = 15;
    const singleRefresh = await refreshSingleGiteePluginStars(
      { id: '@ext/class-manager', repository: 'https://gitee.com/aymwoo/class_manager', stars: 10 },
      { token: 'valid_token_abc', fetchImpl },
    );
    expect(singleRefresh).toEqual({
      pluginId: '@ext/class-manager',
      stars: 15,
      starred: true,
      starUrl: 'https://gitee.com/aymwoo/class_manager',
    });
  });
});
