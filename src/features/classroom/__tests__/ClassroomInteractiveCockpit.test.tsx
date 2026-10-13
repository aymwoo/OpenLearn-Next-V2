import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  ClassroomInteractiveCockpit,
  isStageTransitionAllowed,
  getStageTransitionBlockReason,
} from '../ClassroomInteractiveCockpit';
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

    expect(screen.getByText('极速投票配置')).toBeDefined();
    expect(screen.getByText('ABCD 四选一')).toBeDefined();
    expect(screen.getByText('正确 / 错误')).toBeDefined();
  });

  it('renders stage display modal and handles close action', () => {
    const onClose = vi.fn();
    render(
      <StageDisplayModal isOpen={true} onClose={onClose} lessonId="les_1" lessonTitle="牛顿力学大屏展台" lang="zh" />,
    );

    expect(screen.getByText('牛顿力学大屏展台')).toBeDefined();
    expect(screen.getByText('大屏教学展台')).toBeDefined();

    const closeBtn = screen.getByTitle('关闭展台');
    expect(closeBtn).toBeDefined();
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('disables 课前就绪 button when in IN_CLASS_TEACHING stage and blocks transition with warning', () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    render(
      <ClassroomInteractiveCockpit
        lessonId="les_1"
        lessonTitle="物理课"
        classId="cls_1"
        lang="zh"
        addToast={addToast}
        currentStage="IN_CLASS_TEACHING"
      />,
    );

    const preClassBtn = screen.getByText('课前就绪').closest('button')!;
    const exitTicketBtn = screen.getByText('结课通票').closest('button')!;

    // 课前就绪按钮应处于 disabled / 置灰状态
    expect(preClassBtn.getAttribute('disabled')).not.toBeNull();
    expect(preClassBtn.getAttribute('aria-disabled')).toBe('true');
    expect(preClassBtn.getAttribute('title')).toContain('无法直接退回课前');

    // 结课通票按钮应可点击
    expect(exitTicketBtn.getAttribute('disabled')).toBeNull();

    fetchSpy.mockClear();

    // 点击被禁用的课前就绪按钮，由于原生 disabled，不应触发网络请求
    fireEvent.click(preClassBtn);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignores click on the currently active stage button (no-op)', () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    render(
      <ClassroomInteractiveCockpit
        lessonId="les_1"
        lessonTitle="物理课"
        classId="cls_1"
        lang="zh"
        addToast={addToast}
        currentStage="IN_CLASS_TEACHING"
      />,
    );

    const activeBtn = screen.getByText('课中授课').closest('button')!;
    expect(activeBtn.getAttribute('title')).toBe('当前处于此阶段');

    fetchSpy.mockClear();
    addToast.mockClear();

    fireEvent.click(activeBtn);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('correctly validates stage transitions and reasons via helper functions', () => {
    // 课前就绪 -> 课中授课 (合法)
    expect(isStageTransitionAllowed('PRE_CLASS_READY', 'IN_CLASS_TEACHING')).toBe(true);
    // 课前就绪 -> 结课通票 (非法)
    expect(isStageTransitionAllowed('PRE_CLASS_READY', 'WRAP_UP_EXIT_TICKET')).toBe(false);
    expect(getStageTransitionBlockReason('PRE_CLASS_READY', 'WRAP_UP_EXIT_TICKET', 'zh')).toContain('课堂尚未开始');

    // 课中授课 -> 结课通票 (合法)
    expect(isStageTransitionAllowed('IN_CLASS_TEACHING', 'WRAP_UP_EXIT_TICKET')).toBe(true);
    // 课中授课 -> 课前就绪 (非法)
    expect(isStageTransitionAllowed('IN_CLASS_TEACHING', 'PRE_CLASS_READY')).toBe(false);
    expect(getStageTransitionBlockReason('IN_CLASS_TEACHING', 'PRE_CLASS_READY', 'zh')).toContain('无法直接退回课前');

    // 结课通票 -> 课中授课 / 学情简报 (合法)
    expect(isStageTransitionAllowed('WRAP_UP_EXIT_TICKET', 'IN_CLASS_TEACHING')).toBe(true);
    expect(isStageTransitionAllowed('WRAP_UP_EXIT_TICKET', 'ARCHIVED_REPORT')).toBe(true);

    // 处于同一阶段 (合法 no-op)
    expect(isStageTransitionAllowed('IN_CLASS_TEACHING', 'IN_CLASS_TEACHING')).toBe(true);
    expect(getStageTransitionBlockReason('IN_CLASS_TEACHING', 'IN_CLASS_TEACHING', 'zh')).toBeNull();
  });
});
