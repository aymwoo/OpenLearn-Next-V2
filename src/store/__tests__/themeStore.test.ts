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

  it('saveCustomTheme persists custom theme to localStorage and activates it', () => {
    const customSpec = {
      id: 'my-custom-blue',
      label: '我的定制蓝',
      description: '个性化蓝调',
      previewBg: '#0f172a',
      previewPrimary: '#38bdf8',
      category: 'custom' as const,
    };
    const tokens = {
      '--bg-app': '#0f172a',
      '--color-primary': '#38bdf8',
    };

    useThemeStore.getState().saveCustomTheme(customSpec, tokens);

    // 验证当前状态
    expect(useThemeStore.getState().theme).toBe('my-custom-blue');
    expect(document.documentElement.getAttribute('data-theme')).toBe('my-custom-blue');

    // 验证 localStorage 持久化
    const stored = localStorage.getItem('openlearn_custom_themes');
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].spec.id).toBe('my-custom-blue');
    expect(parsed[0].cssVariables['--color-primary']).toBe('#38bdf8');
  });

  it('deleteCustomTheme removes theme from localStorage and unregisters', () => {
    const customSpec = {
      id: 'to-delete',
      label: '待删除',
      description: '测试删除',
      previewBg: '#000000',
      previewPrimary: '#ffffff',
      category: 'custom' as const,
    };
    useThemeStore.getState().saveCustomTheme(customSpec, { '--color-primary': '#ffffff' });
    expect(useThemeStore.getState().theme).toBe('to-delete');

    useThemeStore.getState().deleteCustomTheme('to-delete');

    expect(useThemeStore.getState().theme).toBe('light');
    const stored = localStorage.getItem('openlearn_custom_themes');
    const parsed = JSON.parse(stored || '[]');
    expect(parsed).toHaveLength(0);
    expect(useThemeStore.getState().availableThemes.some((t) => t.id === 'to-delete')).toBe(false);
  });

  it('initTheme restores custom themes from localStorage correctly', () => {
    const customList = [
      {
        spec: {
          id: 'restored-theme',
          label: '恢复主题',
          description: '从缓存中恢复',
          previewBg: '#1e293b',
          previewPrimary: '#10b981',
          category: 'custom',
        },
        cssVariables: {
          '--bg-app': '#1e293b',
          '--color-primary': '#10b981',
        },
      },
    ];
    localStorage.setItem('openlearn_custom_themes', JSON.stringify(customList));
    localStorage.setItem('openlearn_theme', 'restored-theme');

    useThemeStore.getState().initTheme();

    expect(useThemeStore.getState().theme).toBe('restored-theme');
    expect(useThemeStore.getState().availableThemes.some((t) => t.id === 'restored-theme')).toBe(true);
    expect(document.getElementById('openlearn-custom-theme-restored-theme')).not.toBeNull();
  });
});

