import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileModal } from '../ProfileModal';
import type { SessionType } from '../../types/app';

describe('ProfileModal AI Provider Isolation & Settings UI', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const teacherSession: SessionType = {
    role: 'teacher',
    userId: 'teacher_1',
    name: 'Teacher One',
    subRole: 'teacher',
  };

  const studentSession: SessionType = {
    role: 'student',
    studentId: 'student_1',
    name: 'Student One',
  };

  it('does not display AI Provider tab for student session', () => {
    render(<ProfileModal open={true} session={studentSession} lang="zh" onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByText('个人资料')).toBeTruthy();
    expect(screen.queryByText('AI 模型设置')).toBeNull();
  });

  it('displays tab switcher and allows navigating to AI Providers tab for teacher', async () => {
    // Mock /api/ai-providers fetch
    const mockProviders = [
      {
        id: 'prov_shared',
        name: 'Shared DeepSeek',
        api_url: 'https://api.deepseek.com/v1',
        model_name: 'deepseek-chat',
        api_key: '****',
        owner_id: 'admin_1',
        is_shared: 1,
      },
      {
        id: 'prov_teacher_priv',
        name: 'My Private Minimax',
        api_url: 'https://api.minimax.chat/v1',
        model_name: 'abab6.5',
        api_key: '****',
        owner_id: 'teacher_1',
        is_shared: 0,
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : 'url' in input ? input.url : input.toString();
      if (url === '/api/ai-providers') {
        return new Response(JSON.stringify(mockProviders), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    render(<ProfileModal open={true} session={teacherSession} lang="zh" onClose={vi.fn()} onSaved={vi.fn()} />);

    // Both tabs should be visible
    expect(screen.getByRole('button', { name: /个人资料/ })).toBeTruthy();
    const aiTabButton = screen.getByRole('button', { name: /AI 模型设置/ });
    expect(aiTabButton).toBeTruthy();

    // Click on AI Providers tab
    fireEvent.click(aiTabButton);

    // Should render AI Providers list
    await waitFor(() => {
      expect(screen.getByText('Shared DeepSeek')).toBeTruthy();
      expect(screen.getByText('My Private Minimax')).toBeTruthy();
    });

    // Verify badges
    expect(screen.getByText('平台共享')).toBeTruthy();
    expect(screen.getByText('个人私有')).toBeTruthy();

    // Verify that teacher cannot edit/delete shared provider, but can edit own private provider
    const editButtons = screen.getAllByRole('button', { name: '编辑' });
    expect(editButtons.length).toBe(2);
    // First provider is shared: teacher is not admin -> disabled
    expect((editButtons[0] as HTMLButtonElement).disabled).toBe(true);
    // Second provider is owned by teacher_1 -> enabled
    expect((editButtons[1] as HTMLButtonElement).disabled).toBe(false);
  });
});
