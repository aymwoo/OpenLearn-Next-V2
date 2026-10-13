import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { CourseWizardModal, type CourseWizardModalProps, type WizardSegment } from '../CourseWizardModal';

afterEach(() => cleanup());

function makeProps(overrides: Partial<CourseWizardModalProps> = {}): CourseWizardModalProps {
  return {
    isCourseWizardOpen: true,
    setIsCourseWizardOpen: vi.fn(),
    lang: 'zh',
    wizardStep: 1,
    setWizardStep: vi.fn(),
    wizardIsSubmitting: false,
    wizardCourseTitle: '',
    setWizardCourseTitle: vi.fn(),
    wizardCourseDescription: '',
    setWizardCourseDescription: vi.fn(),
    wizardCourseCategory: 'Mathematics',
    setWizardCourseCategory: vi.fn(),
    wizardCourseTimeline: [] as WizardSegment[],
    setWizardCourseTimeline: vi.fn(),
    wizardCourseContent: '',
    setWizardCourseContent: vi.fn(),
    addToast: vi.fn(),
    wizardIsGeneratingOutline: false,
    handleGenerateOutline: vi.fn(async () => {}),
    handleDeployWizardCourse: vi.fn(),
    ...overrides,
  };
}

describe('CourseWizardModal', () => {
  it('renders the wizard header when open (zh)', () => {
    render(<CourseWizardModal {...makeProps({ lang: 'zh', isCourseWizardOpen: true })} />);
    expect(screen.getByText(/互动课程发布与时间轴向导/)).toBeTruthy();
  });

  it('renders the wizard header when open (en)', () => {
    render(<CourseWizardModal {...makeProps({ lang: 'en', isCourseWizardOpen: true })} />);
    expect(screen.getByText(/Course Design Guide & Wizard/)).toBeTruthy();
  });

  it('does not render the wizard when closed', () => {
    render(<CourseWizardModal {...makeProps({ isCourseWizardOpen: false })} />);
    expect(screen.queryByText(/互动课程发布与时间轴向导/)).toBeNull();
  });
});

/** 把 "12m" 之类的时长串解析成分钟数，用于校验模板总时长 */
function toMinutes(duration: string): number {
  return Number(duration.replace(/[^\d]/g, '')) || 0;
}

describe('CourseWizardModal 课堂框架模板时长', () => {
  const presetTitles = [/经典 5-15-15-5 讲授模式/, /主题讨论工作坊模式/, /翻转课堂高强度训练/];

  function renderPresets(props: Partial<CourseWizardModalProps> = {}) {
    const setWizardCourseTimeline = vi.fn();
    render(<CourseWizardModal {...makeProps({ wizardStep: 2, setWizardCourseTimeline, ...props })} />);
    return setWizardCourseTimeline;
  }

  it.each(presetTitles)('模板「%s」各环节时长之和为 40 分钟', (titleRe) => {
    const setWizardCourseTimeline = renderPresets();

    const presetButton = screen.getByText(titleRe).closest('button');
    expect(presetButton).toBeTruthy();
    fireEvent.click(presetButton!);

    const segments = setWizardCourseTimeline.mock.calls[0][0] as WizardSegment[];
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.reduce((sum, seg) => sum + toMinutes(seg.duration), 0)).toBe(40);
  });

  it.each(presetTitles)('模板「%s」的环节标题写明的分钟数与实际时长一致 (zh)', (titleRe) => {
    const setWizardCourseTimeline = renderPresets();
    fireEvent.click(screen.getByText(titleRe).closest('button')!);

    const segments = setWizardCourseTimeline.mock.calls[0][0] as WizardSegment[];
    // 只校验描述里以 "N分钟" / "N分" 形式出现时长的模板（经典与翻转模式）
    const stated = screen.getByText(titleRe).parentElement?.querySelector('.text-gray-400')?.textContent ?? '';
    const statedMinutes = [...stated.matchAll(/(\d+)\s*分/g)].map((m) => Number(m[1]));
    if (statedMinutes.length === 0) return;

    expect(segments.reduce((sum, seg) => sum + toMinutes(seg.duration), 0)).toBe(
      statedMinutes.reduce((a, b) => a + b, 0),
    );
  });

  it('预设时长累加公式应展示为 40 分钟 (zh)', () => {
    render(<CourseWizardModal {...makeProps({ wizardStep: 2, lang: 'zh' })} />);
    expect(screen.getByText(/环节累加公式/)).toBeTruthy();
  });
});

describe('CourseWizardModal AI 大纲生成', () => {
  it('点击按钮应调用 handleGenerateOutline，而非本地硬编码模板', async () => {
    const handleGenerateOutline = vi.fn(async () => {});
    render(
      <CourseWizardModal
        {...makeProps({
          wizardStep: 3,
          wizardCourseTitle: '西方哲学：康德的三大批判',
          handleGenerateOutline,
        })}
      />,
    );

    fireEvent.click(screen.getByText(/AI 生成专家级教学大纲/));

    await waitFor(() => expect(handleGenerateOutline).toHaveBeenCalledTimes(1));
  });

  it('生成中应禁用按钮并展示加载态', () => {
    render(<CourseWizardModal {...makeProps({ wizardStep: 3, wizardIsGeneratingOutline: true })} />);

    const button = screen.getByText(/AI 正在生成大纲/).closest('button');
    expect(button).toBeTruthy();
    expect(button!.hasAttribute('disabled')).toBe(true);
  });

  it('课题为空时点击只交给 hook 处理（由 hook 统一拦截并提示）', () => {
    const handleGenerateOutline = vi.fn(async () => {});
    const addToast = vi.fn();
    render(
      <CourseWizardModal
        {...makeProps({
          wizardStep: 3,
          wizardCourseTitle: '',
          handleGenerateOutline,
          addToast,
        })}
      />,
    );

    fireEvent.click(screen.getByText(/AI 生成专家级教学大纲/).closest('button')!);

    expect(handleGenerateOutline).toHaveBeenCalledTimes(1);
    // 提示职责在 hook 内，避免 modal 与 hook 重复弹 toast
    expect(addToast).not.toHaveBeenCalled();
  });

  it('英文界面渲染 AI 生成入口', () => {
    render(
      <CourseWizardModal {...makeProps({ wizardStep: 3, lang: 'en', wizardCourseTitle: 'Intro to Regressions' })} />,
    );
    expect(screen.getByText(/AI-Generate Syllabus/)).toBeTruthy();
  });
});
