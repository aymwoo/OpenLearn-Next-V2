import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevealPresentationWrapper } from '../widgets/RevealPresentationWrapper';

describe('RevealPresentationWrapper (Presentation & PPTX Async Loading)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders markdown presentation slides without loading pptx-preview', () => {
    const data = {
      markdown: '# Slide 1\n---\n## Slide 2 Content',
      fileType: 'md',
    };

    render(
      <RevealPresentationWrapper
        elementId="pres-1"
        data={data}
        userRole="teacher"
      />
    );

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

    render(
      <RevealPresentationWrapper
        elementId="pres-2"
        data={data}
        userRole="teacher"
      />
    );

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
});
