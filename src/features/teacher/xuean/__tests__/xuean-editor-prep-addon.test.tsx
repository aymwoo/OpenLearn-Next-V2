/**
 * 内置学案备课面（XueanEditor）的追加扩展槽 `classroom.prep.addon`。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../../plugin-host/plugin-host-store';
import { XueanEditor } from '../XueanEditor';
import { AppDataProvider, type AppDataValue } from '../../../../context/AppDataContext';

vi.mock('../XueanBlocksEditor', () => ({
  XueanBlocksEditor: () => <div data-testid="xuean-blocks-mock" />,
}));

type PrepAddonProps = {
  packId?: string;
  prepContributionId?: string;
  lessonId?: string | null;
  segment?: { id?: string; type?: string } | null;
};

function createLazyComponent<P extends object>(Component: React.ComponentType<P>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

function makeProps(): AppDataValue {
  return {
    lang: 'zh',
    lessons: [{ id: 'les_xuean_01', title: '学案课时' }],
    selectedLesson: 'les_xuean_01',
    timelineSegments: [{ id: 'seg-x', title: '研读', type: 'xuean' }],
    activeSegmentId: 'seg-x',
  } as unknown as AppDataValue;
}

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map(), activePlugins: [] });
});

afterEach(() => {
  cleanup();
});

describe('classroom.prep.addon — 内置学案备课面', () => {
  it('在学案编辑器顶栏渲染，并注入学案 pack 与当前备课环节', async () => {
    const captured: { props?: PrepAddonProps } = {};
    const PrepTools = (props: PrepAddonProps) => {
      captured.props = props;
      return <button data-testid="xuean-prep-addon-btn">学案备课工具</button>;
    };

    usePluginHostStore.getState().registerExtensionPoint('classroom.prep.addon', {
      id: 'xuean-prep-tools',
      label: '学案备课工具',
      pluginId: 'ext-xuean-prep',
      component: createLazyComponent(PrepTools),
    });

    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <AppDataProvider value={makeProps()}>
          <XueanEditor />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('xuean-prep-addon-btn')).toBeTruthy();
    });

    expect(captured.props?.packId).toBe('xuean');
    expect(captured.props?.prepContributionId).toBe('prep-xuean');
    expect(captured.props?.lessonId).toBe('les_xuean_01');
    expect(captured.props?.segment).toMatchObject({ id: 'seg-x', type: 'xuean' });
  });
});
