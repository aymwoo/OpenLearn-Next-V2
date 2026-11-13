import { create } from 'zustand';
import { v7 as uuidv7 } from 'uuid';
import { frontendEventBus } from '../services/event-bus';
import { broadcastThemeToIframes } from '../services/lms-bridge';
import {
  DEFAULT_LAYOUTS,
  buildRuntimeThemeCss,
  isBuiltinThemeId,
  resolveSafeLayouts,
  type ResolvedThemeLayouts,
  type ThemeAppearanceOverrides,
  type ThemeColorMode,
  type UnifiedPluginThemePayload,
  type ValidatedThemeBundle,
} from '../../packages/core/themes/theme-spec';
import {
  fetchMyThemeStateApi,
  fetchPublicThemesApi,
  fetchThemeCatalogApi,
  installThemeZipApi,
  resetMyThemeStateApi,
  resolveThemeAssetUrl,
  updateMyThemeStateApi,
  type ServerUserThemeState,
  type ThemeCatalogEntry,
} from '../services/themeService';

export type BuiltinThemeId = 'light' | 'dark' | 'eyecare' | 'chalkboard';
export type ThemeId = BuiltinThemeId | string;

export interface ThemeSpec {
  id: ThemeId;
  label: string;
  description: string;
  previewBg: string;
  previewPrimary: string;
  category: 'builtin' | 'custom' | 'plugin';
  pluginId?: string;
}

export const BUILTIN_THEMES: ThemeSpec[] = [
  {
    id: 'light',
    label: '浅色日间',
    description: '明亮通透，适合自然采光良好的日间课堂',
    previewBg: '#f8fafc',
    previewPrimary: '#4f46e5',
    category: 'builtin',
  },
  {
    id: 'dark',
    label: '暗夜极客',
    description: '深邃内敛，适合计算机房与夜间专注备课',
    previewBg: '#0b0f19',
    previewPrimary: '#6366f1',
    category: 'builtin',
  },
  {
    id: 'eyecare',
    label: '教学护眼',
    description: '柔和舒缓，防教室大屏眩光，减轻视觉疲劳',
    previewBg: '#f2f7f4',
    previewPrimary: '#2d6a4f',
    category: 'builtin',
  },
  {
    id: 'chalkboard',
    label: '经典黑板',
    description: '经典墨绿板书质感，沉浸式板书演练',
    previewBg: '#0e1713',
    previewPrimary: '#4caf50',
    category: 'builtin',
  },
];

export const BUILTIN_THEME_TOKENS: Record<BuiltinThemeId, Record<string, string>> = {
  light: {
    '--bg-app': '#f8fafc',
    '--bg-surface': '#ffffff',
    '--bg-surface-secondary': '#f1f5f9',
    '--bg-surface-elevated': '#ffffff',
    '--border-theme': '#e2e8f0',
    '--border-theme-subtle': '#f1f5f9',
    '--text-main': '#0f172a',
    '--text-muted': '#475569',
    '--text-subtle': '#5a6b80',
    '--primary-solid': '#4f46e5',
    '--primary-ink': '#4f46e5',
    '--color-primary': '#4f46e5',
    '--color-primary-hover': '#4338ca',
  },
  dark: {
    '--bg-app': '#0b0f19',
    '--bg-surface': '#111827',
    '--bg-surface-secondary': '#1f2937',
    '--bg-surface-elevated': '#1f2937',
    '--border-theme': '#374151',
    '--border-theme-subtle': '#1f2937',
    '--text-main': '#f9fafb',
    '--text-muted': '#94a3b8',
    '--text-subtle': '#8698ad',
    '--primary-solid': '#4f46e5',
    '--primary-ink': '#818cf8',
    '--color-primary': '#6366f1',
    '--color-primary-hover': '#4f46e5',
  },
  eyecare: {
    '--bg-app': '#f2f7f4',
    '--bg-surface': '#ffffff',
    '--bg-surface-secondary': '#e4eee8',
    '--bg-surface-elevated': '#ffffff',
    '--border-theme': '#cbe0d5',
    '--border-theme-subtle': '#dbeef2',
    '--text-main': '#143526',
    '--text-muted': '#2f5a44',
    '--text-subtle': '#457057',
    '--primary-solid': '#2d6a4f',
    '--primary-ink': '#2d6a4f',
    '--color-primary': '#2d6a4f',
    '--color-primary-hover': '#1b4332',
  },
  chalkboard: {
    '--bg-app': '#0e1713',
    '--bg-surface': '#15241e',
    '--bg-surface-secondary': '#1b2f27',
    '--bg-surface-elevated': '#1f382e',
    '--border-theme': '#28473a',
    '--border-theme-subtle': '#1b2f27',
    '--text-main': '#e8f5e9',
    '--text-muted': '#a5d6a7',
    '--text-subtle': '#66bb6a',
    '--primary-solid': '#2f7d32',
    '--primary-ink': '#66bb6a',
    '--color-primary': '#4caf50',
    '--color-primary-hover': '#388e3c',
  },
};

