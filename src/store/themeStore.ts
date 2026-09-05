import { create } from 'zustand';

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
    '--text-muted': '#64748b',
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
    '--text-muted': '#9ca3af',
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
    '--text-muted': '#3d6350',
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
    '--text-muted': '#81c784',
    '--color-primary': '#4caf50',
    '--color-primary-hover': '#388e3c',
  },
};

const STORAGE_KEY = 'openlearn_theme';
const CUSTOM_THEMES_STORAGE_KEY = 'openlearn_custom_themes';

export interface StoredCustomTheme {
  spec: ThemeSpec;
  cssVariables: Record<string, string>;
}

const registeredCSSVars: Record<string, Record<string, string>> = {};

export function getThemeTokens(themeId: ThemeId): Record<string, string> {
  if (registeredCSSVars[themeId]) {
    return registeredCSSVars[themeId];
  }
  if (themeId in BUILTIN_THEME_TOKENS) {
    return BUILTIN_THEME_TOKENS[themeId as BuiltinThemeId];
  }
  return BUILTIN_THEME_TOKENS.light;
}

interface ThemeState {
  theme: ThemeId;
  availableThemes: ThemeSpec[];
  setTheme: (themeId: ThemeId) => void;
  initTheme: () => void;
  registerTheme: (spec: ThemeSpec, cssVariables?: Record<string, string>) => void;
  unregisterTheme: (themeId: ThemeId) => void;
  saveCustomTheme: (spec: ThemeSpec, cssVariables: Record<string, string>) => void;
  deleteCustomTheme: (themeId: ThemeId) => void;
}

/**
 * 将指定主题 ID 挂载到 DOM documentElement 上
 */
function applyThemeToDOM(themeId: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', themeId);
}

/**
 * 动态注入自定义主题 CSS 变量 style 标签
 */
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

function notifyIframes(themeId: string) {
  if (typeof window === 'undefined') return;
  try {
    // 异步延时广播，确保当前 DOM 及 CSS 变量完成应用
    setTimeout(async () => {
      try {
        const { broadcastThemeToIframes } = await import('../services/lms-bridge');
        broadcastThemeToIframes(themeId, getThemeTokens(themeId));
      } catch {}
    }, 0);
  } catch {}
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'light',
  availableThemes: [...BUILTIN_THEMES],

  initTheme: () => {
    if (typeof window === 'undefined') return;

    // 1. 恢复持久化的自定义主题
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
    } catch {}

    // 2. 恢复并应用已保存的主题 ID
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    const initialTheme = saved || 'light';
    applyThemeToDOM(initialTheme);
    set({ theme: initialTheme });
    notifyIframes(initialTheme);
  },

  setTheme: (themeId: ThemeId) => {
    applyThemeToDOM(themeId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, themeId);
    }
    set({ theme: themeId });
    notifyIframes(themeId);
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
        applyThemeToDOM('light');
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, 'light');
        }
        notifyIframes('light');
      }
      return { availableThemes: remaining, theme: nextTheme };
    });
  },

  saveCustomTheme: (spec: ThemeSpec, cssVariables: Record<string, string>) => {
    // 1. 注册并生效
    get().registerTheme(spec, cssVariables);

    // 2. 保存到 localStorage
    if (typeof window !== 'undefined') {
      try {
        const storedCustom = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
        let list: StoredCustomTheme[] = storedCustom ? JSON.parse(storedCustom) : [];
        if (!Array.isArray(list)) list = [];
        list = list.filter((item) => item.spec.id !== spec.id);
        list.push({ spec, cssVariables });
        localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(list));
      } catch {}
    }

    // 3. 激活为当前主题
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
      } catch {}
    }
    get().unregisterTheme(themeId);
  },
}));
