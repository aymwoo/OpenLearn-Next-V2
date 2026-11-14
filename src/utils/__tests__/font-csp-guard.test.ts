import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installExternalFontCspGuard } from '../font-csp-guard';

describe('installExternalFontCspGuard (Issue #518)', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    document.head.innerHTML = '';
  });

  it('neutralizes Google Fonts <link> elements before browser stylesheet loading triggers CSP errors', () => {
    uninstall = installExternalFontCspGuard(document);

    const link = document.createElement('link');
    link.id = 'ooxml-google-webfonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Calibri&display=swap';
    document.head.appendChild(link);

    expect(link.getAttribute('href')).toBeNull();
    expect(link.getAttribute('data-openlearn-blocked-external-font')).toContain('fonts.googleapis.com');
    expect(link.rel).toBe('openlearn-blocked-font');
    expect(document.getElementById('openlearn-local-font-fallback')).not.toBeNull();
  });

  it('neutralizes pre-existing links, insertBefore links, and deferred setAttribute href updates', () => {
    const preExisting = document.createElement('link');
    preExisting.rel = 'stylesheet';
    preExisting.setAttribute('href', 'https://fonts.googleapis.com/css2?family=Roboto');
    document.head.appendChild(preExisting);

    uninstall = installExternalFontCspGuard(document);
    expect(preExisting.isConnected).toBe(false);

    const anchor = document.createElement('meta');
    document.head.appendChild(anchor);

    const inserted = document.createElement('link');
    inserted.rel = 'stylesheet';
    document.head.insertBefore(inserted, anchor);
    inserted.setAttribute('href', 'https://fonts.gstatic.com/s/roboto/v30/test.woff2');

    expect(inserted.getAttribute('href')).toBeNull();
    expect(inserted.getAttribute('data-openlearn-blocked-external-font')).toContain('fonts.gstatic.com');
    expect(document.getElementById('openlearn-local-font-fallback')).not.toBeNull();
  });

  it('allows same-origin local stylesheets to remain untouched', () => {
    uninstall = installExternalFontCspGuard(document);

    const local = document.createElement('link');
    local.rel = 'stylesheet';
    local.href = '/assets/custom.css';
    document.head.appendChild(local);

    expect(local.rel).toBe('stylesheet');
    expect(local.getAttribute('href')).toBe('/assets/custom.css');
    expect(local.getAttribute('data-openlearn-blocked-external-font')).toBeNull();
  });
});
