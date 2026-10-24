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
    handleImportFileChange: vi.fn(),
    downloadCsvTemplate: vi.fn(),
    downloadCourseTemplate: vi.fn(),
    packagePreview: null,
    handlePackageImportSubmit: vi.fn(),
    packageDuplicate: null,
    handlePackageDuplicateDismiss: vi.fn(),
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
    expect(screen.getByText('Bulk-Import Courses')).toBeTruthy();
  });

  it('renders the modal header when open (zh)', () => {
    render(<ImportLessonsModal {...makeProps({ lang: 'zh', isImportLessonsOpen: true })} />);
    expect(screen.getByText('批量导入课程')).toBeTruthy();
  });

  it('does not render the modal when closed', () => {
    render(<ImportLessonsModal {...makeProps({ isImportLessonsOpen: false })} />);
    expect(screen.queryByText('Bulk-Import Courses')).toBeNull();
  });

  it('offers the course-package template download button', () => {
    render(<ImportLessonsModal {...makeProps()} />);
    expect(screen.getByTestId('download-course-package-template-btn')).toBeTruthy();
  });

  it('labels the CSV channel as a quick import so teachers do not expect segments/assets (审计尾巴)', () => {
    // CSV 通道只有两列；此前文案只说「支持 CSV 与课程包」，教师会把「导入了 CSV」
    // 误当成「导入了完整课程」，再去白板上找不到任何组件。徽标把边界摆在明面上。
    render(<ImportLessonsModal {...makeProps({ lang: 'zh', isImportLessonsOpen: true })} />);
    expect(screen.getByTestId('csv-simple-import-badge')).toBeTruthy();
    expect(screen.getByText('简易导入（CSV）')).toBeTruthy();
    expect(screen.getByText('仅标题 + 正文')).toBeTruthy();
    // 头部副标题也要把两条通道的分工说清
    expect(screen.getByText(/CSV 为「简易导入」/)).toBeTruthy();
  });

  it('uses the same distinction in English', () => {
    render(<ImportLessonsModal {...makeProps({ lang: 'en', isImportLessonsOpen: true })} />);
    expect(screen.getByText('Quick import (CSV)')).toBeTruthy();
    expect(screen.getByText('title + body only')).toBeTruthy();
  });

  it('shows the duplicate notice with an explicit "import a copy" escape hatch (G-06)', () => {
    render(
      <ImportLessonsModal
        {...makeProps({
          importStatus: 'error',
          packagePreview: {
            fileName: 'openlearn-course-template.json',
            title: '示例课程',
            metaName: 'meta',
            segments: 5,
            elements: 14,
            assets: 2,
            componentTypes: ['presentation'],
          },
          packageDuplicate: {
            lessonId: 'les_dup_1',
            lessonTitle: '【样例】OpenLearn 预设组件全览',
            importedAt: Date.now(),
            packageKey: 'sha256:abc',
            hasDeclaredId: false,
          },
        })}
      />,
    );
    // 幂等命中不是「故障」：必须给出确认态 + 显式出口，而不是普通报错
    expect(screen.getByTestId('course-package-duplicate-notice')).toBeTruthy();
    expect(screen.getByTestId('course-package-duplicate-force')).toBeTruthy();
    expect(screen.getByTestId('course-package-duplicate-cancel')).toBeTruthy();
    expect(screen.queryByText('Import or Parsing Error')).toBeNull();
  });

  it('shows the ordinary error panel when there is no duplicate conflict', () => {
    render(<ImportLessonsModal {...makeProps({ importStatus: 'error', importErrorMsg: '坏了' })} />);
    expect(screen.getByText('Import or Parsing Error')).toBeTruthy();
    expect(screen.queryByTestId('course-package-duplicate-notice')).toBeNull();
  });

  it('shows the course package preview instead of the CSV table when a package is selected', () => {
    render(
      <ImportLessonsModal
        {...makeProps({
          importStatus: 'parsing',
          packagePreview: {
            fileName: 'openlearn-course-template.json',
            title: '【样例】OpenLearn 预设组件全览',
            metaName: 'OpenLearn 预设组件全览 · 测试样例课',
            segments: 5,
            elements: 14,
            assets: 2,
            componentTypes: ['presentation', 'quiz'],
          },
        })}
      />,
    );
    expect(screen.getByTestId('course-package-preview')).toBeTruthy();
    expect(screen.getByTestId('import-course-package-btn')).toBeTruthy();
    expect(screen.getByText('【样例】OpenLearn 预设组件全览')).toBeTruthy();
  });
});
