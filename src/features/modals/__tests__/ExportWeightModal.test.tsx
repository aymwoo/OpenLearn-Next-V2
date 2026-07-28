import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ExportWeightModal, type ExportWeightModalProps } from '../ExportWeightModal';

afterEach(() => cleanup());

function makeProps(overrides: Partial<ExportWeightModalProps> = {}): ExportWeightModalProps {
  return {
    isExportWeightModalOpen: true,
    setIsExportWeightModalOpen: vi.fn(),
    lang: 'en',
    quizzesWeight: 40,
    setQuizzesWeight: vi.fn(),
    assignmentsWeight: 60,
    setAssignmentsWeight: vi.fn(),
    handleQuizzesWeightChange: vi.fn(),
    handleAssignmentsWeightChange: vi.fn(),
    customCategoryOverrides: {},
    setCustomCategoryOverrides: vi.fn(),
    classDashboardMap: {},
    exportClassId: '',
    exportClassName: '',
    csvPreviewData: null,
    handleExportGrades: vi.fn(),
    ...overrides,
  };
}

describe('ExportWeightModal', () => {
  it('renders the modal header when open (zh)', () => {
    render(<ExportWeightModal {...makeProps({ lang: 'zh', isExportWeightModalOpen: true })} />);
    expect(screen.getByText('导出成绩权重设置')).toBeTruthy();
  });

  it('renders the modal header when open (en)', () => {
    render(<ExportWeightModal {...makeProps({ lang: 'en', isExportWeightModalOpen: true })} />);
    expect(screen.getByText('Grade Export & Weighting Settings')).toBeTruthy();
  });

  it('does not render the modal when closed', () => {
    render(<ExportWeightModal {...makeProps({ isExportWeightModalOpen: false })} />);
    expect(screen.queryByText('Grade Export & Weighting Settings')).toBeNull();
  });
});
