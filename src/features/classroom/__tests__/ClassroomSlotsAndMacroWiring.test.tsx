import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { ExtensionSlot } from '../../../plugin-host/types';
import { ClassroomToolbarQuickActions } from '../ClassroomToolbarQuickActions';
import { ShowcaseDiffModal } from '../showcase-diff/ShowcaseDiffModal';
import { ClassroomMacroRunnerModal, HardwareBridgeSettingsModal, classroomMacroEngine } from '../ecosystem';
import { LiveSubmissionsPanel } from '../LiveSubmissionsPanel';
import { TopPerformersWidget } from '../../teacher/TopPerformersWidget';
import { ClassroomSessionManager } from '../ClassroomSessionManager';
import { StudentInteractiveOverlay } from '../../student/StudentInteractiveOverlay';
import { ClassroomSyncChannel, CLASSROOM_SYNC_CHANNEL_NAME } from '../../../services/classroom-sync-channel';

vi.mock('../../../plugin-host/extension-point-renderer', () => ({
  ExtensionPointRenderer: ({ slot }: { slot: string }) => <div data-testid={`ext-slot-${slot}`}>{slot}</div>,
}));

vi.mock('../../student/StudentCountdownBanner', () => ({
  StudentCountdownBanner: () => null,
}));

vi.mock('../ecosystem/edge-lan-mesh/EdgeLanStatusIndicator', () => ({
  EdgeLanStatusIndicator: () => <div data-testid="mock-edge-lan" />,
}));

vi.mock('../ClassroomCountdownWidget', () => ({
  ClassroomCountdownWidget: () => <div data-testid="mock-countdown" />,
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, sessions: [], total: 0, students: [], summary: {} }),
    })),
  );
});

afterEach(() => {
  cleanup();
  classroomMacroEngine.reset();
  vi.unstubAllGlobals();
});