const STORAGE_KEY = 'openlearn_theme';
const CUSTOM_THEMES_STORAGE_KEY = 'openlearn_custom_themes';
/** Strictly anonymous visual appearance storage ONLY (no userId/username/studentId/personal data). */
export const BROWSER_APPEARANCE_STORAGE_KEY = 'openlearn_browser_appearance';
const THIRDPARTY_STYLE_ELEMENT_ID = 'openlearn-thirdparty-theme';

export interface StoredCustomTheme {
  spec: ThemeSpec;
  cssVariables: Record<string, string>;
}

export interface BrowserAppearanceSnapshot {
  themeId: string;
  mode: ThemeColorMode;
  appearanceOverrides: ThemeAppearanceOverrides;
}

export interface ThemePreviewSnapshot {
  themeId: string;
  bundle: ValidatedThemeBundle | null;
  mode: ThemeColorMode;
  appearanceOverrides: ThemeAppearanceOverrides;
}

const registeredCSSVars: Record<string, Record<string, string>> = {};
const thirdPartyActiveTokens: Record<string, Record<string, string>> = {};

export function getThemeTokens(themeId: ThemeId): Record<string, string> {
  if (thirdPartyActiveTokens[themeId]) {
    return thirdPartyActiveTokens[themeId];
  }
  if (registeredCSSVars[themeId]) {
    return registeredCSSVars[themeId];
  }
  if (themeId in BUILTIN_THEME_TOKENS) {
    return BUILTIN_THEME_TOKENS[themeId as BuiltinThemeId];
  }
  return BUILTIN_THEME_TOKENS.light;
}

function isDarkHexColor(hex?: string): boolean {
  if (!hex || !hex.startsWith('#')) return false;
  const raw = hex.trim().slice(1);
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.slice(0, 6);
  if (full.length !== 6) return false;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return false;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.35;
}

function getSystemPreferredScheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }
  return 'light';
}

function resolveColorScheme(
  themeId: string,
  mode: ThemeColorMode = 'auto',
  bundle?: ValidatedThemeBundle | null,
): 'light' | 'dark' {
  if (themeId === 'dark' || themeId === 'chalkboard') return 'dark';
  if (themeId === 'light' || themeId === 'eyecare') return 'light';

  if (bundle) {
    const effectivePref = mode === 'auto' ? getSystemPreferredScheme() : mode;
    const hasLight = Object.keys(bundle.modes.light || {}).length > 0;
    const hasDark = Object.keys(bundle.modes.dark || {}).length > 0;
    if (effectivePref === 'dark' && hasDark) return 'dark';
    if (effectivePref === 'light' && hasLight) return 'light';
    const candidateBg =
      bundle.modes[effectivePref]?.['--bg-app'] || bundle.modes.light?.['--bg-app'] || bundle.modes.dark?.['--bg-app'];
    return isDarkHexColor(candidateBg) ? 'dark' : 'light';
  }

  const tokens = getThemeTokens(themeId);
  return isDarkHexColor(tokens['--bg-app']) ? 'dark' : 'light';
}

function readAnonymousBrowserAppearance(): BrowserAppearanceSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BROWSER_APPEARANCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.themeId !== 'string') return null;
    const mode: ThemeColorMode =
      parsed.mode === 'light' || parsed.mode === 'dark' || parsed.mode === 'auto' ? parsed.mode : 'auto';
    const appearanceOverrides: ThemeAppearanceOverrides =
      parsed.appearanceOverrides && typeof parsed.appearanceOverrides === 'object' ? parsed.appearanceOverrides : {};
    return {
      themeId: parsed.themeId,
      mode,
      appearanceOverrides,
    };
  } catch {
    return null;
  }
}

