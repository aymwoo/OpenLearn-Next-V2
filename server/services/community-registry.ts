import semver from 'semver';
import { isSafeExternalUrl } from '../utils/url-safety.js';

/**
 * 社区插件注册表（Community Plugin Registry）。
 *
 * 平台自身不托管社区插件包，只做「发现 + 安装」：
 *  1. `GET /api/plugins/community` 由服务端代取运维配置的注册表 JSON（规避 CORS，
 *     并复用 `isSafeExternalUrl` 出站防护），归一化后附带已安装状态返回前端；
 *  2. `POST /api/plugins/install-from-url` 由服务端下载 ZIP 并交给
 *     PluginDistributionManager 安装/更新；服务端下载失败时返回
 *     `fallbackToClient`，由浏览器直传至既有的 `/api/plugins/upload-zip-raw`。
 *
 * 注册表地址通过环境变量 `PLUGIN_COMMUNITY_REGISTRY_URL` 配置。默认留空——
 * 平台不应内置指向第三方域名的硬编码地址，未配置时前端展示明确的配置提示。
 */

export const COMMUNITY_REGISTRY_ENV = 'PLUGIN_COMMUNITY_REGISTRY_URL';

/** 注册表 JSON 的期望版本号，便于未来做不兼容格式演进。 */
export const COMMUNITY_REGISTRY_SCHEMA_VERSION = 1;

const REGISTRY_FETCH_TIMEOUT_MS = 10_000;
/** 插件包普遍较大，给足下载时间；超时后改由浏览器直传。 */
const PACKAGE_FETCH_TIMEOUT_MS = 60_000;
const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;
/** 与 `/api/plugins/upload-zip-raw` 的 express.raw limit 保持同量级。 */
const MAX_PACKAGE_BYTES = 200 * 1024 * 1024;
const MAX_REGISTRY_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 500;

/** 插件逻辑 id：与 manifest.id 同构（点分/短横线/作用域均可，如 ext-homework-hub、@openlearn/builtin）。 */
const PLUGIN_ID_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$/;

export interface CommunityPluginEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloadUrl: string;
  icon: string | null;
  homepage: string | null;
  repository: string | null;
  license: string | null;
  tags: string[];
  capabilities: string[];
  minPlatformVersion: string | null;
  publishedAt: string | null;
  downloads: number | null;
  stars: number | null;
  verified: boolean;
  featured: boolean;
  /** 由服务端根据本地已安装插件填充，注册表自身不提供。 */
  installedVersion: string | null;
  hasUpdate: boolean;
}

export interface CommunityRegistryResult {
  configured: boolean;
  source: string | null;
  registryVersion: number | null;
  fetchedAt: number | null;
  cached: boolean;
  plugins: CommunityPluginEntry[];
  skipped: number;
  error?: string;
}

interface CacheEntry {
  signature: string;
  result: CommunityRegistryResult;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

/** 允许测试注入的 fetch 实现；生产环境始终使用全局 fetch。 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchCommunityRegistryOptions {
  /** manifest.id -> 已安装版本。 */
  installed?: ReadonlyMap<string, string>;
  url?: string | null;
  fetchImpl?: FetchLike;
  /** 跳过缓存（前端「刷新」按钮）。 */
  forceRefresh?: boolean;
  now?: number;
}

// ── 输入归一化 ───────────────────────────────────────────────────────────────

function asTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function asStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const out: string[] = [];
  for (const item of raw) {
    const parsed = asTrimmedString(item, maxLength);
    if (parsed && !out.includes(parsed)) out.push(parsed);
    if (out.length >= maxItems) break;
  }
  return out;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

/**
 * 将注册表中的单条原始记录归一化为受信结构。
 * 任何缺少合法 id 或不安全 downloadUrl 的记录一律丢弃（返回 null），
 * 因为 downloadUrl 最终会成为服务端出站请求的目标。
 */
export function normalizeCommunityEntry(raw: unknown): CommunityPluginEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const id = asTrimmedString(record.id, 128);
  if (!id || !PLUGIN_ID_PATTERN.test(id)) return null;

  const downloadUrl = asTrimmedString(record.downloadUrl ?? record.download_url, 2048);
  if (!downloadUrl) return null;
  if (!isSafeExternalUrl(downloadUrl).safe) return null;

  const homepage = asTrimmedString(record.homepage, 2048);
  const repository = asTrimmedString(record.repository ?? record.repo, 2048);
  const version = asTrimmedString(record.version, 64);

  return {
    id,
    name: asTrimmedString(record.name, 120) ?? id,
    description: asTrimmedString(record.description, 1000) ?? '',
    author: asTrimmedString(record.author, 120) ?? 'Community',
    version: version && semver.valid(version) ? version : (version ?? ''),
    downloadUrl,
    icon: asTrimmedString(record.icon, 2048),
    homepage: homepage && isSafeExternalUrl(homepage).safe ? homepage : null,
    repository: repository && isSafeExternalUrl(repository).safe ? repository : null,
    license: asTrimmedString(record.license, 64),
    tags: asStringArray(record.tags, 8, 32),
    capabilities: asStringArray(record.capabilities ?? record.capabilitiesProposed, 24, 64),
    minPlatformVersion: asTrimmedString(record.minPlatformVersion ?? record.min_platform_version, 64),
    publishedAt: asTrimmedString(record.publishedAt ?? record.published_at, 64),
    downloads: asFiniteNumber(record.downloads),
    stars: asFiniteNumber(record.stars),
    verified: asBoolean(record.verified),
    featured: asBoolean(record.featured),
    installedVersion: null,
    hasUpdate: false,
  };
}

