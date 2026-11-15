// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { PluginInstallWizard } from '../PluginInstallWizard';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function zipFile(manifest: Record<string, unknown>, withSignature = false): Promise<File> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  if (withSignature) {
    zip.file('signature.json', JSON.stringify({ version: 2, algorithm: 'ed25519', signature: 'x' }));
  }
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([buf], 'plugin.zip', { type: 'application/zip' });
}

function stubFetch(allowByDefault: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/admin/runtime-policies')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            policies: { allowUnsigned: { allowByDefault } },
          }),
        };
      }
      return { ok: true, json: async () => ({ success: true, trusted: false }) };
    }),
  );
}

describe('PluginInstallWizard unsigned confirmation', () => {
  it('策略收紧时未签名包必须逐次确认，且一键极速安装不能跳过', async () => {
    stubFetch(false);
    const onConfirmInstall = vi.fn(
      async (_file: File, _mode: 'worker' | 'inline' | 'process', _opts?: { mode?: string; allowUnsigned?: boolean }) =>
        undefined,
    );
    const file = await zipFile({ id: 'ext-unsigned', name: '未签名示例', version: '1.0.0', description: 'demo' });
    render(
      <PluginInstallWizard
        isOpen
        lang="zh"
        file={file}
        onClose={() => undefined}
        onConfirmInstall={onConfirmInstall}
      />,
    );

    expect(await screen.findByText('未签名示例')).toBeTruthy();
    const ack = await screen.findByTestId('unsigned-plugin-ack');
    expect(ack.textContent).toContain('不等于全信任');
    expect(ack.textContent).toContain('一键极速安装不能跳过');

    const express = screen.getByRole('button', { name: '一键极速安装' });
    expect((express as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(express);
    expect(onConfirmInstall).not.toHaveBeenCalled();

    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    }
    const confirm = await screen.findByRole('button', { name: '确认安装并上传' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    const boxes = screen.getAllByRole('checkbox');
    for (const box of boxes) fireEvent.click(box);
    expect(((await screen.findByRole('button', { name: '确认安装并上传' })) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认安装并上传' }));
    await waitFor(() => expect(onConfirmInstall).toHaveBeenCalledTimes(1));
    expect(onConfirmInstall.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ allowUnsigned: true }));
  });

  it('含 signature.json 的包即使策略收紧也不走未签名确认，且不传 allowUnsigned', async () => {
    stubFetch(false);
    const onConfirmInstall = vi.fn(
      async (_file: File, _mode: 'worker' | 'inline' | 'process', _opts?: { mode?: string; allowUnsigned?: boolean }) =>
        undefined,
    );
    const file = await zipFile({ id: 'ext-signed', name: '已签名示例', version: '1.0.0', description: 'signed' }, true);
    render(
      <PluginInstallWizard
        isOpen
        lang="zh"
        file={file}
        onClose={() => undefined}
        onConfirmInstall={onConfirmInstall}
      />,
    );
    expect(await screen.findByText('已签名示例')).toBeTruthy();
    expect(screen.queryByTestId('unsigned-plugin-ack')).toBeNull();
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    }
    fireEvent.click(await screen.findByRole('button', { name: '确认安装并上传' }));
    await waitFor(() => expect(onConfirmInstall).toHaveBeenCalledTimes(1));
    expect(onConfirmInstall.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ allowUnsigned: false }));
  });
});
