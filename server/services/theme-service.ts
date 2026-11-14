import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import semver from 'semver';
import {
  BUILTIN_THEME_IDS,
  ThemeValidationError,
  checkPlatformCompatibility,
  isBuiltinThemeId,
  normalizeSafeRelativeAssetPath,
  resolveSafeLayouts,
  sanitizeCssTokenValue,
  type ThemeAppearanceOverrides,
  type ThemeColorMode,
  type ThemePackageManifest,
  type ValidatedThemeBundle,
} from '../../packages/core/themes/theme-spec.js';
import { buildThemeZipBuffer, parseAndValidateThemeZip } from '../../packages/core/themes/theme-package.js';
import { PLATFORM_VERSION } from '../../packages/core/version.js';
import type { Session } from '../middleware/auth.js';
import { getDataDir } from '../utils/paths.js';

export interface ThemeActor {
  principalKey: string;
  role: 'administrator' | 'teacher' | 'student';
  displayName: string;
}

export interface ThemeCatalogItem {
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

export interface UserThemePreferenceState {
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

const VALID_THEME_ID_SEGMENT = /^[a-z0-9][a-z0-9._-]{1,62}$/;
const VALID_VERSION_SEGMENT = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function getPrincipalKeyFromSession(session: Session): string {
  const normalizedRole =
    session.subRole === 'administrator' || session.role === 'admin' || session.role === 'administrator'
      ? 'administrator'
      : session.role || 'student';
  if (normalizedRole === 'student') {
    const id = String(session.studentId || session.userId || '').trim();
    return `student:${id}`;
  }
  const id = String(session.userId || session.username || '').trim();
  return `${normalizedRole}:${id}`;
}

export function getThemeActorFromSession(session: Session): ThemeActor {
  const normalizedRole =
    session.subRole === 'administrator' || session.role === 'admin' || session.role === 'administrator'
      ? 'administrator'
      : session.role === 'teacher'
        ? 'teacher'
        : 'student';
  return {
    principalKey: getPrincipalKeyFromSession(session),
    role: normalizedRole,
    displayName: String(session.name || session.username || normalizedRole),
  };
}

export function sanitizeAppearanceOverrides(raw: unknown): ThemeAppearanceOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const input = raw as Record<string, unknown>;
  const out: ThemeAppearanceOverrides = {};

  if (typeof input.primaryColor === 'string') {
    const trimmed = input.primaryColor.trim();
    if (trimmed && HEX_COLOR_REGEX.test(trimmed)) {
      out.primaryColor = sanitizeCssTokenValue('--color-primary', trimmed);
    }
  }
  if (input.borderRadius === 'sharp' || input.borderRadius === 'rounded' || input.borderRadius === 'pill') {
    out.borderRadius = input.borderRadius;
  }
  if (input.density === 'compact' || input.density === 'comfortable' || input.density === 'spacious') {
    out.density = input.density;
  }
  if (input.fontScale !== undefined) {
    const scale = Number(input.fontScale);
    if (Number.isFinite(scale)) {
      out.fontScale = Math.min(1.25, Math.max(0.85, Number(scale.toFixed(2))));
    }
  }
  return out;
}

type ThemeDatabase = Pick<Database.Database, 'prepare' | 'transaction'>;

interface ThemeRow {
  id: string;
  name: string;
  description?: string | null;
  author?: string | null;
  latest_version: string;
  uploader_id: string;
  uploader_name?: string | null;
  status: string;
  supports_modes?: string | null;
  platform_min_version?: string | null;
  platform_max_version?: string | null;
  manifest_json?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
}

interface ThemeVersionRow {
  theme_id: string;
  version: string;
  manifest_json?: string | null;
  styles_css?: string | null;
  asset_manifest_json?: string | null;
}

interface UserThemePrefRow {
  principal_key: string;
  theme_id?: string | null;
  installed_version?: string | null;
  mode?: string | null;
  appearance_json?: string | null;
  updated_at?: number | null;
}

export class ThemeService {
  private db: ThemeDatabase;

  constructor(db: ThemeDatabase) {
    this.db = db;
  }

  private getThemesRootDir(): string {
    return path.resolve(getDataDir(), 'themes');
  }