function writeAnonymousBrowserAppearance(snapshot: BrowserAppearanceSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    // Strictly sanitize stored object so NO personal/account identifiers can ever be persisted locally.
    const clean: BrowserAppearanceSnapshot = {
      themeId: String(snapshot.themeId || 'light'),
      mode: snapshot.mode === 'light' || snapshot.mode === 'dark' || snapshot.mode === 'auto' ? snapshot.mode : 'auto',
      appearanceOverrides: {
        ...(snapshot.appearanceOverrides?.primaryColor
          ? { primaryColor: snapshot.appearanceOverrides.primaryColor }
          : {}),
        ...(snapshot.appearanceOverrides?.borderRadius
          ? { borderRadius: snapshot.appearanceOverrides.borderRadius }
          : {}),
        ...(snapshot.appearanceOverrides?.density ? { density: snapshot.appearanceOverrides.density } : {}),
        ...(snapshot.appearanceOverrides?.fontScale !== undefined
          ? { fontScale: snapshot.appearanceOverrides.fontScale }
          : {}),
      },
    };
    localStorage.setItem(BROWSER_APPEARANCE_STORAGE_KEY, JSON.stringify(clean));
    localStorage.setItem(STORAGE_KEY, clean.themeId);
  } catch {
    // ignore storage failures
  }
}

function removeThirdPartyStyleTag(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(THIRDPARTY_STYLE_ELEMENT_ID);
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

const OVERRIDE_RADIUS_CARD: Record<NonNullable<ThemeAppearanceOverrides['borderRadius']>, string> = {
  sharp: '0.375rem',
  rounded: '1rem',
  pill: '1.5rem',
};
const OVERRIDE_RADIUS_CTRL: Record<NonNullable<ThemeAppearanceOverrides['borderRadius']>, string> = {
  sharp: '0.25rem',
  rounded: '0.75rem',
  pill: '9999px',
};
const OVERRIDE_DENSITY_GAP: Record<NonNullable<ThemeAppearanceOverrides['density']>, string> = {
  compact: '0.875rem',
  comfortable: '1.25rem',
  spacious: '1.75rem',
};

function clearDocumentOverrides(): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  for (const prop of [
    '--color-primary',
    '--primary-solid',
    '--primary-ink',
    '--ol-radius-card',
    '--ol-radius-control',
    '--ol-density-gap',
    '--ol-font-scale',
    '--ol-font-sans',
    '--ol-font-display',
    '--ol-font-mono',
    '--ol-shadow-card',
  ]) {
    style.removeProperty(prop);
  }
}

function applyThemeAndOverridesToDOM(
  themeId: string,
  colorScheme: 'light' | 'dark',
  bundle: ValidatedThemeBundle | null,
  overrides: ThemeAppearanceOverrides,
): {
  ok: boolean;
  effectiveTokens: Record<string, string>;
  resolvedLayouts: ResolvedThemeLayouts;
  errorReason?: string;
} {
  if (typeof document === 'undefined') {
    return {
      ok: true,
      effectiveTokens: getThemeTokens(themeId),
      resolvedLayouts: bundle ? resolveSafeLayouts(bundle.layouts) : resolveSafeLayouts(null),
    };
  }

  try {
    clearDocumentOverrides();

    let effectiveTokens: Record<string, string> = {
      ...(BUILTIN_THEME_TOKENS[themeId as BuiltinThemeId] || registeredCSSVars[themeId] || BUILTIN_THEME_TOKENS.light),
    };
    let resolvedLayouts = resolveSafeLayouts(null);

    if (bundle) {
      const built = buildRuntimeThemeCss(bundle, colorScheme, overrides, (relPath) =>
        resolveThemeAssetUrl(bundle.manifest.id, bundle.manifest.version, relPath),
      );
      thirdPartyActiveTokens[bundle.manifest.id] = built.effectiveTokens;
      effectiveTokens = built.effectiveTokens;
      resolvedLayouts = bundle.layouts || resolveSafeLayouts(bundle.manifest.layouts);

      let styleEl = document.getElementById(THIRDPARTY_STYLE_ELEMENT_ID) as HTMLStyleElement | null;
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = THIRDPARTY_STYLE_ELEMENT_ID;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = built.cssText;
    } else {
      removeThirdPartyStyleTag();
      if (overrides.primaryColor) {
        document.documentElement.style.setProperty('--color-primary', overrides.primaryColor);
        document.documentElement.style.setProperty('--primary-solid', overrides.primaryColor);
        document.documentElement.style.setProperty('--primary-ink', overrides.primaryColor);
        effectiveTokens['--color-primary'] = overrides.primaryColor;
        effectiveTokens['--primary-solid'] = overrides.primaryColor;
        effectiveTokens['--primary-ink'] = overrides.primaryColor;
      }
      if (overrides.borderRadius) {
        document.documentElement.style.setProperty('--ol-radius-card', OVERRIDE_RADIUS_CARD[overrides.borderRadius]);
        document.documentElement.style.setProperty('--ol-radius-control', OVERRIDE_RADIUS_CTRL[overrides.borderRadius]);
      }
      if (overrides.density) {
        document.documentElement.style.setProperty('--ol-density-gap', OVERRIDE_DENSITY_GAP[overrides.density]);
      }
      if (overrides.fontScale) {
        document.documentElement.style.setProperty('--ol-font-scale', String(overrides.fontScale));
      }
    }

    document.documentElement.setAttribute('data-theme', themeId);
    document.documentElement.setAttribute('data-color-scheme', colorScheme);
    document.documentElement.style.colorScheme = colorScheme;

    return { ok: true, effectiveTokens, resolvedLayouts };
  } catch (err) {
    // Failsafe automatic recovery to built-in light theme
    removeThirdPartyStyleTag();
    clearDocumentOverrides();
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-color-scheme', 'light');
    document.documentElement.style.colorScheme = 'light';
    return {
      ok: false,
      effectiveTokens: BUILTIN_THEME_TOKENS.light,
      resolvedLayouts: DEFAULT_LAYOUTS,
      errorReason: err instanceof Error ? err.message : '主题应用异常，已自动恢复安全默认主题',
    };
  }
}

