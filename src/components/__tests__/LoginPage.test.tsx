import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LoginPage } from '../LoginPage';

describe('LoginPage autofill attributes', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [] }),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('sets username and current-password autocomplete attributes on teacher sign-in form', () => {
    render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);

    const usernameInput = screen.getByLabelText(/Staff Username/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/Access Password/i) as HTMLInputElement;

    expect(usernameInput.getAttribute('autocomplete')).toBe('username');
    expect(usernameInput.getAttribute('spellcheck')).toBe('false');
    expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');
    expect(passwordInput.type).toBe('password');
  });

  it('sets username and current-password autocomplete attributes on student sign-in form', () => {
    render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);

    fireEvent.click(screen.getByRole('button', { name: /Student Self-Service/i }));

    const accessKeyInput = screen.getByLabelText(/Student Access Key/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/Personal Password/i) as HTMLInputElement;

    expect(accessKeyInput.getAttribute('autocomplete')).toBe('username');
    expect(accessKeyInput.getAttribute('spellcheck')).toBe('false');
    expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');
    expect(passwordInput.type).toBe('password');
  });

  it('renders site logo with explicit dimensions and high fetchpriority for LCP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/site-settings')) {
          return {
            ok: true,
            json: async () => ({ siteName: 'OpenLearn V2', slogan: 'Hi', logoUrl: '/logo.png' }),
          };
        }
        return { ok: true, json: async () => ({ items: [] }) };
      }),
    );

    render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);
    const logo = (await screen.findByAltText('OpenLearn V2')) as HTMLImageElement;
    expect(logo.getAttribute('width')).toBe('64');
    expect(logo.getAttribute('height')).toBe('64');
    expect(logo.getAttribute('fetchpriority')).toBe('high');
  });

  it('displays the runtime version from /health instead of hardcoded V2.0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url === '/health') {
          return {
            ok: true,
            json: async () => ({ status: 'ok', uptime: 12, version: '0.7.15' }),
          };
        }
        return { ok: true, json: async () => ({ items: [] }) };
      }),
    );

    render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);
    const badge = await screen.findByTestId('login-version-badge');
    expect(badge.textContent).toBe('v0.7.15');
    expect(screen.queryByText('V2.0')).toBeNull();
  });

  it('falls back to build-time __APP_VERSION__ when /health fails, and prefers /health when it succeeds', async () => {
    const g = globalThis as Record<string, unknown>;
    const prevVersion = g.__APP_VERSION__;
    g.__APP_VERSION__ = '0.7.14';

    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url === '/health') {
            return { ok: false, status: 503, json: async () => ({}) };
          }
          return { ok: true, json: async () => ({ items: [] }) };
        }),
      );

      const { unmount } = render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);
      expect(screen.getByTestId('login-version-badge').textContent).toBe('v0.7.14');
      unmount();

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(async (url: string) => {
          if (url === '/health') {
            return {
              ok: true,
              json: async () => ({ status: 'ok', uptime: 3, version: '0.7.15' }),
            };
          }
          return { ok: true, json: async () => ({ items: [] }) };
        }),
      );

      render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);
      expect((await screen.findByText('v0.7.15')).getAttribute('data-testid')).toBe('login-version-badge');
    } finally {
      if (prevVersion === undefined) {
        delete g.__APP_VERSION__;
      } else {
        g.__APP_VERSION__ = prevVersion;
      }
    }
  });

  it('omits version badge rather than showing stale V2.0 when no version source is available', () => {
    render(<LoginPage onLoginSuccess={vi.fn()} lang="en" />);
    expect(screen.queryByText('V2.0')).toBeNull();
    expect(screen.queryByTestId('login-version-badge')).toBeNull();
  });
});
