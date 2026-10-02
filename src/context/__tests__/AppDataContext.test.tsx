/**
 * C1-R3: AppDataContext 冒烟测试。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { AppDataProvider, useAppData } from '../AppDataContext';

describe('AppDataContext', () => {
  it('无 Provider 时 useAppData 抛错（防漏接）', () => {
    function Probe() {
      useAppData();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/must be used within <AppDataProvider>/);
  });

  it('有 Provider 时可取值', () => {
    function Probe() {
      const data = useAppData() as Record<string, unknown>;
      return <span data-testid="v">{String(data.marker)}</span>;
    }
    render(
      <AppDataProvider value={{ marker: 'ok' } as any}>
        <Probe />
      </AppDataProvider>,
    );
    expect(screen.getByTestId('v').textContent).toBe('ok');
  });
});
