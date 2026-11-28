/**
 * 内置白板备课面（LessonEditorView）的追加扩展槽 `classroom.prep.addon`。
 *
 * `classroom.prep` 只服务第三方 Mode Pack（替换整块备课面）；内置白板编辑器
 * 通过 `classroom.prep.addon` 追加按钮/弹层入口，不替换编辑器本体。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { LessonEditorView } from '../LessonEditorView';
import { AppDataProvider, type AppDataValue } from '../../../context/AppDataContext';
import type { Lesson } from '../../../types/app';

vi.mock('../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: () => <div data-testid="editor-whiteboard" />,
}));

type PrepAddonProps = {
  packId?: string;
  prepContributionId?: string;
  lessonId?: string | null;
  segment?: { id?: string; type?: string } | null;
  isReadOnly?: boolean;
};

function createLazyComponent<P extends object>(Component: React.ComponentType<P>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockLesson: Lesson = {
  id: 'les_ai_01',
  title: 'Python 算法与递归探索',
  content: '递归调用与分治法实战',
  created_at: 1712000000,
};

function makeProps(): AppDataValue {
  return {
    lang: 'zh',
    lessons: [mockLesson],
    selectedLesson: 'les_ai_01',
    activeRole: 'teacher',
    setActiveRole: vi.fn(),
    editorSaveStatus: 'none',
    setEditorSaveStatus: vi.fn(),
    editorLastSavedTime: null,
    setEditorLastSavedTime: vi.fn(),
    setTeacherTab: vi.fn(),
    handlePaletteActivate: vi.fn(),
    timelineSegments: [{ id: 'seg-1', title: '导入', type: 'lecture' }],
    activeSegmentId: 'seg-1',
    setActiveSegmentId: vi.fn(),
    draggedSegmentIdx: null,
    setDraggedSegmentIdx: vi.fn(),
    saveTimeline: vi.fn().mockResolvedValue(undefined),
    editorPanelsExpanded: true,
    setEditorPanelsExpanded: vi.fn(),
    fetchElements: vi.fn().mockResolvedValue(undefined),
    whiteboardRef: { current: null } as MutableRefObject<unknown>,
    elements: [],
    paletteEdit: null,
    handlePaletteConfirm: vi.fn().mockResolvedValue(undefined),
    setPaletteEdit: vi.fn(),
  } as unknown as AppDataValue;
}

beforeEach(() => {
  usePluginHostStore.setState({ extensionPoints: new Map(), activePlugins: [] });
});

afterEach(() => {
  cleanup();
});

describe('classroom.prep.addon — 内置白板备课面', () => {
  it('在白板编辑器顶栏渲染，并注入白板 pack 与当前备课环节', async () => {
    const captured: { props?: PrepAddonProps } = {};
    const PrepTools = (props: PrepAddonProps) => {
      captured.props = props;
      return <button data-testid="prep-addon-btn">备课工具</button>;
    };

    usePluginHostStore.getState().registerExtensionPoint('classroom.prep.addon', {
      id: 'prep-tools',
      label: '备课工具',
      pluginId: 'ext-prep-tools',
      component: createLazyComponent(PrepTools),
    });

    render(
      <PluginHostProvider host={new FrontendPluginHost()}>
        <AppDataProvider value={makeProps()}>
          <LessonEditorView />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('prep-addon-btn')).toBeTruthy();
    });

    expect(captured.props?.packId).toBe('whiteboard');
    expect(captured.props?.prepContributionId).toBe('prep-whiteboard');
    expect(captured.props?.lessonId).toBe('les_ai_01');
    expect(captured.props?.segment).toMatchObject({ id: 'seg-1', type: 'lecture' });
  });
});
