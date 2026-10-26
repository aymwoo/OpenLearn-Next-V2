/**
 * 作业附件预览对话框单测。
 *
 * 盯住四件事：
 * 1. 内置渲染形态选对（图片 / PDF / 文本 / 不支持）；
 * 2. 文本预览**按文本渲染**（不进 innerHTML），且内容来自带鉴权的下载端点；
 * 3. 扩展插槽按**文件类型**匹配：声明 .docx 的预览器不该出现在 .png 的对话框里；
 * 4. 没有任何插件时，不渲染插槽区（不留空壳）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AssignmentFilePreview } from '../AssignmentFilePreview';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';

const assignmentId = 'asg-preview-0001';

function renderPreview(name: string, extra: Record<string, unknown> = {}) {
  return render(
    <AssignmentFilePreview
      assignmentId={assignmentId}
      file={{ id: 'af-preview-0001', original_name: name, size: 1024, ...extra }}
      onClose={() => undefined}
      lang="zh"
    />,
  );
}

describe('AssignmentFilePreview', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    usePluginHostStore.getState().unregisterPluginExtensionPoints('ext-preview-demo');
  });

  afterEach(() => {
    cleanup();
    usePluginHostStore.getState().unregisterPluginExtensionPoints('ext-preview-demo');
  });

  it('图片 → <img>，地址带鉴权且走 inline 端点', () => {
    renderPreview('照片.png');
    const img = screen.getByTestId('assignment-file-preview-image') as HTMLImageElement;
    expect(img.src).toContain(`/api/assignments/${assignmentId}/files/af-preview-0001`);
    expect(img.src).toContain('disposition=inline');
  });

  it('PDF → <iframe> 走 inline 端点', () => {
    renderPreview('报告.pdf');
    const frame = screen.getByTestId('assignment-file-preview-pdf') as HTMLIFrameElement;
    expect(frame.src).toContain('disposition=inline');
  });

  it('文本 → 拉取内容并按纯文本渲染（不进 innerHTML）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<script>alert(1)</script>',
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPreview('笔记.txt');
    await waitFor(() => expect(screen.getByTestId('assignment-file-preview-text')).toBeTruthy());

    const pre = screen.getByTestId('assignment-file-preview-text');
    // 文本按原样显示为文本节点；组件里没有 dangerouslySetInnerHTML
    expect(pre.textContent).toContain('<script>alert(1)</script>');
    expect(pre.querySelector('script')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('disposition=inline');
  });

  it('宿主不支持的类型 → 明确提示 + 仍可下载', () => {
    renderPreview('方案.docx');
    expect(screen.getByTestId('assignment-file-preview-unsupported')).toBeTruthy();
    const download = document.querySelector('a[download], a[href*="/files/"]') as HTMLAnchorElement;
    expect(download?.getAttribute('href')).toContain(`/api/assignments/${assignmentId}/files/af-preview-0001`);
  });

  it('扩展插槽：只有声明能处理该类型的插件才出现', () => {
    usePluginHostStore.getState().registerExtensionPoint('assignment.file.preview', {
      id: 'docx-preview',
      label: 'Word 预览器',
      pluginId: 'ext-preview-demo',
      component: () => null,
      slotProps: { extensions: ['.docx'], commandType: 'ext-preview-demo.preview' },
    });

    // .docx → 命中
    renderPreview('方案.docx');
    expect(screen.getByTestId('assignment-file-preview-plugin')).toBeTruthy();
    expect(screen.getByText('Word 预览器')).toBeTruthy();
  });

  it('扩展插槽：类型不匹配的插件不出现', () => {
    usePluginHostStore.getState().registerExtensionPoint('assignment.file.preview', {
      id: 'docx-preview',
      label: 'Word 预览器',
      pluginId: 'ext-preview-demo',
      component: () => null,
      slotProps: { extensions: ['.docx'], commandType: 'ext-preview-demo.preview' },
    });

    renderPreview('照片.png');
    expect(screen.queryByTestId('assignment-file-preview-plugin')).toBeNull();
  });

  it('没有任何插件时不渲染插槽区', () => {
    renderPreview('方案.docx');
    expect(screen.queryByTestId('assignment-file-preview-plugin')).toBeNull();
    expect(screen.queryByText(/插件预览器/)).toBeNull();
  });
});
