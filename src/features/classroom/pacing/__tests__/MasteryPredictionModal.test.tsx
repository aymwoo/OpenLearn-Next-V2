import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MasteryPredictionModal, type StudentPaceSnapshot } from '../MasteryPredictionModal';

afterEach(cleanup);

const snapshots: StudentPaceSnapshot[] = [
  { studentId: 'stu-1', studentName: '张子豪', participationScore: 92, quizScore: 88, paceIndicator: 'on-track', behaviorSignals: ['主动提问'] },
  { studentId: 'stu-2', studentName: '李晓彤', participationScore: 22, paceIndicator: 'stalled', behaviorSignals: ['长时间无操作'] },
];

const noopToast = vi.fn();

const aiResponse = {
  lessonId: 'les-1',
  generatedAt: Date.now(),
  aiSucceeded: true,
  currentStage: 'IN_CLASS_TEACHING',
  predictions: [
    {
      studentId: 'stu-1',
      studentName: '张子豪',
      prediction: { algorithmic: 88, engineering: 85, creativity: 90, collaboration: 92, focus: 95 },
      risk: 'low',
      note: '表现优秀',
    },
    {
      studentId: 'stu-2',
      studentName: '李晓彤',
      prediction: { algorithmic: 45, engineering: 40, creativity: 50, collaboration: 55, focus: 30 },
      risk: 'high',
      note: '建议单独辅导',
    },
  ],
};

function renderModal(overrides: Partial<React.ComponentProps<typeof MasteryPredictionModal>> = {}) {
  return render(
    <MasteryPredictionModal
      isOpen={true}
      onClose={noopToast}
      lessonId="les-1"
      lessonTitle="Python 循环与算法"
      currentStageName="IN_CLASS_TEACHING"
      elapsedMin={20}
      plannedTotalMin={45}
      studentSnapshots={snapshots}
      addToast={noopToast}
      {...overrides}
    />,
  );
}

describe('MasteryPredictionModal', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('关闭时不渲染', () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.firstChild).toBeNull();
  });

  it('打开时请求预测并渲染 5 维掌握度', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => aiResponse,
    } as any);

    renderModal();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/classroom/les-1/predict-mastery',
        expect.objectContaining({ method: 'POST' }),
      ),
    );

    // 学生名与 5 维标签
    expect(await screen.findByText('张子豪')).toBeTruthy();
    expect(screen.getByText('李晓彤')).toBeTruthy();
    expect(screen.getAllByText('算法逻辑').length).toBeGreaterThan(0);
    expect(screen.getAllByText('课堂专注').length).toBeGreaterThan(0);
    // 风险徽标（高风险 1 / 低风险 1）
    expect(screen.getByText(/高风险: 1/)).toBeTruthy();
    expect(screen.getByText(/低风险: 1/)).toBeTruthy();
  });

  it('风险优先排序：高风险学生排在最前', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => aiResponse } as any);
    renderModal();

    await screen.findByText('张子豪');
    // 默认 sortBy=risk，李晓彤（high）应在张子豪（low）之前
    const names = screen.getAllByText(/张子豪|李晓彤/).map((el) => el.textContent);
    expect(names[0]).toBe('李晓彤');
  });

  it('AI 降级时显示「降级模式」标记', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ...aiResponse, aiSucceeded: false }),
    } as any);

    renderModal();
    expect(await screen.findByText(/降级模式/)).toBeTruthy();
  });

  it('请求失败弹出错误 toast', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 502, text: async () => 'bad gateway' } as any);
    renderModal();

    await waitFor(() =>
      expect(noopToast).toHaveBeenCalledWith(expect.stringContaining('预测失败'), expect.any(String), 'error'),
    );
  });

  it('无学生数据时不发起请求', async () => {
    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => ({}) } as any);
    renderModal({ studentSnapshots: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('课堂进度条按 elapsed/planned 计算', async () => {
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: true, json: async () => aiResponse } as any);
    renderModal({ elapsedMin: 30, plannedTotalMin: 60 });
    expect(await screen.findByText('50%')).toBeTruthy();
  });
});
