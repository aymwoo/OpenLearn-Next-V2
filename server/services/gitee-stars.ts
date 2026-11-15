import { fetchWithSafeRedirects } from '../utils/url-safety.js';
import type { CommunityPluginEntry } from './community-registry.js';

export type GiteeFetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GiteeRepoRef {
  owner: string;
  repo: string;
  fullName: string;
  htmlUrl: string;
}

export interface GiteeStarAuthRequiredResult {
  ok: false;
  requiresGiteeAuth: true;
  reason: 'missing_token' | 'invalid_token';
  pluginId: string;
  starUrl: string;
  error: string;
}

export interface GiteeStarSuccessResult {
  ok: true;
  pluginId: string;
  starred: boolean;
  stars: number | null;
  starUrl: string;
}

export type GiteeStarToggleResult = GiteeStarSuccessResult | GiteeStarAuthRequiredResult;

export class GiteeStarError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'GiteeStarError';
    this.status = status;
  }
}

const GITEE_API_ORIGIN = 'https://gitee.com/api/v5';
const GITEE_WEB_ORIGIN = 'https://gitee.com';
const SLUG_RE = /^[A-Za-z0-9_.-]+$/;
const HIT_TTL_MS = 15 * 60 * 1000;
const MISS_TTL_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3000;
const MAX_CONCURRENCY = 4;

interface CachedRepoStars {
  stars: number | null;
  expiresAt: number;
}

const repoStarsCache = new Map<string, CachedRepoStars>();
const inflightRepoStars = new Map<string, Promise<number | null>>();

export function __resetGiteeStarsCache(): void {
  repoStarsCache.clear();
  inflightRepoStars.clear();
}

export function normalizeGiteeToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 256) return null;
  if (/[\s\r\n\0]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * 解析并校验插件的 Gitee 仓库地址，提取 owner/repo 与标准网页地址。
 */
export function parseGiteeRepo(repositoryUrl: string | null | undefined): GiteeRepoRef | null {
  if (typeof repositoryUrl !== 'string' || !repositoryUrl.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.hostname.toLowerCase() !== 'gitee.com') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0];
  const rawRepo = segments[1].replace(/\.git$/i, '');
  if (!SLUG_RE.test(owner) || !SLUG_RE.test(rawRepo)) return null;

  return {
    owner,
    repo: rawRepo,
    fullName: `${owner}/${rawRepo}`,
    htmlUrl: `${GITEE_WEB_ORIGIN}/${encodeURIComponent(owner)}/${encodeURIComponent(rawRepo)}`,
  };
}

async function performGiteeFetch(
  url: string,
  options: { method?: string; token?: string | null; fetchImpl?: GiteeFetchLike },
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'OpenLearn-Next',
  };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  if (options.fetchImpl) {
    return options.fetchImpl(url, {
      method: options.method ?? 'GET',
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  return fetchWithSafeRedirects(url, {
    method: options.method ?? 'GET',
    headers,
    timeoutMs: REQUEST_TIMEOUT_MS,
    prevalidated: true,
  });
}

async function fetchRepoStarsUncached(
  repoRef: GiteeRepoRef,
  options: { token?: string | null; fetchImpl?: GiteeFetchLike } = {},
): Promise<number | null> {
  const url = `${GITEE_API_ORIGIN}/repos/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}`;
  try {
    let res = await performGiteeFetch(url, { token: options.token, fetchImpl: options.fetchImpl });
    // 若用户传入的令牌已失效，回退匿名读取公开仓库 Star 数，避免连公开计数也被 401 阻断
    if (!res.ok && res.status === 401 && options.token) {
      res = await performGiteeFetch(url, { fetchImpl: options.fetchImpl });
    }
    if (!res.ok) return null;

    const payload = (await res.json()) as { stargazers_count?: unknown } | null;
    const raw = payload?.stargazers_count;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      return Math.floor(raw);
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchGiteeRepoStars(
  repoRef: GiteeRepoRef,
  options: { token?: string | null; forceRefresh?: boolean; fetchImpl?: GiteeFetchLike } = {},
): Promise<number | null> {
  const cacheKey = repoRef.fullName.toLowerCase();
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = repoStarsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.stars;
    }
  }

  const inflight = inflightRepoStars.get(cacheKey);
  if (inflight && !options.forceRefresh) {
    return inflight;
  }

  const task = (async () => {
    const stars = await fetchRepoStarsUncached(repoRef, {
      token: options.token,
      fetchImpl: options.fetchImpl,
    });
    repoStarsCache.set(cacheKey, {
      stars,
      expiresAt: Date.now() + (stars !== null ? HIT_TTL_MS : MISS_TTL_MS),
    });
    return stars;
  })();

  inflightRepoStars.set(cacheKey, task);
  try {
    return await task;
  } finally {
    if (inflightRepoStars.get(cacheKey) === task) {
      inflightRepoStars.delete(cacheKey);
    }
  }
}

export async function fetchUserStarredGiteeRepos(
  token: string,
  options: { fetchImpl?: GiteeFetchLike } = {},
): Promise<{ ok: true; fullNames: Set<string> } | { ok: false; unauthorized: boolean }> {
  const url = `${GITEE_API_ORIGIN}/user/starred?per_page=100`;
  try {
    const res = await performGiteeFetch(url, { token, fetchImpl: options.fetchImpl });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, unauthorized: true };
    }
    if (!res.ok) {
      return { ok: false, unauthorized: false };
    }
    const items = (await res.json()) as Array<{ full_name?: unknown }> | null;
    const fullNames = new Set<string>();
    if (Array.isArray(items)) {
      for (const item of items) {
        if (typeof item?.full_name === 'string' && item.full_name.trim()) {
          fullNames.add(item.full_name.trim().toLowerCase());
        }
      }
    }
    return { ok: true, fullNames };
  } catch {
    return { ok: false, unauthorized: false };
  }
}