function buildPluginPayload(
  themeId: string,
  colorScheme: 'light' | 'dark',
  tokens: Record<string, string>,
  bundle: ValidatedThemeBundle | null,
  overrides: ThemeAppearanceOverrides,
): UnifiedPluginThemePayload {
  return {
    theme: themeId,
    colorScheme,
    tokens,
    appearance: {
      borderRadius: overrides.borderRadius || bundle?.appearance.borderRadius || 'rounded',
      cardStyle: bundle?.appearance.cardStyle || 'bordered',
      density: overrides.density || bundle?.appearance.density || 'comfortable',
      fontScale: overrides.fontScale || bundle?.typography.baseScale || 1,
    },
    fonts: {
      sans: bundle?.typography.fontSans || 'system-ui, sans-serif',
      display: bundle?.typography.fontDisplay || bundle?.typography.fontSans || 'system-ui, sans-serif',
      mono: bundle?.typography.fontMono || 'ui-monospace, monospace',
    },
  };
}

function notifyIframes(
  themeId: string,
  colorScheme: 'light' | 'dark',
  tokens: Record<string, string>,
  bundle: ValidatedThemeBundle | null,
  overrides: ThemeAppearanceOverrides,
) {
  if (typeof window === 'undefined') return;
  const payload = buildPluginPayload(themeId, colorScheme, tokens, bundle, overrides);
  try {
    void frontendEventBus.publish({
      id: uuidv7(),
      type: 'theme.changed',
      source: 'theme-store',
      payload: {
        theme: themeId,
        tokens,
        colorScheme: payload.colorScheme,
        appearance: payload.appearance,
        fonts: payload.fonts,
      },
      timestamp: Date.now(),
    });
  } catch {
    // ignore event bus errors
  }
  broadcastThemeToIframes(themeId, tokens, {
    colorScheme: payload.colorScheme,
    appearance: payload.appearance,
    fonts: payload.fonts,
  });
}

function injectThemeCSSVars(themeId: string, vars: Record<string, string>) {
  if (typeof document === 'undefined') return;
  registeredCSSVars[themeId] = vars;
  const styleId = `openlearn-custom-theme-${themeId}`;
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  const cssRules = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  styleEl.textContent = `[data-theme="${themeId}"] {\n${cssRules}\n}`;
}

function removeThemeCSSVars(themeId: string) {
  if (typeof document === 'undefined') return;
  delete registeredCSSVars[themeId];
  const styleEl = document.getElementById(`openlearn-custom-theme-${themeId}`);
  if (styleEl && styleEl.parentNode) {
    styleEl.parentNode.removeChild(styleEl);
  }
}