describe('Classroom Plugin Slots & Real Wiring Integration', () => {
  it('ExtensionSlot 类型包含新增的 8 个课堂扩展槽位（且保留原有槽位兼容）', () => {
    const newSlots: ExtensionSlot[] = [
      'classroom.toolbar.quick_action',
      'classroom.monitor.header_action',
      'classroom.submissions.toolbar',
      'classroom.top_performers.action',
      'classroom.showcase_diff.action',
      'classroom.macro_runner.action',
      'classroom.hardware_bridge.addon',
      'classroom.sessions.action',
      // 验证现有槽位未被删除或改名
      'classroom.alert.banner',
      'classroom.quick_activity',
      'classroom.cockpit.drawer.item',
      'classroom.topbar.action',
      'classroom.topbar.pill',
      'classroom.header.action',
      'classroom.collab.canvas',
      'classroom.active_segment.main',
    ];
    expect(newSlots).toHaveLength(16);
  });

  it('ClassroomToolbarQuickActions 暴露 classroom.toolbar.quick_action 槽位', () => {
    render(
      <ClassroomToolbarQuickActions
        lang="zh"
        onOpenDiagnosticCenter={vi.fn()}
        onOpenMasteryPrediction={vi.fn()}
        onOpenGroupCollab={vi.fn()}
        onOpenShowcaseDiff={vi.fn()}
        onOpenPeerReviewShowcase={vi.fn()}
        onOpenParentNotification={vi.fn()}
        onOpenMacroRunner={vi.fn()}
        onOpenHardwareSettings={vi.fn()}
        selectedLesson="les-1"
        syncChannel={null}
        onlineStudentCount={0}
        onTimeRemainingChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('ext-slot-classroom.toolbar.quick_action')).toBeTruthy();
  });

  it('ShowcaseDiffModal / MacroRunner / HardwareBridge / Submissions / TopPerformers / Sessions 均渲染新增插件扩展槽位', () => {
    const noop = vi.fn();
    render(
      <>
        <ShowcaseDiffModal isOpen={true} onClose={noop} availableStudents={[]} candidateWorks={[]} addToast={noop} />
        <ClassroomMacroRunnerModal isOpen={true} onClose={noop} addToast={noop} lessonTitle="测试课节" />
        <HardwareBridgeSettingsModal isOpen={true} onClose={noop} addToast={noop} />
        <LiveSubmissionsPanel
          lang="zh"
          selectedLesson="les-1"
          liveClassSelectedClassId="cls-1"
          attempts={[]}
          displayAttempts={[]}
          loadingAttempts={false}
          searchQuery=""
          setSearchQuery={noop}
          submissionFilter="all"
          setSubmissionFilter={noop}
          fetchAttempts={noop}
          setMiddleTab={noop}
          autoRecordRule={{ enabled: false, minCompletion: 0.8, strategy: 'latest' }}
          autoRecordRuleLoaded={true}
          savingAutoRecordRule={false}
          saveAutoRecordRule={vi.fn(async () => {})}
          autoRecordReport={null}
          runAutoRecord={vi.fn(async () => {})}
          autoRecordRunning={false}
          handleViewRaw={noop}
          handlePromoteAttempt={noop}
          handleMarkAbsent={noop}
        />
        <TopPerformersWidget lang="zh" lessonId="les-1" classId="cls-1" />
        <ClassroomSessionManager lessons={[]} classes={[]} onBackToPortal={noop} onResumeSession={noop} />
      </>,
    );

    expect(screen.getByTestId('ext-slot-classroom.showcase_diff.action')).toBeTruthy();
    expect(screen.getByTestId('ext-slot-classroom.macro_runner.action')).toBeTruthy();
    expect(screen.getByTestId('ext-slot-classroom.hardware_bridge.addon')).toBeTruthy();
    expect(screen.getByTestId('ext-slot-classroom.submissions.toolbar')).toBeTruthy();
    expect(screen.getByTestId('ext-slot-classroom.top_performers.action')).toBeTruthy();
    expect(screen.getByTestId('ext-slot-classroom.sessions.action')).toBeTruthy();
  });

  it('ClassroomMacroRunnerModal 会驱动已注册的 stepExecutor 顺序执行真实教学动作', async () => {
    const executedActions: string[] = [];
    classroomMacroEngine.setStepExecutor(async (step) => {
      executedActions.push(step.actionType);
      return true;
    });

    const addToast = vi.fn();
    render(<ClassroomMacroRunnerModal isOpen={true} onClose={vi.fn()} addToast={addToast} lessonTitle="探究实验课" />);

    fireEvent.click(screen.getByRole('button', { name: /立即一键执行宏动作/i }));

    await waitFor(() => {
      expect(executedActions).toEqual([
        'BROADCAST_NOTIFICATION',
        'LOCK_STUDENT_SCREENS',
        'START_COUNTDOWN',
        'NAVIGATE_VIEW',
        'AUTO_COLLECT_QUIZ',
      ]);
    });
  });

  it('StudentInteractiveOverlay 能够接收教师广播的宏指令通知与多屏对比投屏', async () => {
    render(<StudentInteractiveOverlay lessonId="les-sync-1" studentId="stu-1" studentName="张同学" lang="zh" />);

    const teacherChannel = new ClassroomSyncChannel(CLASSROOM_SYNC_CHANNEL_NAME, 'les-sync-1', 'cls-1');
    teacherChannel.broadcastMacroNotification('请全班专注看黑板！', '焦点切换');
    teacherChannel.broadcastShowcaseDiff({
      selectedIds: ['stu-1', 'stu-2'],
      layout: 'dual',
      anonymous: true,
      works: [
        {
          studentId: 'stu-1',
          studentName: '张同学',
          title: '解法一',
          content: 'const x = 42;',
          accuracyScore: 100,
        },
        {
          studentId: 'stu-2',
          studentName: '李同学',
          title: '解法二',
          content: 'const x = 0;',
          accuracyScore: 70,
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('student-macro-notification-banner')).toBeTruthy();
      expect(screen.getByText('请全班专注看黑板！')).toBeTruthy();
      expect(screen.getByTestId('student-synced-diff-modal')).toBeTruthy();
      expect(screen.getByText('作答方案 A')).toBeTruthy();
      expect(screen.getByText('作答方案 B')).toBeTruthy();
    });

    teacherChannel.destroy();
  });
});
