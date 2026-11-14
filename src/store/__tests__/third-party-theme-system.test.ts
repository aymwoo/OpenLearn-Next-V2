import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BROWSER_APPEARANCE_STORAGE_KEY, BUILTIN_THEMES, useThemeStore } from '../themeStore';
import { resolveSafeLayouts, type ValidatedThemeBundle } from '../../../packages/core/themes/theme-spec';

const sampleBundle: ValidatedThemeBundle = {
  manifest: {
    schemaVersion: 1,
    id: 'campus-atelier',
    name: 'Campus Atelier',
    version: '1.0.0',
    description: 'Studio theme',
    author: 'OpenLearn',
  },
  modes: {
    light: {
      '--bg-app': '#f7f4ed',
      '--bg-surface': '#ffffff',
      '--text-main': '#1c1917',
      '--color-primary': '#0f766e',
    },
    dark: {
      '--bg-app': '#161917',
      '--bg-surface': '#1f2421',
      '--text-main': '#f5f5f4',
      '--color-primary': '#14b8a6',
    },
  },
  typography: {
    fontSans: 'Georgia, serif',
    baseScale: 1,
  },
  appearance: {
    borderRadius: 'pill',
    cardStyle: 'elevated',
    density: 'spacious',
  },
  layouts: resolveSafeLayouts({
    login: { arrangement: 'split-left', order: ['auth-form', 'brand'] },
    teacher: { navPosition: 'right', contentMaxWidth: 'wide' },
    student: { headerPosition: 'bottom', cardColumns: 3 },
    admin: { navStyle: 'sidebar-left' },
  }),
  scopedCss: '[data-theme="campus-atelier"] .theme-accent-badge { color: var(--color-primary); }',
  assetPaths: [],
};

describe('useThemeStore third-party lifecycle, isolation & failsafe recovery (Issue #484)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-color-scheme');
    useThemeStore.setState({
      theme: 'light',
      availableThemes: [...BUILTIN_THEMES],
      catalog: [],
      activeBundle: null,
      installedVersion: null,
      latestVersion: null,
      upgradeAvailable: false,
      colorMode: 'auto',
      resolvedColorScheme: 'light',
      appearanceOverrides: {},
      resolvedLayouts: resolveSafeLayouts(null),
      defaultSiteThemeId: 'light',
      fallbackNotice: null,
      principalKey: null,
      previewState: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists only anonymous visual appearance pre-login and isolates accounts A and B across syncWithSession', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/themes/me') {
        const callCount = fetchMock.mock.calls.filter((c) => c[0] === '/api/themes/me').length;
        if (callCount === 1) {
          // Account A
          return {
            ok: true,
            json: async () => ({
              principalKey: 'teacher:usr-a',
              themeId: 'campus-atelier',
              installedVersion: '1.0.0',
              latestVersion: '1.1.0',
              upgradeAvailable: true,
              mode: 'dark',
              appearanceOverrides: { primaryColor: '#14b8a6', borderRadius: 'pill' },
              activeBundle: sampleBundle,
              defaultSiteThemeId: 'light',
              fallbackApplied: false,
              updatedAt: Date.now(),
            }),
          };
        }
        // Account B
        return {
          ok: true,
          json: async () => ({
            principalKey: 'student:stu-b',
            themeId: 'eyecare',
            installedVersion: null,
            latestVersion: null,
            upgradeAvailable: false,
            mode: 'light',
            appearanceOverrides: {},
            activeBundle: null,
            defaultSiteThemeId: 'light',
            fallbackApplied: false,
            updatedAt: Date.now(),
          }),
        };
      }
      if (url === '/api/themes') {
        return { ok: true, json: async () => ({ themes: [] }) };
      }
      return {
        ok: true,
        json: async () => ({ defaultThemeId: 'light', defaultThemeBundle: null, availablePublicThemes: [] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    // Account A signs in
    await useThemeStore.getState().syncWithSession({ userId: 'usr-a', role: 'teacher' });
    expect(useThemeStore.getState().theme).toBe('campus-atelier');
    expect(useThemeStore.getState().resolvedColorScheme).toBe('dark');
    expect(useThemeStore.getState().upgradeAvailable).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('campus-atelier');
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('dark');

    // Local anonymous browser appearance MUST contain zero user identifiers
    const rawBrowserAppearance = localStorage.getItem(BROWSER_APPEARANCE_STORAGE_KEY) || '';
    expect(rawBrowserAppearance).not.toContain('usr-a');
    expect(rawBrowserAppearance).not.toContain('teacher');

    // Isolated third-party style tag is mounted
    const styleEl = document.getElementById('openlearn-thirdparty-theme');
    expect(styleEl?.textContent).toContain('--bg-app: #161917');
    expect(styleEl?.textContent).toContain('--ol-radius-card: 1.5rem');

    // Account A logs out -> in-memory identity & upgrade badge cleared, pre-login public visual kept cleanly
    await useThemeStore.getState().syncWithSession(null);
    expect(useThemeStore.getState().principalKey).toBeNull();
    expect(useThemeStore.getState().upgradeAvailable).toBe(false);

    // Account B signs in -> isolated preferences overwrite DOM completely without inheriting Account A
    await useThemeStore.getState().syncWithSession({ studentId: 'stu-b', role: 'student' });
    expect(useThemeStore.getState().principalKey).toBe('student:stu-b');
    expect(useThemeStore.getState().theme).toBe('eyecare');
    expect(useThemeStore.getState().activeBundle).toBeNull();
    expect(document.getElementById('openlearn-thirdparty-theme')).toBeNull();
  });

  it('supports live preview & cancelPreview without losing committed state, plus one-click resetToSafeDefault', async () => {
    useThemeStore.getState().setTheme('eyecare');

    useThemeStore.getState().startPreview({
      themeId: 'campus-atelier',
      bundle: sampleBundle,
      mode: 'dark',
      appearanceOverrides: { density: 'compact' },
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('campus-atelier');
    expect(useThemeStore.getState().resolvedLayouts.teacher.navPosition).toBe('right');
    expect(useThemeStore.getState().getUnifiedPluginThemePayload().theme).toBe('campus-atelier');

    // Cancel preview restores committed state cleanly
    useThemeStore.getState().cancelPreview();
    expect(useThemeStore.getState().previewState).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('eyecare');
    expect(useThemeStore.getState().resolvedLayouts.teacher.navPosition).toBe('left');

    // Reset to safe default cleans thirdparty styles & browser storage immediately even offline
    useThemeStore.getState().startPreview({
      themeId: 'campus-atelier',
      bundle: sampleBundle,
      mode: 'light',
      appearanceOverrides: {},
    });
    await useThemeStore.getState().resetToSafeDefault();
    expect(useThemeStore.getState().theme).toBe('light');
    expect(useThemeStore.getState().activeBundle).toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.getElementById('openlearn-thirdparty-theme')).toBeNull();
    expect(localStorage.getItem(BROWSER_APPEARANCE_STORAGE_KEY)).toBeNull();
  });
});