  private getVersionDir(themeId: string, version: string): string {
    if (!VALID_THEME_ID_SEGMENT.test(themeId) || !VALID_VERSION_SEGMENT.test(version)) {
      throw new ThemeValidationError('INVALID_PATH', '非法的主题 ID 或版本号');
    }
    const root = this.getThemesRootDir();
    const target = path.resolve(root, themeId, version);
    if (!target.startsWith(root + path.sep)) {
      throw new ThemeValidationError('INVALID_PATH', '主题存储路径越界');
    }
    return target;
  }

  buildAssetUrl(themeId: string, version: string, relativePath: string): string {
    const normalized = normalizeSafeRelativeAssetPath(relativePath);
    if (!normalized) return '';
    return `/api/themes/${encodeURIComponent(themeId)}/assets/${encodeURIComponent(version)}/${normalized
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  private buildBundleFromRow(
    themeRow: ThemeRow | undefined,
    versionRow: ThemeVersionRow | undefined,
  ): ValidatedThemeBundle | null {
    if (!themeRow || !versionRow) return null;
    try {
      const manifest = JSON.parse(versionRow.manifest_json || '{}') as ThemePackageManifest;
      const assetPaths = JSON.parse(versionRow.asset_manifest_json || '[]') as string[];
      const baseTokens = manifest.tokens || {};
      const lightTokens = { ...baseTokens, ...(manifest.modes?.light?.tokens || {}) };
      const darkTokens = {
        ...baseTokens,
        ...(Object.keys(manifest.modes?.dark?.tokens || {}).length > 0
          ? manifest.modes?.dark?.tokens
          : manifest.modes?.light?.tokens || {}),
      };
      return {
        manifest,
        modes: {
          light: lightTokens,
          dark: darkTokens,
        },
        typography: manifest.typography || {},
        appearance: manifest.appearance || {},
        layouts: resolveSafeLayouts(manifest.layouts),
        scopedCss: String(versionRow.styles_css || ''),
        assetPaths: Array.isArray(assetPaths) ? assetPaths : [],
      };
    } catch {
      return null;
    }
  }

  getDefaultSiteThemeId(): string {
    try {
      const row = this.db.prepare('SELECT default_theme_id FROM site_settings WHERE id = ?').get('global') as
        { default_theme_id?: string | null } | undefined;
      const candidate = String(row?.default_theme_id || '').trim();
      if (!candidate) return 'light';
      if (isBuiltinThemeId(candidate)) return candidate;
      const activeTheme = this.db
        .prepare('SELECT id, status, platform_min_version, platform_max_version FROM themes WHERE id = ?')
        .get(candidate) as
        Pick<ThemeRow, 'id' | 'status' | 'platform_min_version' | 'platform_max_version'> | undefined;
      if (!activeTheme || activeTheme.status !== 'active') {
        return 'light';
      }
      const compat = checkPlatformCompatibility(
        {
          minPlatformVersion: activeTheme.platform_min_version || undefined,
          maxPlatformVersion: activeTheme.platform_max_version || undefined,
        },
        PLATFORM_VERSION,
      );
      return compat.compatible ? candidate : 'light';
    } catch {
      return 'light';
    }
  }

  getThemeBundle(
    themeId: string,
    requestedVersion?: string | null,
  ): {
    bundle: ValidatedThemeBundle | null;
    version: string | null;
    status: 'active' | 'disabled' | 'missing';
    latestVersion: string | null;
    compatible: boolean;
    compatibilityReason?: string;
    changelog?: string;
  } {
    if (isBuiltinThemeId(themeId)) {
      return {
        bundle: null,
        version: null,
        status: 'active',
        latestVersion: null,
        compatible: true,
      };
    }

    const themeRow = this.db.prepare('SELECT * FROM themes WHERE id = ?').get(themeId) as ThemeRow | undefined;
    if (!themeRow) {
      return {
        bundle: null,
        version: null,
        status: 'missing',
        latestVersion: null,
        compatible: false,
        compatibilityReason: '主题不存在或已被移除',
      };
    }

    const status = themeRow.status === 'disabled' ? 'disabled' : 'active';
    const targetVersion =
      requestedVersion && VALID_VERSION_SEGMENT.test(requestedVersion)
        ? requestedVersion
        : String(themeRow.latest_version);

    let versionRow = this.db
      .prepare('SELECT * FROM theme_versions WHERE theme_id = ? AND version = ?')
      .get(themeId, targetVersion) as ThemeVersionRow | undefined;

    if (!versionRow && targetVersion !== themeRow.latest_version) {
      versionRow = this.db
        .prepare('SELECT * FROM theme_versions WHERE theme_id = ? AND version = ?')
        .get(themeId, themeRow.latest_version) as ThemeVersionRow | undefined;
    }

    const bundle = this.buildBundleFromRow(themeRow, versionRow);
    if (!bundle) {
      return {
        bundle: null,
        version: null,
        status: 'missing',
        latestVersion: themeRow.latest_version,
        compatible: false,
        compatibilityReason: '主题包数据损坏或无法解析',
      };
    }

    const compat = checkPlatformCompatibility(bundle.manifest.compatibility, PLATFORM_VERSION);
    return {
      bundle,
      version: bundle.manifest.version,
      status,
      latestVersion: String(themeRow.latest_version),
      compatible: compat.compatible,
      compatibilityReason: compat.reason,
      changelog: bundle.manifest.changelog,
    };
  }

  async installThemePackage(
    zipBuffer: Buffer,
    actor: ThemeActor,
  ): Promise<{
    item: ThemeCatalogItem;
    bundle: ValidatedThemeBundle;
    isUpdate: boolean;
  }> {
    const parsed = await parseAndValidateThemeZip(zipBuffer, { platformVersion: PLATFORM_VERSION });
    const { bundle, assets } = parsed;
    const { manifest } = bundle;
    const now = Date.now();

    if (isBuiltinThemeId(manifest.id)) {
      throw new ThemeValidationError('BUILTIN_CONFLICT', `不能覆盖系统内置主题 "${manifest.id}"`);
    }

    const existing = this.db.prepare('SELECT * FROM themes WHERE id = ?').get(manifest.id) as ThemeRow | undefined;
    const isUpdate = Boolean(existing);

    if (existing) {
      if (existing.uploader_id !== actor.principalKey) {
        throw new ThemeValidationError('UPLOADER_MISMATCH', '该主题已由其他账号发布，只有原上传者可以发布更高版本更新');
      }
      const existingSemver = semver.valid(existing.latest_version);
      const nextSemver = semver.valid(manifest.version);
      if (existingSemver && nextSemver && !semver.gt(nextSemver, existingSemver)) {
        throw new ThemeValidationError(
          'VERSION_NOT_HIGHER',
          `更新版本 (${manifest.version}) 必须高于当前最新版本 (${existing.latest_version})`,
        );
      }
    }

    // Write static assets to disk cleanly before recording DB rows
    const versionDir = this.getVersionDir(manifest.id, manifest.version);
    fs.mkdirSync(versionDir, { recursive: true });
    for (const [relPath, buf] of assets.entries()) {
      const normalized = normalizeSafeRelativeAssetPath(relPath);
      if (!normalized) continue;
      const dest = path.resolve(versionDir, normalized);
      if (!dest.startsWith(versionDir + path.sep)) {
        throw new ThemeValidationError('INVALID_PATH', `非法资源路径: ${relPath}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }

