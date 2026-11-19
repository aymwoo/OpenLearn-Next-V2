// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminRuntimePoliciesPanel } from '../AdminRuntimePoliciesPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const policies = {
  hookTelemetry: {
    enabled: true,
    storedValue: null,
    configSource: 'default',
    effect: '新打开的课件会立即按此值注入',
  },
  httpAccessLog: {
    mode: 'errors',
    storedMode: null,
    modeSource: 'default',
    ignorePrefixes: [],
    storedIgnore: null,
    ignoreSource: 'default',
    slowMs: 1000,
    storedSlowMs: null,
    slowSource: 'default',
    effect: '对后续请求立即生效',
  },
  allowUnsigned: {
    allowByDefault: true,
    storedValue: null,
    configSource: 'default',
    effect: '不是全信任',
  },
  modePacks: {
    enabled: false,
    storedValue: null,
    configSource: 'default',
    showXueanTab: false,
    storedShowXueanTab: null,
    showXueanTabSource: 'default',
    effect: '默认关闭',
  },
  communityInstall: {
    enabled: true,
    storedValue: null,
    configSource: 'default',
    effect: '默认开启',
  },
};

describe('AdminRuntimePoliciesPanel', () => {
  it('展示用途、来源、保留 ENV，并提交显式开关', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/runtime-policies' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}'));
        return {
          ok: true,
          json: async () => ({
            success: true,
            policies: {
              ...policies,
              hookTelemetry: {
                ...policies.hookTelemetry,
                enabled: body.hookTelemetryEnabled === false ? false : true,
                storedValue: body.hookTelemetryEnabled ?? null,
                configSource: body.hookTelemetryEnabled == null ? 'default' : 'database',
              },
            },
            reservedEnvBoundaries: [
              { key: 'OPENLEARN_SKIP_PASSWORD_CHANGE_GATE', reason: '跳过改密门禁属于认证绕过，禁止做成普通按钮。' },
            ],
            retiredFeatureEnv: [
              { key: 'OPENLEARN_COMMUNITY_INSTALL', setting: '允许从社区注册表安装', historicalDefault: '开启' },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          policies,
          reservedEnvBoundaries: [
            { key: 'OPENLEARN_SKIP_PASSWORD_CHANGE_GATE', reason: '跳过改密门禁属于认证绕过，禁止做成普通按钮。' },
            { key: 'LOG_REDACT', reason: '允许从界面关闭会把口令与令牌写入日志。' },
          ],
          retiredFeatureEnv: [{ key: 'VITE_OPENLEARN_MODE_PACKS', setting: 'Mode Pack', historicalDefault: '关闭' }],
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminRuntimePoliciesPanel lang="zh" />);
    expect(await screen.findByText('运行时策略（管理员）')).toBeTruthy();
    expect(screen.getByText(/不再读取环境变量/)).toBeTruthy();
    expect(screen.getByTestId('runtime-policy-mode-packs')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Mode Pack' })).toBeTruthy();
    expect(screen.getByTestId('runtime-policy-retired-env').textContent).toContain('VITE_OPENLEARN_MODE_PACKS');
    expect(screen.getByTestId('runtime-policy-reserved-env').textContent).toContain(
      'OPENLEARN_SKIP_PASSWORD_CHANGE_GATE',
    );
    expect(screen.getByTestId('runtime-policy-reserved-env').textContent).toContain('认证绕过');

    fireEvent.click(screen.getByRole('switch', { name: '课件网络遥测总闸' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ hookTelemetryEnabled: false });
    });
  });

  it('403 时提示仅管理员可查看，不渲染保留清单细节作为可写表单', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden' }),
      })),
    );
    render(<AdminRuntimePoliciesPanel lang="zh" />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('仅管理员可查看运行时策略');
    expect(screen.queryByRole('switch', { name: '课件网络遥测总闸' })).toBeNull();
  });
});
