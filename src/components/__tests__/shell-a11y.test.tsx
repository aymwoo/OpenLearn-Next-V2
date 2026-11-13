import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { RightSidebar } from '../../features/shared/RightSidebar';
import { QuickActionsMenu } from '../QuickActionsMenu';
import { RevealPresentationWrapper } from '../../features/whiteboard/widgets/RevealPresentationWrapper';

describe('Shell accessibility landmarks & interactive semantics (#487)', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('RightSidebar uses <aside> with aria-label when expanded and <button type="button"> when collapsed', () => {
    const setShowRightSidebar = vi.fn();
    render(<RightSidebar showRightSidebar={true} setShowRightSidebar={setShowRightSidebar} lang="zh" t={{}} />);

    const aside = screen.getByRole('complementary', { name: 'AI 与扩展侧栏' });
    expect(aside.tagName).toBe('ASIDE');

    const collapseBtn = screen.getByRole('button', { name: '收起右侧栏' });
    expect(collapseBtn.getAttribute('type')).toBe('button');

    cleanup();

    render(<RightSidebar showRightSidebar={false} setShowRightSidebar={setShowRightSidebar} lang="zh" t={{}} />);

    const expandBtn = screen.getByRole('button', { name: 'OS Core Options · 展开 AI 与扩展侧栏' });
    expect(expandBtn.tagName).toBe('BUTTON');
    expect(expandBtn.getAttribute('type')).toBe('button');
    fireEvent.click(expandBtn);
    expect(setShowRightSidebar).toHaveBeenCalledWith(true);
  });

  it('QuickActionsMenu renders native <button type="button"> elements for quick action options', () => {
    render(
      <QuickActionsMenu
        classes={[]}
        lessons={[]}
        lang="zh"
        onScheduleClass={async () => true}
        onGenerateAssignment={async () => true}
        onCreateLesson={async () => true}
      />,
    );

    const fab = screen.getByRole('button', { name: '快捷操作指令' });
    expect(fab.getAttribute('type')).toBe('button');
    expect(fab.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(fab);
    expect(fab.getAttribute('aria-expanded')).toBe('true');

    const actionSchedule = document.getElementById('action-schedule-class');
    const actionAssignment = document.getElementById('action-generate-assignment');
    const actionLesson = document.getElementById('action-create-lesson');

    expect(actionSchedule?.tagName).toBe('BUTTON');
    expect(actionSchedule?.getAttribute('type')).toBe('button');
    expect(actionAssignment?.tagName).toBe('BUTTON');
    expect(actionLesson?.tagName).toBe('BUTTON');
  });

  it('RevealPresentationWrapper adds a descriptive title attribute to PDF preview iframes', () => {
    render(
      <RevealPresentationWrapper
        elementId="el-pdf-1"
        data={{
          fileType: 'pdf',
          fileUrl: '/uploads/demo-slides.pdf',
          fileName: 'Demo Slides.pdf',
        }}
      />,
    );

    const iframe = document.querySelector('iframe');
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute('title')).toBe('Demo Slides.pdf');
  });
});
