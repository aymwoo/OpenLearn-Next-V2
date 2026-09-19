import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GlobalErrorBoundary } from '../GlobalErrorBoundary';
import { errorStore } from '../../../store/errorStore';
import * as clipboardModule from '../../../utils/clipboard';

const ProblemChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Explosive component crash');
  }
  return <div>Healthy Component</div>;
};

describe('GlobalErrorBoundary', () => {
  let copySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorStore.getState().clearErrors();
    copySpy = vi.spyOn(clipboardModule, 'copyToClipboard').mockResolvedValue(true);
    // Suppress console.error in tests for intentional throw
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders children normally when there is no error', () => {
    render(
      <GlobalErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </GlobalErrorBoundary>,
    );

    expect(screen.getByText('Healthy Component')).toBeTruthy();
  });

  it('catches render error, records into errorStore, and renders fallback UI', () => {
    render(
      <GlobalErrorBoundary fallbackTitle="单元测试捕获异常">
        <ProblemChild shouldThrow={true} />
      </GlobalErrorBoundary>,
    );

    // Should render friendly error card
    expect(screen.getByText('单元测试捕获异常')).toBeTruthy();
    expect(screen.getByText(/Explosive component crash/)).toBeTruthy();

    // Check error store
    const errors = errorStore.getState().errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('react');
    expect(errors[0].message).toContain('Explosive component crash');
  });

  it('copies error report to clipboard when copy button is clicked', async () => {
    render(
      <GlobalErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </GlobalErrorBoundary>,
    );

    const copyBtn = screen.getByRole('button', { name: /一键复制错误报告/ });
    expect(copyBtn).toBeTruthy();

    fireEvent.click(copyBtn);

    expect(copySpy).toHaveBeenCalledWith(expect.stringContaining('Explosive component crash'));
  });
});
