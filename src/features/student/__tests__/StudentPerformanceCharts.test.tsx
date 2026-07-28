import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StudentPerformanceCharts } from '../StudentPerformanceCharts';

afterEach(() => {
  cleanup();
});

describe('StudentPerformanceCharts', () => {
  it('renders without throwing', () => {
    const { container } = render(
      <StudentPerformanceCharts assignments={[{ id: 'a1' }]} lang="zh" />
    );
    expect(container.querySelector('div')).toBeTruthy();
  });
});
