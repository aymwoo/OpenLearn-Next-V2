import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../../../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../../plugin-host/plugin-host-store';
import { ClassStudentsPanel } from '../ClassStudentsPanel';
import { ClassRowHeader } from '../ClassRowHeader';
import type {
  ClassCardBadgeSlotProps,
  ClassListBatchActionSlotProps,
  StudentRowBadgeSlotProps,
  StudentRowTabSlotProps,
  StudentRosterFilterSlotProps,
  StudentRosterSummarySlotProps,
  StudentSettingsAddonSlotProps,
} from '../../../../plugin-host/types';
import type { ClassType, StudentType } from '../../../../types/app';

function createLazyComponent<P>(Component: React.ComponentType<P>): () => Promise<{ default: React.ComponentType<P> }> {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockClass: ClassType = {
  id: 'cls_301',
  name: '高二(2)班',
  description: '文科实验班',
  class_passcode: '2468',
  created_at: 1712000000000,
  student_count: 3,
};

const studentWithCareNotes: StudentType = {
  id: 'stu_care',
  name: '王关注',
  student_number: '2027001',
  email: 'care@example.com',
  private_notes: '{"html":"<p>需要特别关注</p>","category":"SpecialCare"}',
  created_at: 1712000000000,
};

const studentWithGeneralNotes: StudentType = {
  id: 'stu_general',
  name: '李日常',
  student_number: '2027002',
  email: 'general@example.com',
  private_notes: '<p>纯文本备忘按 General 口径解析</p>',
  created_at: 1712000000000,
};

const studentWithoutNotes: StudentType = {
  id: 'stu_none',
  name: '赵无记',
  student_number: '2027003',
  email: 'none@example.com',
  created_at: 1712000000000,
};

const mockStudents = [studentWithCareNotes, studentWithGeneralNotes, studentWithoutNotes];

beforeEach(() => {
  usePluginHostStore.setState({
    extensionPoints: new Map(),
    activePlugins: [],
  });
});

afterEach(() => {
  cleanup();
});

function renderWithHost(ui: ReactElement, host = new FrontendPluginHost()) {
  return {
    host,
    ...render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>),
  };
}

function renderPanel(host: FrontendPluginHost, overrides: Partial<Record<string, unknown>> = {}) {
  return renderWithHost(
    <ClassStudentsPanel
      cls={mockClass}
      classStudentsMap={{ cls_301: mockStudents }}
      students={mockStudents}
      lang="zh"
      selectedStudentIds={new Set()}
      rosterViewMode="grid"
      setRosterViewMode={vi.fn()}
      rosterSearchQuery=""
      setRosterSearchQuery={vi.fn()}
      rosterTagFilter="all"
      setRosterTagFilter={vi.fn()}
      batchMode={false}
      toggleSelectAllStudents={vi.fn()}
      handleBatchDeleteStudents={vi.fn()}
      handleBatchResetPassword={vi.fn()}
      handleBatchTransferStudents={vi.fn()}
      handleBatchSetLockedLesson={vi.fn()}
      expandedStudentId={null}
      setExpandedStudentId={vi.fn()}
      fetchStudentProgress={vi.fn().mockResolvedValue(undefined)}
      studentProgressMap={{}}
      studentActiveTabs={{}}
      setStudentActiveTabs={vi.fn()}
      toggleStudentSelection={vi.fn()}
      get30DayAverageWarning={vi.fn().mockReturnValue(null)}
      lessons={[]}
      setStudents={vi.fn()}
      setClassStudentsMap={vi.fn()}
      fetchClassStudents={vi.fn().mockResolvedValue(undefined)}
      fetchStudents={vi.fn().mockResolvedValue(undefined)}
      parseCSV={vi.fn()}
      {...overrides}
    />,
    host,
  );
}

