import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, BUILTIN_THEMES } from '../themeStore';

describe('themeStore (Theming System Engine)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    useThemeStore.setState({
      theme: 'light',
      availableThemes: [...BUILTIN_THEMES],
    });
  });

  it('initializes with default light theme and 4 builtin presets', () => {
    const state = useThemeStore.getState();
    expect(state.theme).toBe('light');
    expect(state.availableThemes).toHaveLength(4);
    expect(state.availableThemes.map((t) => t.id)).toEqual(['light', 'dark', 'eyecare', 'chalkboard']);
  });

  it('initTheme reads persisted theme from localStorage and applies to DOM', () => {
    localStorage.setItem('openlearn_theme', 'dark');
    useThemeStore.getState().initTheme();

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setTheme updates store, DOM attribute and localStorage', () => {
    useThemeStore.getState().setTheme('eyecare');

    expect(useThemeStore.getState().theme).toBe('eyecare');
    expect(document.documentElement.getAttribute('data-theme')).toBe('eyecare');
    expect(localStorage.getItem('openlearn_theme')).toBe('eyecare');
  });

  it('allows dynamic registration of custom themes with CSS variables', () => {
    const customSpec = {
      id: 'cyberpunk',
      label: '赛博朋克',
      description: '霓虹夜光',
      previewBg: '#050505',
      previewPrimary: '#00f0ff',
      category: 'plugin' as const,
      pluginId: 'ext-cyber',
    };

    useThemeStore.getState().registerTheme(customSpec, {
      '--bg-app': '#050505',
      '--color-primary': '#00f0ff',
    });

    const state = useThemeStore.getState();
    expect(state.availableThemes.some((t) => t.id === 'cyberpunk')).toBe(true);

    const styleEl = document.getElementById('openlearn-custom-theme-cyberpunk');
    expect(styleEl).toBeDefined();
    expect(styleEl?.textContent).toContain('--color-primary: #00f0ff;');
  });

  it('unregisters a theme, removes CSS style tag and reverts to light if active', () => {
    const customSpec = {
      id: 'temp-theme',
      label: '临时主题',
      description: '待卸载',
      previewBg: '#111111',
      previewPrimary: '#ff0000',
      category: 'custom' as const,
    };

    useThemeStore.getState().registerTheme(customSpec, { '--color-primary': '#ff0000' });
    useThemeStore.getState().setTheme('temp-theme');
    expect(useThemeStore.getState().theme).toBe('temp-theme');

    // Unregister
    useThemeStore.getState().unregisterTheme('temp-theme');
    const state = useThemeStore.getState();

    expect(state.availableThemes.some((t) => t.id === 'temp-theme')).toBe(false);
    expect(state.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.getElementById('openlearn-custom-theme-temp-theme')).toBeNull();
  });
});
