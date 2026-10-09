import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { StudentGrowthProfileModal, type StudentProfileData } from '../StudentGrowthProfileModal';
import type { IHostActionDispatcher } from '../../../plugin-host/types';

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

const mockStudent: StudentProfileData = {
  id: 'stu_1001',
  name: '李小华',
  student_number: '2026001',
  role: '组长',
  group_name: '第一探索组',
  className: '高一(1)班',
  points: 42,
  deltaPoints: 5,
  focusPercentage: 92,
  accuracyPercentage: 88,
  helpCount: 4,
  competencyScores: {
    logic: 85,
    engineering: 90,
    creativity: 78,
    collaboration: 88,
    focus: 92,
  },
  timeline: [
    {
      id: 'evt_1',
      time: '10:15',
      type: 'poll',
      title: '随堂测验提交',
      description: '满分完成循环结构基础测验',
      points: 5,
    },
  ],
};

beforeEach(() => {
  usePluginHostStore.setState({
    extensionPoints: new Map(),
    activePlugins: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('student.profile.tab extension slot', () => {
  it('renders extension tab button with renderType=button and handles tab switch', () => {
    const setTabMock = vi.fn();

    usePluginHostStore.getState().registerExtensionPoint('student.profile.tab', {
      id: 'ai-diagnosis',
      label: 'AI 深度学情诊断',
      icon: 'Brain',
      pluginId: 'ext-ai-diagnostics',
      component: createLazyComponent(() => <div>诊断面板</div>),
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="student.profile.tab"
        slotProps={{
          renderType: 'button',
          studentActiveTab: 'overview',
          setStudentActiveTab: setTabMock,
          student: mockStudent,
        }}
      />,
    );

    const btn = screen.getByText('AI 深度学情诊断');
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    expect(setTabMock).toHaveBeenCalledWith('plugin:ext-ai-diagnostics/ai-diagnosis');
  });

  it('renders extension panel with renderType=panel when activeTab matches', async () => {
    const receivedProps: any = {};

    const PluginPanel = (props: any) => {
      Object.assign(receivedProps, props);
      return <div data-testid="diagnosis-panel">诊断详情：{props.student?.name}</div>;
    };

    usePluginHostStore.getState().registerExtensionPoint('student.profile.tab', {
      id: 'ai-diagnosis',
      label: 'AI 深度学情诊断',
      pluginId: 'ext-ai-diagnostics',
      component: createLazyComponent(PluginPanel),
    });

    renderWithHost(
      <ExtensionPointRenderer
        slot="student.profile.tab"
        slotProps={{
          renderType: 'panel',
          studentActiveTab: 'plugin:ext-ai-diagnostics/ai-diagnosis',
          student: mockStudent,
          lessonId: 'les_phy_01',
          classId: 'cls_101',
          lang: 'zh',
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('diagnosis-panel')).toBeTruthy();
    });

    expect(receivedProps.student?.id).toBe('stu_1001');
    expect(receivedProps.lessonId).toBe('les_phy_01');
    expect(receivedProps.classId).toBe('cls_101');
    expect(receivedProps.dispatcher).toBeDefined();
    expect(typeof receivedProps.dispatcher.dispatch).toBe('function');
  });

  it('integrates seamlessly with StudentGrowthProfileModal: default overview and tab switching', async () => {
    const mockDispatchResult = vi.fn();

    const DiagnosticsTabComponent = ({ student, dispatcher }: { student: StudentProfileData; dispatcher: IHostActionDispatcher }) => {
      return (
        <div data-testid="ai-profile-panel">
          <h3>诊断面板：{student.name}</h3>
          <button
            data-testid="send-action-btn"
            onClick={async () => {
              const res = await dispatcher.dispatch({
                type: 'host:toast',
                payload: {
                  title: '诊断完成',
                  message: `${student.name} 的认知诊断已生成`,
                  type: 'success',
                },
              });
              mockDispatchResult(res);
            }}
          >
            生成诊断报告
          </button>
        </div>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('student.profile.tab', {
      id: 'deep-diagnosis',
      label: '深度素养追踪',
      pluginId: 'ext-competency',
      component: createLazyComponent(DiagnosticsTabComponent),
    });

    const host = new FrontendPluginHost();
    // 监听 host:toast 动作
    const toastListener = vi.fn();
    host.getDispatcher().subscribe('host:toast', (envelope) => {
      toastListener(envelope.action.payload);
    });

    renderWithHost(
      <StudentGrowthProfileModal
        isOpen={true}
        onClose={vi.fn()}
        student={mockStudent}
        lessonId="les_01"
        classId="cls_101"
      />,
      host,
    );

    // 默认展示全景概览
    expect(screen.getByText('全景概览')).toBeTruthy();
    expect(screen.getByText('深度素养追踪')).toBeTruthy();
    expect(screen.getByText('多维素养与计算思维雷达')).toBeTruthy();

    // 点击切换至扩展 Tab
    const extTabBtn = screen.getByText('深度素养追踪');
    fireEvent.click(extTabBtn);

    // 验证全景概览隐藏，插件面板挂载
    await waitFor(() => {
      expect(screen.getByTestId('ai-profile-panel')).toBeTruthy();
    });
    expect(screen.queryByText('多维素养与计算思维雷达')).toBeNull();

    // 点击插件内动作按钮并验证受控分发器通信
    const actionBtn = screen.getByTestId('send-action-btn');
    fireEvent.click(actionBtn);

    await waitFor(() => {
      expect(toastListener).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '诊断完成',
          message: '李小华 的认知诊断已生成',
          type: 'success',
        }),
      );
    });

    // 切回全景概览
    const overviewBtn = screen.getByText('全景概览');
    fireEvent.click(overviewBtn);

    await waitFor(() => {
      expect(screen.getByText('多维素养与计算思维雷达')).toBeTruthy();
    });
    expect(screen.queryByTestId('ai-profile-panel')).toBeNull();
  });
});
