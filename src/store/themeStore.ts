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

const STORAGE_KEY = 'openlearn_theme';

interface ThemeState {
  theme: ThemeId;
  availableThemes: ThemeSpec[];
  setTheme: (themeId: ThemeId) => void;
  initTheme: () => void;
  registerTheme: (spec: ThemeSpec, cssVariables?: Record<string, string>) => void;
  unregisterTheme: (themeId: ThemeId) => void;
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
  const styleEl = document.getElementById(`openlearn-custom-theme-${themeId}`);
  if (styleEl && styleEl.parentNode) {
    styleEl.parentNode.removeChild(styleEl);
  }
}

export const useThemeStore = create<ThemeState>((set, _get) => ({
  theme: 'light',
  availableThemes: [...BUILTIN_THEMES],

  initTheme: () => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    const initialTheme = saved || 'light';
    applyThemeToDOM(initialTheme);
    set({ theme: initialTheme });
  },

  setTheme: (themeId: ThemeId) => {
    applyThemeToDOM(themeId);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, themeId);
    }
    set({ theme: themeId });
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
      }
      return { availableThemes: remaining, theme: nextTheme };
    });
  },
}));