describe('花名册备忘分类过滤修复（Issue IKYOXD）', () => {
  it("非 'all' 过滤键按备忘分类收敛列表，无备忘学生仅出现在 'all'", () => {
    const { rerender } = renderPanel(new FrontendPluginHost());

    // 'all'：三人齐全
    expect(screen.getByText('王关注')).toBeTruthy();
    expect(screen.getByText('李日常')).toBeTruthy();
    expect(screen.getByText('赵无记')).toBeTruthy();

    rerender(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <ClassStudentsPanel
          cls={mockClass}
          classStudentsMap={{ cls_301: mockStudents }}
          students={mockStudents}
          lang="zh"
          selectedStudentIds={new Set()}
          rosterViewMode="grid"
          setRosterViewMode={vi.fn()}
          rosterSearchQuery=""
          setRosterSearchQuery={vi.fn()}
          rosterTagFilter="SpecialCare"
          setRosterTagFilter={vi.fn()}
          batchMode={false}
          toggleSelectAllStudents={vi.fn()}
          handleBatchDeleteStudents={vi.fn()}
          handleBatchResetPassword={vi.fn()}
          handleBatchTransferStudents={vi.fn()}
          handleBatchSetLockedLesson={vi.fn()}
          expandedStudentId={null}
          setExpandedStudentId={vi.fn()}
          fetchStudentProgress={vi.fn().mockResolvedValue(undefined)}
          studentProgressMap={{}}
          studentActiveTabs={{}}
          setStudentActiveTabs={vi.fn()}
          toggleStudentSelection={vi.fn()}
          get30DayAverageWarning={vi.fn().mockReturnValue(null)}
          lessons={[]}
          setStudents={vi.fn()}
          setClassStudentsMap={vi.fn()}
          fetchClassStudents={vi.fn().mockResolvedValue(undefined)}
          fetchStudents={vi.fn().mockResolvedValue(undefined)}
          parseCSV={vi.fn()}
        />
      </PluginHostProvider>,
    );

    // SpecialCare：仅 JSON {category: SpecialCare} 学生
    expect(screen.getByText('王关注')).toBeTruthy();
    expect(screen.queryByText('李日常')).toBeNull();
    expect(screen.queryByText('赵无记')).toBeNull();
  });
});