    const supportsModes: Array<'light' | 'dark'> = [];
    if (manifest.modes?.light || manifest.tokens || Object.keys(bundle.modes.light).length > 0) {
      supportsModes.push('light');
    }
    if (manifest.modes?.dark && Object.keys(manifest.modes.dark.tokens || {}).length > 0) {
      supportsModes.push('dark');
    }
    if (supportsModes.length === 0) {
      supportsModes.push('light');
    }

    const manifestJson = JSON.stringify(manifest);
    const assetManifestJson = JSON.stringify(bundle.assetPaths);
    const supportsModesJson = JSON.stringify(supportsModes);

    const tx = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            `UPDATE themes
             SET name = ?, description = ?, author = ?, latest_version = ?, supports_modes = ?,
                 platform_min_version = ?, platform_max_version = ?, manifest_json = ?, styles_css = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            manifest.name,
            manifest.description || '',
            manifest.author || actor.displayName,
            manifest.version,
            supportsModesJson,
            manifest.compatibility?.minPlatformVersion || null,
            manifest.compatibility?.maxPlatformVersion || null,
            manifestJson,
            bundle.scopedCss,
            now,
            manifest.id,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO themes (
              id, name, description, author, latest_version, uploader_id, uploader_name,
              status, supports_modes, platform_min_version, platform_max_version,
              manifest_json, styles_css, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            manifest.id,
            manifest.name,
            manifest.description || '',
            manifest.author || actor.displayName,
            manifest.version,
            actor.principalKey,
            actor.displayName,
            supportsModesJson,
            manifest.compatibility?.minPlatformVersion || null,
            manifest.compatibility?.maxPlatformVersion || null,
            manifestJson,
            bundle.scopedCss,
            now,
            now,
          );
      }

      this.db
        .prepare(
          `INSERT OR REPLACE INTO theme_versions (
            theme_id, version, manifest_json, styles_css, asset_manifest_json, uploader_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(manifest.id, manifest.version, manifestJson, bundle.scopedCss, assetManifestJson, actor.principalKey, now);
    });
    tx();

