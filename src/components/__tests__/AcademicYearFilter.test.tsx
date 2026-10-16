import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AcademicYearFilter } from '../AcademicYearFilter';

describe('AcademicYearFilter', () => {
  it('renders options and calls onChange (zh)', () => {
    const onChange = vi.fn();
    render(
      <AcademicYearFilter value="all" options={['2025-2026', '2024-2025']} onChange={onChange} lang="zh" />,
    );
    expect(screen.getByText('全部学年')).toBeTruthy();
    expect(screen.getByText('2025-2026')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('学年筛选'), { target: { value: '2024-2025' } });
    expect(onChange).toHaveBeenCalledWith('2024-2025');
  });

  it('can hide the all option (en)', () => {
    render(<AcademicYearFilter value="2025-2026" options={['2025-2026']} onChange={() => {}} lang="en" includeAll={false} />);
    expect(screen.queryByText('All academic years')).toBeNull();
  });
});
