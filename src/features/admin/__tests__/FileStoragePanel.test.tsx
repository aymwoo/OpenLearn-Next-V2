import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStoragePanel } from '../FileStoragePanel';

describe('FileStoragePanel (管理后台文件存储策略面板)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  function installFetchMock(overrides?: { putHandler?: (body: any) => Promise<any> }) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/admin/file-storage/config' && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            config: {
              layout: { scheme: 'by-date' },
              defaultBackend: 'local',
              deduplicateByHash: true,
            },
            backends: [
              {
                id: 'local',
                displayName: '本地磁盘存储 (Local Disk)',
                description: 'Stores uploaded files under <OPENLEARN_DATA_DIR>/files.',
                owner: 'core',
                capabilities: { supportsRange: true, supportsPresignedUrl: false, externalBacked: false },
              },
            ],
          }),
        } as Response;
      }

      if (url === '/api/admin/file-storage/stats') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            stats: {
              activeAssets: 12,
              totalAssets: 14,
              uniqueBlobs: 9,
              physicalBytes: 2048,
              logicalBytes: 4096,
              savedBytes: 2048,
              legacyAliases: 3,
            },
          }),
        } as Response;
      }

      if (url === '/api/admin/file-storage/preview') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        return {
          ok: true,
          json: async () => ({
            success: true,
            previewKey:
              body.scheme === 'custom'
                ? 'lesson-asset/2026/11/课件插图-0001.png'
                : '2026/11/14/lesson-asset/课件插图-0001.png',
          }),
        } as Response;
      }

      if (url === '/api/admin/file-storage/config' && init?.method === 'PUT') {
        const body = init.body ? JSON.parse(String(init.body)) : {};
        if (overrides?.putHandler) {
          return overrides.putHandler(body);
        }
        return {
          ok: true,
          json: async () => ({ success: true, config: body }),
        } as Response;
      }

      return { ok: false, json: async () => ({ error: 'Unexpected fetch' }) } as Response;
    });

    global.fetch = fetchMock as any;
    return fetchMock;
  }

  it('加载配置与去重统计，严格遵循自定义模板延迟校验与无障碍错误绑定', async () => {
    const fetchMock = installFetchMock();
    render(<FileStoragePanel lang="zh" />);

    await waitFor(() => {
      expect(screen.getByText('12')).toBeTruthy();
      expect(screen.getByText('2026/11/14/lesson-asset/课件插图-0001.png')).toBeTruthy();
    });

    // 切换到 custom 模式后，初始尚未触发错误：aria-invalid="false"
    const customRadio = screen.getByRole('radio', { name: /自定义路径模板/ });
    fireEvent.click(customRadio);

    const templateInput = screen.getByLabelText('自定义路径模板') as HTMLInputElement;
    expect(templateInput.getAttribute('aria-invalid')).toBe('false');
    expect(templateInput.getAttribute('autocorrect')).toBe('off');
    expect(templateInput.getAttribute('autocapitalize')).toBe('none');
    expect(templateInput.getAttribute('spellcheck')).toBe('false');

    // 输入缺少唯一占位符的模板并提交 -> 触发校验、聚焦输入框、不发送 PUT
    fireEvent.change(templateInput, { target: { value: 'unsafe/{purpose}' } });
    const submitBtn = screen.getByRole('button', { name: /保存文件存储策略/ });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(templateInput.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(templateInput);
    });

    const putCallsAfterInvalid = fetchMock.mock.calls.filter(
      (c) => c[0] === '/api/admin/file-storage/config' && c[1]?.method === 'PUT',
    );
    expect(putCallsAfterInvalid.length).toBe(0);

    // 修正为包含 {safeName} 的合法模板并提交
    fireEvent.change(templateInput, { target: { value: 'custom/{courseId}/{safeName}' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const putCalls = fetchMock.mock.calls.filter(
        (c) => c[0] === '/api/admin/file-storage/config' && c[1]?.method === 'PUT',
      );
      expect(putCalls.length).toBe(1);
      const sent = JSON.parse(String(putCalls[0][1]!.body));
      expect(sent.layout.scheme).toBe('custom');
      expect(sent.layout.template).toBe('custom/{courseId}/{safeName}');
      expect(screen.getByRole('status').textContent).toContain('文件存储策略已保存');
    });
  });
});