describe('班级学生管理域 P1/P2 扩展槽位（Issue IKYOXD）', () => {
  it('student.row.badge 在学生行徽章区渲染并收到白名单投影', async () => {
    const captured: { current: StudentRowBadgeSlotProps | null } = { current: null };
    const BadgePlugin: React.FC<StudentRowBadgeSlotProps> = (props) => {
      captured.current = props;
      return <span data-testid="honor-badge">素养徽章:{props.student?.name}</span>;
    };

    usePluginHostStore.getState().registerExtensionPoint('student.row.badge', {
      id: 'honor-badge',
      label: '素养徽章',
      pluginId: 'ext-honor',
      component: createLazyComponent(BadgePlugin),
    });

    renderPanel(new FrontendPluginHost());

    const badges = await screen.findAllByTestId('honor-badge');
    expect(badges).toHaveLength(3);
    expect(captured.current?.student).not.toHaveProperty('private_notes');
    expect(captured.current?.student).not.toHaveProperty('password');
    expect(screen.queryByText(/需要特别关注/)).toBeNull();
  });

  it('class.list.batch.action 注入选中班级投影、disabled 与 onRefresh', async () => {
    const captured: { current: ClassListBatchActionSlotProps | null } = { current: null };
    const BatchArchivePlugin: React.FC<ClassListBatchActionSlotProps> = (props) => {
      captured.current = props;
      return (
        <button
          data-testid="batch-archive-btn"
          disabled={props.disabled}
          onClick={() => {
            void props.onRefresh?.();
          }}
        >
          批量归档（{props.selectedClasses?.length ?? 0}）
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('class.list.batch.action', {
      id: 'batch-archive',
      label: '批量归档',
      pluginId: 'ext-archive',
      component: createLazyComponent(BatchArchivePlugin),
    });

    const refreshMock = vi.fn();
    renderWithHost(
      <ExtensionPointRenderer
        slot="class.list.batch.action"
        slotProps={{
          selectedClassIds: ['cls_1'],
          selectedClasses: [{ id: 'cls_1', name: '高一(1)班', description: '', created_at: 0 }],
          disabled: false,
          lang: 'zh',
          onRefresh: refreshMock,
        }}
      />,
    );

    const btn = await screen.findByTestId('batch-archive-btn');
    expect(btn.textContent).toContain('批量归档（1）');
    expect(captured.current?.selectedClasses[0]).not.toHaveProperty('class_passcode');

    fireEvent.click(btn);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('class.card.badge 在班级行头渲染且 cls 为白名单投影', async () => {
    const captured: { current: ClassCardBadgeSlotProps | null } = { current: null };
    const BoardBadgePlugin: React.FC<ClassCardBadgeSlotProps> = (props) => {
      captured.current = props;
      return <span data-testid="board-badge">班牌:{props.cls?.name}</span>;
    };

    usePluginHostStore.getState().registerExtensionPoint('class.card.badge', {
      id: 'board-badge',
      label: '班牌绑定',
      pluginId: 'ext-board',
      component: createLazyComponent(BoardBadgePlugin),
    });

    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <ClassRowHeader
          cls={mockClass}
          lang="zh"
          isExpanded={false}
          batchMode={false}
          selectedClassIds={new Set()}
          setExpandedClassId={vi.fn()}
          setSelectedStudentIds={vi.fn()}
          toggleClassSelection={vi.fn()}
          fetchClassStudents={vi.fn().mockResolvedValue(undefined)}
          fetchClassProgress={vi.fn().mockResolvedValue(undefined)}
          fetchClassDashboard={vi.fn().mockResolvedValue(undefined)}
          fetchClassSchedules={vi.fn().mockResolvedValue(undefined)}
        />
      </PluginHostProvider>,
    );

    const badge = await screen.findByTestId('board-badge');
    expect(badge.textContent).toContain('高二(2)班');
    expect(captured.current?.cls).not.toHaveProperty('class_passcode');
    expect(JSON.stringify(captured.current?.cls)).not.toContain('2468');
  });

  it('student.settings.addon 在「教学控制」Tab 渲染并触发宿主刷新', async () => {
    const captured: { current: StudentSettingsAddonSlotProps | null } = { current: null };
    const GroupAddonPlugin: React.FC<StudentSettingsAddonSlotProps> = (props) => {
      captured.current = props;
      return (
        <button
          data-testid="group-addon-btn"
          onClick={() => {
            void props.onRefresh?.();
          }}
        >
          分组设置
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('student.settings.addon', {
      id: 'group-addon',
      label: '分组设置',
      pluginId: 'ext-grouping',
      component: createLazyComponent(GroupAddonPlugin),
    });

    const fetchClassStudentsMock = vi.fn().mockResolvedValue(undefined);
    const fetchStudentsMock = vi.fn().mockResolvedValue(undefined);
    renderPanel(new FrontendPluginHost(), {
      expandedStudentId: 'stu_care',
      studentActiveTabs: { stu_care: 'settings' },
      fetchClassStudents: fetchClassStudentsMock,
      fetchStudents: fetchStudentsMock,
    });

    const btn = await screen.findByTestId('group-addon-btn');
    expect(captured.current?.student.id).toBe('stu_care');
    expect(captured.current?.student).not.toHaveProperty('private_notes');

    fireEvent.click(btn);
    await waitFor(() => {
      expect(fetchClassStudentsMock).toHaveBeenCalledWith('cls_301');
      expect(fetchStudentsMock).toHaveBeenCalled();
    });
  });

  it('student.row.tab button 形态渲染插件页签并在点击时切换到 plugin: 前缀值', async () => {
    const CounselingTabPlugin: React.FC<StudentRowTabSlotProps> = () => (
      <span data-testid="counseling-tab-label">心理</span>
    );

    usePluginHostStore.getState().registerExtensionPoint('student.row.tab', {
      id: 'counseling-tab',
      label: '心理档案',
      pluginId: 'ext-counseling',
      component: createLazyComponent(CounselingTabPlugin),
    });

    const setStudentActiveTabs = vi.fn((updater: (prev: Record<string, string>) => Record<string, string>) =>
      updater({}),
    );
    renderPanel(new FrontendPluginHost(), {
      expandedStudentId: 'stu_care',
      setStudentActiveTabs,
    });

    const btn = await screen.findByRole('button', { name: '心理档案' });
    fireEvent.click(btn);
    expect(setStudentActiveTabs).toHaveBeenCalled();
    const updaterArg = setStudentActiveTabs.mock.calls[0][0] as (
      prev: Record<string, string>,
    ) => Record<string, string>;
    expect(updaterArg({})).toEqual({ stu_care: 'plugin:ext-counseling/counseling-tab' });
  });

  it('student.row.tab panel 形态仅在该插件页签激活时渲染', async () => {
    const CounselingPanelPlugin: React.FC<StudentRowTabSlotProps> = (props) => (
      <div data-testid="counseling-panel">心理档案面板:{props.student?.name}</div>
    );

    usePluginHostStore.getState().registerExtensionPoint('student.row.tab', {
      id: 'counseling-tab',
      label: '心理档案',
      pluginId: 'ext-counseling',
      component: createLazyComponent(CounselingPanelPlugin),
    });

    // 激活内建 tab：面板不渲染
    renderPanel(new FrontendPluginHost(), {
      expandedStudentId: 'stu_care',
      studentActiveTabs: { stu_care: 'progress' },
    });
    expect(screen.queryByTestId('counseling-panel')).toBeNull();
    cleanup();

    // 激活插件 tab：面板渲染，student 为白名单投影
    renderPanel(new FrontendPluginHost(), {
      expandedStudentId: 'stu_care',
      studentActiveTabs: { stu_care: 'plugin:ext-counseling/counseling-tab' },
    });
    const panel = await screen.findByTestId('counseling-panel');
    expect(panel.textContent).toContain('王关注');
    // 插件 Tab 激活时不叠加内建进度列表空态
    expect(screen.queryByText('未分配任何课程。')).toBeNull();
  });

  it('student.roster.filter 在过滤条右侧渲染并收到当前过滤键与切换回调', async () => {
    const captured: { current: StudentRosterFilterSlotProps | null } = { current: null };
    const GroupFilterPlugin: React.FC<StudentRosterFilterSlotProps> = (props) => {
      captured.current = props;
      return (
        <button data-testid="group-filter-btn" onClick={() => props.setRosterTagFilter?.('ext:group-a')}>
          自定义筛选:{props.rosterTagFilter}
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('student.roster.filter', {
      id: 'group-filter',
      label: '自定义筛选',
      pluginId: 'ext-filter',
      component: createLazyComponent(GroupFilterPlugin),
    });

    const setRosterTagFilter = vi.fn();
    renderPanel(new FrontendPluginHost(), { setRosterTagFilter });

    const btn = await screen.findByTestId('group-filter-btn');
    expect(btn.textContent).toContain('自定义筛选:all');
    expect(captured.current?.students).toHaveLength(3);
    expect(captured.current?.students[0]).not.toHaveProperty('private_notes');

    fireEvent.click(btn);
    expect(setRosterTagFilter).toHaveBeenCalledWith('ext:group-a');
  });

  it('student.roster.summary 在花名册底部渲染并收到投影列表', async () => {
    const SummaryPlugin: React.FC<StudentRosterSummarySlotProps> = (props) => (
      <div data-testid="roster-summary">
        合计 {props.students?.length ?? 0} 人 / {props.cls?.name}
      </div>
    );

    usePluginHostStore.getState().registerExtensionPoint('student.roster.summary', {
      id: 'roster-summary',
      label: '花名册统计',
      pluginId: 'ext-summary',
      component: createLazyComponent(SummaryPlugin),
    });

    renderPanel(new FrontendPluginHost());

    const summary = await screen.findByTestId('roster-summary');
    expect(summary.textContent).toContain('合计 3 人');
    expect(summary.textContent).toContain('高二(2)班');
  });

  it('class.create.source 注入 lang 与 onRefresh', async () => {
    const ImportSourcePlugin: React.FC<{ lang?: string; onRefresh?: () => void }> = (props) => (
      <button data-testid="sis-import-btn" onClick={() => props.onRefresh?.()}>
        {props.lang === 'zh' ? '教务系统导入' : 'Import from SIS'}
      </button>
    );

    usePluginHostStore.getState().registerExtensionPoint('class.create.source', {
      id: 'sis-import',
      label: '教务系统导入',
      pluginId: 'ext-sis',
      component: createLazyComponent(ImportSourcePlugin),
    });

    const refreshMock = vi.fn();
    renderWithHost(
      <ExtensionPointRenderer slot="class.create.source" slotProps={{ lang: 'zh', onRefresh: refreshMock }} />,
    );

    const btn = await screen.findByTestId('sis-import-btn');
    expect(btn.textContent).toContain('教务系统导入');

    fireEvent.click(btn);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