async function checkSingleRepoStarred(
  repoRef: GiteeRepoRef,
  token: string,
  fetchImpl?: GiteeFetchLike,
): Promise<{ ok: true; starred: boolean } | { ok: false; requiresAuth: boolean }> {
  const url = `${GITEE_API_ORIGIN}/user/starred/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}`;
  const res = await performGiteeFetch(url, { method: 'GET', token, fetchImpl });
  if (res.status === 204 || res.status === 200) {
    return { ok: true, starred: true };
  }
  if (res.status === 404) {
    return { ok: true, starred: false };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, requiresAuth: true };
  }
  throw new GiteeStarError(`查询 Gitee 标星状态失败（HTTP ${res.status}）`, 502);
}

/**
 * 批量读取并回填社区插件在 Gitee 仓库上的实时 Star 数；
 * 若请求携带了用户 Gitee 令牌，同时返回当前用户是否已标星。
 */
export async function enrichCommunityGiteeStars(
  entries: CommunityPluginEntry[],
  options: { token?: string | null; forceRefresh?: boolean; fetchImpl?: GiteeFetchLike } = {},
): Promise<Array<CommunityPluginEntry & { starred: boolean; giteeRepoUrl: string | null }>> {
  const normalizedToken = normalizeGiteeToken(options.token);
  const parsedRefs = entries.map((entry) => parseGiteeRepo(entry.repository));

  const liveStarsByIndex = new Array<number | null>(entries.length).fill(null);
  const giteeIndices = parsedRefs.map((ref, idx) => (ref ? idx : -1)).filter((idx) => idx >= 0);

  let cursor = 0;
  async function worker() {
    while (cursor < giteeIndices.length) {
      const idx = giteeIndices[cursor++];
      const ref = parsedRefs[idx];
      if (!ref) continue;
      liveStarsByIndex[idx] = await fetchGiteeRepoStars(ref, {
        token: normalizedToken,
        forceRefresh: options.forceRefresh,
        fetchImpl: options.fetchImpl,
      });
    }
  }

  let starredSet: Set<string> | null = null;
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(1, giteeIndices.length)) }, () => worker());
  const starredTask = normalizedToken
    ? fetchUserStarredGiteeRepos(normalizedToken, { fetchImpl: options.fetchImpl }).then((res) => {
        if (res.ok) starredSet = res.fullNames;
      })
    : Promise.resolve();

  await Promise.all([...workers, starredTask]);

  return entries.map((entry, idx) => {
    const ref = parsedRefs[idx];
    const liveStars = liveStarsByIndex[idx];
    return {
      ...entry,
      stars: liveStars !== null ? liveStars : entry.stars,
      starred: Boolean(ref && starredSet && starredSet.has(ref.fullName.toLowerCase())),
      giteeRepoUrl: ref ? ref.htmlUrl : null,
    };
  });
}

