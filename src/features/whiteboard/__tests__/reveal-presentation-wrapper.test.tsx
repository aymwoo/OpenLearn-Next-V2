import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RevealPresentationWrapper } from '../widgets/RevealPresentationWrapper';

describe('RevealPresentationWrapper (Presentation & PPTX Async Loading)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 每个用例自己卸载：本文件没有全局 RTL cleanup，漏掉会污染后续用例 ——
  // 表现为「同一段 markdown 在多个已挂载的树里各渲染一份」，getByText 报 multiple elements。
  afterEach(() => cleanup());

  it('renders markdown presentation slides without loading PPTX viewer', () => {
    const data = {
      markdown: '# Slide 1\n---\n## Slide 2 Content',
      fileType: 'md',
    };

    render(<RevealPresentationWrapper elementId="pres-1" data={data} userRole="teacher" />);

    expect(screen.getByText('Slide 1')).toBeDefined();
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();

    // 切换到下一页
    const nextButtons = screen.getAllByRole('button');
    const rightButton = nextButtons.find((btn) => btn.querySelector('svg.lucide-chevron-right'));
    if (rightButton) {
      fireEvent.click(rightButton);
      expect(screen.getByText('Slide 2 Content')).toBeDefined();
    }
  });

  it('switches between PPT, Document, and Edit modes', () => {
    const data = {
      markdown: '# Overview\nDetails here',
      fileType: 'md',
    };

    render(<RevealPresentationWrapper elementId="pres-2" data={data} userRole="teacher" />);

    // 点击进入编辑模式
    const editBtn = screen.getAllByTitle('在线编辑 Markdown 内容')[0];
    fireEvent.click(editBtn);

    const textarea = screen.getByPlaceholderText(/在此输入 Markdown 文档/);
    expect(textarea).toBeDefined();

    // 点击进入讲义模式
    const docBtn = screen.getAllByTitle('以精美文档形式阅读 (Markdown Document mode)')[0];
    fireEvent.click(docBtn);
    // 断言必须挑「只在 doc 模式存在」的标记：doc 模式下 'Overview' 会同时出现在
    // 大纲侧栏按钮与正文标题里，`getByText('Overview')` 是歧义的 —— 它此前能过，
    // 只是因为点击没生效、mode 没真的切过去（一旦切换成功就报 multiple elements）。
    expect(screen.getByText('文档大纲')).toBeDefined();
    expect(screen.getAllByText('Overview').length).toBeGreaterThanOrEqual(1);
  });

  it('safely loads and renders PowerPointViewer and cleans up on unmount', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(32)),
    } as any);

    try {
      const { unmount, rerender } = render(
        <RevealPresentationWrapper
          elementId="pres-pptx"
          data={{
            fileUrl: 'http://localhost:9000/sample.pptx',
            fileType: 'pptx',
            slideCount: 3,
          }}
          userRole="teacher"
        />,
      );

      // 等待异步 fetch 触发与完成
      await vi.waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('http://localhost:9000/sample.pptx');
      });

      // 切换课件类型为 md：触发卸载与清理分支
      rerender(
        <RevealPresentationWrapper
          elementId="pres-pptx"
          data={{
            markdown: '# Back to Markdown',
            fileType: 'md',
          }}
          userRole="teacher"
        />,
      );

      expect(() => unmount()).not.toThrow();
    } finally {
      global.fetch = originalFetch;
    }
  });
  it('renders a download card for non-embeddable course-package attachments', () => {
    // 课程包可以带 docx/xlsx/zip 这类附件，但白板没有它们的内联渲染器。
    // 服务端导入时会把 fileType 降级成 'file'；这里必须给出一张可下载的卡片，
    // 而不是让 PowerPointViewer 去解析 zip 字节（表现是「一直解析中」）。
    const data = {
      fileUrl: '/uploads/1234-abcd.docx',
      fileName: '第3章讲义.docx',
      fileType: 'file',
      slideCount: 0,
    };

    render(<RevealPresentationWrapper elementId="pres-file" data={data} userRole="teacher" />);

    expect(screen.getByTestId('course-package-file-card')).toBeTruthy();
    expect(screen.getByText('第3章讲义.docx')).toBeTruthy();
    const link = screen.getByTestId('course-package-file-download') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/uploads/1234-abcd.docx');
    expect(link.getAttribute('download')).toBe('第3章讲义.docx');
  });

  it('lets teachers drop the reference but hides that affordance from students', () => {
    const onElementUpdate = vi.fn();
    const data = { fileUrl: '/uploads/x.zip', fileName: '素材.zip', fileType: 'file', slideCount: 0 };

    render(
      <RevealPresentationWrapper
        elementId="pres-file-2"
        data={data}
        userRole="teacher"
        onElementUpdate={onElementUpdate}
      />,
    );
    expect(screen.getByTestId('course-package-file-clear')).toBeTruthy();

    cleanup();
    render(
      <RevealPresentationWrapper elementId="pres-file-3" data={data} userRole="student" onElementUpdate={onElementUpdate} />,
    );
    expect(screen.queryByTestId('course-package-file-clear')).toBeNull();
  });

});
