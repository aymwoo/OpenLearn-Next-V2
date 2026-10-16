import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AcademicYearProvider, useAcademicYear } from '../AcademicYearContext';

function Probe() {
  const { currentAcademicYear, loading } = useAcademicYear();
  return <div>{loading ? 'loading' : (currentAcademicYear ?? 'none')}</div>;
}

describe('AcademicYearContext', () => {
  it('renders provider and resolves', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ currentAcademicYear: '2025-2026', academicStartMonth: 9 }),
    }));
    render(
      <AcademicYearProvider>
        <Probe />
      </AcademicYearProvider>,
    );
    // allow async
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText('2025-2026')).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
