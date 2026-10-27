// @vitest-environment jsdom
/**
 * R-02：安装向导必须把「清单申请的出站域名」摆到管理员面前。
 *
 * 背景（`docs/audit/trust-boundary-hardening-audit-2026-10-14.md` R-02）：
 * 插件的 `network.outbound` 声明此前在安装界面上完全不可见，管理员既不知道
 * 这个插件想访问哪些外部主机，也没有任何批准入口 —— `approvePluginNetHosts`
 * 在整个仓库里没有任何调用方，等于这条路根本走不通。
 *
 * 这里钉住三件事：
 * 1. 可批准的域名逐条列出，且默认**不勾选**（fail-closed）；
 * 2. 永远不可批准的项（回环/私有/通配符）**单独列出并带原因**，
 *    不能混进可批准列表让管理员误以为勾上就生效；
 * 3. 勾选后 `approveNetworkHosts` 一路传到安装选项，不打折扣。
 */
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

async function advanceToSecurityStep(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
  }
}

describe('PluginInstallWizard outbound hosts (R-02)', () => {
  it('lists requested hosts, never pre-approves them, and separates blocked ones with reasons', async () => {
    const file = await zipFile({
      id: 'ext-outbound',
      name: '出站示例',
      version: '1.0.0',
      executionMode: 'inline',
      description: '第三方',
      network: { outbound: ['api.openai.com', 'localhost', '*.evil.com'] },
    });

    render(<PluginInstallWizard isOpen lang="zh" file={file} onClose={() => undefined} onConfirmInstall={vi.fn()} />);

    await advanceToSecurityStep();

    // 可批准的域名必须出现在界面上
    expect(await screen.findByText('api.openai.com')).toBeTruthy();
    // 默认不勾选 = 零白名单
    const checkbox = screen.getByTestId('approve-network-hosts') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // 不可批准的项要带原因单独说明，而不是静默消失
    expect(screen.getByText(/永远.*批准|永远不会被批准/)).toBeTruthy();
    expect(screen.getByText(/不支持通配符/)).toBeTruthy();
  });

  it('passes approveNetworkHosts through to the install options when checked', async () => {
    const onConfirmInstall = vi.fn(
      async (_file: File, _mode: string, _opts?: { approveNetworkHosts?: boolean }) => undefined,
    );
    const file = await zipFile({
      id: 'ext-outbound-2',
      name: '出站示例2',
      version: '1.0.0',
      executionMode: 'inline',
      description: '第三方',
      network: { outbound: ['api.openai.com'] },
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

    await advanceToSecurityStep();
    fireEvent.click(await screen.findByTestId('approve-network-hosts'));
    fireEvent.click(screen.getByRole('button', { name: '确认安装并上传' }));

    await waitFor(() => expect(onConfirmInstall).toHaveBeenCalledTimes(1));
    expect(onConfirmInstall.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ approveNetworkHosts: true }));
  });

  it('renders no outbound section for plugins that request nothing', async () => {
    const file = await zipFile({
      id: 'ext-no-outbound',
      name: '无出站示例',
      version: '1.0.0',
      executionMode: 'inline',
      description: '第三方',
    });

    render(<PluginInstallWizard isOpen lang="zh" file={file} onClose={() => undefined} onConfirmInstall={vi.fn()} />);

    await advanceToSecurityStep();
    expect(screen.queryByTestId('approve-network-hosts')).toBeNull();
  });
});
