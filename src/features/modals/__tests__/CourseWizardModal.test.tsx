import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
    generateTemplateContent: vi.fn((title: string, category: string) => ''),
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
