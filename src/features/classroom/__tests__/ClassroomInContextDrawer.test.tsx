import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ClassroomInContextDrawer } from '../ClassroomInContextDrawer';
import { AppDataProvider } from '../../../context/AppDataContext';
import { appStore } from '../../../store/appStore';
import { uiStore } from '../../../store/uiStore';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';

describe('ClassroomInContextDrawer (课中侧滑抽屉工作台)', () => {
  beforeEach(() => {
    appStore.setState({
      lang: 'zh',
      teacherTab: 'live_class',
    });
    uiStore.setState({
      classroomDrawerTab: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does NOT render when classroomDrawerTab is null', () => {
    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <AppDataProvider value={{} as any}>
          <ClassroomInContextDrawer />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    expect(screen.queryByTestId('classroom-in-context-drawer')).toBeNull();
  });

  it('renders drawer when classroomDrawerTab is "plugins"', async () => {
    uiStore.setState({ classroomDrawerTab: 'plugins' });

    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <AppDataProvider value={{ plugins: [] } as any}>
          <ClassroomInContextDrawer />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    expect(screen.getByTestId('classroom-in-context-drawer')).toBeTruthy();
    expect(screen.getByText('插件设置')).toBeTruthy();
    expect(screen.getByText('班级与学生')).toBeTruthy();
  });

  it('switches tabs inside drawer on button click', async () => {
    uiStore.setState({ classroomDrawerTab: 'plugins' });

    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <AppDataProvider value={{ plugins: [], classes: [], students: [] } as any}>
          <ClassroomInContextDrawer />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    const classesTabBtn = screen.getByText('班级与学生');
    fireEvent.click(classesTabBtn);

    expect(uiStore.getState().classroomDrawerTab).toBe('classes');
  });

  it('closes drawer on close button click', () => {
    uiStore.setState({ classroomDrawerTab: 'plugins' });

    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <AppDataProvider value={{ plugins: [] } as any}>
          <ClassroomInContextDrawer />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    const closeBtn = screen.getByTitle('关闭抽屉并继续上课');
    fireEvent.click(closeBtn);

    expect(uiStore.getState().classroomDrawerTab).toBeNull();
  });

  it('triggers full screen and closes drawer on fullscreen button click', () => {
    const setTeacherTabSpy = vi.fn();
    appStore.setState({ setTeacherTab: setTeacherTabSpy });
    uiStore.setState({ classroomDrawerTab: 'plugins' });

    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <AppDataProvider value={{ plugins: [] } as any}>
          <ClassroomInContextDrawer />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    const fullscreenBtn = screen.getByTitle('全屏打开此模块（白板将在后台保活）');
    fireEvent.click(fullscreenBtn);

    expect(uiStore.getState().classroomDrawerTab).toBeNull();
    expect(setTeacherTabSpy).toHaveBeenCalledWith('plugins');
  });
});
