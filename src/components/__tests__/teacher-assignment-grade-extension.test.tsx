import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TeacherAssignmentGradePanel } from '../TeacherAssignmentGradePanel';
import { ExtensionPointRenderer } from '../../plugin-host/extension-point-renderer';
import { PluginHostProvider } from '../../plugin-host/plugin-host-context';
import { FrontendPluginHost } from '../../plugin-host/plugin-host';
import { usePluginHostStore } from '../../plugin-host/plugin-host-store';

function createLazyComponent(Component: React.ComponentType<any>) {
  const factory = () => Promise.resolve({ default: Component });
  (factory as unknown as { __isLazyFactory?: boolean }).__isLazyFactory = true;
  return factory;
}

const mockSubmissions = [
  {
    id: 'sub_001',
    student_id: 'stu_101',
    studentName: '张三',
    version: 1,
    filePath: '/storage/assignments/test.py',
    updatedAt: 1712000000000,
    peerReviews: [{ id: 'rev_1', reviewer_name: '李四', score: 85, comment: '代码逻辑清晰' }],
    peerAverageScore: 85,
    grade: null,
  },
];

describe('TeacherAssignmentGradePanel extension slots', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    usePluginHostStore.setState({
      extensionPoints: new Map(),
      activePlugins: [],
    });
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/eval-grades')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockSubmissions,
        } as any);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      } as any);
    });
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders assignment.grade.toolbar.action slot and passes correct context', async () => {
    let capturedToolbarProps: any = null;

    const BatchAiGradingPlugin = (props: any) => {
      capturedToolbarProps = props;
      return (
        <button data-testid="batch-ai-grade-btn" onClick={() => props.refresh?.()}>
          AI 批量初评 ({props.submissions?.length || 0})
        </button>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('assignment.grade.toolbar.action', {
      id: 'batch-ai-grade',
      label: 'AI 批量初评',
      pluginId: 'prov-ai-grader',
      component: createLazyComponent(BatchAiGradingPlugin),
    });

    const host = new FrontendPluginHost();
    const addToastMock = vi.fn();

    render(
      <PluginHostProvider host={host}>
        <TeacherAssignmentGradePanel lessonId="les_001" lang="zh" addToast={addToastMock} />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('batch-ai-grade-btn')).toBeTruthy();
    });

    expect(capturedToolbarProps).not.toBeNull();
    expect(capturedToolbarProps.lessonId).toBe('les_001');
    expect(capturedToolbarProps.lang).toBe('zh');
    expect(typeof capturedToolbarProps.refresh).toBe('function');

    fireEvent.click(screen.getByTestId('batch-ai-grade-btn'));
    // Refresh re-triggers fetch
    expect(global.fetch).toHaveBeenCalledWith('/api/lessons/les_001/eval-grades');
  });

  it('renders assignment.grade.item.addon slot inside student card and allows updating scores', async () => {
    let capturedItemProps: any = null;

    const CodeAnalysisPlugin = (props: any) => {
      capturedItemProps = props;
      return (
        <div data-testid="code-analysis-addon" className="p-2 bg-slate-100 rounded">
          <span>代码规范评分: 95</span>
          <button
            data-testid="apply-suggested-score-btn"
            onClick={() => {
              props.onScoreChange?.(95);
              props.onCommentChange?.('代码架构优良，单测全部通过。');
            }}
          >
            应用建议分
          </button>
        </div>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('assignment.grade.item.addon', {
      id: 'code-analysis',
      label: '代码静态分析与测试',
      pluginId: 'ext-code-analyzer',
      component: createLazyComponent(CodeAnalysisPlugin),
    });

    const host = new FrontendPluginHost();
    const addToastMock = vi.fn();

    render(
      <PluginHostProvider host={host}>
        <TeacherAssignmentGradePanel lessonId="les_001" lang="zh" addToast={addToastMock} />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('code-analysis-addon')).toBeTruthy();
    });

    expect(capturedItemProps).not.toBeNull();
    expect(capturedItemProps.studentId).toBe('stu_101');
    expect(capturedItemProps.submission.id).toBe('sub_001');

    // Click apply score
    fireEvent.click(screen.getByTestId('apply-suggested-score-btn'));

    // Score input should reflect 95
    const scoreInput = document.getElementById('teacher_score_input_sub_001') as HTMLInputElement;
    expect(scoreInput.value).toBe('95');

    // Comment textarea should reflect applied text
    const commentInput = document.getElementById('teacher_comment_input_sub_001') as HTMLTextAreaElement;
    expect(commentInput.value).toBe('代码架构优良，单测全部通过。');
  });

  it('renders assignment.grade.rubric.addon slot in weights configuration area', async () => {
    let capturedRubricProps: any = null;

    const RubricTuningPlugin = (props: any) => {
      capturedRubricProps = props;
      return (
        <div data-testid="rubric-addon">
          <button data-testid="tune-weights-btn" onClick={() => props.onTeacherWeightChange?.(70)}>
            调整为70%
          </button>
        </div>
      );
    };

    usePluginHostStore.getState().registerExtensionPoint('assignment.grade.rubric.addon', {
      id: 'rubric-tuning',
      label: '量规微调',
      pluginId: 'ext-rubric-tuner',
      component: createLazyComponent(RubricTuningPlugin),
    });

    const host = new FrontendPluginHost();
    const addToastMock = vi.fn();

    render(
      <PluginHostProvider host={host}>
        <TeacherAssignmentGradePanel lessonId="les_001" lang="zh" addToast={addToastMock} />
      </PluginHostProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('rubric-addon')).toBeTruthy();
    });

    expect(capturedRubricProps).not.toBeNull();
    expect(capturedRubricProps.defaultTeacherWeight).toBe(60);

    fireEvent.click(screen.getByTestId('tune-weights-btn'));
    expect(screen.getAllByText('70%').length).toBeGreaterThanOrEqual(1);
  });
});
