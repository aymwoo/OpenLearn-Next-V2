import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';

function renderWithHost(ui: ReactElement) {
  const host = new FrontendPluginHost();
  return render(<PluginHostProvider host={host}>{ui}</PluginHostProvider>);
}

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

beforeEach(() => {
  usePluginHostStore.setState({
    extensionPoints: new Map(),
    activePlugins: [],
  });
});

afterEach(() => {
  cleanup();
});

describe('ExtensionPointRenderer — timetable.tab & admin.tab extension points', () => {
  describe('timetable.tab', () => {
    it('renders timetable tab button and triggers tab switch on click', () => {
      const setTabMock = vi.fn();

      usePluginHostStore.getState().registerExtensionPoint('timetable.tab', {
        id: 'smart-scheduling',
        label: '智能排课助理',
        icon: 'Calendar',
        pluginId: 'ext-scheduler',
        component: createLazyComponent(() => <div data-testid="scheduler-panel">排课面板</div>),
      });

      renderWithHost(
        <ExtensionPointRenderer
          slot="timetable.tab"
          slotProps={{
            renderType: 'button',
            timetableActiveTab: 'view',
            setTimetableActiveTab: setTabMock,
          }}
        />,
      );

      const tabBtn = screen.getByText('智能排课助理');
      expect(tabBtn).toBeTruthy();

      fireEvent.click(tabBtn);
      expect(setTabMock).toHaveBeenCalledWith('plugin:ext-scheduler/smart-scheduling');
    });

    it('renders timetable tab panel when active and passes context props', async () => {
      const DummyScheduler = ({ classes, lang }: any) => (
        <div data-testid="scheduler-panel">
          <span>{lang}</span>
          <span>班级数: {classes?.length ?? 0}</span>
        </div>
      );

      usePluginHostStore.getState().registerExtensionPoint('timetable.tab', {
        id: 'smart-scheduling',
        label: '智能排课助理',
        pluginId: 'ext-scheduler',
        component: createLazyComponent(DummyScheduler),
      });

      // Active state matches
      const { rerender } = renderWithHost(
        <ExtensionPointRenderer
          slot="timetable.tab"
          slotProps={{
            renderType: 'panel',
            timetableActiveTab: 'plugin:ext-scheduler/smart-scheduling',
            classes: [{ id: 'c1', name: '高一(1)班' }],
            lang: 'zh',
          }}
        />,
      );

      expect(await screen.findByTestId('scheduler-panel')).toBeTruthy();
      expect(screen.getByText('班级数: 1')).toBeTruthy();

      // Inactive state does not render panel
      rerender(
        <PluginHostProvider host={new FrontendPluginHost()}>
          <ExtensionPointRenderer
            slot="timetable.tab"
            slotProps={{
              renderType: 'panel',
              timetableActiveTab: 'view',
              classes: [{ id: 'c1', name: '高一(1)班' }],
              lang: 'zh',
            }}
          />
        </PluginHostProvider>,
      );

      expect(screen.queryByTestId('scheduler-panel')).toBeNull();
    });
  });

  describe('admin.tab', () => {
    it('renders admin tab button and triggers tab switch on click', () => {
      const setAdminTabMock = vi.fn();

      usePluginHostStore.getState().registerExtensionPoint('admin.tab', {
        id: 'audit-logs',
        label: '审计与容灾',
        icon: 'Shield',
        pluginId: 'ext-audit',
        component: createLazyComponent(() => <div data-testid="audit-panel">审计面板</div>),
      });

      renderWithHost(
        <ExtensionPointRenderer
          slot="admin.tab"
          slotProps={{
            renderType: 'button',
            adminActiveTab: 'directory',
            setAdminActiveTab: setAdminTabMock,
          }}
        />,
      );

      const tabBtn = screen.getByText('审计与容灾');
      expect(tabBtn).toBeTruthy();

      fireEvent.click(tabBtn);
      expect(setAdminTabMock).toHaveBeenCalledWith('plugin:ext-audit/audit-logs');
    });

    it('renders admin tab panel when active and passes context props', async () => {
      const DummyAdminAudit = ({ currentUserId, currentUserRole, lang }: any) => (
        <div data-testid="admin-audit-panel">
          <span>用户: {currentUserId}</span>
          <span>角色: {currentUserRole}</span>
          <span>语言: {lang}</span>
        </div>
      );

      usePluginHostStore.getState().registerExtensionPoint('admin.tab', {
        id: 'audit-logs',
        label: '审计与容灾',
        pluginId: 'ext-audit',
        component: createLazyComponent(DummyAdminAudit),
      });

      // Active state matches
      const { rerender } = renderWithHost(
        <ExtensionPointRenderer
          slot="admin.tab"
          slotProps={{
            renderType: 'panel',
            adminActiveTab: 'plugin:ext-audit/audit-logs',
            currentUserId: 'admin-user-01',
            currentUserRole: 'administrator',
            lang: 'zh',
          }}
        />,
      );

      expect(await screen.findByTestId('admin-audit-panel')).toBeTruthy();
      expect(screen.getByText('用户: admin-user-01')).toBeTruthy();
      expect(screen.getByText('角色: administrator')).toBeTruthy();

      // Inactive state does not render panel
      rerender(
        <PluginHostProvider host={new FrontendPluginHost()}>
          <ExtensionPointRenderer
            slot="admin.tab"
            slotProps={{
              renderType: 'panel',
              adminActiveTab: 'directory',
              currentUserId: 'admin-user-01',
              currentUserRole: 'administrator',
              lang: 'zh',
            }}
          />
        </PluginHostProvider>,
      );

      expect(screen.queryByTestId('admin-audit-panel')).toBeNull();
    });

    it('injects IHostActionDispatcher into timetable.tab and admin.tab components', async () => {
      let capturedTimetableDispatcher: any = null;
      let capturedAdminDispatcher: any = null;

      const TimetableComp = (props: any) => {
        capturedTimetableDispatcher = props.dispatcher;
        return <div data-testid="tt-disp">OK</div>;
      };

      const AdminComp = (props: any) => {
        capturedAdminDispatcher = props.dispatcher;
        return <div data-testid="adm-disp">OK</div>;
      };

      usePluginHostStore.getState().registerExtensionPoint('timetable.tab', {
        id: 'tt-test',
        label: 'TT',
        pluginId: 'p-tt',
        component: createLazyComponent(TimetableComp),
      });

      usePluginHostStore.getState().registerExtensionPoint('admin.tab', {
        id: 'adm-test',
        label: 'ADM',
        pluginId: 'p-adm',
        component: createLazyComponent(AdminComp),
      });

      const host = new FrontendPluginHost();

      render(
        <PluginHostProvider host={host}>
          <ExtensionPointRenderer
            slot="timetable.tab"
            slotProps={{
              renderType: 'panel',
              timetableActiveTab: 'plugin:p-tt/tt-test',
            }}
          />
          <ExtensionPointRenderer
            slot="admin.tab"
            slotProps={{
              renderType: 'panel',
              adminActiveTab: 'plugin:p-adm/adm-test',
            }}
          />
        </PluginHostProvider>,
      );

      expect(await screen.findByTestId('tt-disp')).toBeTruthy();
      expect(await screen.findByTestId('adm-disp')).toBeTruthy();

      expect(capturedTimetableDispatcher).toBeDefined();
      expect(typeof capturedTimetableDispatcher.dispatch).toBe('function');
      expect(capturedAdminDispatcher).toBeDefined();
      expect(typeof capturedAdminDispatcher.dispatch).toBe('function');
    });
  });
});
