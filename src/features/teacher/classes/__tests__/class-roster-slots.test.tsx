import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../../../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../../plugin-host/plugin-host-store';
import { ClassStudentsPanel } from '../ClassStudentsPanel';
import type {
  ClassBatchActionSlotProps,
  ClassListToolbarActionSlotProps,
  StudentEnrollSourceSlotProps,
  StudentRowActionSlotProps,
} from '../../../../plugin-host/types';
import type { ClassType, StudentType } from '../../../../types/app';

function createLazyComponent<P>(Component: React.ComponentType<P>): () => Promise<{ default: React.ComponentType<P> }> {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockClass: ClassType = {
  id: 'cls_201',
  name: '高一(1)班',
  description: '高一重点实验班',
  class_passcode: '8848',
  created_at: 1712000000000,
  student_count: 2,
};

const mockStudents: StudentType[] = [
  {
    id: 'stu_1',
    name: '张三',
    student_number: '2026001',
    email: 'zhangsan@example.com',
    password: 'stu-secret-hash',
    private_notes: '{"html":"<p>私密观察记录</p>","category":"SpecialCare"}',
    created_at: 1712000000000,
  },
  {
    id: 'stu_2',
    name: '李四',
    student_number: '2026002',
    email: 'lisi@example.com',
    created_at: 1712000000000,
  },
];

beforeEach(() => {
  usePluginHostStore.setState({
    extensionPoints: new Map(),
    activePlugins: [],
  });
});

afterEach(() => {
  cleanup();
});

function renderPanel(host: FrontendPluginHost, overrides: Partial<Record<string, unknown>> = {}) {
  return renderWithHost(
    <ClassStudentsPanel
      cls={mockClass}
      classStudentsMap={{ cls_201: mockStudents }}
      students={mockStudents}
      lang="zh"
      selectedStudentIds={new Set(['stu_1'])}
      rosterViewMode="list"
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

function renderWithHost(ui: ReactElement, host = new FrontendPluginHost()) {
  return {
    host,
    ...render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>),
  };
}

describe('班级学生管理域 P0 扩展槽位（Issue IKYMS2）', () => {
  it('student.enroll.source 在花名册工具栏渲染并触发宿主刷新', async () => {
    const captured: { current: StudentEnrollSourceSlotProps | null } = { current: null };
    const EnrollPlugin: React.FC<StudentEnrollSourceSlotProps> = (props) => {
      captured.current = props;
      return (
        <button
          data-testid="qr-enroll-btn"
          onClick={() => {
            void props.onRefresh?.();
          }}
        >
          扫码加入 {props.classInfo?.name}
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('student.enroll.source', {
      id: 'qr-enroll',
      label: '扫码加入',
      pluginId: 'ext-qr-enroll',
      component: createLazyComponent(EnrollPlugin),
    });

    const fetchClassStudentsMock = vi.fn().mockResolvedValue(undefined);
    const fetchStudentsMock = vi.fn().mockResolvedValue(undefined);
    renderPanel(new FrontendPluginHost(), {
      fetchClassStudents: fetchClassStudentsMock,
      fetchStudents: fetchStudentsMock,
    });

    const btn = await screen.findByTestId('qr-enroll-btn');
    expect(btn.textContent).toContain('高一(1)班');
    // classInfo 为白名单投影：不含 class_passcode
    expect(captured.current?.classInfo).not.toHaveProperty('class_passcode');

    fireEvent.click(btn);
    await waitFor(() => {
      expect(fetchClassStudentsMock).toHaveBeenCalledWith('cls_201');
      expect(fetchStudentsMock).toHaveBeenCalled();
    });
  });

  it('student.row.action 在学生行内渲染并收到白名单投影的 student', async () => {
    const captured: { current: StudentRowActionSlotProps | null } = { current: null };
    const NotifyParentPlugin: React.FC<StudentRowActionSlotProps> = (props) => {
      captured.current = props;
      return (
        <button
          data-testid="notify-parent-btn"
          onClick={() => {
            void props.onRefresh?.();
          }}
        >
          通知家长
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('student.row.action', {
      id: 'notify-parent',
      label: '通知家长',
      pluginId: 'ext-parent-notify',
      component: createLazyComponent(NotifyParentPlugin),
    });

    const fetchClassStudentsMock = vi.fn().mockResolvedValue(undefined);
    const fetchStudentsMock = vi.fn().mockResolvedValue(undefined);
    renderPanel(new FrontendPluginHost(), {
      fetchClassStudents: fetchClassStudentsMock,
      fetchStudents: fetchStudentsMock,
    });

    // 每个学生行各渲染一个插件按钮
    const buttons = await screen.findAllByTestId('notify-parent-btn');
    expect(buttons).toHaveLength(2);

    // 白名单投影：student 不携带 password / private_notes
    const projected = captured.current!.student;
    expect(projected).toEqual({
      id: 'stu_2',
      name: '李四',
      student_number: '2026002',
      email: 'lisi@example.com',
      gender: null,
      avatar: null,
      locked_lesson_id: null,
      created_at: 1712000000000,
    });
    expect(projected).not.toHaveProperty('password');
    expect(projected).not.toHaveProperty('private_notes');
    expect(screen.queryByText(/私密观察记录/)).toBeNull();

    fireEvent.click(buttons[0]);
    await waitFor(() => {
      expect(fetchClassStudentsMock).toHaveBeenCalledWith('cls_201');
      expect(fetchStudentsMock).toHaveBeenCalled();
    });
  });

  it('class.list.toolbar.action 槽位注入投影 classes、selectedClassIds 与 onRefresh', async () => {
    const captured: { current: ClassListToolbarActionSlotProps | null } = { current: null };
    const SisToolbarPlugin: React.FC<ClassListToolbarActionSlotProps> = (props) => {
      captured.current = props;
      return (
        <button
          data-testid="sis-sync-toolbar-btn"
          onClick={() => {
            void props.onRefresh?.();
          }}
        >
          学籍同步（{props.classes?.length ?? 0} 班）
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('class.list.toolbar.action', {
      id: 'sis-sync-toolbar',
      label: '学籍同步',
      pluginId: 'ext-sis-sync',
      component: createLazyComponent(SisToolbarPlugin),
    });

    const refreshMock = vi.fn();
    renderWithHost(
      <ExtensionPointRenderer
        slot="class.list.toolbar.action"
        slotProps={{
          classes: [{ id: 'cls_1', name: '高一(1)班', description: '', student_count: 42, created_at: 1712000000000 }],
          selectedClassIds: ['cls_1'],
          lang: 'zh',
          onRefresh: refreshMock,
        }}
      />,
    );

    const btn = await screen.findByTestId('sis-sync-toolbar-btn');
    expect(btn.textContent).toContain('学籍同步（1 班）');
    expect(captured.current?.selectedClassIds).toEqual(['cls_1']);

    fireEvent.click(btn);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('class.batch.action 向插件传递白名单投影（不再透传 password/private_notes/class_passcode）', async () => {
    const captured: { current: ClassBatchActionSlotProps | null } = { current: null };
    const BatchSyncPlugin: React.FC<ClassBatchActionSlotProps> = (props) => {
      captured.current = props;
      return <button data-testid="batch-sync-btn">同步学籍 ({props.selectedStudents?.length ?? 0})</button>;
    };

    usePluginHostStore.getState().registerExtensionPoint('class.batch.action', {
      id: 'batch-sync',
      label: '同步学籍',
      pluginId: 'ext-sis-sync',
      component: createLazyComponent(BatchSyncPlugin),
    });

    renderPanel(new FrontendPluginHost(), { batchMode: true });

    await screen.findByTestId('batch-sync-btn');
    const projected = captured.current!;
    expect(projected.cls).not.toHaveProperty('class_passcode');
    expect(projected.selectedStudents[0]).not.toHaveProperty('password');
    expect(projected.selectedStudents[0]).not.toHaveProperty('private_notes');
    expect(projected.selectedStudents[0].name).toBe('张三');
    expect(projected.allStudents).toHaveLength(2);
  });
});
