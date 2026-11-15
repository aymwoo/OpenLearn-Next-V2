import { execFileSync } from 'child_process';
import semver from 'semver';

export type UpdateSource = { type: 'github-release' | 'gitee-release'; repo: string };

export interface VersionCheckResult {
  hasUpdate: boolean;
  installedVersion: string;
  latestVersion: string | null;
  isPrerelease: boolean;
  downloadUrl: string | null;
  releaseUrl?: string | null;
  changelog: string | null;
  error?: string;
}

export interface CheckVersionOptions {
  forceRefresh?: boolean;
  fetchImpl?: typeof fetch;
  gitExecImpl?: (url: string) => string;
}

interface CacheEntry {
  result: VersionCheckResult;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(source: UpdateSource, installedVersion: string): string {
  return `${source.type}:${source.repo}:${installedVersion}`;
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

// ── Input validation ────────────────────────────────────────────────────────

/**
 * `owner/name` 形式的仓库白名单。
 *
 * repo 来自插件 manifest（安装时由上传方控制，属不可信输入），随后会被拼进
 * git URL 与 REST API URL。若不校验，形如 `x"$(cmd)"` 的值在 shell 中会触发
 * 命令替换（SEC: 命令注入 → RCE）。故只允许字母/数字/点/下划线/连字符，
 * 并强制 `owner/name` 两段结构。
 */
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 校验并规范化更新源；非法返回 null，由调用方转为错误结果。 */
function normalizeSource(source: UpdateSource | undefined | null): UpdateSource | null {
  if (!source) return null;
  if (source.type !== 'github-release' && source.type !== 'gitee-release') return null;
  if (typeof source.repo !== 'string' || source.repo.length > 140) return null;
  if (!REPO_PATTERN.test(source.repo)) return null;
  return { type: source.type, repo: source.repo };
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
  const latestStable = stable.length > 0 ? stable.reduce((a, b) => (semver.gt(b.parsed, a.parsed) ? b : a)) : null;

  if (latestStable && semver.gt(latestStable.parsed, installed)) {
    return { version: latestStable.cleaned, isPrerelease: false };
  }

  // If no newer stable, check prereleases
  const prerelease = valid.filter((t) => t.parsed.prerelease.length > 0);
  const latestPre = prerelease.length > 0 ? prerelease.reduce((a, b) => (semver.gt(b.parsed, a.parsed) ? b : a)) : null;

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
): {
  version: string | null;
  isPrerelease: boolean;
  downloadUrl: string | null;
  releaseUrl: string | null;
  changelog: string | null;
} {
  const installedCoerced = semver.valid(installed) ?? semver.coerce(installed)?.version ?? '0.0.0';
  const parsed = releases
    .map((r) => {
      const cleaned = r.tag_name.replace(/^v/, '');
      const p = semver.parse(cleaned);
      return p ? { ...r, parsed: p, cleaned } : null;
    })
    .filter((r): r is ReleaseItem & { parsed: semver.SemVer; cleaned: string } => r !== null);

  if (parsed.length === 0) {
    return { version: null, isPrerelease: false, downloadUrl: null, releaseUrl: null, changelog: null };
  }

  // Stable first
  const stable = parsed.filter((r) => !r.prerelease);
  const latestStable = stable.length > 0 ? stable.reduce((a, b) => (semver.gt(b.parsed, a.parsed) ? b : a)) : null;

  if (latestStable && semver.gt(latestStable.parsed, installedCoerced)) {
    const zipAsset = latestStable.assets?.find((a) => a.name.toLowerCase().endsWith('.zip'));
    return {
      version: latestStable.cleaned,
      isPrerelease: false,
      downloadUrl: zipAsset?.browser_download_url ?? null,
      releaseUrl: latestStable.html_url ?? null,
      changelog: latestStable.body ?? null,
    };
  }

  // Prerelease
  const pre = parsed.filter((r) => r.prerelease);
  const latestPre = pre.length > 0 ? pre.reduce((a, b) => (semver.gt(b.parsed, a.parsed) ? b : a)) : null;

  if (latestPre && semver.gt(latestPre.parsed, installedCoerced)) {
    const zipAsset = latestPre.assets?.find((a) => a.name.toLowerCase().endsWith('.zip'));
    return {
      version: latestPre.cleaned,
      isPrerelease: true,
      downloadUrl: zipAsset?.browser_download_url ?? null,
      releaseUrl: latestPre.html_url ?? null,
      changelog: latestPre.body ?? null,
    };
  }

  return { version: null, isPrerelease: false, downloadUrl: null, releaseUrl: null, changelog: null };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function checkVersion(
  source: UpdateSource,
  installedVersion: string,
  options: CheckVersionOptions = {},
): Promise<VersionCheckResult> {
  const base: VersionCheckResult = {
    hasUpdate: false,
    installedVersion,
    latestVersion: null,
    isPrerelease: false,
    downloadUrl: null,
    releaseUrl: null,
    changelog: null,
  };

  // SEC: repo 来自插件 manifest，属不可信输入，必须先白名单校验再使用。
  const safeSource = normalizeSource(source);
  if (!safeSource) {
    return { ...base, error: '无效的更新源：仅支持 owner/name 形式的 GitHub / Gitee 仓库' };
  }

  const key = cacheKey(safeSource, installedVersion);
  if (!options.forceRefresh) {
    const hit = cached(key);
    if (hit) return { ...hit, installedVersion };
  }

  const installedCoerced = semver.valid(installedVersion) ?? semver.coerce(installedVersion)?.version ?? '0.0.0';
  let gitTagHint: { version: string; isPrerelease: boolean } | null = null;

  // Strategy 1: git ls-remote (detect new semver tag fast; do NOT short-circuit before fetching release ZIP asset)
  try {
    const url = repoUrl(safeSource);
    const stdout = options.gitExecImpl
      ? options.gitExecImpl(url)
      : (execFileSync('git', ['ls-remote', '--tags', url], {
          timeout: 8000,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }) as string);
    const tags = parseTagsFromLsRemote(stdout);
    const { version, isPrerelease } = latestSemver(tags, installedCoerced);
    if (version) {
      gitTagHint = { version, isPrerelease };
    }
  } catch {
    // git unavailable or network error — fall through to HTTP API
  }

  // Strategy 2: HTTP Releases API (provides exact .zip asset downloadUrl + release notes)
  const fetchFn = options.fetchImpl ?? fetch;
  try {
    const apiUrl = apiReleasesUrl(safeSource);
    const resp = await fetchFn(apiUrl, {
      headers: { 'User-Agent': 'OpenLearnV2-PluginUpdater/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      if (gitTagHint) {
        const result: VersionCheckResult = {
          ...base,
          hasUpdate: true,
          latestVersion: gitTagHint.version,
          isPrerelease: gitTagHint.isPrerelease,
          downloadUrl: null,
          releaseUrl:
            safeSource.type === 'github-release'
              ? `https://github.com/${safeSource.repo}/releases/tag/v${gitTagHint.version}`
              : `https://gitee.com/${safeSource.repo}/releases/tag/v${gitTagHint.version}`,
        };
        setCache(key, result);
        return result;
      }
      return { ...base, error: `更新源响应异常: HTTP ${resp.status}` };
    }
    const releases = (await resp.json()) as ReleaseItem[];
    const { version, isPrerelease, downloadUrl, releaseUrl, changelog } = latestFromReleases(
      releases,
      installedVersion,
    );
    const resolvedVersion = version ?? gitTagHint?.version ?? null;
    const result: VersionCheckResult = {
      ...base,
      hasUpdate: resolvedVersion !== null,
      latestVersion: resolvedVersion,
      isPrerelease: version ? isPrerelease : (gitTagHint?.isPrerelease ?? false),
      downloadUrl,
      releaseUrl:
        releaseUrl ??
        (gitTagHint
          ? safeSource.type === 'github-release'
            ? `https://github.com/${safeSource.repo}/releases/tag/v${gitTagHint.version}`
            : `https://gitee.com/${safeSource.repo}/releases/tag/v${gitTagHint.version}`
          : null),
      changelog,
    };
    setCache(key, result);
    return result;
  } catch (e: any) {
    if (gitTagHint) {
      const result: VersionCheckResult = {
        ...base,
        hasUpdate: true,
        latestVersion: gitTagHint.version,
        isPrerelease: gitTagHint.isPrerelease,
        downloadUrl: null,
        releaseUrl:
          safeSource.type === 'github-release'
            ? `https://github.com/${safeSource.repo}/releases/tag/v${gitTagHint.version}`
            : `https://gitee.com/${safeSource.repo}/releases/tag/v${gitTagHint.version}`,
      };
      setCache(key, result);
      return result;
    }
    const msg =
      e.cause?.code === 'ENOTFOUND' || e.message?.includes('fetch')
        ? '无法连接到更新源：网络不可达'
        : `更新源请求失败: ${e.message}`;
    return { ...base, error: msg };
  }
}

export function clearCache(): void {
  cache.clear();
}
