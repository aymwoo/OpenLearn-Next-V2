import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { sanitizeHref } from '../../../../packages/core/security/url-safety.js';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Download,
  ExternalLink,
  Github,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Star,
  Store,
  X,
} from 'lucide-react';

/**
 * 社区插件市场（Community Plugin Registry）。
 *
 * 只负责「发现 + 安装」：注册表 JSON 由服务端 `/api/plugins/community` 代取并
 * 归一化，安装通过 `/api/plugins/install-from-url` 由服务端下载 ZIP 后落盘；
 * 服务端下载失败时后端返回 `fallbackToClient`，本组件改为浏览器下载并以
 * application/octet-stream 直传 `/api/plugins/upload-zip-raw`。
 *
 * 类型与文案刻意保持自包含（不引入 i18n / store 模块），便于独立测试。
 */

export interface CommunityPlugin {
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
  integrity?: string | null;
  signature?: string | null;
  featured: boolean;
  installedVersion: string | null;
  hasUpdate: boolean;
}

interface CommunityRegistryResponse {
  success?: boolean;
  configured: boolean;
  source: string | null;
  registryVersion: number | null;
  fetchedAt: number | null;
  cached: boolean;
  plugins: CommunityPlugin[];
  skipped: number;
  error?: string;
  envVar?: string;
  canConfigure?: boolean;
  configSource?: 'database' | 'env' | 'none';
  databaseUrl?: string | null;
  hasEnvFallback?: boolean;
  installEnabled?: boolean;
  installConfigSource?: 'database' | 'env' | 'default' | null;
  storedInstallEnabled?: boolean | null;
  hasInstallEnvFallback?: boolean | null;
  publicKeysConfigured?: boolean | null;
}

export interface PluginCommunityPanelProps {
  /** 本地已安装插件；仅使用 id 与 manifest 字段，便于与 PluginType 结构兼容。 */
  installedPlugins: ReadonlyArray<{ id: string; manifest: string }>;
  lang: string;
  /** 是否有权修改社区插件源（管理员专属；未传时取服务端返回值，单元测试回落为 true）。 */
  canConfigure?: boolean;
  /** 安装成功后回调，父组件可据此刷新已安装列表。 */
  onInstalled?: () => void;
  /** 测试注入点；默认使用全局 fetch。 */
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
}

type InstallPhase = 'installing' | 'success' | 'error';

interface InstallState {
  phase: InstallPhase;
  message: string;
}

type SortKey = 'recommended' | 'downloads' | 'name';

const REGISTRY_ENDPOINT = '/api/plugins/community';
const CONFIG_ENDPOINT = '/api/plugins/community/config';
const INSTALL_ENDPOINT = '/api/plugins/install-from-url';
const ZIP_UPLOAD_ENDPOINT = '/api/plugins/upload-zip-raw';