export interface ThemeState {
  theme: ThemeId;
  availableThemes: ThemeSpec[];
  catalog: ThemeCatalogEntry[];
  activeBundle: ValidatedThemeBundle | null;
  installedVersion: string | null;
  latestVersion: string | null;
  upgradeAvailable: boolean;
  upgradeChangelog?: string;
  colorMode: ThemeColorMode;
  resolvedColorScheme: 'light' | 'dark';
  appearanceOverrides: ThemeAppearanceOverrides;
  resolvedLayouts: ResolvedThemeLayouts;
  defaultSiteThemeId: string;
  fallbackNotice: string | null;
  principalKey: string | null;
  previewState: ThemePreviewSnapshot | null;

  initTheme: () => void;
  setTheme: (themeId: ThemeId) => void;
  registerTheme: (spec: ThemeSpec, cssVariables?: Record<string, string>) => void;
  unregisterTheme: (themeId: ThemeId) => void;
  saveCustomTheme: (spec: ThemeSpec, cssVariables: Record<string, string>) => void;
  deleteCustomTheme: (themeId: ThemeId) => void;

  // Issue #484 Third-party theme lifecycle actions
  syncWithSession: (session: { userId?: string; studentId?: string; role?: string } | null) => Promise<void>;
  refreshCatalog: () => Promise<void>;
  installThemeZip: (fileOrBuffer: File | ArrayBuffer | Uint8Array) => Promise<ThemeCatalogEntry>;
  applyServerUserState: (state: ServerUserThemeState) => void;
  selectTheme: (themeId: string, options?: { version?: string | null; mode?: ThemeColorMode }) => Promise<void>;
  setColorMode: (mode: ThemeColorMode) => Promise<void>;
  setAppearanceOverrides: (overrides: ThemeAppearanceOverrides) => Promise<void>;
  upgradeCurrentTheme: () => Promise<void>;
  startPreview: (preview: ThemePreviewSnapshot) => void;
  cancelPreview: () => void;
  resetToSafeDefault: () => Promise<void>;
  clearFallbackNotice: () => void;
  getUnifiedPluginThemePayload: () => UnifiedPluginThemePayload;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',
  availableThemes: [...BUILTIN_THEMES],
  catalog: [],
  activeBundle: null,
  installedVersion: null,
  latestVersion: null,
  upgradeAvailable: false,
  upgradeChangelog: undefined,
  colorMode: 'auto',
  resolvedColorScheme: 'light',
  appearanceOverrides: {},
  resolvedLayouts: resolveSafeLayouts(null),
  defaultSiteThemeId: 'light',
  fallbackNotice: null,
  principalKey: null,
  previewState: null,

  initTheme: () => {
    if (typeof window === 'undefined') return;

    try {
      const storedCustom = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
      if (storedCustom) {
        const customThemes: StoredCustomTheme[] = JSON.parse(storedCustom);
        if (Array.isArray(customThemes)) {
          customThemes.forEach((ct) => {
            if (ct && ct.spec && ct.spec.id) {
              get().registerTheme(ct.spec, ct.cssVariables);
            }
          });
        }
      }
    } catch {
      // ignore corrupted legacy custom themes
    }

    const browserAppearance = readAnonymousBrowserAppearance();
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    const initialTheme = browserAppearance?.themeId || saved || 'light';
    const initialMode = browserAppearance?.mode || 'auto';
    const initialOverrides = browserAppearance?.appearanceOverrides || {};

    const scheme = resolveColorScheme(initialTheme, initialMode, null);
    const applied = applyThemeAndOverridesToDOM(initialTheme, scheme, null, initialOverrides);
    const finalTheme = applied.ok ? initialTheme : 'light';
    const finalScheme = applied.ok ? scheme : 'light';

    set({
      theme: finalTheme,
      colorMode: initialMode,
      resolvedColorScheme: finalScheme,
      appearanceOverrides: initialOverrides,
      resolvedLayouts: applied.resolvedLayouts,
      fallbackNotice: applied.ok ? null : applied.errorReason || null,
    });
    notifyIframes(finalTheme, finalScheme, applied.effectiveTokens, null, initialOverrides);
  },

