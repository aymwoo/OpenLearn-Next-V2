import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../../../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../../plugin-host/plugin-host-store';
import { ClassStudentsPanel } from '../ClassStudentsPanel';
import type { ClassType, StudentType } from '../../../../types/app';
import type { IHostActionDispatcher } from '../../../../plugin-host/types';

function renderWithHost(ui: ReactElement, host = new FrontendPluginHost()) {
  return {
    host,
    ...render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>),
  };
}

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockClass: ClassType = {
  id: 'cls_201',
  name: '高一(1)班',
  description: '高一重点实验班',
  created_at: 1712000000000,
  student_count: 2,
};

const mockStudents: StudentType[] = [
  {
    id: 'stu_1',
    name: '张三',
    student_number: '2026001',
    email: 'zhangsan@example.com',
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

describe('class.batch.action extension slot', () => {
  it('passes enriched context (selectedStudents, cls, allStudents, disabled) to extension component', async () => {
    let capturedProps: any = null;

    const BatchSyncPlugin = (props: any) => {
      capturedProps = props;
      return (
        <button
          data-testid="batch-sync-btn"
          disabled={props.disabled}
          onClick={() => {
            props.onRefresh?.();
          }}
        >
          一键同步学籍 ({props.selectedStudents?.length ?? 0})
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('class.batch.action', {
      id: 'batch-sync',
      label: '一键同步学籍',
      pluginId: 'ext-sis-sync',
      component: createLazyComponent(BatchSyncPlugin),
    });

    const refreshMock = vi.fn();

    renderWithHost(
      <ExtensionPointRenderer
        slot="class.batch.action"
        slotProps={{
          classId: mockClass.id,
          cls: mockClass,
          lang: 'zh',
          selectedStudentIds: ['stu_1'],
          selectedStudents: [mockStudents[0]],
          allStudents: mockStudents,
          disabled: false,
          onRefresh: refreshMock,
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('batch-sync-btn')).toBeTruthy();
    });

    expect(capturedProps.classId).toBe('cls_201');
    expect(capturedProps.cls.name).toBe('高一(1)班');
    expect(capturedProps.selectedStudents).toHaveLength(1);
    expect(capturedProps.selectedStudents[0].name).toBe('张三');
    expect(capturedProps.disabled).toBe(false);
    expect(capturedProps.dispatcher).toBeDefined();

    // 触发刷新
    fireEvent.click(screen.getByTestId('batch-sync-btn'));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('integrates with ClassStudentsPanel: displays batch action in batch mode and triggers host:refresh', async () => {
    const fetchClassStudentsMock = vi.fn().mockResolvedValue(undefined);
    const fetchStudentsMock = vi.fn().mockResolvedValue(undefined);

    const BatchAwardPlugin = ({
      selectedStudents,
      disabled,
      dispatcher,
    }: {
      selectedStudents: StudentType[];
      disabled: boolean;
      dispatcher: IHostActionDispatcher;
    }) => {
      return (
        <button
          data-testid="batch-award-btn"
          disabled={disabled}
          onClick={async () => {
            // 通过受控分发器发起全局学生刷新
            await dispatcher.dispatch({
              type: 'host:refresh',
              payload: { target: 'students' },
            });
          }}
        >
          颁发微勋章 ({selectedStudents?.length ?? 0})
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('class.batch.action', {
      id: 'batch-award',
      label: '颁发微勋章',
      pluginId: 'ext-badging',
      component: createLazyComponent(BatchAwardPlugin),
    });

    const host = new FrontendPluginHost();

    renderWithHost(
      <ClassStudentsPanel
        cls={mockClass}
        classStudentsMap={{ 'cls_201': mockStudents }}
        students={mockStudents}
        lang="zh"
        selectedStudentIds={new Set(['stu_1', 'stu_2'])}
        rosterViewMode="list"
        setRosterViewMode={vi.fn()}
        rosterSearchQuery=""
        setRosterSearchQuery={vi.fn()}
        rosterTagFilter="all"
        setRosterTagFilter={vi.fn()}
        batchMode={true}
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
        fetchClassStudents={fetchClassStudentsMock}
        fetchStudents={fetchStudentsMock}
        parseCSV={vi.fn()}
      />,
      host,
    );

    // 验证批量工具栏中展示了插件按钮
    await waitFor(() => {
      expect(screen.getByTestId('batch-award-btn')).toBeTruthy();
    });

    expect(screen.getByText('颁发微勋章 (2)')).toBeTruthy();

    // 点击按钮，派发 host:refresh
    fireEvent.click(screen.getByTestId('batch-award-btn'));

    // 验证 ClassStudentsPanel 中注册的 host:refresh 处理器被触发
    await waitFor(() => {
      expect(fetchClassStudentsMock).toHaveBeenCalledWith('cls_201');
      expect(fetchStudentsMock).toHaveBeenCalled();
    });
  });
});
