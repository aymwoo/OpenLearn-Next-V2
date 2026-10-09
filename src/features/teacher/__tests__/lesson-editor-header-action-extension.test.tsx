import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { ExtensionPointRenderer } from '../../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../../plugin-host/plugin-host-store';
import { LessonEditorView } from '../LessonEditorView';
import { AppDataProvider } from '../../../context/AppDataContext';
import type { Lesson } from '../../../types/app';
import type { IHostActionDispatcher } from '../../../plugin-host/types';

vi.mock('../../../components/LazyWhiteboard', () => ({
  LazyWhiteboard: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="editor-whiteboard" data-read-only={String(Boolean(readOnly))} />
  ),
}));

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockLesson: Lesson = {
  id: 'les_ai_01',
  title: 'Python 算法与递归探索',
  content: '递归调用与分治法实战',
  created_at: 1712000000000,
};

function makeProps(overrides: Record<string, any> = {}): Record<string, any> {
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
    timelineSegments: [],
    activeSegmentId: null,
    setActiveSegmentId: vi.fn(),
    draggedSegmentIdx: null,
    setDraggedSegmentIdx: vi.fn(),
    saveTimeline: vi.fn().mockResolvedValue(undefined),
    editorPanelsExpanded: true,
    setEditorPanelsExpanded: vi.fn(),
    fetchElements: vi.fn().mockResolvedValue(undefined),
    whiteboardRef: { current: null } as MutableRefObject<any>,
    elements: [],
    paletteEdit: null,
    handlePaletteConfirm: vi.fn().mockResolvedValue(undefined),
    setPaletteEdit: vi.fn(),
    ...overrides,
  };
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

describe('editor.header.action extension slot', () => {
  it('receives complete lesson context and dispatcher props', async () => {
    let capturedProps: any = null;

    const ExportPdfPlugin = (props: any) => {
      capturedProps = props;
      return (
        <button
          data-testid="export-pdf-btn"
          onClick={() => {
            props.onSave?.();
          }}
        >
          导出教案 PDF ({props.currentLesson?.title})
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('editor.header.action', {
      id: 'export-pdf',
      label: '导出教案 PDF',
      pluginId: 'ext-pdf-exporter',
      component: createLazyComponent(ExportPdfPlugin),
    });

    const host = new FrontendPluginHost();
    const saveMock = vi.fn();

    render(
      <PluginHostProvider host={host}>
        <ExtensionPointRenderer
          slot="editor.header.action"
          slotProps={{
            lessonId: 'les_ai_01',
            currentLesson: mockLesson,
            lang: 'zh',
            isReadOnly: false,
            activeRole: 'teacher',
            onSave: saveMock,
          }}
        />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('export-pdf-btn')).toBeTruthy();
    });

    expect(capturedProps.lessonId).toBe('les_ai_01');
    expect(capturedProps.currentLesson?.title).toBe('Python 算法与递归探索');
    expect(capturedProps.isReadOnly).toBe(false);
    expect(capturedProps.activeRole).toBe('teacher');
    expect(capturedProps.dispatcher).toBeDefined();

    fireEvent.click(screen.getByTestId('export-pdf-btn'));
    expect(saveMock).toHaveBeenCalled();
  });

  it('integrates seamlessly in LessonEditorView top bar and reacts to host:refresh', async () => {
    const fetchElementsMock = vi.fn().mockResolvedValue(undefined);

    const AiAuditPlugin = ({
      currentLesson,
      dispatcher,
    }: {
      currentLesson?: Lesson;
      dispatcher: IHostActionDispatcher;
    }) => {
      return (
        <button
          data-testid="ai-audit-btn"
          className="px-2 py-1 bg-amber-500 text-white rounded text-xs"
          onClick={async () => {
            // 插件发起课程受控刷新
            await dispatcher.dispatch({
              type: 'host:refresh',
              payload: { target: 'lessons' },
            });
          }}
        >
          AI 教案合规审查 ({currentLesson?.title?.slice(0, 6)})
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('editor.header.action', {
      id: 'ai-compliance-audit',
      label: 'AI 教案合规审查',
      pluginId: 'ext-ai-audit',
      component: createLazyComponent(AiAuditPlugin),
    });

    const host = new FrontendPluginHost();

    render(
      <PluginHostProvider host={host}>
        <AppDataProvider value={makeProps({ fetchElements: fetchElementsMock }) as any}>
          <LessonEditorView />
        </AppDataProvider>
      </PluginHostProvider>,
    );

    // 验证顶栏右侧渲染了 AI 审查按钮
    await waitFor(() => {
      expect(screen.getByTestId('ai-audit-btn')).toBeTruthy();
    });

    expect(screen.getByText('AI 教案合规审查 (Python)')).toBeTruthy();

    // 点击按钮派发受控动作
    fireEvent.click(screen.getByTestId('ai-audit-btn'));

    // 验证 LessonEditorView 中注册的 host:refresh 处理器被触发
    await waitFor(() => {
      expect(fetchElementsMock).toHaveBeenCalledWith('les_ai_01');
    });
  });
});
