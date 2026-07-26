import { execSync, exec } from 'child_process';
import semver from 'semver';

export type UpdateSource = { type: 'github-release' | 'gitee-release'; repo: string };

export interface VersionCheckResult {
  hasUpdate: boolean;
  installedVersion: string;
  latestVersion: string | null;
  isPrerelease: boolean;
  downloadUrl: string | null;
  changelog: string | null;
  error?: string;
}

interface CacheEntry {
  result: VersionCheckResult;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(source: UpdateSource): string {
  return `${source.type}:${source.repo}`;
}

function cached(key: string): VersionCheckResult | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.result;
  }
  return null;
}

function setCache(key: string, result: VersionCheckResult): void {
  cache.set(key, { result, timestamp: Date.now() });
}

// ── Git ls-remote strategy ──────────────────────────────────────────────────

function repoUrl(source: UpdateSource): string {
  if (source.type === 'github-release') {
    return `https://github.com/${source.repo}.git`;
  }
  if (source.type === 'gitee-release') {
    return `https://gitee.com/${source.repo}.git`;
  }
  return '';
}

function apiReleasesUrl(source: UpdateSource): string {
  if (source.type === 'github-release') {
    return `https://api.github.com/repos/${source.repo}/releases?per_page=5`;
  }
  if (source.type === 'gitee-release') {
    return `https://gitee.com/api/v5/repos/${source.repo}/releases?per_page=5`;
  }
  return '';
}

function parseTagsFromLsRemote(stdout: string): string[] {
  const tags: string[] = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(/refs\/tags\/(.+)$/);
    if (m) tags.push(m[1].replace(/\^\{\}$/, ''));
  }
  return tags;
}

function latestSemver(tags: string[], installed: string): { version: string | null; isPrerelease: boolean } {
  const valid = tags
    .map((t) => {
      // strip leading 'v' if present
      const cleaned = t.replace(/^v/, '');
      return { raw: t, cleaned, parsed: semver.parse(cleaned) };
    })
    .filter((t): t is { raw: string; cleaned: string; parsed: semver.SemVer } => t.parsed !== null);

  if (valid.length === 0) return { version: null, isPrerelease: false };

  // Find latest stable
  const stable = valid.filter((t) => !t.parsed.prerelease.length);
  const latestStable = stable.length > 0
    ? stable.reduce((a, b) => (semver.gt(b.parsed, a.parsed) ? b : a))
    : null;

  if (latestStable && semver.gt(latestStable.parsed, installed)) {
    return { version: latestStable.cleaned, isPrerelease: false };
  }

  // If no newer stable, check prereleases
  const prerelease = valid.filter((t) => t.parsed.prerelease.length > 0);
  const latestPre = prerelease.length > 0
    ? prerelease.reduce((a, b) => (semver.gt(b.parsed, a.parsed) ? b : a))
    : null;

  if (latestPre && semver.gt(latestPre.parsed, installed)) {
    return { version: latestPre.cleaned, isPrerelease: true };
  }

  return { version: null, isPrerelease: false };
}

// ── HTTP API fallback ───────────────────────────────────────────────────────

interface ReleaseItem {
  tag_name: string;
  prerelease: boolean;
  html_url: string;
  body?: string;
  assets?: Array<{ browser_download_url: string; name: string }>;
}

function latestFromReleases(
  releases: ReleaseItem[],
  installed: string,
  source: UpdateSource,
): { version: string | null; isPrerelease: boolean; downloadUrl: string | null; changelog: string | null } {
  const parsed = releases
    .map((r) => {
      const cleaned = r.tag_name.replace(/^v/, '');
      const p = semver.parse(cleaned);
      return p ? { ...r, parsed: p, cleaned } : null;
    })
    .filter((r): r is ReleaseItem & { parsed: semver.SemVer; cleaned: string } => r !== null);

  if (parsed.length === 0) return { version: null, isPrerelease: false, downloadUrl: null, changelog: null };

  // Stable first
  const stable = parsed.filter((r) => !r.prerelease);
  const latestStable = stable.length > 0
    ? stable.reduce((a, b) => (semver.gt(b.parsed, a.parsed) ? b : a))
    : null;

  if (latestStable && semver.gt(latestStable.parsed, installed)) {
    const zipAsset = latestStable.assets?.find((a) => a.name.endsWith('.zip'));
    return {
      version: latestStable.cleaned,
      isPrerelease: false,
      downloadUrl: zipAsset?.browser_download_url ?? latestStable.html_url,
      changelog: latestStable.body ?? null,
    };
  }

  // Prerelease
  const pre = parsed.filter((r) => r.prerelease);
  const latestPre = pre.length > 0
    ? pre.reduce((a, b) => (semver.gt(b.parsed, a.parsed) ? b : a))
    : null;

  if (latestPre && semver.gt(latestPre.parsed, installed)) {
    const zipAsset = latestPre.assets?.find((a) => a.name.endsWith('.zip'));
    return {
      version: latestPre.cleaned,
      isPrerelease: true,
      downloadUrl: zipAsset?.browser_download_url ?? latestPre.html_url,
      changelog: latestPre.body ?? null,
    };
  }

  return { version: null, isPrerelease: false, downloadUrl: null, changelog: null };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function checkVersion(
  source: UpdateSource,
  installedVersion: string,
): Promise<VersionCheckResult> {
  const key = cacheKey(source);
  const hit = cached(key);
  if (hit) return { ...hit, installedVersion };

  const base: VersionCheckResult = {
    hasUpdate: false,
    installedVersion,
    latestVersion: null,
    isPrerelease: false,
    downloadUrl: null,
    changelog: null,
  };

  // Strategy 1: git ls-remote
  try {
    const url = repoUrl(source);
    const stdout = execSync(`git ls-remote --tags "${url}"`, {
      timeout: 8000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tags = parseTagsFromLsRemote(stdout);
    const { version, isPrerelease } = latestSemver(tags, installedVersion);
    if (version) {
      const result = {
        ...base,
        hasUpdate: true,
        latestVersion: version,
        isPrerelease,
        downloadUrl: null,
      };
      setCache(key, result);
      return result;
    }
    // No update found via tags — fall through to HTTP API for downloadUrl
  } catch {
    // git unavailable or network error — fall through to HTTP API
  }

  // Strategy 2: HTTP API
  try {
    const apiUrl = apiReleasesUrl(source);
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'OpenLearnV2-PluginUpdater/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      return { ...base, error: `更新源响应异常: HTTP ${resp.status}` };
    }
    const releases: ReleaseItem[] = await resp.json();
    const { version, isPrerelease, downloadUrl, changelog } = latestFromReleases(releases, installedVersion, source);
    const result: VersionCheckResult = {
      ...base,
      hasUpdate: version !== null,
      latestVersion: version,
      isPrerelease,
      downloadUrl,
      changelog,
    };
    setCache(key, result);
    return result;
  } catch (e: any) {
    const msg = e.cause?.code === 'ENOTFOUND' || e.message?.includes('fetch')
      ? '无法连接到更新源：网络不可达'
      : `更新源请求失败: ${e.message}`;
    return { ...base, error: msg };
  }
}

export function clearCache(): void {
  cache.clear();
}
