// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { PluginInstallWizard } from '../PluginInstallWizard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function zipFile(manifest: Record<string, unknown>): Promise<File> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([buf], 'plugin.zip', { type: 'application/zip' });
}

describe('PluginInstallWizard isolation lock', () => {
  it('把非 @openlearn 插件锁在子进程，且默认不批准公开路由', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ success: true, installed: false }) })),
    );
    const onConfirmInstall = vi.fn(
      async (
        _file: File,
        _mode: 'worker' | 'inline' | 'process',
        _opts?: { mode?: string; approvePublicRoutes?: boolean },
      ) => undefined,
    );
    const file = await zipFile({
      id: 'ext-community',
      name: '社区示例',
      version: '1.0.0',
      executionMode: 'inline',
      description: '第三方',
    });

    render(
      <PluginInstallWizard
        isOpen
        lang="zh"
        file={file}
        onClose={() => undefined}
        onConfirmInstall={onConfirmInstall}
      />,
    );

    expect(await screen.findByText('社区示例')).toBeTruthy();
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    }

    expect(await screen.findByTestId('wizard-isolation-lock')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /主进程/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '确认安装并上传' }));

    await waitFor(() => expect(onConfirmInstall).toHaveBeenCalledTimes(1));
    expect(onConfirmInstall.mock.calls[0]?.[1]).toBe('process');
    expect(onConfirmInstall.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({ mode: 'install', approvePublicRoutes: false }),
    );
  });
});
