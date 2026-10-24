// @vitest-environment jsdom
/**
 * 已安装插件的出站域名面板（审计 R-02 的后半段）。
 *
 * 背景：安装向导只覆盖「装的时候看得见」。已安装插件的管理员仍无处查看与**撤销**
 * 授权 —— 而撤销是授权机制最该有的另一半。这里钉住：
 *
 * 1. 三个列表分开呈现（已批准 / 申请中 / 不可批准），不合并成一张列表 ——
 *    合并会让「清单写了」看起来像「已经能访问」；
 * 2. 不可批准的项**带原因**，且不给批准按钮；
 * 3. 批准 / 撤销打对端点与载荷，完成后重新拉取；
 * 4. 403（非管理员）整块隐藏，而不是甩一个红框给教师。
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PluginNetworkGrantsPanel } from '../PluginNetworkGrantsPanel';

const PLUGIN_ID = 'ext-sample';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function grantsBody(overrides: Partial<{ proposed: string[]; approved: string[]; rejected: unknown[] }> = {}) {
  return {
    success: true,
    proposed: ['api.openai.com', 'pending.example.com'],
    approved: ['api.openai.com'],
    rejected: [{ host: 'localhost', reason: '回环/私有/保留地址一律拒绝（SSRF 防线）' }],
    ...overrides,
  };
}

let calls: Array<{ url: string; method: string; body?: unknown }>;

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return handler(String(url), init);
    }),
  );
}

describe('PluginNetworkGrantsPanel', () => {
  it('renders approved / requested / not-approvable separately', async () => {
    stubFetch(() => jsonResponse(grantsBody()));
    render(<PluginNetworkGrantsPanel pluginId={PLUGIN_ID} lang="zh" />);

    expect(await screen.findByTestId('network-grants-panel')).toBeTruthy();
    // 已批准
    expect(screen.getByText('api.openai.com')).toBeTruthy();
    expect(screen.getByTestId('revoke-api.openai.com')).toBeTruthy();
    // 申请中（approved 里已有的不应重复出现在申请区）
    expect(screen.getByTestId('approve-pending.example.com')).toBeTruthy();
    expect(screen.queryByTestId('approve-api.openai.com')).toBeNull();
    // 不可批准 —— 带原因，且没有批准按钮
    expect(screen.getByTestId('rejected-hosts').textContent).toContain('localhost');
    expect(screen.getByTestId('rejected-hosts').textContent).toContain('回环');
    expect(screen.queryByTestId('approve-localhost')).toBeNull();
  });

  it('approves a single host and refreshes the list', async () => {
    let approved = ['api.openai.com'];
    stubFetch((url, init) => {
      if (init?.method === 'POST') {
        approved = [...approved, 'pending.example.com'];
        return jsonResponse({ success: true, approved: ['pending.example.com'], rejected: [] });
      }
      return jsonResponse(
        grantsBody({
          approved,
          proposed: ['api.openai.com', 'pending.example.com'],
        }),
      );
    });

    render(<PluginNetworkGrantsPanel pluginId={PLUGIN_ID} lang="zh" />);
    fireEvent.click(await screen.findByTestId('approve-pending.example.com'));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe(`/api/plugins/${PLUGIN_ID}/network-grants`);
    expect(post.body).toEqual({ hosts: ['pending.example.com'] });

    // 批准后重新拉取，该项应出现在「已批准」区并带撤销入口
    await waitFor(() => expect(screen.getByTestId('revoke-pending.example.com')).toBeTruthy());
  });

  it('revokes an approved host via DELETE with the host in the query', async () => {
    let approved = ['api.openai.com'];
    stubFetch((url, init) => {
      if (init?.method === 'DELETE') {
        approved = [];
        return jsonResponse({ success: true, revoked: 'api.openai.com' });
      }
      return jsonResponse(grantsBody({ approved, proposed: ['api.openai.com'] }));
    });

    render(<PluginNetworkGrantsPanel pluginId={PLUGIN_ID} lang="zh" />);
    fireEvent.click(await screen.findByTestId('revoke-api.openai.com'));

    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.url).toContain(`/api/plugins/${PLUGIN_ID}/network-grants`);
    expect(del.url).toContain('host=api.openai.com');
  });

  it('hides the whole panel for non-admins (403) instead of showing an error', async () => {
    stubFetch(() => jsonResponse({ success: false, error: 'forbidden' }, 403));
    render(<PluginNetworkGrantsPanel pluginId={PLUGIN_ID} lang="zh" />);
    await waitFor(() => expect(screen.queryByTestId('network-grants-loading')).toBeNull());
    expect(screen.queryByTestId('network-grants-panel')).toBeNull();
  });

  it('renders nothing when the plugin neither declares nor holds any host', async () => {
    stubFetch(() => jsonResponse({ success: true, proposed: [], approved: [], rejected: [] }));
    render(<PluginNetworkGrantsPanel pluginId={PLUGIN_ID} lang="zh" />);
    await waitFor(() => expect(screen.queryByTestId('network-grants-loading')).toBeNull());
    expect(screen.queryByTestId('network-grants-panel')).toBeNull();
  });

  it('explains the default-deny state when nothing is approved yet', async () => {
    stubFetch(() => jsonResponse({ success: true, proposed: ['api.openai.com'], approved: [], rejected: [] }));
    render(<PluginNetworkGrantsPanel pluginId={PLUGIN_ID} lang="zh" />);
    expect(await screen.findByTestId('no-approved')).toBeTruthy();
    expect(screen.getByTestId('approve-api.openai.com')).toBeTruthy();
  });
});
