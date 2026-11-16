// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClassroomSessionLifecycleSettingsPanel } from '../ClassroomSessionLifecycleSettingsPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ClassroomSessionLifecycleSettingsPanel', () => {
  it('loads the current threshold and saves hours through the admin API', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/classroom/session-lifecycle-settings' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body || '{}'));
        return {
          ok: true,
          json: async () => ({ success: true, autoArchiveAfterMs: body.autoArchiveAfterMs }),
        };
      }
      return {
        ok: true,
        json: async () => ({ success: true, autoArchiveAfterMs: 24 * 60 * 60 * 1000 }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<ClassroomSessionLifecycleSettingsPanel lang="zh" />);
    await waitFor(() => expect(screen.getByTestId('auto-archive-hours-input')).toHaveProperty('value', '24'));
    fireEvent.change(screen.getByTestId('auto-archive-hours-input'), { target: { value: '48' } });
    fireEvent.click(screen.getByRole('button', { name: '保存归档阈值' }));
    await waitFor(() => expect(screen.getByText('课次自动归档阈值已保存')).toBeTruthy());
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
    expect(putCall).toBeTruthy();
    expect(JSON.parse(String((putCall?.[1] as RequestInit).body))).toEqual({
      autoArchiveAfterMs: 48 * 60 * 60 * 1000,
    });
  });
});
