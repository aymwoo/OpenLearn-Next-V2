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

  it('does not fetch protected /api/students endpoint on mount', () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ siteName: 'OpenLearn V2', allowPublicStudentLookup: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LoginPage onLoginSuccess={vi.fn()} lang="zh" />);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/students'))).toBe(false);
  });

  it('hides student ID lookup button when allowPublicStudentLookup is false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/site-settings')) {
          return {
            ok: true,
            json: async () => ({ siteName: 'OpenLearn V2', allowPublicStudentLookup: false }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<LoginPage onLoginSuccess={vi.fn()} lang="zh" />);
    fireEvent.click(screen.getByRole('button', { name: /学生自助端/i }));

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /忘记学号/i })).toBeNull();
    });
  });

  it('opens student ID lookup dialog, searches with class filter, and autofills student ID input', async () => {
    const lookupCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/site-settings')) {
          return {
            ok: true,
            json: async () => ({ siteName: 'OpenLearn V2', allowPublicStudentLookup: true }),
          };
        }
        if (url.includes('/api/auth/public-classes')) {
          return {
            ok: true,
            json: async () => ({
              items: [
                { id: 'cls-1', name: '七年级(1)班' },
                { id: 'cls-2', name: '信息学竞赛班' },
              ],
            }),
          };
        }
        if (url.includes('/api/auth/student-lookup')) {
          lookupCalls.push(url);
          return {
            ok: true,
            json: async () => ({
              items: [
                { name: '张伟', studentNumber: '20260101', classes: ['七年级(1)班', '信息学竞赛班'] },
                { name: '张晓明', studentNumber: '20260199', classes: [] },
              ],
              truncated: true,
              limit: 10,
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      }),
    );

    render(<LoginPage onLoginSuccess={vi.fn()} lang="zh" />);
    fireEvent.click(screen.getByRole('button', { name: /学生自助端/i }));

    const triggerBtn = await screen.findByRole('button', { name: /忘记学号/i });
    fireEvent.click(triggerBtn);

    const nameInput = await screen.findByLabelText(/学生姓名/i);
    const classSelect = screen.getByLabelText(/所在班级/i);
    await screen.findByRole('option', { name: '七年级(1)班' });

    // 短字符（1 个英文字母）本地拦截，不触发请求
    fireEvent.change(nameInput, { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: /^查询学号$/ }));
    expect(await screen.findByText(/请输入至少 2 个字符/i)).toBeTruthy();
    expect(lookupCalls).toHaveLength(0);

    // 选择班级 + 输入姓名发起查询
    fireEvent.change(classSelect, { target: { value: 'cls-1' } });
    fireEvent.change(nameInput, { target: { value: '张' } });
    fireEvent.click(screen.getByRole('button', { name: /^查询学号$/ }));

    expect(await screen.findByText('20260101')).toBeTruthy();
    expect(screen.getByText('七年级(1)班、信息学竞赛班')).toBeTruthy();
    expect(screen.getByText('未分班')).toBeTruthy();
    expect(screen.getByText(/匹配结果超过 10 条/i)).toBeTruthy();
    expect(lookupCalls[0]).toContain('classId=cls-1');

    // 点击「使用此学号」回填登录表单并聚焦密码框
    const useButtons = screen.getAllByRole('button', { name: /使用此学号/i });
    fireEvent.click(useButtons[0]);

    const accessKeyInput = screen.getByLabelText(/学号 \/ Student ID/i) as HTMLInputElement;
    expect(accessKeyInput.value).toBe('20260101');
    const passwordInput = screen.getByLabelText(/个人密码 \/ 临时班级密码/i);
    expect(document.activeElement).toBe(passwordInput);
  });
});
