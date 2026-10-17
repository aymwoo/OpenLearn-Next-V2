import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { TimelineRail } from '../TimelineRail';
import { SegmentEditorCard } from '../SegmentEditorCard';
import { FrontendPluginHost } from '../../../../plugin-host/plugin-host';
import { PluginHostProvider } from '../../../../plugin-host/plugin-host-context';
import { usePluginHostStore } from '../../../../plugin-host/plugin-host-store';

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

describe('editor.timeline.node_badge extension slot', () => {
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

  it('renders node_badge slot in TimelineRail with segment props', async () => {
    let capturedProps: any = null;

    const MockBadgePlugin = (props: any) => {
      capturedProps = props;
      return (
        <span data-testid="custom-timeline-badge" className="text-xs bg-indigo-100 text-indigo-700 px-1 rounded">
          器材: {props.segment.id}
        </span>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('editor.timeline.node_badge', {
      id: 'equipment-badge-ext',
      label: '实验器材微徽章',
      pluginId: 'ext-physics-dis',
      component: createLazyComponent(MockBadgePlugin),
    });

    const segments = [
      { id: 'seg_1', title: '环节一：导入', duration: '5m', color: 'blue' },
      { id: 'seg_2', title: '环节二：探究', duration: '15m', color: 'emerald' },
    ];

    render(
      <PluginHostProvider host={host}>
        <TimelineRail
          lang="zh"
          segments={segments}
          activeSegmentId="seg_1"
          setActiveSegmentId={vi.fn()}
          draggedSegmentIdx={null}
          setDraggedSegmentIdx={vi.fn()}
          selectedLesson="lesson_123"
          saveTimeline={vi.fn()}
          editorPanelsExpanded={true}
          setEditorPanelsExpanded={vi.fn()}
        />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      const badges = screen.getAllByTestId('custom-timeline-badge');
      expect(badges.length).toBe(2);
    });

    expect(capturedProps).not.toBeNull();
    expect(capturedProps.lang).toBe('zh');
    expect(typeof capturedProps.idx).toBe('number');
    expect(typeof capturedProps.isActive).toBe('boolean');
    expect(typeof capturedProps.isCompleted).toBe('boolean');
  });

  it('renders node_badge slot in SegmentEditorCard header', async () => {
    let capturedProps: any = null;

    const MockCardBadge = (props: any) => {
      capturedProps = props;
      return (
        <span data-testid="custom-card-badge" className="text-xs bg-amber-100 text-amber-700 px-1.5 rounded">
          AI评估待测
        </span>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('editor.timeline.node_badge', {
      id: 'ai-eval-badge-ext',
      label: 'AI评估徽章',
      pluginId: 'ext-ai-eval',
      component: createLazyComponent(MockCardBadge),
    });

    render(
      <PluginHostProvider host={host}>
        <SegmentEditorCard
          lang="zh"
          segment={{
            id: 'seg_test',
            title: '自主探究',
            type: 'inquiry',
            duration: '10m',
          }}
          onPatch={vi.fn()}
          onDelete={vi.fn()}
        />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('custom-card-badge')).toBeTruthy();
    });

    expect(capturedProps).not.toBeNull();
    expect(capturedProps.segment.id).toBe('seg_test');
    expect(capturedProps.isActive).toBe(true);
    expect(capturedProps.isCompleted).toBe(false);
  });
});
