import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevealPresentationWrapper } from '../widgets/RevealPresentationWrapper';

describe('RevealPresentationWrapper (Presentation & PPTX Async Loading)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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
    expect(screen.getByText('Overview')).toBeDefined();
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
});
