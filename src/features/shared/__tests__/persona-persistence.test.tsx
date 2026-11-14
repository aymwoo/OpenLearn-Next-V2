import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightSidebar } from '../RightSidebar';
import { AGENT_PERSONA_STORAGE_KEY } from '../../../hooks/useAgentChat';
import { AiPersonasSection } from '../../admin/AiPersonasSection';

describe('IKVA8R · 前端 Persona 持久化、defaultForRole 与后台 CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('RightSidebar 持久化选择的 personaId 至 localStorage，并在无缓存时按 defaultForRole 兜底', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/agent/personas') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            defaultPersonaId: 'teacher_default_bot',
            personas: [
              { id: 'plain_assistant', nameZh: '普通助教', nameEn: 'Plain', source: 'builtin' },
              {
                id: 'teacher_default_bot',
                nameZh: '教师默认助教',
                nameEn: 'Teacher Default',
                source: 'admin',
                defaultForRole: ['teacher'],
              },
              { id: 'socratic_questioner', nameZh: '苏格拉底追问者', nameEn: 'Socratic', source: 'builtin' },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    function Wrapper() {
      const [personaId, setPersonaId] = useState<string>(() => localStorage.getItem(AGENT_PERSONA_STORAGE_KEY) || '');
      const updatePersonaId = (id: string) => {
        setPersonaId(id);
        if (id) localStorage.setItem(AGENT_PERSONA_STORAGE_KEY, id);
        else localStorage.removeItem(AGENT_PERSONA_STORAGE_KEY);
      };
      return (
        <RightSidebar
          showRightSidebar={true}
          rightSidebarTab="agent"
          personaId={personaId}
          setPersonaId={updatePersonaId}
          aiProviders={[{ id: 'p1', name: 'DeepSeek', model_name: 'ds' }]}
          selectedAgentProvider={{ id: 'p1', name: 'DeepSeek', model_name: 'ds' }}
          chatLog={[]}
          lang="zh"
          t={{}}
        />
      );
    }

    render(<Wrapper />);

    const select = (await screen.findByLabelText('选择 AI 助教角色')) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('teacher_default_bot'));
    expect(localStorage.getItem(AGENT_PERSONA_STORAGE_KEY)).toBe('teacher_default_bot');

    fireEvent.change(select, { target: { value: 'socratic_questioner' } });
    expect(select.value).toBe('socratic_questioner');
    expect(localStorage.getItem(AGENT_PERSONA_STORAGE_KEY)).toBe('socratic_questioner');

    // 重新挂载时保留用户上次选择
    cleanup();
    render(<Wrapper />);
    const remountSelect = (await screen.findByLabelText('选择 AI 助教角色')) as HTMLSelectElement;
    await waitFor(() => expect(remountSelect.value).toBe('socratic_questioner'));
  });

  it('AiPersonasSection 渲染角色表并支持新建与删除自定义角色模板', async () => {
    let serverPersonas = [
      {
        id: 'plain_assistant',
        nameZh: '普通助教',
        nameEn: 'Plain Assistant',
        instructionZh: '',
        instructionEn: '',
        source: 'builtin',
        mode: 'overlay',
        basePolicy: 'inherit',
      },
    ];

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/agent/personas?scope=all' && (!init?.method || init.method === 'GET')) {
        return { ok: true, json: async () => ({ success: true, personas: serverPersonas }) } as Response;
      }
      if (url === '/api/agent/personas' && init?.method === 'POST') {
        const created = { ...JSON.parse(String(init.body)), source: 'admin' };
        serverPersonas = [...serverPersonas, created];
        return { ok: true, status: 201, json: async () => ({ success: true, persona: created }) } as Response;
      }
      if (url === '/api/agent/personas/custom_bot' && init?.method === 'DELETE') {
        serverPersonas = serverPersonas.filter((p) => p.id !== 'custom_bot');
        return { ok: true, json: async () => ({ success: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({ success: false }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AiPersonasSection lang="zh" />);
    await screen.findByText('普通助教');

    fireEvent.click(screen.getByRole('button', { name: /新建角色模板/i }));

    fireEvent.change(screen.getByLabelText(/唯一 ID/i), { target: { value: 'custom_bot' } });
    fireEvent.change(screen.getByLabelText(/中文名称/i), { target: { value: '物理导师' } });
    fireEvent.change(screen.getByLabelText(/英文名称/i), { target: { value: 'Physics Tutor' } });
    fireEvent.change(screen.getByLabelText(/中文系统指令/i), { target: { value: '只围绕物理建模提问' } });
    fireEvent.change(screen.getByLabelText(/英文系统指令/i), { target: { value: 'Focus on physics modeling' } });

    fireEvent.click(screen.getByRole('button', { name: /保存角色模板/i }));

    await screen.findByText('物理导师');
    const delBtn = screen.getByRole('button', { name: /删除角色模板 物理导师 \(custom_bot\)/i });
    fireEvent.click(delBtn);

    await waitFor(() => expect(screen.queryByText('物理导师')).toBeNull());
  });
});