/** 从 downloadUrl 推断 ZIP 文件名，供浏览器直传时带上 x-filename。 */
function zipFilenameFromUrl(downloadUrl: string): string {
  try {
    const base = new URL(downloadUrl).pathname.split('/').filter(Boolean).pop();
    return base ? decodeURIComponent(base) : 'plugin.zip';
  } catch {
    return 'plugin.zip';
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function formatCount(value: number | null, lang: string): string | null {
  if (value === null) return null;
  if (value >= 10000) return lang === 'zh' ? `${(value / 10000).toFixed(1)} 万` : `${(value / 1000).toFixed(1)}k`;
  if (value >= 1000) return lang === 'zh' ? `${value}` : `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

/** 卡片的图标槽：支持 emoji、图片 URL，缺失时回落到名称首字母。 */
function PluginIcon({ plugin }: { plugin: CommunityPlugin }) {
  const [broken, setBroken] = useState(false);
  const icon = plugin.icon?.trim();
  const isImage = !!icon && (icon.startsWith('http://') || icon.startsWith('https://'));

  if (isImage && !broken) {
    return (
      <img
        src={icon}
        alt=""
        className="w-11 h-11 rounded-lg object-cover border border-gray-100 shrink-0"
        onError={() => setBroken(true)}
      />
    );
  }
  if (icon && !isImage) {
    return (
      <div className="w-11 h-11 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xl shrink-0">
        <span aria-hidden>{icon}</span>
      </div>
    );
  }
  return (
    <div className="w-11 h-11 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center font-bold shrink-0">
      {plugin.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-col gap-3 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-lg bg-gray-100 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-100 rounded w-2/3" />
          <div className="h-3 bg-gray-100 rounded w-1/3" />
        </div>
      </div>
      <div className="h-3 bg-gray-100 rounded" />
      <div className="h-3 bg-gray-100 rounded w-5/6" />
      <div className="h-8 bg-gray-100 rounded-lg mt-2" />
    </div>
  );
}

export function PluginCommunityPanel({
  installedPlugins,
  lang,
  canConfigure: canConfigureProp,
  onInstalled,
  fetcher,
}: PluginCommunityPanelProps) {
  const zh = lang === 'zh';
  const doFetch = useMemo(() => fetcher ?? ((input: string, init?: RequestInit) => fetch(input, init)), [fetcher]);
  const registryInputId = useId();
  const registryHintId = useId();
  const registryErrorId = useId();
  const configPanelId = useId();
  const configHeadingId = useId();
  const registryInputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<CommunityRegistryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('recommended');
  const [hideInstalled, setHideInstalled] = useState(false);
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
  /** 本次会话内已成功安装的 id，用于无需等待刷新即可更新卡片状态。 */
  const [justInstalled, setJustInstalled] = useState<Record<string, true>>({});
  const [configOpen, setConfigOpen] = useState(false);
  const [registryUrlInput, setRegistryUrlInput] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configNotice, setConfigNotice] = useState<string | null>(null);
  const [registryInputDirty, setRegistryInputDirty] = useState(false);
  const [installSaving, setInstallSaving] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState<string | null>(null);

  const canConfigure = canConfigureProp ?? data?.canConfigure ?? true;

  const loadRegistry = useCallback(
    async (forceRefresh: boolean) => {
      setStatus('loading');
      setError(null);
      try {
        const res = await doFetch(`${REGISTRY_ENDPOINT}${forceRefresh ? '?refresh=1' : ''}`);
        const body = (await res.json()) as CommunityRegistryResponse;
        if (!res.ok || !body?.success) {
          throw new Error(body?.error || (zh ? '服务端拒绝请求' : 'Request rejected by the server'));
        }
        setData(body);
        if (body.error) {
          setConfigNotice(null);
          setError(body.error);
          setStatus('error');
        } else {
          setStatus('ready');
        }
      } catch (e) {
        setConfigNotice(null);
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    },
    [doFetch, zh],
  );

  useEffect(() => {
    void loadRegistry(false);
  }, [loadRegistry]);

  /** 本地已安装的 manifest.id；与注册表 id 对齐用于展示「已安装 / 可更新」。 */
  const installedManifestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const plugin of installedPlugins) {
      try {
        const parsed = JSON.parse(plugin.manifest);
        if (typeof parsed?.id === 'string' && parsed.id) ids.add(parsed.id);
      } catch {
        // 单行 manifest 损坏时退回到数据库 id
        ids.add(plugin.id);
      }
    }
    return ids;
  }, [installedPlugins]);

  const isInstalled = useCallback(
    (plugin: CommunityPlugin) =>
      Boolean(justInstalled[plugin.id]) || installedManifestIds.has(plugin.id) || plugin.installedVersion !== null,
    [installedManifestIds, justInstalled],
  );

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plugin of data?.plugins ?? []) {
      for (const tag of plugin.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([tag]) => tag);
  }, [data]);

  const visiblePlugins = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = (data?.plugins ?? []).filter((plugin) => {
      if (hideInstalled && isInstalled(plugin)) return false;
      if (activeTag && !plugin.tags.includes(activeTag)) return false;
      if (!needle) return true;
      return [plugin.name, plugin.id, plugin.description, plugin.author, plugin.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });

    if (sort === 'downloads') {
      list = [...list].sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1));
    } else if (sort === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [activeTag, data, hideInstalled, isInstalled, query, sort]);

  const setInstallState = useCallback((id: string, next: InstallState | null) => {
    setInstallStates((prev) => {
      const copy = { ...prev };
      if (next) copy[id] = next;
      else delete copy[id];
      return copy;
    });
  }, []);

  /** 服务端下载失败时的兜底：浏览器取包 + application/octet-stream 直传。 */
  const uploadViaBrowser = useCallback(
    async (plugin: CommunityPlugin, approvePublic: boolean) => {
      setInstallState(plugin.id, {
        phase: 'installing',
        message: zh ? '服务端下载不可用，改为浏览器直传…' : 'Server download unavailable, transferring from browser…',
      });

      const zipResponse = await doFetch(plugin.downloadUrl);
      if (!zipResponse.ok) {
        throw new Error(`${zh ? '浏览器下载失败' : 'Browser download failed'}: HTTP ${zipResponse.status}`);
      }
      const blob = await zipResponse.blob();
      if (blob.size === 0) throw new Error(zh ? '插件包为空' : 'The package is empty');

      const filename = zipFilenameFromUrl(plugin.downloadUrl);
      const uploadResponse = await doFetch(ZIP_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-filename': encodeURIComponent(filename),
          'x-community-install': 'true',
          ...(plugin.integrity ? { 'x-integrity': plugin.integrity } : {}),
          ...(plugin.signature ? { 'x-signature': plugin.signature } : {}),
          ...(approvePublic ? { 'x-approve-public-routes': 'true' } : {}),
        },
        body: blob,
      });
      const uploadBody = (await uploadResponse.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
        code?: string;
      } | null;
      if (!uploadResponse.ok || !uploadBody?.success) {
        if (uploadResponse.status === 403 && !uploadBody?.code) {
          throw new Error(zh ? '仅管理员可安装社区插件，请联系管理员。' : 'Only administrators can install plugins.');
        }
        throw new Error(uploadBody?.error || (zh ? '浏览器直传失败' : 'Browser upload failed'));
      }
    },
    [doFetch, setInstallState, zh],
  );

  const handleInstall = useCallback(
    async (plugin: CommunityPlugin, approvePublic: boolean) => {
      setInstallState(plugin.id, {
        phase: 'installing',
        message: zh ? '正在由服务端下载插件包…' : 'Server is downloading the package…',
      });

      try {
        const response = await doFetch(INSTALL_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            downloadUrl: plugin.downloadUrl,
            expectedId: plugin.id,
            approvePublicRoutes: approvePublic,
            ...(plugin.integrity ? { integrity: plugin.integrity } : {}),
            ...(plugin.signature ? { signature: plugin.signature } : {}),
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
          code?: string;
          fallbackToClient?: boolean;
          updated?: boolean;
          newVersion?: string;
        } | null;

        if (!response.ok || !body?.success) {
          if (body?.fallbackToClient) {
            await uploadViaBrowser(plugin, approvePublic);
          } else if (response.status === 403 && !body?.code) {
            throw new Error(zh ? '仅管理员可安装社区插件，请联系管理员。' : 'Only administrators can install plugins.');
          } else {
            throw new Error(body?.error || (zh ? '安装失败' : 'Installation failed'));
          }
        }

        setJustInstalled((prev) => ({ ...prev, [plugin.id]: true }));
        setInstallState(plugin.id, {
          phase: 'success',
          message: zh ? '安装完成，请在「发现」页启用' : 'Installed — enable it on the Discover tab',
        });
        onInstalled?.();
      } catch (e) {
        setInstallState(plugin.id, {
          phase: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [doFetch, onInstalled, setInstallState, uploadViaBrowser, zh],
  );

  const validateRegistryUrl = useCallback(
    (raw: string, allowEmpty: boolean): string | null => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return allowEmpty
          ? null
          : zh
            ? '请输入社区插件注册表 JSON 地址'
            : 'Please enter the community registry JSON URL';
      }
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return zh ? '仅支持 http:// 或 https:// 开头的公网地址' : 'Only http:// or https:// URLs are supported';
        }
      } catch {
        return zh
          ? '请输入有效的 URL 地址（例如 https://example.com/community-plugins.json）'
          : 'Please enter a valid URL (e.g. https://example.com/community-plugins.json)';
      }
      return null;
    },
    [zh],
  );

  const openConfigPanel = useCallback(() => {
    setRegistryUrlInput(data?.databaseUrl ?? data?.source ?? '');
    setConfigError(null);
    setRegistryInputDirty(false);
    setConfigOpen(true);
  }, [data]);

  const submitRegistryConfig = useCallback(
    async (rawUrl: string | null, allowEmpty: boolean) => {
      const normalized = rawUrl === null ? '' : rawUrl.trim();
      const validationError = validateRegistryUrl(normalized, allowEmpty);
      if (validationError) {
        setConfigError(validationError);
        registryInputRef.current?.focus();
        return;
      }

      setConfigSaving(true);
      setConfigError(null);
      setConfigNotice(null);
      try {
        const res = await doFetch(CONFIG_ENDPOINT, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registryUrl: normalized || null }),
        });
        const body = (await res.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
        } | null;

        if (!res.ok || !body?.success) {
          const msg =
            res.status === 403
              ? zh
                ? '仅管理员可修改社区插件源设置'
                : 'Only administrators can configure the community registry'
              : body?.error || (zh ? '保存社区插件源失败' : 'Failed to save community registry URL');
          setConfigError(msg);
          registryInputRef.current?.focus();
          return;
        }

        setConfigOpen(false);
        setRegistryInputDirty(false);
        setRegistryUrlInput(normalized);
        setConfigNotice(
          normalized
            ? zh
              ? '社区插件源已保存，正在加载注册表…'
              : 'Community registry URL saved, loading…'
            : zh
              ? '已清除界面自定义插件源'
              : 'Cleared custom community registry URL',
        );
        await loadRegistry(true);
      } catch (e) {
        setConfigError(e instanceof Error ? e.message : String(e));
      } finally {
        setConfigSaving(false);
      }
    },
    [doFetch, loadRegistry, validateRegistryUrl, zh],
  );

  const submitInstallConfig = useCallback(
    async (installEnabled: boolean | null) => {
      if (!canConfigure) return;
      setInstallSaving(true);
      setInstallError(null);
      setInstallNotice(null);
      try {
        const res = await doFetch(CONFIG_ENDPOINT, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ installEnabled }),
        });
        const body = (await res.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
        } | null;
        if (!res.ok || !body?.success) {
          const msg =
            res.status === 403
              ? zh
                ? '仅管理员可修改社区安装开关'
                : 'Only administrators can change the community install switch'
              : body?.error || (zh ? '保存社区安装开关失败' : 'Failed to save community install setting');
          setInstallError(msg);
          return;
        }
        setInstallNotice(
          installEnabled === null
            ? zh
              ? '已清除界面覆盖，将按环境变量或默认开启生效'
              : 'Cleared UI override; env or default-on now applies'
            : installEnabled
              ? zh
                ? '已允许从社区注册表安装，立即生效'
                : 'Community registry install enabled; takes effect immediately'
              : zh
                ? '已关闭社区注册表安装，立即生效'
                : 'Community registry install disabled; takes effect immediately',
        );
        await loadRegistry(false);
      } catch (e) {
        setInstallError(e instanceof Error ? e.message : String(e));
      } finally {
        setInstallSaving(false);
      }
    },
    [canConfigure, doFetch, loadRegistry, zh],
  );

  const renderInstallToggle = (options: { compact?: boolean } = {}) => {
    const enabled = Boolean(data?.installEnabled ?? true);
    const source = canConfigure ? data?.installConfigSource : null;
    const stored = canConfigure ? data?.storedInstallEnabled : null;
    const hasEnvFallback = canConfigure ? Boolean(data?.hasInstallEnvFallback) : false;
    const sourceLabel =
      source === 'database'
        ? zh
          ? '当前来源：管理员界面配置（覆盖环境变量）'
          : 'Source: admin UI setting (overrides env)'
        : source === 'env'
          ? zh
            ? `当前来源：环境变量 OPENLEARN_COMMUNITY_INSTALL=${enabled ? '1' : '0'}（未在界面显式配置）`
            : `Source: OPENLEARN_COMMUNITY_INSTALL=${enabled ? '1' : '0'} (no explicit UI setting)`
          : source === 'default'
            ? zh
              ? '当前来源：默认开启（未在界面或环境变量中关闭）'
              : 'Source: default on (not disabled in UI or env)'
            : null;

    return (
      <div
        className={
          options.compact
            ? 'mb-4 px-4 py-3 rounded-xl bg-white border border-gray-200 text-left'
            : 'rounded-lg border border-gray-200 bg-slate-50/70 px-3 py-3 space-y-2'
        }
        data-testid="community-install-toggle"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800">
              {zh ? '允许从社区注册表安装' : 'Allow install from community registry'}
            </p>
            <p className="text-xs text-gray-500 leading-relaxed mt-1">
              {canConfigure
                ? zh
                  ? '默认开启。管理员可在此开启或关闭，保存后立即对安装、URL 更新和社区直传生效。未在界面显式配置时，可使用环境变量 OPENLEARN_COMMUNITY_INSTALL=0 关闭；显式设置会覆盖该环境变量。'
                  : 'On by default. Admins can turn this on or off here; the change applies immediately to install, URL update, and community direct upload. When no explicit UI value is stored, env OPENLEARN_COMMUNITY_INSTALL=0 can disable it; an explicit UI value overrides that env.'
                : zh
                  ? '社区安装由管理员在插件中心配置，默认开启。'
                  : 'Community install is configured by an administrator and is on by default.'}
            </p>
            <p className="text-xs text-gray-600 mt-1.5">
              {zh ? `有效状态：${enabled ? '已开启' : '已关闭'}` : `Effective: ${enabled ? 'on' : 'off'}`}
              {sourceLabel ? ` · ${sourceLabel}` : ''}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={zh ? '允许从社区注册表安装' : 'Allow install from community registry'}
            disabled={!canConfigure || installSaving}
            onClick={() => void submitInstallConfig(!enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              enabled ? 'bg-indigo-600' : 'bg-gray-300'
            } ${!canConfigure || installSaving ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {canConfigure && stored !== null && stored !== undefined && (
          <button
            type="button"
            disabled={installSaving}
            onClick={() => void submitInstallConfig(null)}
            className="text-xs font-semibold text-indigo-700 hover:text-indigo-900 disabled:opacity-60 cursor-pointer"
          >
            {hasEnvFallback
              ? zh
                ? '清除界面覆盖，回退到环境变量'
                : 'Clear UI override and fall back to env'
              : zh
                ? '清除界面覆盖，恢复默认开启'
                : 'Clear UI override and fall back to default on'}
          </button>
        )}
        {installError && (
          <p role="alert" className="text-xs text-rose-600">
            {installError}
          </p>
        )}
        {installNotice && !installError && (
          <p role="status" className="text-xs text-emerald-700">
            {installNotice}
          </p>
        )}
      </div>
    );
  };

  const renderRegistryConfigForm = (options: { isUnconfiguredCard?: boolean } = {}) => {
    const isUnconfiguredCard = Boolean(options.isUnconfiguredCard);
    const hasDatabaseOverride = Boolean(data?.databaseUrl) || data?.configSource === 'database';
    const allowEmpty = !isUnconfiguredCard && hasDatabaseOverride;
    const describedBy = configError ? `${registryHintId} ${registryErrorId}` : registryHintId;

    return (
      <form
        aria-labelledby={isUnconfiguredCard ? undefined : configHeadingId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submitRegistryConfig(registryUrlInput, allowEmpty);
        }}
        className={isUnconfiguredCard ? 'mt-6 text-left' : 'space-y-3'}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={registryInputId} className="text-xs font-semibold text-gray-700">
            {zh ? '社区插件注册表 JSON 地址' : 'Community Registry JSON URL'}
          </label>
          <p id={registryHintId} className="text-xs text-gray-500 leading-relaxed">
            {zh
              ? `支持远端 JSON 注册表地址（仅允许公网 HTTP(S)，回环与内网地址会被安全拦截）。${
                  !isUnconfiguredCard && hasDatabaseOverride
                    ? data?.hasEnvFallback
                      ? `留空保存或点击清除可恢复环境变量 ${data?.envVar || 'PLUGIN_COMMUNITY_REGISTRY_URL'} 默认配置。`
                      : '留空保存或点击清除可移除当前配置。'
                    : ''
                }`
              : `Enter a remote JSON registry URL (public HTTP(S) only; loopback and private networks are blocked).${
                  !isUnconfiguredCard && hasDatabaseOverride
                    ? data?.hasEnvFallback
                      ? ` Clear to fall back to ${data?.envVar || 'PLUGIN_COMMUNITY_REGISTRY_URL'}.`
                      : ' Clear to remove the current URL.'
                    : ''
                }`}
          </p>
          <input
            ref={registryInputRef}
            id={registryInputId}
            name="registryUrl"
            type="url"
            value={registryUrlInput}
            onChange={(e) => {
              setRegistryUrlInput(e.target.value);
              setRegistryInputDirty(true);
              if (configError) setConfigError(null);
            }}
            onBlur={() => {
              if (registryInputDirty) {
                setConfigError(validateRegistryUrl(registryUrlInput, allowEmpty));
              }
            }}
            placeholder="https://example.com/community-plugins.json"
            autoComplete="url"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            aria-invalid={Boolean(configError)}
            aria-describedby={describedBy}
            className={`w-full px-3 py-2 text-sm bg-white border rounded-lg focus:outline-none focus:ring-2 ${
              configError
                ? 'border-rose-400 focus:ring-rose-500/30 focus:border-rose-500'
                : 'border-gray-200 focus:ring-indigo-500/30 focus:border-indigo-400'
            }`}
          />
          {configError && (
            <p id={registryErrorId} role="alert" className="text-xs text-rose-600 flex items-center gap-1.5 mt-0.5">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{configError}</span>
            </p>
          )}
        </div>

        {renderInstallToggle()}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={configSaving}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors cursor-pointer"
          >
            {configSaving && <Loader2 size={13} className="animate-spin" />}
            <span>
              {isUnconfiguredCard ? (zh ? '保存并加载' : 'Save & Load') : zh ? '保存并刷新' : 'Save & Refresh'}
            </span>
          </button>

          {!isUnconfiguredCard && hasDatabaseOverride && (
            <button
              type="button"
              disabled={configSaving}
              onClick={() => void submitRegistryConfig(null, true)}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-60 transition-colors cursor-pointer"
            >
              {data?.hasEnvFallback
                ? zh
                  ? '恢复环境变量默认'
                  : 'Reset to env default'
                : zh
                  ? '清除配置'
                  : 'Clear configuration'}
            </button>
          )}

          {!isUnconfiguredCard && (
            <button
              type="button"
              disabled={configSaving}
              onClick={() => {
                setConfigOpen(false);
                setConfigError(null);
              }}
              className="px-3 py-2 text-xs font-medium rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              {zh ? '收起' : 'Close'}
            </button>
          )}
        </div>
      </form>
    );
  };

  // ── 未配置 ────────────────────────────────────────────────────────────
  if (status === 'ready' && data && !data.configured) {
    return (
      <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
        <div className="max-w-2xl mx-auto mt-10 bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
          <Store size={44} className="mx-auto text-indigo-300 mb-4" />
          <h3 className="text-lg font-bold text-gray-900">
            {zh ? '尚未配置社区插件源' : 'No community registry configured'}
          </h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            {canConfigure
              ? zh
                ? '社区市场会从一个远端 JSON 注册表读取可安装插件。您可以直接在下方配置注册表地址，或在服务端环境变量中设置：'
                : 'The community market reads an installable-plugin list from a remote JSON registry. Configure the registry URL below or set the server environment variable:'
              : zh
                ? '社区市场会从一个远端 JSON 注册表读取可安装插件。请联系管理员在页面中配置地址，或在服务端环境变量中配置后重启服务：'
                : 'The community market reads an installable-plugin list from a remote JSON registry. Ask an administrator to configure it or set the environment variable on the server:'}
          </p>
          {canConfigure && renderRegistryConfigForm({ isUnconfiguredCard: true })}
          {!canConfigure && renderInstallToggle({ compact: true })}
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-2">
              {zh ? '也可以通过服务端环境变量配置：' : 'Or configure via server environment variable:'}
            </p>
            <code className="inline-block px-3 py-1.5 rounded-lg bg-gray-900 text-gray-50 text-xs font-mono">
              {data.envVar || 'PLUGIN_COMMUNITY_REGISTRY_URL'}={'<https://example.com/community-plugins.json>'}
            </code>
          </div>
          {!canConfigure && (
            <p className="text-xs text-gray-400 mt-4">
              {zh
                ? '地址仅允许公网 HTTP(S)，回环与内网地址会被安全拦截。'
                : 'Only public HTTP(S) endpoints are allowed; loopback and private addresses are blocked.'}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={zh ? '搜索插件名称、作者或标签…' : 'Search by name, author or tag…'}
            aria-label={zh ? '搜索社区插件' : 'Search community plugins'}
            className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label={zh ? '清空搜索' : 'Clear search'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label={zh ? '排序方式' : 'Sort order'}
          className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-600 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        >
          <option value="recommended">{zh ? '推荐排序' : 'Recommended'}</option>
          <option value="downloads">{zh ? '下载最多' : 'Most downloaded'}</option>
          <option value="name">{zh ? '按名称' : 'By name'}</option>
        </select>

        <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-500 hover:text-gray-900 select-none transition-colors border border-gray-200 rounded-lg px-3 py-2 bg-white shadow-sm">
          <input
            type="checkbox"
            checked={hideInstalled}
            onChange={(e) => setHideInstalled(e.target.checked)}
            className="w-3.5 h-3.5 rounded text-indigo-600 border-gray-300 focus:ring-indigo-500 cursor-pointer"
          />
          <span>{zh ? '隐藏已安装' : 'Hide installed'}</span>
        </label>

        <button
          type="button"
          onClick={() => void loadRegistry(true)}
          disabled={status === 'loading'}
          className="flex items-center gap-1.5 text-xs font-semibold border border-gray-200 rounded-lg px-3 py-2 bg-white shadow-sm text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          <span>{zh ? '刷新' : 'Refresh'}</span>
        </button>

        {canConfigure && (
          <button
            type="button"
            onClick={() => {
              if (configOpen) {
                setConfigOpen(false);
                setConfigError(null);
              } else {
                openConfigPanel();
              }
            }}
            aria-expanded={configOpen}
            aria-controls={configPanelId}
            className={`flex items-center gap-1.5 text-xs font-semibold border rounded-lg px-3 py-2 shadow-sm transition-colors cursor-pointer ${
              configOpen
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300'
            }`}
          >
            <Settings size={14} />
            <span>{zh ? '插件源设置' : 'Registry Source'}</span>
          </button>
        )}
      </div>

      {configNotice && (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 flex items-center justify-between gap-2"
        >
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 size={14} className="shrink-0" />
            <span>{configNotice}</span>
          </span>
          <button
            type="button"
            onClick={() => setConfigNotice(null)}
            aria-label={zh ? '关闭提示' : 'Dismiss notice'}
            className="text-emerald-600 hover:text-emerald-900 cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {canConfigure && configOpen && (
        <section
          id={configPanelId}
          data-testid="community-registry-config-panel"
          className="mb-4 bg-white border border-indigo-200 rounded-xl p-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 id={configHeadingId} className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <Settings size={14} className="text-indigo-600" />
              <span>{zh ? '社区插件源设置' : 'Community Registry Settings'}</span>
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
              {data?.configSource === 'database'
                ? zh
                  ? '当前来源：界面配置（覆盖环境变量）'
                  : 'Source: UI setting (overrides env)'
                : data?.configSource === 'env'
                  ? zh
                    ? `当前来源：环境变量 ${data.envVar || 'PLUGIN_COMMUNITY_REGISTRY_URL'}`
                    : `Source: env ${data.envVar || 'PLUGIN_COMMUNITY_REGISTRY_URL'}`
                  : zh
                    ? '当前状态：未配置'
                    : 'Status: Not configured'}
            </span>
          </div>
          {renderRegistryConfigForm()}
        </section>
      )}

      {!configOpen && renderInstallToggle({ compact: true })}

      {/* 来源与统计 */}
      {data?.source && status === 'ready' && (
        <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1">
            <Store size={11} />
            <span className="font-mono">{hostOf(data.source)}</span>
          </span>
          <span>
            {zh
              ? `${visiblePlugins.length} / ${data.plugins.length} 个插件`
              : `${visiblePlugins.length} of ${data.plugins.length} plugins`}
          </span>
          {data.fetchedAt && (
            <span className="font-mono">
              {zh ? '更新于 ' : 'Fetched '}
              {new Date(data.fetchedAt).toLocaleTimeString(zh ? 'zh-CN' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          {data.skipped > 0 && (
            <span
              title={
                zh ? '注册表中存在格式非法或地址不安全的条目' : 'Registry entries with invalid format or unsafe URLs'
              }
            >
              ⚠️ {zh ? `${data.skipped} 条记录被忽略` : `${data.skipped} entries ignored`}
            </span>
          )}
        </div>
      )}

      {/* 标签筛选 */}
      {allTags.length > 0 && status === 'ready' && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4" data-testid="community-tag-filters">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer ${
              activeTag === null
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600'
            }`}
          >
            {zh ? '全部' : 'All'}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors cursor-pointer ${
                activeTag === tag
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* 错误态 */}
      {status === 'error' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">
              {zh ? '社区插件市场加载失败' : 'Failed to load the community market'}
            </p>
            <p className="text-xs text-amber-700 mt-1 break-all">{error}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadRegistry(true)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer"
              >
                {zh ? '重试' : 'Retry'}
              </button>
              {canConfigure && !configOpen && (
                <button
                  type="button"
                  onClick={openConfigPanel}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  {zh ? '修改插件源' : 'Edit registry source'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 加载骨架 */}
      {status === 'loading' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* 空态 */}
      {status === 'ready' && visiblePlugins.length === 0 && (
        <div className="text-center py-16">
          <Package size={44} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-medium text-gray-500">
            {data?.plugins.length
              ? zh
                ? '没有符合当前筛选条件的插件'
                : 'No plugins match the current filters'
              : zh
                ? '社区注册表暂时没有可用插件'
                : 'The community registry has no plugins yet'}
          </p>
          {data?.plugins.length ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setActiveTag(null);
                setHideInstalled(false);
              }}
              className="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
            >
              {zh ? '清除筛选条件' : 'Clear filters'}
            </button>
          ) : null}
        </div>
      )}

      {/* 预览卡片 */}
      {status === 'ready' && visiblePlugins.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4">
          {visiblePlugins.map((plugin) => {
            const state = installStates[plugin.id];
            const installed = isInstalled(plugin);
            const installLabel = installed
              ? plugin.hasUpdate
                ? zh
                  ? `更新至 v${plugin.version}`
                  : `Update to v${plugin.version}`
                : zh
                  ? '已安装'
                  : 'Installed'
              : zh
                ? '安装'
                : 'Install';

            return (
              <article
                key={plugin.id}
                data-testid={`community-card-${plugin.id}`}
                className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col gap-3 relative overflow-hidden"
              >
                {/* 角标 */}
                <div className="absolute top-0 right-0 p-3 flex items-center gap-1.5 flex-wrap justify-end">
                  {plugin.featured && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white flex items-center gap-1 shadow-sm">
                      <Sparkles size={9} />
                      {zh ? '精选' : 'FEATURED'}
                    </span>
                  )}
                  {plugin.verified && (
                    <span
                      title={zh ? '官方安全社区插件' : 'Official safe community plugin'}
                      className="text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                    >
                      <BadgeCheck size={11} />
                      {zh ? '已认证' : 'VERIFIED'}
                    </span>
                  )}
                </div>

                {/* 头部 */}
                <div className="flex items-start gap-3 pr-20">
                  <PluginIcon plugin={plugin} />
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-gray-900 truncate" title={plugin.name}>
                      {plugin.name}
                    </h4>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-400 min-w-0">
                      <span className="truncate">{plugin.author}</span>
                      {plugin.version && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="font-mono shrink-0">v{plugin.version}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* 描述 */}
                <p className="text-sm text-gray-600 leading-relaxed line-clamp-3 min-h-[3.6rem]">
                  {plugin.description || (zh ? '该插件未提供描述。' : 'No description provided.')}
                </p>

                {/* 标签与权限 */}
                {(plugin.tags.length > 0 || plugin.capabilities.length > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {plugin.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                    {plugin.capabilities.length > 0 && (
                      <span
                        title={plugin.capabilities.join('\n')}
                        className="inline-flex items-center gap-1 text-xs font-medium bg-rose-50 text-rose-600 border border-rose-100 px-2 py-0.5 rounded-full"
                      >
                        <Shield size={9} />
                        {zh
                          ? `${plugin.capabilities.length} 项权限`
                          : `${plugin.capabilities.length} permission${plugin.capabilities.length > 1 ? 's' : ''}`}
                      </span>
                    )}
                    {installed && plugin.installedVersion && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-full">
                        {zh ? '已装' : 'Installed'} v{plugin.installedVersion}
                      </span>
                    )}
                  </div>
                )}

                {/* 元信息 */}
                <div className="mt-auto flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-2 gap-2 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      {plugin.downloads !== null && (
                        <span className="inline-flex items-center gap-1" title={zh ? '下载量' : 'Downloads'}>
                          <Download size={10} />
                          {formatCount(plugin.downloads, lang)}
                        </span>
                      )}
                      {plugin.stars !== null && (
                        <span className="inline-flex items-center gap-1" title={zh ? '收藏数' : 'Stars'}>
                          <Star size={10} />
                          {formatCount(plugin.stars, lang)}
                        </span>
                      )}
                      {plugin.license && <span className="font-mono">{plugin.license}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {sanitizeHref(plugin.repository) && (
                        <a
                          href={sanitizeHref(plugin.repository) as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={zh ? '查看源码仓库' : 'View source repository'}
                          className="inline-flex items-center gap-1 text-xs font-mono text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded border border-indigo-200/60 transition-colors"
                        >
                          <Github size={10} />
                          <span>{zh ? '源码' : 'Code'}</span>
                        </a>
                      )}
                      {sanitizeHref(plugin.homepage) && (
                        <a
                          href={sanitizeHref(plugin.homepage) as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={zh ? '打开主页' : 'Open homepage'}
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 bg-gray-50 hover:bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 transition-colors"
                        >
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* 操作区 */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleInstall(plugin, true);
                      }}
                      disabled={state?.phase === 'installing' || (installed && !plugin.hasUpdate)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 shrink-0 disabled:cursor-default ${
                        installed && !plugin.hasUpdate
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-700 hover:to-violet-700 shadow-sm disabled:opacity-60 cursor-pointer'
                      }`}
                    >
                      {state?.phase === 'installing' ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : installed && !plugin.hasUpdate ? (
                        <CheckCircle2 size={12} />
                      ) : (
                        <Download size={12} />
                      )}
                      <span>{installLabel}</span>
                    </button>
                    {state && (
                      <span
                        className={`text-xs ${
                          state.phase === 'error'
                            ? 'text-rose-600 break-words flex-1 min-w-[12rem]'
                            : state.phase === 'success'
                              ? 'text-emerald-600 truncate'
                              : 'text-gray-400 truncate'
                        }`}
                        title={state.message}
                        role={state.phase === 'error' ? 'alert' : undefined}
                      >
                        {state.message}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PluginCommunityPanel;