export interface NormalizeResult {
  plugins: CommunityPluginEntry[];
  skipped: number;
  registryVersion: number | null;
}

/**
 * 归一化整个注册表响应。同时接受 v1 信封 `{ version, plugins: [...] }` 与裸数组，
 * 以兼容手工维护的极简清单。
 */
export function normalizeCommunityRegistry(raw: unknown): NormalizeResult {
  const container = Array.isArray(raw) ? { plugins: raw } : raw && typeof raw === 'object' ? raw : null;
  if (!container) return { plugins: [], skipped: 0, registryVersion: null };

  const record = container as Record<string, unknown>;
  const list = Array.isArray(record.plugins) ? record.plugins : Array.isArray(record.items) ? record.items : null;
  const registryVersion = asFiniteNumber(record.version);

  if (!list) return { plugins: [], skipped: 0, registryVersion };

  const plugins: CommunityPluginEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const item of list.slice(0, MAX_ENTRIES)) {
    const entry = normalizeCommunityEntry(item);
    // 同一 id 重复时保留首次出现的记录，避免歧义安装目标。
    if (!entry || seen.has(entry.id)) {
      skipped += 1;
      continue;
    }
    seen.add(entry.id);
    plugins.push(entry);
  }

  plugins.sort(compareEntries);
  return { plugins, skipped, registryVersion };
}

/** 精选优先，其次下载量、star 数，最后按名称稳定排序。 */
function compareEntries(a: CommunityPluginEntry, b: CommunityPluginEntry): number {
  if (a.featured !== b.featured) return a.featured ? -1 : 1;
  if ((a.downloads ?? -1) !== (b.downloads ?? -1)) return (b.downloads ?? -1) - (a.downloads ?? -1);
  if ((a.stars ?? -1) !== (b.stars ?? -1)) return (b.stars ?? -1) - (a.stars ?? -1);
  return a.name.localeCompare(b.name);
}

/**
 * 用本地已安装版本标注每条记录：已装版本 + 是否存在更新。
 * 未安装 / 版本非法时 hasUpdate 恒为 false，前端因此只会展示「安装」。
 */
export function annotateInstallState(
  entries: readonly CommunityPluginEntry[],
  installed: ReadonlyMap<string, string>,
): CommunityPluginEntry[] {
  return entries.map((entry) => {
    const installedVersion = installed.get(entry.id) ?? null;
    // 本地 manifest 里的版本可能被人为改坏（例如 'nightly'），semver 比较前必须
    // 双向校验，否则 semver.gt 会抛 Invalid Version 并让整个市场请求失败。
    const isNewer =
      installedVersion !== null &&
      !!entry.version &&
      semver.valid(entry.version) !== null &&
      semver.valid(installedVersion) !== null &&
      semver.gt(entry.version, installedVersion);
    return { ...entry, installedVersion, hasUpdate: isNewer };
  });
}

// ── 注册表地址 ───────────────────────────────────────────────────────────────

/**
 * 解析注册表地址：显式入参 > 环境变量。返回值已被 SSRF 校验，
 * 非法或未配置一律返回 null（调用方转成「未配置」提示而非抛错）。
 */
export function resolveCommunityRegistryUrl(explicit?: string | null): string | null {
  const raw = (explicit ?? process.env[COMMUNITY_REGISTRY_ENV] ?? '').trim();
  if (!raw) return null;
  return isSafeExternalUrl(raw).safe ? raw : null;
}

// ── 拉取与缓存 ───────────────────────────────────────────────────────────────

function cacheSignature(url: string, installed: ReadonlyMap<string, string>): string {
  const installedPart = Array.from(installed.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, version]) => `${id}@${version}`)
    .join(',');
  return `${url}::${installedPart}`;
}

function cachedResult(signature: string, now: number): CommunityRegistryResult | null {
  const entry = cache.get(signature);
  if (entry && now - entry.timestamp < REGISTRY_CACHE_TTL_MS) return entry.result;
  return null;
}

function setCachedResult(signature: string, result: CommunityRegistryResult, now: number): void {
  // 简单容量控制：每个 (url + 已安装集合) 一份，超过 16 份时丢弃最旧的一份。
  if (cache.size >= 16) {
    const oldest = Array.from(cache.entries()).reduce((acc, cur) => (cur[1].timestamp < acc[1].timestamp ? cur : acc));
    cache.delete(oldest[0]);
  }
  cache.set(signature, { signature, result, timestamp: now });
}

