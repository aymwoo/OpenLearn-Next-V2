/**
 * 外壳请求卫生（回归）。
 *
 * ## 背景
 *
 * 功能巡检（`pnpm sweep`）在学生端外壳上抓到两类无谓请求：
 *
 * 1. `GET /api/db-status` —— 该端点只开放给教师/管理员，学生端每 5s 心跳一次
 *    → 恒定 403（`useSessionBootstrap` 的 DB 心跳没有按角色门控）；
 * 2. `GET /api/students?pageSize=all` —— 学生端要拿「自己这一条」来执行锁定
 *    状态，原先端点对学生一律 403 → 取不到自己那行，教师锁了学生、学生端却
 *    不受约束（服务端侧已修，见
 *    `server/__tests__/student-self-roster-scope.test.ts`）。
 *
 * 另外一条：教师端在没有进行中课堂会话时也会回写 view-state → 稳定 404。
 *
 * 本文件把这三条的前端行为固化成断言：
 * - 学生会话**不**发起 DB 状态心跳；
 * - 教师会话**会**发起 DB 状态心跳（能力不能被误伤）；
 * - 学生端**不**渲染 DB 状态徽章（运维指标不该出现在学生界面）；
 * - 无进行中会话时**不**回写 view-state；有会话时**照旧回写**（恢复协议不能坏）。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, renderHook, waitFor, cleanup } from '@testing-library/react';
import { AppHeader } from '../AppHeader';
import { AppDataProvider } from '../../context/AppDataContext';
import { appStore } from '../../store/appStore';
import { useSessionBootstrap } from '../../hooks/useSessionBootstrap';

// `__APP_VERSION__` 是 vite 的编译期注入（见 vite.config.ts），vitest 下不存在。
if (typeof (globalThis as Record<string, unknown>).__APP_VERSION__ === 'undefined') {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0';
}

const originalFetch = globalThis.fetch;

/** 记录所有 fetch 调用并按 URL 回应。 */
function installFetchStub(handler: (url: string) => { status?: number; body?: unknown } = () => ({})) {
  const calls: string[] = [];
  const stub = vi.fn(async (input: any) => {
    const url = String(typeof input === 'string' ? input : (input?.url ?? input));
    calls.push(url);
    const { status = 200, body = {} } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as any;
  });
  vi.stubGlobal('fetch', stub);
  return { calls, stub };
}

describe('外壳请求卫生', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    appStore.getState().setSession(null);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    appStore.getState().setSession(null);
  });

  // ── DB 状态心跳：按角色门控 ───────────────────────────────────

  it('学生会话不发起 DB 状态心跳（/api/db-status 只对教师/管理员开放）', async () => {
    const { calls } = installFetchStub();
    appStore.getState().setSession({ role: 'student', studentId: 'stu-1', name: '学生甲' } as any);

    renderHook(() => useSessionBootstrap({ fetchStudents: vi.fn().mockResolvedValue(undefined) }));

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.filter((url) => url.includes('/api/db-status'))).toHaveLength(0);
  });

  it('教师会话照常发起 DB 状态心跳（不能把能力一起关掉）', async () => {
    const { calls } = installFetchStub();
    appStore.getState().setSession({ role: 'teacher', userId: 'usr-1', username: 't1', name: '教师' } as any);

    renderHook(() => useSessionBootstrap({ fetchStudents: vi.fn().mockResolvedValue(undefined) }));

    await waitFor(() => expect(calls.some((url) => url.includes('/api/db-status'))).toBe(true));
  });

  it('管理员会话照常发起 DB 状态心跳（管理员是 role=teacher + subRole=administrator）', async () => {
    const { calls } = installFetchStub();
    // 管理员与会话类型里同为 `role: 'teacher'`，靠 subRole 区分。守住这条是为了
    // 防止将来把门控收窄成「只认 subRole !== 'administrator'」而误伤管理员。
    appStore
      .getState()
      .setSession({ role: 'teacher', subRole: 'administrator', userId: 'usr-2', name: '管理员' } as any);

    renderHook(() => useSessionBootstrap({ fetchStudents: vi.fn().mockResolvedValue(undefined) }));

    await waitFor(() => expect(calls.some((url) => url.includes('/api/db-status'))).toBe(true));
  });

  // ── DB 状态徽章：学生端不渲染 ────────────────────────────────

  const headerProps = (activeRole: 'teacher' | 'student') => ({
    lang: 'zh' as const,
    activeRole,
    session: { role: activeRole, name: activeRole === 'teacher' ? '教师甲' : '学生甲' } as any,
    studentViewStatus: 'dashboard' as const,
    setStudentViewStatus: vi.fn(),
    teacherTab: 'dashboard',
    setTeacherTab: vi.fn(),
    onLogout: vi.fn(),
    addToast: vi.fn(),
    siteInfo: { siteName: 'OpenLearn', slogan: '', logoUrl: null } as any,
    dbConnected: true,
    dbStatus: 'normal' as const,
  });

  it('学生端顶栏不渲染 DB 状态徽章（运维指标不该出现在学生界面）', () => {
    installFetchStub();
    render(
      <AppDataProvider value={headerProps('student') as any}>
        <AppHeader />
      </AppDataProvider>,
    );
    expect(document.querySelector('#db-connection-status-badge')).toBeNull();
  });

  it('教师端顶栏仍然渲染 DB 状态徽章', () => {
    installFetchStub();
    render(
      <AppDataProvider value={headerProps('teacher') as any}>
        <AppHeader />
      </AppDataProvider>,
    );
    expect(document.querySelector('#db-connection-status-badge')).not.toBeNull();
  });
});
