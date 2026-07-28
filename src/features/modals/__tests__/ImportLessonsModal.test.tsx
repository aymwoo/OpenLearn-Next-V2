import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ImportLessonsModal, type ImportLessonsModalProps, type ImportRow } from '../ImportLessonsModal';

afterEach(() => cleanup());

function makeProps(overrides: Partial<ImportLessonsModalProps> = {}): ImportLessonsModalProps {
  return {
    isImportLessonsOpen: true,
    setIsImportLessonsOpen: vi.fn(),
    lang: 'en',
    importStatus: 'idle',
    setIsDraggingImport: vi.fn(),
    handleCSVFileChange: vi.fn(),
    downloadCsvTemplate: vi.fn(),
    isDraggingImport: false,
    previewImportData: [] as ImportRow[],
    setPreviewImportData: vi.fn(),
    setImportStatus: vi.fn(),
    importProgress: 0,
    importProgressTotal: 1,
    importErrorMsg: '',
    setImportErrorMsg: vi.fn(),
    handleCSVImportSubmit: vi.fn(),
    ...overrides,
  };
}

describe('ImportLessonsModal', () => {
  it('renders the modal header when open (en)', () => {
    render(<ImportLessonsModal {...makeProps({ lang: 'en', isImportLessonsOpen: true })} />);
    expect(screen.getByText('Bulk-Import Courses (CSV)')).toBeTruthy();
  });

  it('renders the modal header when open (zh)', () => {
    render(<ImportLessonsModal {...makeProps({ lang: 'zh', isImportLessonsOpen: true })} />);
    expect(screen.getByText('批量导入课程 (CSV)')).toBeTruthy();
  });

  it('does not render the modal when closed', () => {
    render(<ImportLessonsModal {...makeProps({ isImportLessonsOpen: false })} />);
    expect(screen.queryByText('Bulk-Import Courses (CSV)')).toBeNull();
  });
});