/** 测试辅助：清空注册表缓存，避免用例间互相污染。 */
export function __resetCommunityRegistryCache(): void {
  cache.clear();
}

/**
 * 拉取并归一化社区注册表。设计上不抛异常——网络/格式问题以 `error` 字段返回，
 * 前端据此渲染可重试的错误态。
 */
export async function fetchCommunityRegistry(
  options: FetchCommunityRegistryOptions = {},
): Promise<CommunityRegistryResult> {
  const installed = options.installed ?? new Map<string, string>();
  const url = resolveCommunityRegistryUrl(options.url);
  const now = options.now ?? Date.now();

  if (!url) {
    return {
      configured: false,
      source: null,
      registryVersion: null,
      fetchedAt: null,
      cached: false,
      plugins: [],
      skipped: 0,
    };
  }

  const signature = cacheSignature(url, installed);
  if (!options.forceRefresh) {
    const hit = cachedResult(signature, now);
    if (hit) return { ...hit, cached: true };
  }

  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));

  let raw: unknown;
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'OpenLearnV2-PluginRegistry/1.0' },
      signal: AbortSignal.timeout(REGISTRY_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return failureResult(url, installed, `注册表返回 HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_REGISTRY_BYTES) {
      return failureResult(url, installed, '注册表响应过大，已拒绝解析');
    }
    raw = JSON.parse(text);
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    const message = e instanceof Error ? e.message : String(e);
    const isTimeout = name === 'TimeoutError' || /timeout/i.test(message);
    return failureResult(url, installed, isTimeout ? '拉取社区注册表超时' : `拉取社区注册表失败: ${message}`);
  }

  const normalized = normalizeCommunityRegistry(raw);
  const result: CommunityRegistryResult = {
    configured: true,
    source: url,
    registryVersion: normalized.registryVersion,
    fetchedAt: now,
    cached: false,
    plugins: annotateInstallState(normalized.plugins, installed),
    skipped: normalized.skipped,
  };
  setCachedResult(signature, result, now);
  return result;
}

function failureResult(url: string, installed: ReadonlyMap<string, string>, error: string): CommunityRegistryResult {
  return {
    configured: true,
    source: url,
    registryVersion: null,
    fetchedAt: null,
    cached: false,
    plugins: annotateInstallState([], installed),
    skipped: 0,
    error,
  };
}

// ── 插件包下载 ───────────────────────────────────────────────────────────────

export interface DownloadedPackage {
  buffer: Buffer;
  filename: string;
  bytes: number;
}

/**
 * 服务端下载插件包。地址必须已通过 `isSafeExternalUrl`；响应体超过
 * `MAX_PACKAGE_BYTES` 直接拒绝，避免把非法大文件写进内存与磁盘。
 */
export async function downloadPluginPackage(
  downloadUrl: string,
  options: { fetchImpl?: FetchLike } = {},
): Promise<DownloadedPackage> {
  const safety = isSafeExternalUrl(downloadUrl);
  if (!safety.safe) {
    throw new Error(`安全拦截: 非法下载地址 (${safety.reason})`);
  }

  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const response = await fetchImpl(downloadUrl, {
    headers: { 'User-Agent': 'OpenLearnV2-PluginInstaller/1.0', Accept: 'application/zip, application/octet-stream' },
    signal: AbortSignal.timeout(PACKAGE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`下载插件包失败: HTTP ${response.status}`);
  }

  const declaredLength = Number(response.headers?.get?.('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PACKAGE_BYTES) {
    throw new Error(`插件包超过 ${Math.floor(MAX_PACKAGE_BYTES / 1024 / 1024)}MB 上限`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('插件包为空');
  }
  if (buffer.length > MAX_PACKAGE_BYTES) {
    throw new Error(`插件包超过 ${Math.floor(MAX_PACKAGE_BYTES / 1024 / 1024)}MB 上限`);
  }

  return { buffer, filename: resolveFilename(response, downloadUrl), bytes: buffer.length };
}

function resolveFilename(response: Response, downloadUrl: string): string {
  const disposition = response.headers?.get?.('content-disposition') ?? '';
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1].replace(/"/g, '')).slice(0, 200) || 'plugin.zip';
    } catch {
      /* 非法编码时回退到 URL 推断 */
    }
  }
  try {
    const base = new URL(downloadUrl).pathname.split('/').filter(Boolean).pop();
    if (base) return decodeURIComponent(base).slice(0, 200);
  } catch {
    /* 忽略：调用方已校验 URL 合法性 */
  }
  return 'plugin.zip';
}

/** 供 /api/plugins/install-from-url 校验注册表声明的逻辑 id。 */
export function isValidPluginId(id: unknown): id is string {
  return typeof id === 'string' && PLUGIN_ID_PATTERN.test(id);
}
