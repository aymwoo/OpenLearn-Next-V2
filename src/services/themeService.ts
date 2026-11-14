import type {
  ThemeAppearanceOverrides,
  ThemeColorMode,
  ValidatedThemeBundle,
} from '../../packages/core/themes/theme-spec';

export interface ThemeCatalogEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  latestVersion: string;
  uploaderId: string;
  uploaderName: string;
  isOwner: boolean;
  status: 'active' | 'disabled';
  supportsModes: Array<'light' | 'dark'>;
  platformMinVersion: string | null;
  platformMaxVersion: string | null;
  compatible: boolean;
  compatibilityReason?: string;
  previewImageUrl: string | null;
  changelog?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ServerUserThemeState {
  principalKey: string;
  themeId: string;
  installedVersion: string | null;
  latestVersion: string | null;
  upgradeAvailable: boolean;
  upgradeChangelog?: string;
  mode: ThemeColorMode;
  appearanceOverrides: ThemeAppearanceOverrides;
  activeBundle: ValidatedThemeBundle | null;
  defaultSiteThemeId: string;
  fallbackApplied: boolean;
  fallbackReason?: string;
  updatedAt: number;
}

export interface PublicThemeSummary {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  supportsModes: Array<'light' | 'dark'>;
  previewImageUrl: string | null;
}

export interface PublicThemesResponse {
  defaultThemeId: string;
  defaultThemeBundle: ValidatedThemeBundle | null;
  availablePublicThemes: PublicThemeSummary[];
  builtinThemes: string[];
}

export async function fetchPublicThemesApi(): Promise<PublicThemesResponse | null> {
  try {
    const res = await fetch('/api/themes/public');
    if (!res.ok) return null;
    return (await res.json()) as PublicThemesResponse;
  } catch {
    return null;
  }
}

export async function fetchThemeCatalogApi(): Promise<ThemeCatalogEntry[] | null> {
  try {
    const res = await fetch('/api/themes');
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.themes) ? (data.themes as ThemeCatalogEntry[]) : [];
  } catch {
    return null;
  }
}

export async function fetchMyThemeStateApi(): Promise<ServerUserThemeState | null> {
  try {
    const res = await fetch('/api/themes/me');
    if (!res.ok) return null;
    return (await res.json()) as ServerUserThemeState;
  } catch {
    return null;
  }
}

export async function updateMyThemeStateApi(payload: {
  themeId?: string;
  installedVersion?: string | null;
  mode?: ThemeColorMode;
  appearanceOverrides?: ThemeAppearanceOverrides;
}): Promise<ServerUserThemeState> {
  const res = await fetch('/api/themes/me', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || '保存主题偏好失败');
  }
  return data as ServerUserThemeState;
}

export async function resetMyThemeStateApi(): Promise<ServerUserThemeState | null> {
  try {
    const res = await fetch('/api/themes/me/reset', { method: 'POST' });
    if (!res.ok) return null;
    return (await res.json()) as ServerUserThemeState;
  } catch {
    return null;
  }
}

export async function installThemeZipApi(
  fileOrBuffer: File | ArrayBuffer | Uint8Array,
): Promise<{ item: ThemeCatalogEntry; bundle: ValidatedThemeBundle; isUpdate: boolean }> {
  const body =
    fileOrBuffer instanceof Uint8Array
      ? fileOrBuffer
      : fileOrBuffer instanceof ArrayBuffer
        ? new Uint8Array(fileOrBuffer)
        : fileOrBuffer;

  const res = await fetch('/api/themes/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: body as BodyInit,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || '主题包安装失败');
  }
  return data as { item: ThemeCatalogEntry; bundle: ValidatedThemeBundle; isUpdate: boolean };
}

export async function disableThemeApi(themeId: string): Promise<ThemeCatalogEntry> {
  const res = await fetch(`/api/themes/${encodeURIComponent(themeId)}/disable`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || '停用主题失败');
  }
  return data.theme as ThemeCatalogEntry;
}

export async function enableThemeApi(themeId: string): Promise<ThemeCatalogEntry> {
  const res = await fetch(`/api/themes/${encodeURIComponent(themeId)}/enable`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || '启用主题失败');
  }
  return data.theme as ThemeCatalogEntry;
}

export async function deleteThemeApi(themeId: string): Promise<void> {
  const res = await fetch(`/api/themes/${encodeURIComponent(themeId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || '删除主题失败');
  }
}

export function getThemeExportUrl(themeId: string, version?: string | null): string {
  const base = `/api/themes/${encodeURIComponent(themeId)}/export`;
  return version ? `${base}?version=${encodeURIComponent(version)}` : base;
}

export async function fetchThemeBundleApi(
  themeId: string,
  version?: string | null,
): Promise<{ bundle: ValidatedThemeBundle; compatible: boolean; compatibilityReason?: string } | null> {
  try {
    const query = version ? `?version=${encodeURIComponent(version)}` : '';
    const res = await fetch(`/api/themes/${encodeURIComponent(themeId)}/bundle${query}`);
    if (!res.ok) return null;
    return (await res.json()) as { bundle: ValidatedThemeBundle; compatible: boolean; compatibilityReason?: string };
  } catch {
    return null;
  }
}

export function resolveThemeAssetUrl(themeId: string, version: string, relativePath: string): string {
  const clean = relativePath.replace(/^\.?\//, '');
  return `/api/themes/${encodeURIComponent(themeId)}/assets/${encodeURIComponent(version)}/${clean
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}
