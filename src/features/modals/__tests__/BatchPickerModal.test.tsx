import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BatchPickerModal, type BatchPickerModalProps } from '../BatchPickerModal';

afterEach(() => cleanup());

function makeProps(overrides: Partial<BatchPickerModalProps> = {}): BatchPickerModalProps {
  return {
    batchPicker: 'schedule',
    setBatchPicker: vi.fn(),
    batchPickerLesson: '',
    setBatchPickerLesson: vi.fn(),
    batchPickerDate: '',
    setBatchPickerDate: vi.fn(),
    batchPickerTargetClass: '',
    setBatchPickerTargetClass: vi.fn(),
    lessons: [],
    classes: [],
    expandedClassId: null,
    confirmBatchPicker: vi.fn(),
    lang: 'en',
    ...overrides,
  };
}

describe('BatchPickerModal', () => {
  it('renders the modal header when open (zh)', () => {
    render(<BatchPickerModal {...makeProps({ lang: 'zh', batchPicker: 'schedule' })} />);
    expect(screen.getByText('批量排课')).toBeTruthy();
  });

  it('renders the modal header when open (en)', () => {
    render(<BatchPickerModal {...makeProps({ lang: 'en', batchPicker: 'schedule' })} />);
    expect(screen.getByText('Batch Schedule')).toBeTruthy();
  });

  it('does not render the modal when closed', () => {
    render(<BatchPickerModal {...makeProps({ batchPicker: null })} />);
    expect(screen.queryByText('批量排课')).toBeNull();
    expect(screen.queryByText('Batch Schedule')).toBeNull();
  });
});