/**
 * 刷新单个插件在 Gitee 仓库上的实时 Star 数（用于从 Gitee 新标签页返回后增量同步）。
 */
export async function refreshSingleGiteePluginStars(
  entry: { id: string; repository: string | null | undefined; stars: number | null },
  options: { token?: string | null; fetchImpl?: GiteeFetchLike } = {},
): Promise<{ pluginId: string; stars: number | null; starred: boolean; starUrl: string | null }> {
  const repoRef = parseGiteeRepo(entry.repository);
  if (!repoRef) {
    return { pluginId: entry.id, stars: entry.stars, starred: false, starUrl: null };
  }
  const normalizedToken = normalizeGiteeToken(options.token);
  const [liveStars, starredState] = await Promise.all([
    fetchGiteeRepoStars(repoRef, {
      token: normalizedToken,
      forceRefresh: true,
      fetchImpl: options.fetchImpl,
    }),
    normalizedToken
      ? checkSingleRepoStarred(repoRef, normalizedToken, options.fetchImpl).catch(() => ({
          ok: false as const,
          requiresAuth: false,
        }))
      : Promise.resolve({ ok: false as const, requiresAuth: false }),
  ]);

  return {
    pluginId: entry.id,
    stars: liveStars !== null ? liveStars : entry.stars,
    starred: starredState.ok ? starredState.starred : false,
    starUrl: repoRef.htmlUrl,
  };
}

/**
 * 通过 Gitee OpenAPI v5 为插件对应的 Gitee 仓库加星 / 取消加星。
 * 若未提供令牌或令牌无效/过期，则返回 requiresGiteeAuth 引导前端提示并打开仓库页。
 */
export async function toggleGiteeRepoStar(params: {
  pluginId: string;
  repository: string | null | undefined;
  token?: string | null;
  desired?: boolean;
  fetchImpl?: GiteeFetchLike;
}): Promise<GiteeStarToggleResult> {
  const repoRef = parseGiteeRepo(params.repository);
  if (!repoRef) {
    throw new GiteeStarError('该插件未关联有效的 Gitee 仓库地址', 400);
  }

  const normalizedToken = normalizeGiteeToken(params.token);
  if (!normalizedToken) {
    return {
      ok: false,
      requiresGiteeAuth: true,
      reason: 'missing_token',
      pluginId: params.pluginId,
      starUrl: repoRef.htmlUrl,
      error: '需要登录并授权 Gitee 账号后才能在页面内直接加星',
    };
  }

  const current = await checkSingleRepoStarred(repoRef, normalizedToken, params.fetchImpl);
  if (!current.ok) {
    return {
      ok: false,
      requiresGiteeAuth: true,
      reason: 'invalid_token',
      pluginId: params.pluginId,
      starUrl: repoRef.htmlUrl,
      error: 'Gitee 账号授权已失效或缺少 projects 权限，请重新登录授权',
    };
  }

  const nextStarred = typeof params.desired === 'boolean' ? params.desired : !current.starred;
  if (nextStarred !== current.starred) {
    const targetUrl = `${GITEE_API_ORIGIN}/user/starred/${encodeURIComponent(repoRef.owner)}/${encodeURIComponent(repoRef.repo)}`;
    const mutateRes = await performGiteeFetch(targetUrl, {
      method: nextStarred ? 'PUT' : 'DELETE',
      token: normalizedToken,
      fetchImpl: params.fetchImpl,
    });
    if (mutateRes.status === 401 || mutateRes.status === 403) {
      return {
        ok: false,
        requiresGiteeAuth: true,
        reason: 'invalid_token',
        pluginId: params.pluginId,
        starUrl: repoRef.htmlUrl,
        error: 'Gitee 账号授权已失效或缺少 projects 权限，请重新登录授权',
      };
    }
    if (!mutateRes.ok) {
      throw new GiteeStarError(`Gitee 标星操作失败（HTTP ${mutateRes.status}）`, 502);
    }
  }

  const liveStars = await fetchGiteeRepoStars(repoRef, {
    token: normalizedToken,
    forceRefresh: true,
    fetchImpl: params.fetchImpl,
  });

  return {
    ok: true,
    pluginId: params.pluginId,
    starred: nextStarred,
    stars: liveStars,
    starUrl: repoRef.htmlUrl,
  };
}
