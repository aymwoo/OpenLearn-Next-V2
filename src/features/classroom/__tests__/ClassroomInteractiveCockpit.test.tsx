import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ClassroomInteractiveCockpit } from '../ClassroomInteractiveCockpit';
import { StageDisplayModal } from '../StageDisplayModal';

describe('ClassroomInteractiveCockpit & StageDisplayModal', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn((url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/classroom/sessions/')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              hasActiveSession: true,
              stage: 'IN_CLASS_TEACHING',
              activePoll: null,
              activeBuzzer: null,
            }),
        });
      }
      if (urlStr.includes('/api/classroom/stage/')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stage: 'IN_CLASS_TEACHING',
              checkinCode: '8848',
              activePoll: null,
              activeBuzzer: null,
              pacing: { TOO_FAST: 1, CONFUSED: 2, CLEAR: 10 },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    }) as any;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders all four classroom stage transition buttons', () => {
    render(
      <ClassroomInteractiveCockpit
        lessonId="les_1"
        lessonTitle="物理课"
        classId="cls_1"
        lang="zh"
        addToast={addToast}
      />,
    );

    expect(screen.getByText('课前就绪')).toBeDefined();
    expect(screen.getByText('课中授课')).toBeDefined();
    expect(screen.getByText('结课通票')).toBeDefined();
    expect(screen.getByText('学情简报')).toBeDefined();
  });

  it('renders quick action buttons: 极速投票, 发起抢答, 60s 通票, and 打开大屏展台', () => {
    render(
      <ClassroomInteractiveCockpit
        lessonId="les_1"
        lessonTitle="物理课"
        classId="cls_1"
        lang="zh"
        addToast={addToast}
      />,
    );

    expect(screen.getByText('极速投票')).toBeDefined();
    expect(screen.getByText('发起抢答')).toBeDefined();
    expect(screen.getByText('60s 通票')).toBeDefined();
    expect(screen.getByText('打开大屏展台')).toBeDefined();
  });

  it('opens quick poll setup modal when 极速投票 button is clicked', () => {
    render(
      <ClassroomInteractiveCockpit
        lessonId="les_1"
        lessonTitle="物理课"
        classId="cls_1"
        lang="zh"
        addToast={addToast}
      />,
    );

    const pollBtn = screen.getByText('极速投票');
    fireEvent.click(pollBtn);

    expect(screen.getByText('发起口播极速单选')).toBeDefined();
    expect(screen.getByText('ABCD 四选一')).toBeDefined();
    expect(screen.getByText('正确 / 错误')).toBeDefined();
  });

  it('renders stage display modal and handles close action', () => {
    const onClose = vi.fn();
    render(
      <StageDisplayModal
        isOpen={true}
        onClose={onClose}
        lessonId="les_1"
        lessonTitle="牛顿力学大屏展台"
        lang="zh"
      />,
    );

    expect(screen.getByText('牛顿力学大屏展台')).toBeDefined();
    expect(screen.getByText('大屏教学展台')).toBeDefined();

    const closeBtn = screen.getByTitle('关闭展台');
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
