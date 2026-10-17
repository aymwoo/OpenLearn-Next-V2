import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { SegmentEditorCard } from '../SegmentEditorCard';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import { usePluginHostStore } from '../../../../plugin-host/plugin-host-store';

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

describe('editor.segment.type_config extension slot', () => {
  let host: FrontendPluginHost;

  beforeEach(() => {
    vi.restoreAllMocks();
    host = new FrontendPluginHost();
    usePluginHostStore.setState({
      activePlugins: [],
      extensionPoints: new Map(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders editor.segment.type_config slot with segment type and context', async () => {
    let capturedProps: any = null;
    const patchMock = vi.fn();

    const ExperimentConfigPlugin = (props: any) => {
      capturedProps = props;
      return (
        <div data-testid="experiment-config-panel">
          <h4>数字化探究实验配置</h4>
          <button
            data-testid="add-apparatus-btn"
            onClick={() => {
              props.onPatch({ apparatus: ['力传感器', '光电门'] });
            }}
          >
            添加器材
          </button>
        </div>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('editor.segment.type_config', {
      id: 'experiment-config-extension',
      label: '实验器材配置面板',
      pluginId: 'ext-physics-dis',
      component: createLazyComponent(ExperimentConfigPlugin),
    });

    render(
      <PluginHostProvider host={host}>
        <SegmentEditorCard
          lang="zh"
          segment={{
            id: 'seg_exp_1',
            title: '探究加速度与力的关系',
            type: 'scientific_experiment',
            duration: '15m',
            notes: '注意滑轮水平校准',
          }}
          onPatch={patchMock}
          onDelete={vi.fn()}
        />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('experiment-config-panel')).toBeTruthy();
    });

    expect(capturedProps).not.toBeNull();
    expect(capturedProps.segmentType).toBe('scientific_experiment');
    expect(capturedProps.segment.id).toBe('seg_exp_1');
    expect(capturedProps.lang).toBe('zh');
    expect(capturedProps.readOnly).toBe(false);

    fireEvent.click(screen.getByTestId('add-apparatus-btn'));
    expect(patchMock).toHaveBeenCalledWith({ apparatus: ['力传感器', '光电门'] });
  });
});