  setTheme: (themeId: ThemeId) => {
    const { colorMode, appearanceOverrides } = get();
    const bundle =
      isBuiltinThemeId(themeId) || themeId in registeredCSSVars
        ? null
        : get().activeBundle?.manifest.id === themeId
          ? get().activeBundle
          : null;
    const scheme = resolveColorScheme(themeId, colorMode, bundle);
    const applied = applyThemeAndOverridesToDOM(themeId, scheme, bundle, appearanceOverrides);
    const finalTheme = applied.ok ? themeId : 'light';
    const finalScheme = applied.ok ? scheme : 'light';

    writeAnonymousBrowserAppearance({
      themeId: finalTheme,
      mode: colorMode,
      appearanceOverrides,
    });
    set({
      theme: finalTheme,
      activeBundle: applied.ok ? bundle : null,
      resolvedColorScheme: finalScheme,
      resolvedLayouts: applied.resolvedLayouts,
      previewState: null,
      fallbackNotice: applied.ok ? get().fallbackNotice : applied.errorReason || null,
    });
    notifyIframes(finalTheme, finalScheme, applied.effectiveTokens, applied.ok ? bundle : null, appearanceOverrides);
  },

  registerTheme: (spec: ThemeSpec, cssVariables?: Record<string, string>) => {
    if (cssVariables) {
      injectThemeCSSVars(spec.id, cssVariables);
    }
    set((state) => {
      const filtered = state.availableThemes.filter((t) => t.id !== spec.id);
      return { availableThemes: [...filtered, spec] };
    });
  },

  unregisterTheme: (themeId: ThemeId) => {
    removeThemeCSSVars(themeId);
    set((state) => {
      const remaining = state.availableThemes.filter((t) => t.id !== themeId);
      const nextTheme = state.theme === themeId ? 'light' : state.theme;
      if (state.theme === themeId) {
        const applied = applyThemeAndOverridesToDOM('light', 'light', null, state.appearanceOverrides);
        writeAnonymousBrowserAppearance({
          themeId: 'light',
          mode: state.colorMode,
          appearanceOverrides: state.appearanceOverrides,
        });
        notifyIframes('light', 'light', applied.effectiveTokens, null, state.appearanceOverrides);
      }
      return {
        availableThemes: remaining,
        theme: nextTheme,
        activeBundle: state.theme === themeId ? null : state.activeBundle,
      };
    });
  },

  saveCustomTheme: (spec: ThemeSpec, cssVariables: Record<string, string>) => {
    get().registerTheme(spec, cssVariables);

    if (typeof window !== 'undefined') {
      try {
        const storedCustom = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
        let list: StoredCustomTheme[] = storedCustom ? JSON.parse(storedCustom) : [];
        if (!Array.isArray(list)) list = [];
        list = list.filter((item) => item.spec.id !== spec.id);
        list.push({ spec, cssVariables });
        localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(list));
      } catch {
        // ignore storage quota errors
      }
    }

