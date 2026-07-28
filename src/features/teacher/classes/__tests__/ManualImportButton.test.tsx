import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ManualImportButton } from '../ManualImportButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeProps(overrides: Partial<ReturnType<typeof baseProps>> = {}) {
  const base = baseProps();
  return { ...base, ...overrides };
}

function baseProps() {
  return {
    lang: 'zh' as 'zh' | 'en',
    setImportError: vi.fn(),
    setImportSuccess: vi.fn(),
    setShowImportModal: vi.fn(),
  };
}

describe('ManualImportButton', () => {
  it('renders the zh label when lang is zh', () => {
    render(<ManualImportButton {...makeProps()} />);
    expect(screen.getByText('手动导入数据')).toBeTruthy();
  });

  it('renders the en label when lang is en', () => {
    render(<ManualImportButton {...makeProps({ lang: 'en' })} />);
    expect(screen.getByText('Manual Import')).toBeTruthy();
  });

  it('calls the setters and opens the modal on click', () => {
    const props = makeProps();
    render(<ManualImportButton {...props} />);
    fireEvent.click(screen.getByRole('button'));
    expect(props.setImportError).toHaveBeenCalledWith(null);
    expect(props.setImportSuccess).toHaveBeenCalledWith(null);
    expect(props.setShowImportModal).toHaveBeenCalledWith(true);
  });
});
