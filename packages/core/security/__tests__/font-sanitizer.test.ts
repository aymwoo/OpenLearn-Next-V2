import { describe, it, expect } from 'vitest';
import { isBlockedExternalFontUrl, sanitizeExternalFontsInHtml, LOCAL_SANS_FALLBACK_STACK } from '../font-sanitizer.js';
import { buildRuntimeThemeCss, DEFAULT_LAYOUTS } from '../../themes/theme-spec.js';

describe('font-sanitizer (Issue #518)', () => {
  it('detects Google Fonts and gstatic font CDN URLs while allowing local/data URLs', () => {
    expect(isBlockedExternalFontUrl('https://fonts.googleapis.com/css2?family=Inter:wght@400;600')).toBe(true);
    expect(isBlockedExternalFontUrl('//fonts.gstatic.com/s/inter/v18/abc.woff2')).toBe(true);
    expect(isBlockedExternalFontUrl('HTTPS://FONTS.GOOGLEAPIS.COM/icon?family=Material+Icons')).toBe(true);

    expect(isBlockedExternalFontUrl('/assets/fonts/inter.woff2')).toBe(false);
    expect(isBlockedExternalFontUrl('data:font/woff2;base64,AAAA')).toBe(false);
    expect(isBlockedExternalFontUrl('./local.css')).toBe(false);
    expect(isBlockedExternalFontUrl('')).toBe(false);
  });

  it('strips Google Fonts links and @import rules from HTML courseware and injects local fallback CSS', () => {
    const html = `<!doctype html>
<html>
  <head>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" />
    <link rel="stylesheet" href="/courseware/local.css" />
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC&display=swap');
      body { font-family: 'Inter', sans-serif; color: #111; }
    </style>
  </head>
  <body><h1>Hello</h1></body>
</html>`;

    const result = sanitizeExternalFontsInHtml(html);

    expect(result.strippedCount).toBe(4);
    expect(result.html).not.toContain('fonts.googleapis.com');
    expect(result.html).not.toContain('fonts.gstatic.com');
    expect(result.html).toContain('/courseware/local.css');
    expect(result.html).toContain('data-openlearn-local-font-fallback');
    expect(result.html).toContain(LOCAL_SANS_FALLBACK_STACK);
    expect(result.html).toContain('color: #111;');
  });

  it('filters remote Google Fonts @font-face entries when building runtime theme CSS', () => {
    const { cssText } = buildRuntimeThemeCss(
      {
        manifest: { id: 'theme-518', name: 'Theme 518', version: '1.0.0' },
        modes: { light: {}, dark: {} },
        typography: {
          fontFaces: [
            {
              family: 'RemoteInter',
              src: 'https://fonts.gstatic.com/s/inter/v13/abc.woff2',
              weight: '400',
            },
            {
              family: 'LocalOpenSans',
              src: '/assets/fonts/open-sans.woff2',
              weight: '400',
            },
          ],
        },
        appearance: {},
        layouts: DEFAULT_LAYOUTS,
        scopedCss: '',
        assetPaths: [],
      },
      'light',
    );

    expect(cssText).not.toContain('fonts.gstatic.com');
    expect(cssText).not.toContain('RemoteInter');
    expect(cssText).toContain('LocalOpenSans');
    expect(cssText).toContain('/assets/fonts/open-sans.woff2');
  });
});