    get().setTheme(spec.id);
  },

  deleteCustomTheme: (themeId: ThemeId) => {
    if (typeof window !== 'undefined') {
      try {
        const storedCustom = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
        if (storedCustom) {
          let list: StoredCustomTheme[] = JSON.parse(storedCustom);
          if (Array.isArray(list)) {
            list = list.filter((item) => item.spec.id !== themeId);
            localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(list));
          }
        }
      } catch {
        // ignore
      }
    }
    get().unregisterTheme(themeId);
  },

  applyServerUserState: (serverState: ServerUserThemeState) => {
    const scheme = resolveColorScheme(serverState.themeId, serverState.mode, serverState.activeBundle);
    const applied = applyThemeAndOverridesToDOM(
      serverState.themeId,
      scheme,
      serverState.activeBundle,
      serverState.appearanceOverrides,
    );
    const effectiveThemeId = applied.ok ? serverState.themeId : 'light';
    const effectiveScheme = applied.ok ? scheme : 'light';
    const effectiveBundle = applied.ok ? serverState.activeBundle : null;

    // Update anonymous visual cache for smooth post-logout / next load login styling
    writeAnonymousBrowserAppearance({
      themeId: effectiveThemeId,
      mode: serverState.mode,
      appearanceOverrides: serverState.appearanceOverrides,
    });

    set({
      principalKey: serverState.principalKey,
      theme: effectiveThemeId,
      activeBundle: effectiveBundle,
      installedVersion: applied.ok ? serverState.installedVersion : null,
      latestVersion: applied.ok ? serverState.latestVersion : null,
      upgradeAvailable: applied.ok ? serverState.upgradeAvailable : false,
      upgradeChangelog: applied.ok ? serverState.upgradeChangelog : undefined,
      colorMode: serverState.mode,
      resolvedColorScheme: effectiveScheme,
      appearanceOverrides: serverState.appearanceOverrides,
      resolvedLayouts: applied.resolvedLayouts,
      defaultSiteThemeId: serverState.defaultSiteThemeId,
      previewState: null,
      fallbackNotice: !applied.ok
        ? applied.errorReason || '主题资源异常，已自动回退至安全默认主题'
        : serverState.fallbackApplied
          ? serverState.fallbackReason || '已自动回退到安全默认主题'
          : null,
    });
    notifyIframes(
      effectiveThemeId,
      effectiveScheme,
      applied.effectiveTokens,
      effectiveBundle,
      serverState.appearanceOverrides,
    );
  },

  syncWithSession: async (session) => {
    if (!session) {
      // Logged out -> discard in-memory user identity & server bundle overrides from previous user,
      // and apply anonymous pre-login defaults safely.
      set({
        principalKey: null,
        upgradeAvailable: false,
        upgradeChangelog: undefined,
        installedVersion: null,
        latestVersion: null,
        previewState: null,
      });

      const pub = await fetchPublicThemesApi();
      const browserAppearance = readAnonymousBrowserAppearance();
      let candidateThemeId = browserAppearance?.themeId || pub?.defaultThemeId || 'light';
      let candidateBundle: ValidatedThemeBundle | null = null;

      if (!isBuiltinThemeId(candidateThemeId) && !(candidateThemeId in registeredCSSVars)) {
        if (pub?.defaultThemeBundle && pub.defaultThemeBundle.manifest.id === candidateThemeId) {
          candidateBundle = pub.defaultThemeBundle;
        } else {
          // If pre-login theme is disabled or unavailable, cleanly fall back to default
          candidateThemeId = pub?.defaultThemeId && isBuiltinThemeId(pub.defaultThemeId) ? pub.defaultThemeId : 'light';
          if (pub?.defaultThemeBundle && candidateThemeId === pub.defaultThemeBundle.manifest.id) {
            candidateBundle = pub.defaultThemeBundle;
          }
        }
      }

      const mode = browserAppearance?.mode || 'auto';
      const overrides = browserAppearance?.appearanceOverrides || {};
      const scheme = resolveColorScheme(candidateThemeId, mode, candidateBundle);
      const applied = applyThemeAndOverridesToDOM(candidateThemeId, scheme, candidateBundle, overrides);
      const finalTheme = applied.ok ? candidateThemeId : 'light';
      const finalScheme = applied.ok ? scheme : 'light';

      set({
        theme: finalTheme,
        activeBundle: applied.ok ? candidateBundle : null,
        colorMode: mode,
        resolvedColorScheme: finalScheme,
        appearanceOverrides: overrides,
        resolvedLayouts: applied.resolvedLayouts,
        defaultSiteThemeId: pub?.defaultThemeId || 'light',
        catalog: [],
        fallbackNotice: applied.ok ? null : applied.errorReason || null,
      });
      notifyIframes(finalTheme, finalScheme, applied.effectiveTokens, applied.ok ? candidateBundle : null, overrides);
      return;
    }

    const [myState, catalog] = await Promise.all([fetchMyThemeStateApi(), fetchThemeCatalogApi()]);
    if (catalog) {
      set({ catalog });
    }
    if (myState) {
      get().applyServerUserState(myState);
    }
  },

  refreshCatalog: async () => {
    const catalog = await fetchThemeCatalogApi();
    if (catalog) {
      set({ catalog });
    }
  },

  installThemeZip: async (fileOrBuffer) => {
    const result = await installThemeZipApi(fileOrBuffer);
    await get().refreshCatalog();
    return result.item;
  },

  selectTheme: async (themeId, options) => {
    const state = get();
    if (state.principalKey) {
      const updated = await updateMyThemeStateApi({
        themeId,
        installedVersion: options?.version ?? null,
        mode: options?.mode ?? state.colorMode,
        appearanceOverrides: state.appearanceOverrides,
      });
      get().applyServerUserState(updated);
      return;
    }

    // Unauthenticated or local custom theme fallback
    if (options?.mode) {
      set({ colorMode: options.mode });
    }
    get().setTheme(themeId);
  },

  setColorMode: async (mode) => {
    const state = get();
    if (state.principalKey) {
      const updated = await updateMyThemeStateApi({ mode });
      get().applyServerUserState(updated);
      return;
    }
    const scheme = resolveColorScheme(state.theme, mode, state.activeBundle);
    const applied = applyThemeAndOverridesToDOM(state.theme, scheme, state.activeBundle, state.appearanceOverrides);
    writeAnonymousBrowserAppearance({
      themeId: state.theme,
      mode,
      appearanceOverrides: state.appearanceOverrides,
    });
    set({
      colorMode: mode,
      resolvedColorScheme: scheme,
      resolvedLayouts: applied.resolvedLayouts,
    });
    notifyIframes(state.theme, scheme, applied.effectiveTokens, state.activeBundle, state.appearanceOverrides);
  },

  setAppearanceOverrides: async (overrides) => {
    const state = get();
    if (state.principalKey) {
      const updated = await updateMyThemeStateApi({ appearanceOverrides: overrides });
      get().applyServerUserState(updated);
      return;
    }
    const scheme = resolveColorScheme(state.theme, state.colorMode, state.activeBundle);
    const applied = applyThemeAndOverridesToDOM(state.theme, scheme, state.activeBundle, overrides);
    writeAnonymousBrowserAppearance({
      themeId: state.theme,
      mode: state.colorMode,
      appearanceOverrides: overrides,
    });
    set({
      appearanceOverrides: overrides,
      resolvedLayouts: applied.resolvedLayouts,
    });
    notifyIframes(state.theme, scheme, applied.effectiveTokens, state.activeBundle, overrides);
  },

  upgradeCurrentTheme: async () => {
    const state = get();
    if (!state.latestVersion || !state.theme) return;
    await get().selectTheme(state.theme, { version: state.latestVersion });
  },

  startPreview: (preview) => {
    const scheme = resolveColorScheme(preview.themeId, preview.mode, preview.bundle);
    const applied = applyThemeAndOverridesToDOM(preview.themeId, scheme, preview.bundle, preview.appearanceOverrides);
    if (!applied.ok) {
      set({
        previewState: null,
        fallbackNotice: applied.errorReason || '预览失败，已保留当前安全主题',
      });
      return;
    }
    set({
      previewState: preview,
      resolvedColorScheme: scheme,
      resolvedLayouts: applied.resolvedLayouts,
    });
    notifyIframes(preview.themeId, scheme, applied.effectiveTokens, preview.bundle, preview.appearanceOverrides);
  },

  cancelPreview: () => {
    const state = get();
    if (!state.previewState) return;
    const scheme = resolveColorScheme(state.theme, state.colorMode, state.activeBundle);
    const applied = applyThemeAndOverridesToDOM(state.theme, scheme, state.activeBundle, state.appearanceOverrides);
    set({
      previewState: null,
      resolvedColorScheme: scheme,
      resolvedLayouts: applied.resolvedLayouts,
    });
    notifyIframes(state.theme, scheme, applied.effectiveTokens, state.activeBundle, state.appearanceOverrides);
  },

  resetToSafeDefault: async () => {
    // Immediate local DOM recovery first — works even if server/network/CSS fails
    removeThirdPartyStyleTag();
    clearDocumentOverrides();
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(BROWSER_APPEARANCE_STORAGE_KEY);
        localStorage.setItem(STORAGE_KEY, 'light');
      } catch {
        // ignore storage errors
      }
    }
    const applied = applyThemeAndOverridesToDOM('light', 'light', null, {});
    set({
      theme: 'light',
      activeBundle: null,
      installedVersion: null,
      latestVersion: null,
      upgradeAvailable: false,
      upgradeChangelog: undefined,
      colorMode: 'light',
      resolvedColorScheme: 'light',
      appearanceOverrides: {},
      resolvedLayouts: DEFAULT_LAYOUTS,
      previewState: null,
      fallbackNotice: '已一键恢复至安全默认主题（浅色日间）',
    });
    notifyIframes('light', 'light', applied.effectiveTokens, null, {});

    if (get().principalKey) {
      const serverReset = await resetMyThemeStateApi();
      if (serverReset) {
        set({ defaultSiteThemeId: serverReset.defaultSiteThemeId });
      }
    }
  },

  clearFallbackNotice: () => set({ fallbackNotice: null }),

  getUnifiedPluginThemePayload: () => {
    const state = get();
    const effectiveTheme = state.previewState?.themeId || state.theme;
    const effectiveBundle = state.previewState ? state.previewState.bundle : state.activeBundle;
    const effectiveOverrides = state.previewState?.appearanceOverrides || state.appearanceOverrides;
    const scheme = state.resolvedColorScheme;
    const tokens = getThemeTokens(effectiveTheme);
    return buildPluginPayload(effectiveTheme, scheme, tokens, effectiveBundle, effectiveOverrides);
  },
}));