    // Note: intentionally DO NOT mutate other users' user_theme_preferences rows!
    // Users opt into upgrading to latest_version from their own theme center UI.
    const row = this.db.prepare('SELECT * FROM themes WHERE id = ?').get(manifest.id) as ThemeRow;
    return {
      item: this.mapRowToCatalogItem(row, actor),
      bundle,
      isUpdate,
    };
  }

  private mapRowToCatalogItem(row: ThemeRow, actor?: ThemeActor): ThemeCatalogItem {
    let manifest: ThemePackageManifest | null;
    try {
      manifest = JSON.parse(row.manifest_json || '{}') as ThemePackageManifest;
    } catch {
      manifest = null;
    }
    let supportsModes: Array<'light' | 'dark'> = ['light'];
    try {
      const parsedModes = JSON.parse(row.supports_modes || '["light"]');
      if (Array.isArray(parsedModes) && parsedModes.length > 0) {
        supportsModes = parsedModes;
      }
    } catch {
      supportsModes = ['light'];
    }
    const compat = checkPlatformCompatibility(
      {
        minPlatformVersion: row.platform_min_version || undefined,
        maxPlatformVersion: row.platform_max_version || undefined,
      },
      PLATFORM_VERSION,
    );
    const previewImageUrl =
      manifest?.previewImage && row.latest_version
        ? this.buildAssetUrl(row.id, row.latest_version, manifest.previewImage)
        : null;

    return {
      id: row.id,
      name: row.name,
      description: row.description || '',
      author: row.author || row.uploader_name || 'Unknown',
      latestVersion: row.latest_version,
      uploaderId: row.uploader_id,
      uploaderName: row.uploader_name || '',
      isOwner: Boolean(actor && row.uploader_id === actor.principalKey),
      status: row.status === 'disabled' ? 'disabled' : 'active',
      supportsModes,
      platformMinVersion: row.platform_min_version || null,
      platformMaxVersion: row.platform_max_version || null,
      compatible: compat.compatible,
      compatibilityReason: compat.reason,
      previewImageUrl,
      changelog: manifest?.changelog,
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
  }

  listCatalog(actor?: ThemeActor): ThemeCatalogItem[] {
    const isAdmin = actor?.role === 'administrator';
    const sql = isAdmin
      ? 'SELECT * FROM themes ORDER BY updated_at DESC'
      : "SELECT * FROM themes WHERE status = 'active' ORDER BY updated_at DESC";
    const rows = this.db.prepare(sql).all() as ThemeRow[];
    return rows.map((row) => this.mapRowToCatalogItem(row, actor));
  }

  getUserThemeState(principalKey: string): UserThemePreferenceState {
    const defaultSiteThemeId = this.getDefaultSiteThemeId();
    const pref = this.db.prepare('SELECT * FROM user_theme_preferences WHERE principal_key = ?').get(principalKey) as
      UserThemePrefRow | undefined;

    if (!pref) {
      const resolvedDefault = this.resolveActiveOrFallback(defaultSiteThemeId, null);
      return {
        principalKey,
        themeId: resolvedDefault.themeId,
        installedVersion: resolvedDefault.installedVersion,
        latestVersion: resolvedDefault.latestVersion,
        upgradeAvailable: false,
        mode: 'auto',
        appearanceOverrides: {},
        activeBundle: resolvedDefault.bundle,
        defaultSiteThemeId,
        fallbackApplied: resolvedDefault.fallbackApplied,
        fallbackReason: resolvedDefault.fallbackReason,
        updatedAt: Date.now(),
      };
    }

    let appearanceOverrides: ThemeAppearanceOverrides;
    try {
      appearanceOverrides = sanitizeAppearanceOverrides(JSON.parse(pref.appearance_json || '{}'));
    } catch {
      appearanceOverrides = {};
    }

    const mode: ThemeColorMode =
      pref.mode === 'light' || pref.mode === 'dark' || pref.mode === 'auto' ? pref.mode : 'auto';

    const requestedThemeId = String(pref.theme_id || defaultSiteThemeId || 'light');
    const requestedVersion = pref.installed_version ? String(pref.installed_version) : null;

    if (isBuiltinThemeId(requestedThemeId)) {
      return {
        principalKey,
        themeId: requestedThemeId,
        installedVersion: null,
        latestVersion: null,
        upgradeAvailable: false,
        mode,
        appearanceOverrides,
        activeBundle: null,
        defaultSiteThemeId,
        fallbackApplied: false,
        updatedAt: Number(pref.updated_at || Date.now()),
      };
    }

    const lookup = this.getThemeBundle(requestedThemeId, requestedVersion);
    if (lookup.status === 'active' && lookup.bundle && lookup.compatible) {
      const installedVer = lookup.version;
      const latestVer = lookup.latestVersion;
      let upgradeAvailable = false;
      let upgradeChangelog: string | undefined;
      if (installedVer && latestVer && semver.valid(installedVer) && semver.valid(latestVer)) {
        upgradeAvailable = semver.gt(latestVer, installedVer);
        if (upgradeAvailable) {
          const latestRow = this.db
            .prepare('SELECT manifest_json FROM theme_versions WHERE theme_id = ? AND version = ?')
            .get(requestedThemeId, latestVer) as Pick<ThemeVersionRow, 'manifest_json'> | undefined;
          try {
            const latestManifest = JSON.parse(latestRow?.manifest_json || '{}') as ThemePackageManifest;
            upgradeChangelog = latestManifest.changelog;
          } catch {
            // ignore
          }
        }
      }

      return {
        principalKey,
        themeId: requestedThemeId,
        installedVersion: installedVer,
        latestVersion: latestVer,
        upgradeAvailable,
        upgradeChangelog,
        mode,
        appearanceOverrides,
        activeBundle: lookup.bundle,
        defaultSiteThemeId,
        fallbackApplied: false,
        updatedAt: Number(pref.updated_at || Date.now()),
      };
    }

    // Selected third-party theme is disabled, missing, or incompatible -> clean fallback
    const fallbackReason =
      lookup.status === 'disabled'
        ? `当前主题 (${requestedThemeId}) 已被管理员停用，已自动回退到安全默认主题`
        : lookup.compatibilityReason || `当前主题 (${requestedThemeId}) 不可用，已自动回退到安全默认主题`;

    const fallback = this.resolveActiveOrFallback(defaultSiteThemeId, null);
    return {
      principalKey,
      themeId: fallback.themeId,
      installedVersion: fallback.installedVersion,
      latestVersion: fallback.latestVersion,
      upgradeAvailable: false,
      mode,
      appearanceOverrides,
      activeBundle: fallback.bundle,
      defaultSiteThemeId,
      fallbackApplied: true,
      fallbackReason,
      updatedAt: Number(pref.updated_at || Date.now()),
    };
  }

  private resolveActiveOrFallback(
    candidateThemeId: string,
    requestedVersion: string | null,
  ): {
    themeId: string;
    installedVersion: string | null;
    latestVersion: string | null;
    bundle: ValidatedThemeBundle | null;
    fallbackApplied: boolean;
    fallbackReason?: string;
  } {
    if (isBuiltinThemeId(candidateThemeId)) {
      return {
        themeId: candidateThemeId,
        installedVersion: null,
        latestVersion: null,
        bundle: null,
        fallbackApplied: false,
      };
    }
    const lookup = this.getThemeBundle(candidateThemeId, requestedVersion);
    if (lookup.status === 'active' && lookup.bundle && lookup.compatible) {
      return {
        themeId: candidateThemeId,
        installedVersion: lookup.version,
        latestVersion: lookup.latestVersion,
        bundle: lookup.bundle,
        fallbackApplied: false,
      };
    }
    return {
      themeId: 'light',
      installedVersion: null,
      latestVersion: null,
      bundle: null,
      fallbackApplied: true,
      fallbackReason: lookup.compatibilityReason || '站点默认第三方主题不可用，已自动恢复到内置浅色主题',
    };
  }

  updateUserThemePreference(
    principalKey: string,
    input: {
      themeId?: string;
      installedVersion?: string | null;
      mode?: ThemeColorMode;
      appearanceOverrides?: ThemeAppearanceOverrides;
    },
  ): UserThemePreferenceState {
    const existing = this.getUserThemeState(principalKey);
    const nextThemeId =
      typeof input.themeId === 'string' && input.themeId.trim() ? input.themeId.trim() : existing.themeId;

    let pinnedVersion: string | null;
    if (isBuiltinThemeId(nextThemeId)) {
      pinnedVersion = null;
    } else {
      const requestedVer =
        input.installedVersion !== undefined
          ? input.installedVersion
          : nextThemeId === existing.themeId
            ? existing.installedVersion
            : null;
      const lookup = this.getThemeBundle(nextThemeId, requestedVer);
      if (lookup.status !== 'active' || !lookup.bundle) {
        throw new ThemeValidationError(
          'THEME_UNAVAILABLE',
          lookup.status === 'disabled' ? '该主题已被管理员停用' : '指定主题不存在或已卸载',
        );
      }
      if (!lookup.compatible) {
        throw new ThemeValidationError('INCOMPATIBLE_PLATFORM', lookup.compatibilityReason || '主题不兼容当前平台版本');
      }
      pinnedVersion = lookup.version;
    }

    const nextMode: ThemeColorMode =
      input.mode === 'light' || input.mode === 'dark' || input.mode === 'auto' ? input.mode : existing.mode;
    const nextOverrides =
      input.appearanceOverrides !== undefined
        ? sanitizeAppearanceOverrides(input.appearanceOverrides)
        : existing.appearanceOverrides;

    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO user_theme_preferences (
          principal_key, theme_id, installed_version, mode, appearance_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(principal_key) DO UPDATE SET
          theme_id = excluded.theme_id,
          installed_version = excluded.installed_version,
          mode = excluded.mode,
          appearance_json = excluded.appearance_json,
          updated_at = excluded.updated_at`,
      )
      .run(principalKey, nextThemeId, pinnedVersion, nextMode, JSON.stringify(nextOverrides), now);

    return this.getUserThemeState(principalKey);
  }

  resetUserThemePreference(principalKey: string): UserThemePreferenceState {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO user_theme_preferences (
          principal_key, theme_id, installed_version, mode, appearance_json, updated_at
        ) VALUES (?, 'light', NULL, 'light', '{}', ?)
        ON CONFLICT(principal_key) DO UPDATE SET
          theme_id = 'light',
          installed_version = NULL,
          mode = 'light',
          appearance_json = '{}',
          updated_at = excluded.updated_at`,
      )
      .run(principalKey, now);
    return this.getUserThemeState(principalKey);
  }

  setThemeStatus(themeId: string, status: 'active' | 'disabled'): ThemeCatalogItem {
    if (isBuiltinThemeId(themeId)) {
      throw new ThemeValidationError('BUILTIN_READONLY', '系统内置主题不可停用');
    }
    const existing = this.db.prepare('SELECT * FROM themes WHERE id = ?').get(themeId) as ThemeRow | undefined;
    if (!existing) {
      throw new ThemeValidationError('THEME_NOT_FOUND', '主题不存在');
    }
    const now = Date.now();
    this.db.prepare('UPDATE themes SET status = ?, updated_at = ? WHERE id = ?').run(status, now, themeId);
    if (status === 'disabled') {
      try {
        this.db
          .prepare("UPDATE site_settings SET default_theme_id = 'light' WHERE id = 'global' AND default_theme_id = ?")
          .run(themeId);
      } catch {
        // ignore if site_settings has no matching row
      }
    }
    const updated = this.db.prepare('SELECT * FROM themes WHERE id = ?').get(themeId) as ThemeRow;
    return this.mapRowToCatalogItem(updated);
  }

  deleteTheme(themeId: string): void {
    if (isBuiltinThemeId(themeId)) {
      throw new ThemeValidationError('BUILTIN_READONLY', '系统内置主题不可删除');
    }
    const existing = this.db.prepare('SELECT id FROM themes WHERE id = ?').get(themeId) as
      Pick<ThemeRow, 'id'> | undefined;
    if (!existing) {
      throw new ThemeValidationError('THEME_NOT_FOUND', '主题不存在');
    }
    this.db.prepare('DELETE FROM themes WHERE id = ?').run(themeId);
    try {
      this.db
        .prepare("UPDATE site_settings SET default_theme_id = 'light' WHERE id = 'global' AND default_theme_id = ?")
        .run(themeId);
    } catch {
      // ignore
    }
    const themeRoot = path.resolve(this.getThemesRootDir(), themeId);
    if (themeRoot.startsWith(this.getThemesRootDir() + path.sep) && fs.existsSync(themeRoot)) {
      fs.rmSync(themeRoot, { recursive: true, force: true });
    }
  }

  async exportThemeZip(
    themeId: string,
    requestedVersion?: string | null,
  ): Promise<{ filename: string; buffer: Buffer }> {
    const lookup = this.getThemeBundle(themeId, requestedVersion);
    if (!lookup.bundle || !lookup.version) {
      throw new ThemeValidationError('THEME_NOT_FOUND', '找不到可导出的第三方主题版本');
    }
    const assetsRecord: Record<string, Buffer> = {};
    const versionDir = this.getVersionDir(themeId, lookup.version);
    for (const relPath of lookup.bundle.assetPaths) {
      const normalized = normalizeSafeRelativeAssetPath(relPath);
      if (!normalized) continue;
      const fullPath = path.resolve(versionDir, normalized);
      if (fullPath.startsWith(versionDir + path.sep) && fs.existsSync(fullPath)) {
        assetsRecord[normalized] = fs.readFileSync(fullPath);
      }
    }
    const buffer = await buildThemeZipBuffer({
      manifest: lookup.bundle.manifest,
      stylesCss: lookup.bundle.scopedCss,
      assets: assetsRecord,
    });
    return {
      filename: `${themeId}-${lookup.version}.zip`,
      buffer,
    };
  }

  resolveThemeAssetFile(themeId: string, version: string, rawAssetPath: string): string | null {
    if (!VALID_THEME_ID_SEGMENT.test(themeId) || !VALID_VERSION_SEGMENT.test(version)) {
      return null;
    }
    const normalized = normalizeSafeRelativeAssetPath(rawAssetPath);
    if (!normalized) return null;
    const versionDir = this.getVersionDir(themeId, version);
    const resolved = path.resolve(versionDir, normalized);
    if (!resolved.startsWith(versionDir + path.sep)) {
      return null;
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return null;
    }
    return resolved;
  }

  getPublicPreLoginState(): {
    defaultThemeId: string;
    defaultThemeBundle: ValidatedThemeBundle | null;
    availablePublicThemes: PublicThemeSummary[];
    builtinThemes: readonly string[];
  } {
    const defaultThemeId = this.getDefaultSiteThemeId();
    const defaultLookup = !isBuiltinThemeId(defaultThemeId) ? this.getThemeBundle(defaultThemeId) : null;
    const activeRows = this.db
      .prepare(
        "SELECT id, name, description, author, latest_version, supports_modes, manifest_json FROM themes WHERE status = 'active' ORDER BY updated_at DESC",
      )
      .all() as Array<
      Pick<ThemeRow, 'id' | 'name' | 'description' | 'author' | 'latest_version' | 'supports_modes' | 'manifest_json'>
    >;

    const availablePublicThemes: PublicThemeSummary[] = activeRows.map((row) => {
      let supportsModes: Array<'light' | 'dark'>;
      let previewImageUrl: string | null = null;
      try {
        supportsModes = JSON.parse(row.supports_modes || '["light"]');
      } catch {
        supportsModes = ['light'];
      }
      try {
        const m = JSON.parse(row.manifest_json || '{}') as ThemePackageManifest;
        if (m.previewImage) {
          previewImageUrl = this.buildAssetUrl(row.id, row.latest_version, m.previewImage);
        }
      } catch {
        previewImageUrl = null;
      }
      return {
        id: row.id,
        name: row.name,
        description: row.description || '',
        author: row.author || 'Unknown',
        version: row.latest_version,
        supportsModes,
        previewImageUrl,
      };
    });

    return {
      defaultThemeId,
      defaultThemeBundle: defaultLookup?.bundle || null,
      availablePublicThemes,
      builtinThemes: BUILTIN_THEME_IDS,
    };
  }
}
