// @vitest-environment jsdom
/**
 * 安装向导的隔离档选择 —— 必须与**服务端信任结论**一致。
 *
 * 回归背景：`trustedInProcess = false` 曾硬编码，三个单选按钮永远不渲染，
 * `effectiveMode` 恒为 `'process'` 并作为 `X-Execution-Mode` 发出 ——
 * 于是从 UI 装的包永远是子进程，受信 inline 插件也永远装不成 inline。
 *
 * 现在的契约：
 * 1. 向导解析完 manifest 后问 `GET /api/plugins/isolation-policy`；
 * 2. `trusted !== true`（或接口失败 / 403 / 非 200）⇒ 锁定子进程，只展示说明；
 * 3. `trusted === true` ⇒ 展示三档单选，选中的档位如实上报；
 * 4. 升级路径按该插件**当前实际档**回填，避免每次升级把 inline 静默降回 process。
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

type FetchImpl = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** 带参数签名的 mock —— 否则 `mock.calls[0][1]` 会被推断成空元组。 */
function makeConfirm() {
  return vi.fn(
    async (_file: File, _mode: 'worker' | 'inline' | 'process', _opts?: Record<string, unknown>): Promise<void> =>
      undefined,
  );
}

function stubFetch(policy: unknown | (() => Promise<never>), opts: { byManifest?: unknown } = {}) {
  const impl: FetchImpl = async (url: string) => {
    if (url.includes('/api/plugins/isolation-policy')) {
      if (typeof policy === 'function') return (policy as () => Promise<never>)();
      return { ok: true, json: async () => policy };
    }
    return { ok: true, json: async () => opts.byManifest ?? { success: true, installed: false } };
  };
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function renderWizard(
  file: File,
  onConfirmInstall: ReturnType<typeof vi.fn>,
  extra: Record<string, unknown> = {},
) {
  render(
    <PluginInstallWizard
      isOpen
      lang="zh"
      file={file}
      onClose={() => undefined}
      onConfirmInstall={onConfirmInstall as never}
      {...extra}
    />,
  );
  // 升级路径会在页面上多处渲染插件名 —— 用 findAll 避免「找到多个」的误报
  expect((await screen.findAllByText(/社区示例|受信示例/)).length).toBeGreaterThan(0);
  for (let i = 0; i < 4; i += 1) {
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  }
}

const manifest = (id: string) => ({
  id,
  name: id === 'ext-community' ? '社区示例' : '受信示例',
  version: '1.0.0',
  executionMode: 'inline',
});

describe('PluginInstallWizard 隔离档与服务端信任结论对齐', () => {
  it('服务端判为不可信时：锁定子进程，且上报 process', async () => {
    // 曾经的默认 mock：任何 URL 都返回 installed:false —— 等价于「问不到信任结论」
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ success: true, installed: false }) })),
    );
    const onConfirmInstall = makeConfirm();

    await renderWizard(await zipFile(manifest('ext-community')), onConfirmInstall);

    expect(screen.getByTestId('wizard-isolation-lock')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /主进程/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '确认安装并上传' }));
    await waitFor(() => expect(onConfirmInstall).toHaveBeenCalledTimes(1));
    expect(onConfirmInstall.mock.calls[0][1]).toBe('process');
  });

  it('策略接口失败（403 / 网络错误）时按不可信处理（fail-closed）', async () => {
    stubFetch(() => Promise.reject(new Error('403')));
    const onConfirmInstall = makeConfirm();

    await renderWizard(await zipFile(manifest('ext-community')), onConfirmInstall);

    expect(screen.getByTestId('wizard-isolation-lock')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /主进程/ })).toBeNull();
  });

  it('服务端判为受信时：展示三档单选，选中的档位如实上报', async () => {
    stubFetch({ success: true, trusted: true, resolvedMode: 'process' });
    const onConfirmInstall = makeConfirm();

    await renderWizard(await zipFile(manifest('openlearn-plugin-trusted-demo')), onConfirmInstall);

    expect(screen.queryByTestId('wizard-isolation-lock')).toBeNull();
    // 默认仍是子进程 —— 受信不等于默认降档
    expect((screen.getByRole('radio', { name: /子进程隔离/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: /主进程（仅受信内置）/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认安装并上传' }));

    await waitFor(() => expect(onConfirmInstall).toHaveBeenCalledTimes(1));
    expect(onConfirmInstall.mock.calls[0][1]).toBe('inline');
  });

  it('升级路径按该插件当前实际档回填，不把 inline 静默降回 process', async () => {
    stubFetch(
      { success: true, trusted: true, resolvedMode: 'inline' },
      {
        byManifest: {
          success: true,
          installed: true,
          pluginId: 'db-1',
          name: '受信示例',
          version: '0.9.0',
          status: 'active',
          isSystem: false,
          isolationMode: 'inline',
        },
      },
    );
    const onConfirmInstall = makeConfirm();

    await renderWizard(await zipFile(manifest('openlearn-plugin-trusted-demo')), onConfirmInstall);

    await waitFor(() =>
      expect((screen.getByRole('radio', { name: /主进程（仅受信内置）/ }) as HTMLInputElement).checked).toBe(true),
    );

    // 升级路径的按钮文案是「确认更新并上传」
    fireEvent.click(screen.getByRole('button', { name: '确认更新并上传' }));
    await waitFor(() => expect(onConfirmInstall).toHaveBeenCalledTimes(1));
    expect(onConfirmInstall.mock.calls[0][1]).toBe('inline');
    expect(onConfirmInstall.mock.calls[0][2]).toEqual(
      expect.objectContaining({ mode: 'update', targetPluginId: 'db-1' }),
    );
  });
});
